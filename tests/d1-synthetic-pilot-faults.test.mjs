// Explicit UNIT/FAKE fault tests of generated control flow, NOT workerd or D1 evidence.
import test from 'node:test';import assert from 'node:assert/strict';
import {buildLocalPilotSource} from '../scripts/d1-synthetic-pilot/local-source.mjs';
const c={enabled:true,accountId:'1988481e4c75c760516161104b7e1e50',databaseUuid:'00000000-0000-4000-8000-000000000044',databaseName:'maono_synthetic_rehearsal_fake_faults',deploymentId:'00000000-0000-4000-8000-000000000001',versionId:'00000000-0000-4000-8000-000000000002',registryNamespaceId:'a'.repeat(32),attemptId:'00000000-0000-4000-8000-000000000003',auditSha256:'b'.repeat(64),audience:'https://maono-synthetic-rehearsal-faults.invalid/fixed-batch'};
function setup({claimFault,finishFault,batchFault}={}){
 let time=1000,batches=0,row=null;
 const store={async claimOnce(_key,record){if(row)return false;row={...record};if(claimFault==='lost-ack')throw Error('private claim details');if(claimFault==='expire')time=5000;if(claimFault==='truthy')return 'yes';return true;},async finish(_key,attempt,state){assert.equal(row.attemptId,attempt);if(row.state!=='claimed')throw Error('already terminal');row.state=state;if(finishFault==='lost-ack')throw Error('private finish details');if(finishFault==='nonboolean')return undefined;return true;}};
 const source=buildLocalPilotSource(c).source.replace(/^import .*;$/gm,'').replace(/^export \{.*;$/gm,'').replace('export default','return');
 const factory=new Function('createLocalInvocationVerifier','createRegistryStore','crypto','CryptoKey','Request','Response','Date',source);
 const worker=factory(()=>async()=>({authenticatedIssuedAtMs:100,authenticatedExpiresAtMs:5000}),()=>store,crypto,CryptoKey,Request,Response,{now:()=>time});
 const env={LOCAL_REHEARSAL_MODE:'local-only',LOCAL_ACCOUNT_ID:c.accountId,LOCAL_VERSION_ID:c.versionId,LOCAL_TEST_KEY_HEX:'0'.repeat(64),REGISTRY:{},TARGET:{prepare(){return {bind(){return this;}};},async batch(){batches++;if(batchFault)throw Error('private engine SQL');return [{success:true},{success:true},{success:true}];}}};
 return {async invoke(request=new Request(c.audience,{method:'POST'})){return (await worker.fetch(request,env)).json();},get batches(){return batches;},get row(){return row;},setTime(v){time=v;}};
}
test('FAKE: persisted claim with lost acknowledgement returns UNKNOWN, no target and no replay',async()=>{
 const f=setup({claimFault:'lost-ack'});assert.equal((await f.invoke()).outcome,'unknown');assert.equal(f.batches,0);assert.equal(f.row.state,'claimed');assert.equal((await f.invoke()).outcome,'denied-replay');assert.equal(f.batches,0);
});
test('FAKE: expiry while claim awaited preserves closed unknown record and zero target calls',async()=>{
 const f=setup({claimFault:'expire'});assert.equal((await f.invoke()).outcome,'unknown');assert.equal(f.batches,0);assert.equal(f.row.state,'unknown');assert.equal((await f.invoke()).outcome,'denied');assert.equal(f.batches,0);
});
test('FAKE: lost terminal acknowledgement after target returns UNKNOWN and never repeats target',async()=>{
 const f=setup({finishFault:'lost-ack'});const r=await f.invoke();assert.equal(r.outcome,'unknown');assert.equal(r.retryAllowed,false);assert.equal(f.batches,1);assert.equal(f.row.state,'returned-unverified');assert.equal((await f.invoke()).outcome,'denied-replay');assert.equal(f.batches,1);assert.ok(!JSON.stringify(r).includes('private'));
});
test('FAKE: claim and finish require exact true, never truthy/undefined success',async()=>{
 const a=setup({claimFault:'truthy'});assert.equal((await a.invoke()).outcome,'unknown');assert.equal(a.batches,0);
 const b=setup({finishFault:'nonboolean'});assert.equal((await b.invoke()).outcome,'unknown');assert.equal(b.batches,1);assert.equal((await b.invoke()).outcome,'denied-replay');assert.equal(b.batches,1);
});
test('FAKE: engine failure has no raw details or retry and closes claim',async()=>{
 const f=setup({batchFault:true});const r=await f.invoke();assert.equal(r.outcome,'unknown');assert.equal(f.row.state,'unknown');assert.ok(!JSON.stringify(r).includes('SQL'));assert.equal((await f.invoke()).outcome,'denied-replay');assert.equal(f.batches,1);
});

test('FAKE: delayed EOF expiring authentication denies before claim; nonempty chunk denied',async()=>{
 const f=setup();const body=new ReadableStream({start(controller){setTimeout(()=>{f.setTime(5000);controller.close();},5);}});
 assert.equal((await f.invoke(new Request(c.audience,{method:'POST',body,duplex:'half'}))).outcome,'denied');assert.equal(f.row,null);assert.equal(f.batches,0);
 const g=setup();assert.equal((await g.invoke(new Request(c.audience,{method:'POST',body:'SQL'}))).outcome,'denied');assert.equal(g.row,null);
});
test('FAKE: stalled empty stream is bounded and never claims or writes',async()=>{
 const f=setup();const body=new ReadableStream({start(){}});assert.equal((await f.invoke(new Request(c.audience,{method:'POST',body,duplex:'half'}))).outcome,'denied');assert.equal(f.row,null);assert.equal(f.batches,0);
});
