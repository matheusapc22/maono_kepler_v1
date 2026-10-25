import test from 'node:test';
import assert from 'node:assert/strict';
import {offReceiptFromTrace,assertFreshOffReceipt,createCc07Readiness} from '../scripts/acceptance/cc07-readiness.mjs';
import worker from '../workers/ticket-notifications.js';
const now=Date.now(),p={organizationId:1,readiness:{waitSeconds:60},worker:{offVersion:'11111111-1111-4111-8111-111111111111',cron:'* * * * *'},policy:{runId:'33333333-3333-4333-8333-333333333333',organizationId:1,managerId:1,startAt:new Date(now-60000).toISOString(),endAt:new Date(now+209*60000).toISOString(),maxEvents:3,maxAttempts:6,batchSize:1}};
const receipt=()=>({event:'ticket.notifications.off-ready',schemaVersion:1,versionId:p.worker.offVersion,runId:p.policy.runId,organizationId:1,scheduledTime:now,cron:p.worker.cron,consumerEnabled:false,claimed:0});
const trace=r=>({scriptName:'maono-ticket-notifications',event:{cron:p.worker.cron,scheduledTime:now},outcome:'ok',exceptions:[],logs:[{message:[JSON.stringify(r||receipt())]}]});
test('readiness accepts only a completed scheduled OFF invocation and bounds proof freshness',()=>{
 const result=offReceiptFromTrace(trace(),p,{since:now-100,now});assert.equal(result.consumerOff,true);
 assertFreshOffReceipt(result,p,{since:now-100,now:now+120000});assert.throws(()=>assertFreshOffReceipt(result,p,{since:now-100,now:now+120001}),{code:'CC07_CRON_RECEIPT_EXPIRED'});
 assert.equal(offReceiptFromTrace({...trace(),scriptName:'other'},p,{since:now-100,now}),null);
 assert.equal(offReceiptFromTrace(trace(),p,{since:now+1,now:now+2}),null);
});
for(const key of ['versionId','runId','organizationId','cron','consumerEnabled','claimed','schemaVersion','scheduledTime'])test(`readiness refuses incorrect ${key}`,()=>{
 const r=receipt();r[key]=key==='claimed'?1:'foreign';assert.throws(()=>offReceiptFromTrace(trace(r),p,{since:now-100,now}),{code:'CC07_CRON_RECEIPT_INVALID'});
});
test('failed handler, missing receipt, extra receipt and future schedule are distinct failures',()=>{
 for(const [change,code]of [[x=>{x.outcome='exception';},'CC07_CRON_HANDLER_FAILED'],[x=>{x.exceptions=[{message:'private-canary'}];},'CC07_CRON_HANDLER_FAILED'],[x=>{x.logs=[];},'CC07_CRON_RECEIPT_MISSING'],[x=>{x.logs.push(x.logs[0]);},'CC07_CRON_RECEIPT_MISSING'],[x=>{x.event.scheduledTime=now+1;},'CC07_CRON_EVENT_INVALID']]){
  const x=trace();change(x);assert.throws(()=>offReceiptFromTrace(x,p,{since:now-100,now}),e=>e.code===code&&!e.message.includes('private-canary'));
 }
});
test('actual Worker OFF scheduled handler emits version-bound proof without touching D1',async()=>{
 const logs=[],promises=[],original=console.log;console.log=x=>logs.push(x);
 try{await worker.scheduled({cron:p.worker.cron,scheduledTime:now},{CF_VERSION_METADATA:{id:p.worker.offVersion},MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:'false',MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON:JSON.stringify(p.policy),MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:'1',MAONO_TICKET_NOTIFICATION_START_AT:p.policy.startAt,DB:{prepare(){assert.fail('OFF must not read/write D1');}}},{waitUntil:x=>promises.push(x)});await Promise.all(promises);}finally{console.log=original;}
 assert.equal(logs.length,1);assert.deepEqual(JSON.parse(logs[0]),receipt());
});
function transport({status=200,invalidUrl=false,removeFailure=false,uncertain=false,expiresAt=new Date(now+3600000).toISOString(),onSessionCreated}={}){
 const calls=[];let socket;
 class Socket extends EventTarget{constructor(url,protocol){super();assert.equal(protocol,'trace-v1');assert.match(url,/^wss:\/\/tail\.developers\.workers\.dev\//);socket=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}send(value){assert.deepEqual(JSON.parse(value),{debug:false});}close(){this.dispatchEvent(new Event('close'));}message(value){this.dispatchEvent(new MessageEvent('message',{data:value}));}}
 const fetchImpl=async(url,o)=>{calls.push(o.method);assert.match(String(url),/\/workers\/scripts\/maono-ticket-notifications\/tails/);if(uncertain)throw Error('private-canary');if(o.method==='DELETE')return Response.json({success:!removeFailure},{status:removeFailure?403:200});return Response.json({success:status===200,result:{id:'a'.repeat(32),expires_at:expiresAt,url:invalidUrl?'wss://example.invalid/secret':'wss://tail.developers.workers.dev/ephemeral'}},{status});};
 const observer=createCc07Readiness('fixture-only',p,{fetchImpl,WebSocketImpl:Socket,now:()=>now,onSessionCreated});return {observer,calls,socket:()=>socket};
}
test('ephemeral tail opens trace-v1, accepts proof, deletes with success-only API envelope',async()=>{
 const f=transport();await f.observer.start();f.observer.resetSince(now-100);f.socket().message(JSON.stringify(trace()));assert.equal(f.observer.receipt().claimed,0);
 assert.equal((await f.observer.close()).deleted,true);assert.deepEqual(f.calls,['POST','DELETE']);
});
for(const failure of ['disconnect','frame','handler'])test(`tail ${failure} is fail-closed and still removable`,async()=>{
 const f=transport();await f.observer.start();f.observer.resetSince(now-100);
 if(failure==='disconnect')f.socket().dispatchEvent(new Event('close'));else f.socket().message(failure==='frame'?'invalid JSON':JSON.stringify({...trace(),outcome:'exception'}));
 assert.throws(()=>f.observer.receipt());assert.equal((await f.observer.close()).deleted,true);
});
test('denied access and uncertain creation never retry or silently broaden the token',async()=>{
 const denied=transport({status:403});await assert.rejects(()=>denied.observer.start(),{code:'CC07_TAIL_ACCESS_DENIED'});await denied.observer.close();assert.deepEqual(denied.calls,['POST']);
 const uncertain=transport({uncertain:true});await assert.rejects(()=>uncertain.observer.start(),{code:'CC07_TAIL_CREATE_UNCONFIRMED'});await assert.rejects(()=>uncertain.observer.start(),{code:'CC07_TAIL_ALREADY_STARTED'});await assert.rejects(()=>uncertain.observer.close(),{code:'CC07_TAIL_CREATE_UNCONFIRMED'});assert.deepEqual(uncertain.calls,['POST']);
});
test('invalid websocket destination is never contacted, but created tail is removed',async()=>{
 const f=transport({invalidUrl:true});await assert.rejects(()=>f.observer.start(),{code:'CC07_TAIL_URL_INVALID'});assert.equal(f.socket(),undefined);await f.observer.close();assert.deepEqual(f.calls,['POST','DELETE']);
});
test('tail deletion failure is explicit, without credential or provider error exposure',async()=>{
 const f=transport({removeFailure:true});await f.observer.start();await assert.rejects(()=>f.observer.close(),{code:'CC07_TAIL_CLEANUP_UNCONFIRMED'});
});
test('binary trace frames are bounded and proof remains invalid after a new OFF transition',async()=>{
 const f=transport();await f.observer.start();f.observer.resetSince(now-1);
 f.socket().message(new TextEncoder().encode(JSON.stringify(trace())).buffer);assert.equal(f.observer.receipt().consumerOff,true);
 f.observer.resetSince(now+1);assert.equal(f.observer.receipt(),null);f.socket().message(JSON.stringify(trace()));assert.equal(f.observer.receipt(),null);
 f.socket().message(new ArrayBuffer(65537));assert.throws(()=>f.observer.receipt(),{code:'CC07_TAIL_FRAME_INVALID'});await f.observer.close();
});
test('session checkpoint contains only safe metadata and failure still permits cleanup',async()=>{
 let checkpoint;const f=transport({onSessionCreated:value=>{checkpoint=value;throw Error('checkpoint unavailable');}});
 await assert.rejects(()=>f.observer.start(),/checkpoint unavailable/);assert.equal(checkpoint.sessionId,'a'.repeat(32));
 assert.ok(!JSON.stringify(checkpoint).includes('wss:'));assert.equal(f.socket(),undefined);await f.observer.close();assert.deepEqual(f.calls,['POST','DELETE']);
});
for(const expiresAt of ['invalid',new Date(now+30000).toISOString(),new Date(now+86400001).toISOString()])test(`tail rejects unbounded or insufficient expiry ${expiresAt}`,async()=>{
 const f=transport({expiresAt});await assert.rejects(()=>f.observer.start(),{code:'CC07_TAIL_EXPIRY_INVALID'});await f.observer.close();assert.equal(f.socket(),undefined);
});

test('concurrent first close and later close share one confirmed cleanup result',async()=>{
 const f=transport();await f.observer.start();
 const first=f.observer.close(),second=f.observer.close();assert.equal(first,second);
 assert.equal((await first).transportClosed,true);assert.equal(await f.observer.close(),await second);
 assert.deepEqual(f.calls,['POST','DELETE']);
});
test('closing before start never allows later remote creation',async()=>{
 const f=transport();assert.equal((await f.observer.close()).transportClosed,true);
 await assert.rejects(()=>f.observer.start(),{code:'CC07_TAIL_ALREADY_STARTED'});assert.deepEqual(f.calls,[]);
});
test('transport disposal failure cannot prevent provider deletion or be reported as closed',async()=>{
 const f=transport();await f.observer.start();f.socket().dispose=async()=>{throw Error('private-transport-canary');};
 await assert.rejects(()=>f.observer.close(),e=>e.code==='CC07_TAIL_TRANSPORT_CLEANUP_UNCONFIRMED'&&!e.message.includes('private-transport-canary'));
 assert.deepEqual(f.calls,['POST','DELETE']);assert.equal(f.observer.summary().deleted,true);assert.equal(f.observer.summary().transportClosed,false);
 await assert.rejects(()=>f.observer.close());assert.deepEqual(f.calls,['POST','DELETE']);
});
test('expired budget still releases transport but does not start a provider request',async()=>{
 let expired=false,disposed=false;const calls=[];
 class Socket extends EventTarget{constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('open')));}send(){}async dispose(timeout){assert.equal(timeout,1);disposed=true;return {closed:true,terminated:true};}}
 const observer=createCc07Readiness('fixture',p,{now:()=>now,WebSocketImpl:Socket,budget:{assertActive(){},requestTimeoutMs:ms=>{if(expired)throw Error('expired');return ms;}},fetchImpl:async(_url,o)=>{calls.push(o.method);return Response.json({success:true,result:{id:'a'.repeat(32),expires_at:new Date(now+3600000).toISOString(),url:'wss://tail.developers.workers.dev/fixture'}});}});
 await observer.start();expired=true;await assert.rejects(()=>observer.close(),{code:'CC07_TAIL_CLEANUP_UNCONFIRMED'});
 assert.equal(disposed,true);assert.deepEqual(calls,['POST']);assert.equal(observer.summary().transportClosed,true);assert.equal(observer.summary().deleted,false);
});
