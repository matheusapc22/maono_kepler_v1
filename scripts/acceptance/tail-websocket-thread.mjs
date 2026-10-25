import {parentPort,workerData} from 'node:worker_threads';

// Internal transport only: no provider token, fetch, filesystem or production
// actions. The parent has already validated the ephemeral websocket origin.
const socket=new WebSocket(workerData.url,workerData.protocol);
socket.binaryType='arraybuffer';
socket.addEventListener('open',()=>parentPort.postMessage({type:'open'}));
socket.addEventListener('message',event=>parentPort.postMessage({type:'message',data:event.data}));
socket.addEventListener('error',()=>parentPort.postMessage({type:'error'}));
socket.addEventListener('close',()=>{parentPort.postMessage({type:'close'});parentPort.close();});
parentPort.on('message',message=>{
 try{
  if(message.type==='send')socket.send(message.data);
  if(message.type==='close')socket.close();
 }catch{parentPort.postMessage({type:'error'});}
});
