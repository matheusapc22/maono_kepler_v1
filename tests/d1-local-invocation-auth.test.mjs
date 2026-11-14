import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalInvocationVerifier} from '../scripts/d1-batch-rehearsal/local-invocation-auth.mjs';
const now=100000;
const pins={databaseUuid:'00000000-0000-4000-8000-000000000044',payloadSha256:'a'.repeat(64),auditSha256:'b'.repeat(64),attemptId:'00000000-0000-4000-8000-000000000001',deploymentId:'00000000-0000-4000-8000-000000000002',registryNamespaceId:'c'.repeat(32),audience:'https://maono-synthetic-rehearsal-auth.invalid/fixed-batch'};
const claims={...pins,issuedAtMs:now,expiresAtMs:now+60000};
const key=()=>crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
const b64=bytes=>Buffer.from(bytes).toString('base64url');
async function token(k,c=claims){
 const encoded=b64(new TextEncoder().encode(JSON.stringify(c)));
 const signature=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode('maono-synthetic-invocation-v1\nPOST\n'+encoded));
 return 'Maono-HMAC '+encoded+'.'+b64(signature);
}
function request(t,url=pins.audience,options={}){return new Request(url,{method:'POST',headers:{authorization:t},...options});}
const denied=/^Error: SYNTHETIC_AUTH_DENIED$/;
test('ephemeral local WebCrypto signature verifies but gives neither authority nor replay protection',async()=>{
 const k=await key(),verify=createLocalInvocationVerifier(pins,k),t=await token(k);
 const result=await verify(request(t),now);
 assert.deepEqual(result,{localSignatureVerified:true,authenticatedIssuedAtMs:now,authenticatedExpiresAtMs:now+60000,remoteIdentityAuthenticated:false,operationalAuthorization:false,replayProtectionProvided:false});
 assert.ok(Object.isFrozen(result));assert.deepEqual(await verify(request(t),now),result);
});
test('every pinned field rejects a correctly signed alternate identity',async()=>{
 const k=await key(),verify=createLocalInvocationVerifier(pins,k);
 const alternatives={databaseUuid:'00000000-0000-4000-8000-000000000099',payloadSha256:'d'.repeat(64),auditSha256:'e'.repeat(64),attemptId:'00000000-0000-4000-8000-000000000098',deploymentId:'00000000-0000-4000-8000-000000000097',registryNamespaceId:'f'.repeat(32),audience:'https://maono-synthetic-rehearsal-other.invalid/fixed-batch'};
 for(const [field,value]of Object.entries(alternatives))await assert.rejects(verify(request(await token(k,{...claims,[field]:value})),now),denied);
});
test('bad signature, wrong key, malformed envelope and oversized header fail closed',async()=>{
 const k=await key(),verify=createLocalInvocationVerifier(pins,k),t=await token(k);
 const parts=t.split('.');
 for(const bad of ['', 'Bearer x',t+'.extra',parts.slice(0,-1).join('.')+'.'+b64(new Uint8Array(32)),t+'=', 'Maono-HMAC '+ 'a'.repeat(4096),await token(await key())])await assert.rejects(verify(request(bad),now),denied);
});
test('only exact HTTPS endpoint, POST, no query and null body accepted',async()=>{
 const k=await key(),verify=createLocalInvocationVerifier(pins,k),t=await token(k);
 for(const url of [pins.audience+'?x=1',pins.audience+'#fragment',pins.audience+'/extra',pins.audience.replace('https:','http:'),pins.audience.replace('-auth.invalid','-other.invalid')])await assert.rejects(verify(request(t,url),now),denied);
 for(const options of [{method:'GET'},{method:'PUT'},{body:'sql'},{body:''}])await assert.rejects(verify(request(t,pins.audience,options),now),denied);
});
test('expired, future, excessive TTL, negative, malformed times rejected',async()=>{
 const k=await key(),verify=createLocalInvocationVerifier(pins,k);
 for(const times of [{expiresAtMs:now},{issuedAtMs:now+1},{expiresAtMs:now+60001},{issuedAtMs:-1},{issuedAtMs:String(now)},{expiresAtMs:1.5},{issuedAtMs:now-60001,expiresAtMs:now+1}])await assert.rejects(verify(request(await token(k,{...claims,...times})),now),denied);
 for(const badNow of [-1,NaN,Infinity,1.5])await assert.rejects(verify(request(await token(k)),badNow),denied);
});
test('claims reject coercion, extra fields and noncanonical duplicate JSON keys',async()=>{
 const k=await key(),verify=createLocalInvocationVerifier(pins,k);
 for(const c of [{...claims,databaseUuid:[pins.databaseUuid]},{...claims,extra:true}])await assert.rejects(verify(request(await token(k,c)),now),denied);
 const encoded=b64(new TextEncoder().encode(JSON.stringify(claims).replace('{','{"databaseUuid":"ignored",')));
 const sig=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode('maono-synthetic-invocation-v1\nPOST\n'+encoded));
 await assert.rejects(verify(request('Maono-HMAC '+encoded+'.'+b64(sig)),now),denied);
});
test('production, real host, bad config/key rejected and captured pins cannot be mutated',async()=>{
 const k=await key();
 for(const p of [{...pins,databaseUuid:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'},{...pins,databaseUuid:[pins.databaseUuid]},{...pins,audience:'https://maono-synthetic-rehearsal-auth.workers.dev/fixed-batch'},{...pins,extra:true}])assert.throws(()=>createLocalInvocationVerifier(p,k),denied);
 for(const badKey of [{},await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},true,['sign','verify']),await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-1',length:256},false,['verify'])])assert.throws(()=>createLocalInvocationVerifier(pins,badKey),denied);
 const mutable={...pins},verify=createLocalInvocationVerifier(mutable,k);mutable.databaseUuid='00000000-0000-4000-8000-000000000099';
 assert.equal((await verify(request(await token(k)),now)).localSignatureVerified,true);
});
