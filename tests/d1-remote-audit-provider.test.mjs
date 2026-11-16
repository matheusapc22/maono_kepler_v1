import test from 'node:test';import assert from 'node:assert/strict';
import {collectReadonlyPinnedMetadata,PRODUCTION_ACCOUNT_ID,PRODUCTION_DATABASE_UUID} from '../scripts/d1-remote-audit/readonly-provider.mjs';
const manifest={accountId:'1988481e4c75c760516161104b7e1e50',databaseUuid:'00000000-0000-4000-8000-000000000044',databaseName:'maono_synthetic_rehearsal_audit',workerName:'maono-synthetic-rehearsal-audit',deploymentId:'00000000-0000-4000-8000-000000000001',versionId:'00000000-0000-4000-8000-000000000002',registryNamespaceId:'b'.repeat(32),registryClassName:'SyntheticClaimRegistry'};
const token='synthetic-test-token-not-real';
function bodies(){return [{uuid:manifest.databaseUuid,name:manifest.databaseName},{id:manifest.deploymentId,strategy:'percentage',versions:[{version_id:manifest.versionId,percentage:100}],author_email:'PRIVATE'},{id:manifest.versionId,resources:{bindings:[{type:'d1',name:'TARGET',id:manifest.databaseUuid},{type:'durable_object_namespace',name:'REGISTRY',namespace_id:manifest.registryNamespaceId,class_name:manifest.registryClassName}],script:{etag:'NOT_A_PROVEN_BUNDLE_HASH'}}}];}
const response=r=>Response.json({success:true,errors:[],messages:[],result:r});
function fake(responses=bodies()){const calls=[];return {calls,fetchImpl:async(url,options)=>{calls.push({url,options});return response(responses[calls.length-1]);}};}
const run=f=>collectReadonlyPinnedMetadata({manifest,token,...f,now:()=>100000});
const denied=/^Error: READONLY_PROVIDER_DENIED$/;
test('exact three pinned GETs only, credentials not returned, active/provenance never inferred',async()=>{
 const f=fake(),r=await run(f);assert.equal(f.calls.length,3);
 assert.deepEqual(f.calls.map(c=>new URL(c.url).pathname),['/client/v4/accounts/'+manifest.accountId+'/d1/database/'+manifest.databaseUuid,'/client/v4/accounts/'+manifest.accountId+'/workers/scripts/'+manifest.workerName+'/deployments/'+manifest.deploymentId,'/client/v4/accounts/'+manifest.accountId+'/workers/scripts/'+manifest.workerName+'/versions/'+manifest.versionId]);
 for(const {url,options}of f.calls){assert.equal(new URL(url).origin,'https://api.cloudflare.com');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,'Bearer '+token);assert.deepEqual(Object.keys(options.headers).sort(),['Accept','Authorization']);}
 assert.equal(r.pinnedMetadataMatched,true);for(const k of ['activeDeploymentVerified','deploymentPropagationVerified','versionOverrideProtectionVerified','bundleProvenanceVerified','liveInvocationBindingVerified','namespaceStorageIdentityVerified','tokenScopeVerified','operationalAuthorization'])assert.equal(r[k],false);
 assert.ok(!JSON.stringify(r).includes(token));assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.ok(!JSON.stringify(r).includes('NOT_A_PROVEN_BUNDLE_HASH'));
});
test('production and path injection deny before fetch',async()=>{
 for(const change of [{accountId:'a'.repeat(32)},{accountId:PRODUCTION_ACCOUNT_ID},{databaseUuid:PRODUCTION_DATABASE_UUID},{databaseName:'maono_maps'},{workerName:'../production'},{versionId:'?redirect=https://bad.invalid'},{accountId:['a'.repeat(32)]}]){const f=fake();await assert.rejects(collectReadonlyPinnedMetadata({manifest:{...manifest,...change},token,fetchImpl:f.fetchImpl}),denied);assert.equal(f.calls.length,0);}
});
test('wrong identity, split deployment, extra/substituted/unknown bindings fail closed',async()=>{
 for(const mutate of [b=>{b[0].uuid=PRODUCTION_DATABASE_UUID;},b=>{b[0].name='maono_maps';},b=>{b[1].id='00000000-0000-4000-8000-000000000099';},b=>{b[1].versions.push(b[1].versions[0]);},b=>{b[1].versions[0].percentage=99;},b=>{b[2].id='00000000-0000-4000-8000-000000000099';},b=>{b[2].resources.bindings.push({type:'secret_text',name:'UNAPPROVED'});},b=>{b[2].resources.bindings[1].namespace_id='c'.repeat(32);},b=>{b[2].resources.bindings[1].script_name='foreign';},b=>{b[2].resources.bindings[0].extra='unknown';}]){const b=bodies();mutate(b);await assert.rejects(run(fake(b)),denied);}
});
test('API/HTTP errors, redirects, malformed and paginated envelopes are redacted, without retry',async()=>{
 const factories=[()=>new Response('raw secret SQL',{status:403}),()=>Response.json({success:false,errors:[{message:'private'}],messages:[],result:{}}),()=>Response.json({success:true,errors:[],messages:[],result:bodies()[0],result_info:{page:1,total_pages:2}}),()=>new Response('not json',{headers:{'content-type':'application/json'}}),()=>Response.redirect('https://bad.invalid'),()=>Response.json({success:true,errors:[],messages:[],result:[]}),()=>new Response('html',{headers:{'content-type':'text/html'}})];
 for(const make of factories){let count=0;await assert.rejects(run({fetchImpl:async()=>{count++;return make();}}),denied);assert.equal(count,1);}
 let count=0;await assert.rejects(run({fetchImpl:async()=>{count++;throw Error(token);}}),denied);assert.equal(count,1);
});
test('timeout aborts pending GET and never retries, including stalled body',async()=>{
 for(const bodyStall of [false,true]){let calls=0,signal;const fetchImpl=async(_url,options)=>{calls++;signal=options.signal;if(bodyStall)return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}});return new Promise(()=>{});};await assert.rejects(run({fetchImpl,timeoutMs:10}),denied);assert.equal(calls,1);assert.equal(signal.aborted,true);}
});
test('oversized responses and invalid credentials/options denied without data exposure',async()=>{
 await assert.rejects(run({fetchImpl:async()=>new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}})}),denied);
 const f=fake();await assert.rejects(collectReadonlyPinnedMetadata({manifest,token:'bad\ncredential',fetchImpl:f.fetchImpl}),denied);assert.equal(f.calls.length,0);
 await assert.rejects(run({fetchImpl:f.fetchImpl,timeoutMs:30001}),denied);assert.equal(f.calls.length,0);
});

test('FAKE documented database_id and legacy id accept only exact unambiguous identity',async()=>{
 for(const fields of [{id:manifest.databaseUuid},{database_id:manifest.databaseUuid},{id:manifest.databaseUuid,database_id:manifest.databaseUuid}]){
  const b=bodies();b[2].resources.bindings[0]={type:'d1',name:'TARGET',...fields};
  const r=await run(fake(b));assert.equal(r.bindings[0].id,manifest.databaseUuid);assert.equal(r.liveInvocationBindingVerified,false);
 }
 for(const fields of [{},{database_id:null},{database_id:[manifest.databaseUuid]},{id:manifest.databaseUuid,database_id:null},{id:PRODUCTION_DATABASE_UUID,database_id:manifest.databaseUuid},{id:manifest.databaseUuid,database_id:PRODUCTION_DATABASE_UUID},{id:manifest.databaseUuid,extra:true}]){
  const b=bodies();b[2].resources.bindings[0]={type:'d1',name:'TARGET',...fields};await assert.rejects(run(fake(b)),denied);
 }
});
