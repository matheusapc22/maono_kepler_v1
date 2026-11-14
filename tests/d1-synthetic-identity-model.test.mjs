import test from 'node:test';import assert from 'node:assert/strict';
import {compareSyntheticIdentity} from '../scripts/d1-batch-rehearsal/synthetic-identity-model.mjs';
const now=100000;
const approved={accountId:'a'.repeat(32),databaseUuid:'00000000-0000-4000-8000-000000000044',databaseName:'maono_synthetic_rehearsal_case1',workerName:'maono-synthetic-rehearsal-case1',deploymentId:'00000000-0000-4000-8000-000000000001',gitSha:'b'.repeat(40),payloadSha256:'c'.repeat(64),fixtureSha256:'d'.repeat(64),registryNamespaceId:'e'.repeat(32),expiresAtMs:now+60000};
const observed={...approved,observedAtMs:now,d1Bindings:[{binding:'TARGET',databaseUuid:approved.databaseUuid}]};
test('matching local manifests prove only correspondence, never authority',()=>{
 assert.deepEqual(compareSyntheticIdentity(approved,observed,now),{correspondence:true,remoteIdentityAuthenticated:false,operationalAuthorization:false});
});
test('substitution of each pinned identity field fails closed',()=>{
 for(const key of ['accountId','databaseUuid','databaseName','workerName','deploymentId','gitSha','payloadSha256','fixtureSha256','registryNamespaceId'])assert.throws(()=>compareSyntheticIdentity(approved,{...observed,[key]:'other'},now));
});
test('production and extra or substituted D1 bindings are forbidden',()=>{
 for(const d1Bindings of [[],[...observed.d1Bindings,{binding:'PRODUCTION',databaseUuid:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'}],[{binding:'TARGET',databaseUuid:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'}]])assert.throws(()=>compareSyntheticIdentity(approved,{...observed,d1Bindings},now));
 for(const m of [{...approved,databaseName:'maono_maps'},{...approved,databaseUuid:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'}])assert.throws(()=>compareSyntheticIdentity(m,m,now));
});
test('expired, stale, future or malformed time is forbidden',()=>{
 assert.throws(()=>compareSyntheticIdentity({...approved,expiresAtMs:now},observed,now));
 for(const observedAtMs of [now-60001,now+1,NaN])assert.throws(()=>compareSyntheticIdentity(approved,{...observed,observedAtMs},now));
 assert.throws(()=>compareSyntheticIdentity(approved,observed,NaN));
});
test('valid-format substitutions still fail exact identity comparison',()=>{
 const alternatives={accountId:'f'.repeat(32),databaseUuid:'00000000-0000-4000-8000-000000000099',databaseName:'maono_synthetic_rehearsal_other',workerName:'maono-synthetic-rehearsal-other',deploymentId:'00000000-0000-4000-8000-000000000099',gitSha:'f'.repeat(40),payloadSha256:'f'.repeat(64),fixtureSha256:'f'.repeat(64),registryNamespaceId:'f'.repeat(32)};
 for(const [key,value] of Object.entries(alternatives))assert.throws(()=>compareSyntheticIdentity(approved,{...observed,[key]:value},now));
});
test('array coercion cannot bypass production denial or exact string validation',()=>{
 for(const key of ['accountId','databaseUuid','databaseName','workerName','deploymentId','gitSha','payloadSha256','fixtureSha256','registryNamespaceId']){
  const value=[approved[key]];assert.throws(()=>compareSyntheticIdentity({...approved,[key]:value},{...observed,[key]:value},now));
 }
 const value=['5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'];assert.throws(()=>compareSyntheticIdentity({...approved,databaseUuid:value},{...observed,databaseUuid:value,d1Bindings:[{binding:'TARGET',databaseUuid:value}]},now));
});
