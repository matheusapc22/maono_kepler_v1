import test from 'node:test';import assert from 'node:assert/strict';
import {createLocalIntegratedHarness} from '../scripts/d1-batch-rehearsal/local-integrated-harness.mjs';
import {createLocalIdentityFixtureTransport} from '../scripts/d1-batch-rehearsal/local-identity-collector.mjs';
import {makeLocalIdentityCollectorFixture} from './helpers/local-identity-collector-fixture.mjs';
function registry(){const rows=new Map();let claims=0;return {rows,get claims(){return claims;},async claimOnce(k,v){claims++;if(rows.has(k))return false;rows.set(k,{...v});return true;},async finish(k,id,state){const row=rows.get(k);assert.equal(row.attemptId,id);assert.equal(row.state,'claimed');rows.set(k,{...row,state});}};}
async function setup(tokenTtlMs=60000){
 const f=await makeLocalIdentityCollectorFixture();const invocationKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const spec={databaseUuid:f.approved.databaseUuid,databaseName:f.approved.databaseName,payloadSha256:f.approved.payloadSha256,auditSha256:'f'.repeat(64),attemptId:'00000000-0000-4000-8000-000000000003'};
 const audience='https://maono-synthetic-rehearsal-integrated.invalid/fixed-batch';
 const claims={databaseUuid:spec.databaseUuid,payloadSha256:spec.payloadSha256,auditSha256:spec.auditSha256,attemptId:spec.attemptId,deploymentId:f.approved.deploymentId,registryNamespaceId:f.approved.registryNamespaceId,audience,issuedAtMs:f.nowMs,expiresAtMs:f.nowMs+tokenTtlMs};
 const encoded=Buffer.from(JSON.stringify(claims)).toString('base64url');const signature=await crypto.subtle.sign('HMAC',invocationKey,new TextEncoder().encode('maono-synthetic-invocation-v1\nPOST\n'+encoded));
 const token='Maono-HMAC '+encoded+'.'+Buffer.from(signature).toString('base64url');
 const store=registry();const options={approved:f.approved,spec,audience,invocationKey,transport:createLocalIdentityFixtureTransport(f.fixtures),provenanceKey:f.provenanceKey,store,clock:()=>f.nowMs};
 return {...f,options,store,request:(authorization=token)=>new Request(audience,{method:'POST',headers:{authorization}})};
}
test('local auth + fixture provenance + claim permits one counter increment, never authority',async()=>{
 const f=await setup(),h=createLocalIntegratedHarness(f.options);
 const first=await h.invoke(f.request());assert.equal(first.outcome,'returned-unverified');assert.equal(first.simulatedTargetCalls,1);assert.equal(first.simulationOnly,true);assert.equal(first.remoteIdentityAuthenticated,false);assert.equal(first.operationalAuthorization,false);
 assert.equal((await h.invoke(f.request())).outcome,'denied-replay');assert.equal(h.getSimulatedTargetCalls(),1);
});
test('authentication fails before collection timestamp or registry access',async()=>{
 const f=await setup();let clocks=0;const h=createLocalIntegratedHarness({...f.options,transport:{mode:'forged'},clock:()=>{clocks++;return f.nowMs;}});
 await assert.rejects(h.invoke(f.request('Bearer bad')),/LOCAL_INTEGRATED_DENIED/);assert.equal(clocks,1);assert.equal(f.store.claims,0);assert.equal(h.getSimulatedTargetCalls(),0);
});
test('authenticated request with substituted binding or provenance never claims',async()=>{
 for(const mutation of [x=>{x.version.resources.bindings[0].id='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';},x=>{x.provenance.signatureBase64url=Buffer.from(new Uint8Array(32)).toString('base64url');}]){
  const f=await setup();mutation(f.fixtures);const h=createLocalIntegratedHarness({...f.options,transport:createLocalIdentityFixtureTransport(f.fixtures)});
  await assert.rejects(h.invoke(f.request()),/LOCAL_INTEGRATED_DENIED/);assert.equal(f.store.claims,0);assert.equal(h.getSimulatedTargetCalls(),0);
 }
});
test('expiry during collection prevents claim; expiry after claim stays closed without target',async()=>{
 for(const threshold of [4,8]){
  const f=await setup();let clocks=0;const h=createLocalIntegratedHarness({...f.options,clock:()=>++clocks>=threshold?f.nowMs+60001:f.nowMs});
  if(threshold===4){await assert.rejects(h.invoke(f.request()));assert.equal(f.store.claims,0);}else{assert.equal((await h.invoke(f.request())).outcome,'unknown');assert.equal(f.store.rows.values().next().value.state,'unknown');}
  assert.equal(h.getSimulatedTargetCalls(),0);
 }
});
test('two authenticated handlers sharing claim registry cannot duplicate the simulation',async()=>{
 const f=await setup(),a=createLocalIntegratedHarness(f.options),b=createLocalIntegratedHarness(f.options);
 const results=await Promise.all([a.invoke(f.request()),b.invoke(f.request())]);assert.equal(results.filter(r=>r.outcome==='returned-unverified').length,1);assert.equal(results.filter(r=>r.outcome==='denied-replay').length,1);assert.equal(a.getSimulatedTargetCalls()+b.getSimulatedTargetCalls(),1);
});
test('fixed copied configuration rejects mismatch and ignores later caller mutation',async()=>{
 const f=await setup();assert.throws(()=>createLocalIntegratedHarness({...f.options,spec:{...f.options.spec,payloadSha256:'a'.repeat(64)}}),/CONFIG_DENIED/);
 const h=createLocalIntegratedHarness(f.options);f.options.approved.databaseUuid='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';f.options.spec.databaseUuid='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';assert.equal((await h.invoke(f.request())).simulatedTargetCalls,1);
});
test('short token expiry during final crypto wait blocks counter while approval remains valid',async()=>{
 const f=await setup(1000);let clocks=0;
 const h=createLocalIntegratedHarness({...f.options,clock:()=>++clocks>=8?f.nowMs+1000:f.nowMs});
 const result=await h.invoke(f.request());assert.equal(result.outcome,'unknown');assert.equal(h.getSimulatedTargetCalls(),0);assert.equal(f.store.claims,1);assert.equal(f.store.rows.values().next().value.state,'unknown');
});
