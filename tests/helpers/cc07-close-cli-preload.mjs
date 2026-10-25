import {registerHooks} from 'node:module';
import {writeFile,readFile} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {operatorFixture} from './cc07-operator-fixture.mjs';
import {localTailPeer} from './tail-websocket-peer.mjs';
import {TailWebSocket} from '../../scripts/acceptance/tail-websocket.mjs';
import {createCc07Readiness} from '../../scripts/acceptance/cc07-readiness.mjs';
import {fail} from '../../scripts/acceptance/production-acceptance-lib.mjs';

const scenario=process.env.CC07_CLOSE_SCENARIO,cleanup=[],target=process.env.CC07_CLOSE_OBSERVATION;
const f=await operatorFixture({after:fn=>cleanup.push(fn)},{setupOnly:true,fault:scenario==='original-and-delete'?'readiness-handler':null});
const peer=await localTailPeer({respond:scenario==='normal',handshake:scenario!=='connect-timeout'});
const calls=[];
let socket,deleteAborted=false;
const observer=createCc07Readiness('local-tail-canary',f.plan,{
 now:()=>f.clock,
 budget:{assertActive(){},requestTimeoutMs:requested=>scenario==='connect-timeout'?50:scenario==='delete-timeout'&&socket?.readyState>0?80:requested},
 WebSocketImpl:class extends TailWebSocket{constructor(_url,protocol){super(peer.url,protocol);socket=this;}},
 fetchImpl:async(_url,options)=>{
  calls.push(options.method);
  if(options.method==='DELETE'){
   if(scenario==='delete-timeout')return new Promise((_,reject)=>{
    const aborted=()=>{deleteAborted=true;reject(Error('private-provider-canary'));};
    if(options.signal.aborted)aborted();else options.signal.addEventListener('abort',aborted,{once:true});
   });
   return Response.json({success:!['delete-failure','original-and-delete'].includes(scenario)},{status:['delete-failure','original-and-delete'].includes(scenario)?403:200});
  }
  return Response.json({success:true,result:{id:'a'.repeat(32),expires_at:new Date(f.clock+3600000).toISOString(),url:'wss://tail.developers.workers.dev/local-fixture'}});
 }
});
const reset=observer.resetSince.bind(observer),receipt=observer.receipt.bind(observer);
let offSince=Infinity;
const emitReceipt=()=>{
 if(Number.isFinite(offSince)&&f.scheduled&&!f.active){const at=Math.max(offSince,f.clock);peer.send({scriptName:'maono-ticket-notifications',event:{cron:f.plan.worker.cron,scheduledTime:at},outcome:'ok',exceptions:[],logs:[{message:[JSON.stringify({event:'ticket.notifications.off-ready',schemaVersion:1,versionId:f.plan.worker.offVersion,runId:f.plan.policy.runId,organizationId:1,scheduledTime:at,cron:f.plan.worker.cron,consumerEnabled:false,claimed:0})]}]});}
};
observer.resetSince=since=>{
 offSince=since;reset(since);emitReceipt();
};
observer.receipt=()=>{
 if(scenario==='original-and-delete')fail('CC07_CRON_HANDLER_FAILED','fixture original failure');
 if(scenario==='readiness-timeout')return null;
 if(scenario==='disconnect')peer.disconnect();
 return receipt();
};
f.runtime.readiness=observer;
const sleep=f.runtime.sleep;f.runtime.sleep=async ms=>{await sleep(ms);emitReceipt();await pause(10);};
const actual=new URL('../../scripts/acceptance/cc07-operator.mjs',import.meta.url).href;
// Inject only the existing runtime boundary. Execute the unmodified real CLI
// entrypoint/argument parser/report/exit-code path in a separate OS process.
globalThis.__cc07CloseFixture={env:f.env,runtime:f.runtime,async finish(options){
 const report=JSON.parse(await readFile(options.reportPath,'utf8'));
 let repeatedError=null;try{await Promise.all([observer.close(),observer.close()]);}catch(error){repeatedError=error.code;}
 await writeFile(target,JSON.stringify({node:process.version,calls,deleteAborted,readyState:socket?.readyState,telemetry:observer.summary(),repeatedError,reportComplete:report.complete,resources:process.getActiveResourcesInfo()}));
 for(const fn of cleanup.reverse())await fn();
 peer.release();
}};
registerHooks({resolve(specifier,context,next){
 const resolved=next(specifier,context);
 if(resolved.url===actual&&context.parentURL?.endsWith('/operator.mjs'))return {url:'cc07-fixture:runtime',shortCircuit:true};
 return resolved;
},load(url,context,next){
 if(url!=='cc07-fixture:runtime')return next(url,context);
 return {format:'module',shortCircuit:true,source:`import {runCc07Operator as actual} from ${JSON.stringify(actual)};
 export async function runCc07Operator(options){const f=globalThis.__cc07CloseFixture;try{return await actual(options,f.env,f.runtime);}finally{await f.finish(options);}}`};
}});
