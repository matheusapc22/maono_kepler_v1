import {Worker} from 'node:worker_threads';

// Native WebSocket.close() has no public abort/terminate primitive. Keep only
// the ephemeral transport in an isolated thread; provider cleanup and evidence
// remain in the operator. Never force-exit the operator or inherit its secrets.
export const TAIL_SOCKET_CLOSE_GRACE_MS=1000;
export class TailWebSocket extends EventTarget {
 #worker;#exited;#resolveExit;#closing=false;#disposal;#closed=false;
 readyState=0;
 binaryType='arraybuffer';
 constructor(url,protocol){
  super();
  this.#exited=new Promise(resolve=>{this.#resolveExit=resolve;});
  this.#worker=new Worker(new URL('./tail-websocket-thread.mjs',import.meta.url),{
   workerData:{url:String(url),protocol},env:{},execArgv:[],stdout:true,stderr:true,
  });
  // No raw trace, signed URL, environment or transport error leaves this layer.
  this.#worker.stdout.resume();this.#worker.stderr.resume();
  this.#worker.on('message',message=>{
   if(message.type==='open'&&!this.#closing){this.readyState=1;this.dispatchEvent(new Event('open'));}
   if(message.type==='message'&&!this.#closing)this.dispatchEvent(new MessageEvent('message',{data:message.data}));
   if(message.type==='error'&&!this.#closing)this.dispatchEvent(new Event('error'));
   if(message.type==='close')this.#onClose();
  });
  this.#worker.on('error',()=>{if(!this.#closing)this.dispatchEvent(new Event('error'));});
  this.#worker.on('exit',()=>{this.#resolveExit();this.#onClose();});
 }
 #onClose(){
  this.readyState=3;
  if(!this.#closed){this.#closed=true;this.dispatchEvent(new Event('close'));}
 }
 send(data){
  if(this.readyState!==1||this.#closing)throw Error('TAIL_SOCKET_NOT_OPEN');
  this.#worker.postMessage({type:'send',data});
 }
 close(){
  if(this.#closing)return;
  this.#closing=true;
  if(this.readyState!==3){this.readyState=2;this.#worker.postMessage({type:'close'});}
 }
 dispose(timeoutMs=TAIL_SOCKET_CLOSE_GRACE_MS){
  if(this.#disposal)return this.#disposal;
  this.#disposal=(async()=>{
   let timer,onClose;
   const graceful=new Promise(resolve=>{
    onClose=()=>resolve(true);
    this.addEventListener('close',onClose,{once:true});
    timer=setTimeout(()=>resolve(false),Math.max(1,Math.min(timeoutMs,TAIL_SOCKET_CLOSE_GRACE_MS)));
   });
   let acknowledged;
   try{this.close();acknowledged=this.#closed||await graceful;}
   finally{clearTimeout(timer);this.removeEventListener('close',onClose);}
   // Terminate only this thread, after the close handshake or bounded grace.
   // Await actual exit so no live socket or worker can outlast the final report.
   await this.#worker.terminate();await this.#exited;
   return {closed:true,terminated:!acknowledged};
  })();
  return this.#disposal;
 }
}
