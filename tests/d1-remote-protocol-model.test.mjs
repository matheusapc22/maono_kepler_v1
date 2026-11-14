import test from 'node:test';
import assert from 'node:assert/strict';
import {modelInvocation, operationKey, PRODUCTION_UUID} from '../scripts/d1-batch-rehearsal/remote-protocol-model.mjs';
const spec = {databaseUuid:'00000000-0000-4000-8000-000000000044',databaseName:'maono_synthetic_rehearsal_case1',payloadSha256:'a'.repeat(64),auditSha256:'b'.repeat(64),attemptId:'00000000-0000-4000-8000-000000000001'};
// Shared memory simulates the atomic contract, NOT durable storage or remote proof.
function store() {
  const rows = new Map();
  return {rows,
    async claimOnce(key, record) {if (rows.has(key)) return false; rows.set(key, {...record}); return true;},
    async finish(key, attempt, state) {const row=rows.get(key); assert.equal(row.attemptId,attempt); assert.equal(row.state,'claimed'); rows.set(key,{...row,state});},
  };
}
test('production identity and non-synthetic name denied before store or executor', async()=>{
  let calls=0; const forbidden={claimOnce(){calls++;}};
  for (const invalid of [{...spec,databaseUuid:PRODUCTION_UUID},{...spec,databaseName:'maono_maps'},{...spec,payloadSha256:'invalid'}])
    await assert.rejects(modelInvocation({store:forbidden,spec:invalid,executeFixedBatch:()=>calls++}),/INVALID_SYNTHETIC/);
  assert.equal(calls,0);
});
test('concurrent invocations share exactly one claim, not an isolate flag', async()=>{
  const s=store();let calls=0;let release;const gate=new Promise(r=>{release=r;});
  const first=modelInvocation({store:s,spec,executeFixedBatch:async()=>{calls++;await gate;}});
  const second=await modelInvocation({store:s,spec:{...spec,attemptId:'00000000-0000-4000-8000-000000000002'},executeFixedBatch:()=>calls++});
  assert.equal(second.outcome,'denied-replay');release();assert.equal((await first).outcome,'returned-unverified');assert.equal(calls,1);
});
test('recreated handler and changed payload/audit cannot reopen an uncertain target', async()=>{
  const s=store();let calls=0;
  const first=await modelInvocation({store:s,spec,executeFixedBatch:()=>{calls++;throw Error('private SQL');}});
  assert.deepEqual(first,{outcome:'unknown',retryAllowed:false});
  const next=await modelInvocation({store:s,spec:{...spec,payloadSha256:'c'.repeat(64),auditSha256:'d'.repeat(64)},executeFixedBatch:()=>calls++});
  assert.equal(next.outcome,'denied-replay');assert.equal(calls,1);
});
test('claim storage error never calls target', async()=>{
  let calls=0;await assert.rejects(modelInvocation({store:{claimOnce(){throw Error('storage unavailable');}},spec,executeFixedBatch:()=>calls++}));assert.equal(calls,0);
});
test('crash after persisted claim but before target is fail closed', async()=>{
  const s=store();await s.claimOnce(operationKey(spec),{state:'claimed',attemptId:spec.attemptId});let calls=0;
  assert.equal((await modelInvocation({store:s,spec,executeFixedBatch:()=>calls++})).outcome,'denied-replay');assert.equal(calls,0);
});
test('lost completion storage acknowledgement leaves persistent claim closed', async()=>{
  const s=store();s.finish=async()=>{throw Error('storage acknowledgement lost');};let calls=0;
  await assert.rejects(modelInvocation({store:s,spec,executeFixedBatch:()=>calls++}));
  assert.equal((await modelInvocation({store:s,spec,executeFixedBatch:()=>calls++})).outcome,'denied-replay');assert.equal(calls,1);
});
test('lost claim acknowledgement never invokes target and stays closed', async()=>{
  const s=store();const claim=s.claimOnce.bind(s);let calls=0;
  s.claimOnce=async(key,record)=>{await claim(key,record);throw Error('claim acknowledgement lost');};
  await assert.rejects(modelInvocation({store:s,spec,executeFixedBatch:()=>calls++}));
  s.claimOnce=claim;
  assert.equal((await modelInvocation({store:s,spec,executeFixedBatch:()=>calls++})).outcome,'denied-replay');assert.equal(calls,0);
});
test('claim identity fields reject coercible arrays before store access',async()=>{
 let calls=0; const forbidden={claimOnce(){calls++;}};
 for(const key of ['databaseUuid','databaseName','payloadSha256','auditSha256','attemptId'])await assert.rejects(modelInvocation({store:forbidden,spec:{...spec,[key]:[spec[key]]},executeFixedBatch:()=>calls++}),/INVALID_SYNTHETIC/);
 await assert.rejects(modelInvocation({store:forbidden,spec:{...spec,databaseUuid:[PRODUCTION_UUID]},executeFixedBatch:()=>calls++}),/INVALID_SYNTHETIC/);assert.equal(calls,0);
});
