// All API payload tests are preparation-only. No fetch or remote credentials.
import test from 'node:test';import assert from 'node:assert/strict';
import {describeFixedProvisioning,buildFixedCreateD1Request,buildFixedWorkerUploadFromReceipt,buildFixedDisablePublicEndpointsRequest,provisionFixedPilot,DENY_ALL_SCAFFOLD,SCAFFOLD_SHA256} from '../scripts/d1-synthetic-provision/fixed-core.mjs';
import {createHash} from 'node:crypto';
const receipt=()=>({success:true,errors:[],result:{name:'maono_synthetic_rehearsal_pilot_20261116',uuid:'00000000-0000-4000-8000-000000000044'}});
test('hard block occurs before I/O even when caller supplies token, callbacks and asserted safety',async()=>{
 let calls=0;const r=await provisionFixedPilot({enabled:true,freeVerified:true,nonpublicVerified:true,token:'FAKE-ONLY',fetchImpl(){calls++;},onReceipt(){calls++;}});
 assert.equal(calls,0);assert.equal(r.status,'blocked-before-write');assert.equal(r.writeAttempts,0);assert.deepEqual(r.inventory,[]);assert.equal(r.migrationAuthorized,false);assert.equal(r.retryAllowed,false);assert.ok(!JSON.stringify(r).includes('FAKE-ONLY'));
});
test('fixed names, account and non-execution limits cannot be caller-selected',()=>{
 const d=describeFixedProvisioning();assert.equal(d.accountId,'1988481e4c75c760516161104b7e1e50');assert.equal(d.spendingLimitUSD,0);assert.equal(d.maxLifetimeHours,24);assert.equal(d.writeTransportImplemented,true);assert.equal(d.freePlanVerified,false);assert.equal(d.nonPublicCreationVerified,false);
 const r=buildFixedCreateD1Request({accountId:'production',url:'https://evil.invalid'});assert.equal(r.method,'POST');assert.equal(r.redirect,'error');assert.equal(r.credentials,'omit');assert.equal(r.url,'https://api.cloudflare.com/client/v4/accounts/'+d.accountId+'/d1/database');assert.deepEqual(JSON.parse(r.body),{name:d.databaseName});assert.ok(!('Authorization' in r.headers));
});
test('fixed multipart scaffold declares one D1 and one new SQLite namespace, no secret or data SQL',async()=>{
 const r=buildFixedWorkerUploadFromReceipt(receipt());assert.equal(r.method,'PUT');assert.equal(r.redirect,'error');assert.equal(r.url,'https://api.cloudflare.com/client/v4/accounts/1988481e4c75c760516161104b7e1e50/workers/scripts/maono-synthetic-rehearsal-pilot-20261116');
 assert.deepEqual([...r.body.keys()],['metadata','worker.mjs']);const m=JSON.parse(await r.body.get('metadata').text());assert.equal(m.main_module,'worker.mjs');assert.deepEqual(m.migrations,{new_tag:'pilot-initial-v1',new_sqlite_classes:['SyntheticClaimRegistry']});
 assert.deepEqual(m.bindings,[{type:'d1',name:'TARGET',id:receipt().result.uuid},{type:'durable_object_namespace',name:'REGISTRY',class_name:'SyntheticClaimRegistry'}]);
 assert.equal(await r.body.get('worker.mjs').text(),DENY_ALL_SCAFFOLD);assert.equal(SCAFFOLD_SHA256,createHash('sha256').update(DENY_ALL_SCAFFOLD).digest('hex'));assert.ok(!/\.batch\(|\.prepare\(|\.storage|claimOnce|env\./.test(DENY_ALL_SCAFFOLD));
});
test('invalid or production D1 receipt cannot yield upload payload',()=>{
 for(const r of [null,{success:false,errors:[],result:receipt().result},{success:true,errors:[{}],result:receipt().result},{...receipt(),result:{name:'maono_maps',uuid:receipt().result.uuid}},{...receipt(),result:{name:receipt().result.name,uuid:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'}},{...receipt(),result:{name:receipt().result.name,uuid:[receipt().result.uuid]}}])assert.throws(()=>buildFixedWorkerUploadFromReceipt(r));
});
test('public endpoint disabling payload is explicit and separate, never mislabelled atomic',()=>{
 const r=buildFixedDisablePublicEndpointsRequest();assert.equal(r.method,'POST');assert.ok(r.url.endsWith('/maono-synthetic-rehearsal-pilot-20261116/subdomain'));assert.deepEqual(JSON.parse(r.body),{enabled:false,previews_enabled:false});assert.equal(describeFixedProvisioning().nonPublicCreationVerified,false);
});
