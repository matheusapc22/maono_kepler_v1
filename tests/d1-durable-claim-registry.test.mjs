import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const pkg=process.env.MAONO_LOCAL_WRANGLER_PACKAGE || join(repo,'.tmp/d1-batch-rehearsal-runtime/node_modules/wrangler');
const require=createRequire(join(pkg,'package.json'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
assert.equal(require('./package.json').version,'4.140.0');
assert.equal(require('workerd/package.json').version,'1.20260923.1');
const spec={databaseUuid:'00000000-0000-4000-8000-000000000044',databaseName:'maono_synthetic_rehearsal_registry',payloadSha256:'a'.repeat(64),auditSha256:'b'.repeat(64),attemptId:'00000000-0000-4000-8000-000000000001'};
const record={state:'claimed',attemptId:spec.attemptId,payloadSha256:spec.payloadSha256,auditSha256:spec.auditSha256};
const key='synthetic-d1-once:'+spec.databaseUuid;
// Test-only control surface, not exported by the adapter and never deployed.
const harness=`
import {createRegistryStore} from './durable-claim-registry.mjs';
export {SyntheticClaimRegistry} from './durable-claim-registry.mjs';
import {modelInvocation} from './remote-protocol-model.mjs';
let calls=0;
export default {async fetch(request,env){
 if(new URL(request.url).origin!=='http://localhost'||request.method!=='POST')return new Response('DENIED',{status:403});
 const input=await request.json(); const store=createRegistryStore(env.REGISTRY);
 try {
  let result;
  if(input.action==='claim') result=await store.claimOnce(input.key,input.record);
  else if(input.action==='finish') result=await store.finish(input.key,input.attemptId,input.state);
  else if(input.action==='invoke') result=await modelInvocation({store,spec:input.spec,executeFixedBatch:()=>{calls++;}});
  else return new Response('DENIED',{status:403});
  return Response.json({result,calls});
 } catch {return Response.json({error:'DENIED',calls},{status:409});}
}};`;
function start(dir){return new Miniflare(convertV4MiniflareOptions({
 modules:[{type:'ESModule',path:join(repo,'scripts/d1-batch-rehearsal/registry-test-entry.mjs'),contents:harness},
 ...['durable-claim-registry.mjs','remote-protocol-model.mjs'].map(name=>({type:'ESModule',path:join(repo,'scripts/d1-batch-rehearsal',name),contents:readFileSync(join(repo,'scripts/d1-batch-rehearsal',name),'utf8')}))],
 host:'127.0.0.1',port:0,cf:false,compatibilityDate:'2026-09-23',resourcePersistencePath:dir,
 durableObjects:{REGISTRY:{className:'SyntheticClaimRegistry',useSQLite:true}},
}));}
async function call(mf,input){const r=await mf.dispatchFetch('http://localhost/test-only',{method:'POST',body:JSON.stringify(input)});return {status:r.status,...await r.json()};}
test('SQLite Durable Object local concurrent claim, terminal state, dispose/restart persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'maono-local-registry-'));let mf=start(dir);
 try {
  const answers=await Promise.all(Array.from({length:16},()=>call(mf,{action:'invoke',spec})));
  assert.equal(answers.filter(a=>a.result.outcome==='returned-unverified').length,1);
  assert.equal(answers.filter(a=>a.result.outcome==='denied-replay').length,15);
  assert.equal(Math.max(...answers.map(a=>a.calls)),1);
  await mf.dispose();mf=start(dir);
  const replay=await call(mf,{action:'invoke',spec:{...spec,auditSha256:'c'.repeat(64)}});
  assert.equal(replay.result.outcome,'denied-replay');assert.equal(replay.calls,0);
 }finally{await mf.dispose();}
});
test('persisted claim without target execution survives restart; invalid transitions never reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'maono-local-registry-'));let mf=start(dir);
 try {
  assert.equal((await call(mf,{action:'claim',key,record})).result,true);
  await mf.dispose();mf=start(dir);
  assert.equal((await call(mf,{action:'invoke',spec})).result.outcome,'denied-replay');
  assert.equal((await call(mf,{action:'finish',key,attemptId:'00000000-0000-4000-8000-000000000002',state:'unknown'})).status,409);
  assert.equal((await call(mf,{action:'finish',key,attemptId:spec.attemptId,state:'claimed'})).status,409);
  assert.equal((await call(mf,{action:'finish',key,attemptId:spec.attemptId,state:'unknown'})).result,true);
  assert.equal((await call(mf,{action:'finish',key,attemptId:spec.attemptId,state:'returned-unverified'})).status,409);
  const replay=await call(mf,{action:'invoke',spec});assert.equal(replay.result.outcome,'denied-replay');assert.equal(replay.calls,0);
 }finally{await mf.dispose();}
});
test('adapter rejects production key and malformed records before creating claim',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'maono-local-registry-'));const mf=start(dir);
 try {
  for(const input of [{key:'synthetic-d1-once:5bc4dc32-f3bd-4c92-bbd1-cbda63e467db',record},{key,record:{...record,state:'returned-unverified'}},{key,record:{...record,payloadSha256:'bad'}},{key:'other',record}])
   assert.equal((await call(mf,{action:'claim',...input})).status,409);
  assert.equal((await call(mf,{action:'claim',key,record})).result,true);
 }finally{await mf.dispose();}
});
