import {cfRequest,CF_ACCOUNT_ID,fail} from './production-acceptance-lib.mjs';
const worker='maono-ticket-notifications';
const path=`/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${worker}/tails`;
const check=(ok,code)=>{if(!ok)fail(code,'Prova de disparo OFF não confirmada; consumer ON bloqueado.');};
export const CC07_RECEIPT_MAX_AGE_MS=120000;
export function offReceiptFromTrace(trace,plan,{since,now}){
 if(!trace||trace.scriptName!==worker||!Number.isSafeInteger(trace.event?.scheduledTime)||trace.event.scheduledTime<since)return null;
 check(trace.event.cron===plan.worker.cron&&trace.event.scheduledTime<=now,'CC07_CRON_EVENT_INVALID');
 check(trace.outcome==='ok'&&Array.isArray(trace.exceptions)&&trace.exceptions.length===0,'CC07_CRON_HANDLER_FAILED');
 check(Array.isArray(trace.logs)&&trace.logs.length<=100,'CC07_CRON_RECEIPT_INVALID');
 const receipts=[];
 for(const log of trace.logs)for(const message of Array.isArray(log.message)?log.message:[]){
  if(typeof message!=='string'||message.length>2048)continue;
  try{const value=JSON.parse(message);if(value.event==='ticket.notifications.off-ready')receipts.push(value);}catch{/* Never retain raw logs. */}
 }
 check(receipts.length===1,'CC07_CRON_RECEIPT_MISSING');const r=receipts[0];
 check(Object.keys(r).length===9&&r.schemaVersion===1&&r.versionId===plan.worker.offVersion&&r.runId===plan.policy.runId&&r.organizationId===plan.organizationId&&
  r.scheduledTime===trace.event.scheduledTime&&r.cron===plan.worker.cron&&r.consumerEnabled===false&&r.claimed===0,'CC07_CRON_RECEIPT_INVALID');
 return {versionId:r.versionId,runId:r.runId,scheduledAt:new Date(r.scheduledTime).toISOString(),observedAt:new Date(now).toISOString(),consumerOff:true,claimed:0};
}
export function assertFreshOffReceipt(receipt,plan,{since,now}){
 check(receipt?.versionId===plan.worker.offVersion&&receipt.runId===plan.policy.runId&&receipt.consumerOff===true&&receipt.claimed===0&&
  Date.parse(receipt.scheduledAt)>=since&&Date.parse(receipt.scheduledAt)<=now&&now-Date.parse(receipt.scheduledAt)<=CC07_RECEIPT_MAX_AGE_MS,'CC07_CRON_RECEIPT_EXPIRED');
 return receipt;
}
// Ephemeral Cloudflare Tail, using the existing Individual Workers Editor token.
// No persistent logging, extra credential, tail consumer Worker or raw log artifact.
export function createCc07Readiness(token,plan,deps={}){
 const now=deps.now||Date.now,budget=deps.budget,fetchImpl=deps.fetchImpl||fetch,Socket=deps.WebSocketImpl||WebSocket;
 let socket=null,tailId=null,expiry=0,created=false,createUncertain=false,deleted=false,closed=false,connected=false,error=null,latest=null,since=Infinity;
 const summary=()=>({sessionId:tailId,connected,created,deleted,createUncertain,expiresAt:Number.isFinite(expiry)&&expiry?new Date(expiry).toISOString():null});
 const setFailure=code=>{error??=code;};
 const poll=()=>{check(!error,error||'CC07_TAIL_FAILED');check(connected&&!closed&&now()<expiry,'CC07_TAIL_UNAVAILABLE');return latest;};
 const close=async()=>{
  closed=true;try{socket?.close();}catch{/* Continue provider cleanup. */}
  if(tailId&&!deleted){
   let response,envelope;
   try{response=await fetchImpl(`https://api.cloudflare.com${path}/${tailId}`,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(budget?budget.requestTimeoutMs(30000):30000),headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});envelope=await response.json();}
   catch{fail('CC07_TAIL_CLEANUP_UNCONFIRMED','Encerramento da sessão temporária não confirmado.');}
   check(response.ok&&envelope?.success===true,'CC07_TAIL_CLEANUP_UNCONFIRMED');deleted=true;
  }
  check(!createUncertain,'CC07_TAIL_CREATE_UNCONFIRMED');return summary();
 };
 return {summary,close,
  resetSince(value){since=value;latest=null;},
  receipt(){return poll();},
  async start(){
   check(!created&&!createUncertain,'CC07_TAIL_ALREADY_STARTED');createUncertain=true;
   let record;try{record=await cfRequest(token,path,{...deps,method:'POST',body:{filters:[]}});}catch(cause){
    if(cause.code==='CLOUDFLARE_API_FAILED'&&/HTTP (401|403)/.test(cause.message)){createUncertain=false;fail('CC07_TAIL_ACCESS_DENIED','Acesso à sessão temporária negado; não ampliar permissões automaticamente.');}
    fail('CC07_TAIL_CREATE_UNCONFIRMED','Sessão temporária não confirmada; não repetir criação automaticamente.');
   }
   check(/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(record?.id||''),'CC07_TAIL_RESPONSE_INVALID');tailId=record.id;created=true;createUncertain=false;
   expiry=Date.parse(record.expires_at);
   // Non-secret resource ID only, never the websocket URL or raw API response.
   await deps.onSessionCreated?.(summary());
   check(Number.isFinite(expiry)&&expiry>now()+plan.readiness.waitSeconds*1000&&expiry<=now()+86400000,'CC07_TAIL_EXPIRY_INVALID');
   let url;try{url=new URL(record.url);}catch{fail('CC07_TAIL_URL_INVALID','Origem do canal temporário não confirmada.');}
   check(url.protocol==='wss:'&&url.hostname==='tail.developers.workers.dev'&&!url.port&&!url.username&&!url.password&&!url.hash,'CC07_TAIL_URL_INVALID');
   try{socket=new Socket(url.toString(),'trace-v1');socket.binaryType='arraybuffer';}catch{fail('CC07_TAIL_CONNECT_FAILED','Canal temporário indisponível.');}
   socket.addEventListener('message',event=>{
    if(closed)return;
    try{let data=event.data;
     if(data instanceof ArrayBuffer){check(data.byteLength<=65536,'CC07_TAIL_FRAME_INVALID');data=new TextDecoder('utf-8',{fatal:true}).decode(data);}
     check(typeof data==='string'&&data.length<=65536,'CC07_TAIL_FRAME_INVALID');
     const receipt=offReceiptFromTrace(JSON.parse(data),plan,{since,now:now()});if(receipt)latest=receipt;
    }catch(cause){setFailure(typeof cause.code==='string'&&cause.code.startsWith('CC07_')?cause.code:'CC07_TAIL_FRAME_INVALID');}
   });
   socket.addEventListener('error',()=>setFailure('CC07_TAIL_DISCONNECTED'));
   socket.addEventListener('close',()=>{if(!closed)setFailure('CC07_TAIL_DISCONNECTED');});
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('timeout')),budget?budget.requestTimeoutMs(30000):30000);
    socket.addEventListener('open',()=>{try{socket.send(JSON.stringify({debug:false}));connected=true;clearTimeout(timer);resolve();}catch{clearTimeout(timer);reject(Error('connect'));}},{once:true});
    socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('connect'));},{once:true});
   }).catch(()=>fail('CC07_TAIL_CONNECT_FAILED','Canal temporário indisponível.'));
  }
 };
}
