import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {randomBytes} from 'node:crypto';
import {buildLocalPilotSource,LOCAL_PILOT_SQL} from '../scripts/d1-synthetic-pilot/local-source.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const pkg=process.env.MAONO_LOCAL_WRANGLER_PACKAGE||join(repo,'.tmp/d1-batch-rehearsal-runtime/node_modules/wrangler');
const require=createRequire(join(pkg,'package.json'));const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
assert.equal(require('./package.json').version,'4.140.0');assert.equal(require('workerd/package.json').version,'1.20260923.1');
const config={enabled:true,accountId:'1988481e4c75c760516161104b7e1e50',databaseUuid:'00000000-0000-4000-8000-000000000044',databaseName:'maono_synthetic_rehearsal_local_pilot',deploymentId:'00000000-0000-4000-8000-000000000001',versionId:'00000000-0000-4000-8000-000000000002',registryNamespaceId:'a'.repeat(32),attemptId:'00000000-0000-4000-8000-000000000003',auditSha256:'b'.repeat(64),audience:'https://maono-synthetic-rehearsal-pilot.invalid/fixed-batch'};
const runtimeModules=['local-invocation-auth.mjs','durable-claim-registry.mjs','remote-protocol-model.mjs'].map(name=>({type:'ESModule',path:join(repo,'scripts/d1-batch-rehearsal',name),contents:readFileSync(join(repo,'scripts/d1-batch-rehearsal',name),'utf8')}));
function start(dir,keyHex,c=config,bindingOverrides={}){
 const build=buildLocalPilotSource(c);
 return new Miniflare(convertV4MiniflareOptions({modules:[{type:'ESModule',path:join(repo,'scripts/d1-synthetic-pilot/generated-local-pilot.mjs'),contents:build.source},...runtimeModules],
  host:'127.0.0.1',port:0,cf:false,compatibilityDate:'2026-09-23',resourcePersistencePath:dir,
  bindings:{LOCAL_REHEARSAL_MODE:'local-only',LOCAL_ACCOUNT_ID:config.accountId,LOCAL_VERSION_ID:config.versionId,LOCAL_TEST_KEY_HEX:keyHex,...bindingOverrides},
  d1Databases:{TARGET:config.databaseUuid},durableObjects:{REGISTRY:{className:'SyntheticClaimRegistry',useSQLite:true}},
 }));
}
async function seed(mf,marker='local-only-v1'){
 const db=await mf.getD1Database('TARGET');
 await db.batch([db.prepare('CREATE TABLE maono_synthetic_pilot_identity (account_id TEXT, database_uuid TEXT, marker TEXT);'),db.prepare('INSERT INTO maono_synthetic_pilot_identity VALUES (?, ?, ?);').bind(config.accountId,config.databaseUuid,marker)]);
}
async function authorization(keyHex,c=config,time=Date.now()){
 const {payloadSha256}=buildLocalPilotSource(c);
 const claims={databaseUuid:c.databaseUuid,payloadSha256,auditSha256:c.auditSha256,attemptId:c.attemptId,deploymentId:c.deploymentId,registryNamespaceId:c.registryNamespaceId,audience:c.audience,issuedAtMs:time-1000,expiresAtMs:time+59000};
 const encoded=Buffer.from(JSON.stringify(claims)).toString('base64url');
 const key=await crypto.subtle.importKey('raw',Buffer.from(keyHex,'hex'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('maono-synthetic-invocation-v1\nPOST\n'+encoded));
 return 'Maono-HMAC '+encoded+'.'+Buffer.from(sig).toString('base64url');
}
async function call(mf,token,url=config.audience,extra={}){const r=await mf.dispatchFetch(url,{method:'POST',headers:{authorization:token},...extra});return {status:r.status,...await r.json()};}
async function rows(mf){const db=await mf.getD1Database('TARGET');return (await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='maono_synthetic_pilot_result'").all()).results;}
test('source generator default disabled/unconfigured; remote/account/production/arbitrary SQL rejected',()=>{
 const disabled=buildLocalPilotSource();assert.equal(disabled.configured,false);assert.equal(disabled.remoteExecutionSupported,false);assert.match(disabled.source,/503/);assert.ok(!disabled.source.includes('batch('));
 for(const change of [{accountId:'09d455fa1cf988b0d9db89987b73eaff'},{databaseUuid:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'},{audience:'https://maono-synthetic-rehearsal-pilot.workers.dev/fixed-batch'},{sql:'DROP TABLE x'},{accountId:[config.accountId]},{enabled:false}])assert.throws(()=>buildLocalPilotSource({...config,...change}));
 assert.equal(LOCAL_PILOT_SQL.length,3);assert.ok(LOCAL_PILOT_SQL.every(s=>!/^\s*(DROP|DELETE|UPDATE)/.test(s)));
});
test('actual local Worker+D1+DO: concurrent invokes grant one batch, restart forbids changed-audit replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'maono-pilot-local-')),keyHex=randomBytes(32).toString('hex');let mf=start(dir,keyHex);
 try{
  await seed(mf);const token=await authorization(keyHex);const results=await Promise.all(Array.from({length:8},()=>call(mf,token)));
  assert.equal(results.filter(r=>r.outcome==='returned-unverified').length,1);assert.equal(results.filter(r=>r.outcome==='denied-replay').length,7);
  const db=await mf.getD1Database('TARGET');assert.deepEqual((await db.prepare('SELECT id,label FROM maono_synthetic_pilot_result').all()).results,[{id:1,label:'local-fixed-pilot-v1'}]);
  for(const r of results){assert.equal(r.localRehearsalOnly,true);assert.equal(r.remoteIdentityAuthenticated,false);assert.equal(r.operationalAuthorization,false);assert.equal(r.retryAllowed,false);}
  await mf.dispose();const changed={...config,auditSha256:'c'.repeat(64)};mf=start(dir,keyHex,changed);
  assert.equal((await call(mf,await authorization(keyHex,changed))).outcome,'denied-replay');
 }finally{await mf.dispose();}
});
test('bad auth, host, query, body and expiry do not consume claim or write target',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'maono-pilot-local-')),keyHex=randomBytes(32).toString('hex');const mf=start(dir,keyHex);
 try{
  await seed(mf);const token=await authorization(keyHex);
  for(const [auth,url,extra]of [['Bearer bad',config.audience,{}],[token,config.audience+'?sql=DROP',{}],[token,config.audience.replace('.invalid','.example.com'),{}],[token,config.audience,{body:'SELECT 1'}],[token,config.audience,{method:'GET'}],[await authorization(keyHex,config,Date.now()-120000),config.audience,{}]])assert.equal((await call(mf,auth,url,extra)).outcome,'denied');
  assert.deepEqual(await rows(mf),[]);assert.equal((await call(mf,token)).outcome,'returned-unverified');
 }finally{await mf.dispose();}
});
test('wrong local runtime version/account declarations deny before claim; declarations never prove remote identity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'maono-pilot-local-')),keyHex=randomBytes(32).toString('hex');let mf=start(dir,keyHex,config,{LOCAL_VERSION_ID:'wrong'});
 try{
  await seed(mf);assert.equal((await call(mf,await authorization(keyHex))).outcome,'denied');assert.deepEqual(await rows(mf),[]);
  await mf.dispose();mf=start(dir,keyHex,config,{LOCAL_ACCOUNT_ID:'wrong'});assert.equal((await call(mf,await authorization(keyHex))).outcome,'denied');
  await mf.dispose();mf=start(dir,keyHex);assert.equal((await call(mf,await authorization(keyHex))).outcome,'returned-unverified');
 }finally{await mf.dispose();}
});
test('failed local sentinel guard yields UNKNOWN and permanently closed claim across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'maono-pilot-local-')),keyHex=randomBytes(32).toString('hex');let mf=start(dir,keyHex);
 try{
  await seed(mf,'wrong-fixture');const first=await call(mf,await authorization(keyHex));assert.equal(first.outcome,'unknown');assert.equal(first.retryAllowed,false);assert.deepEqual(await rows(mf),[]);
  await mf.dispose();mf=start(dir,keyHex);assert.equal((await call(mf,await authorization(keyHex))).outcome,'denied-replay');assert.deepEqual(await rows(mf),[]);
 }finally{await mf.dispose();}
});
test('discarded local acknowledgement then restart: reconcile rows read-only and never repeat batch',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'maono-pilot-local-')),keyHex=randomBytes(32).toString('hex');let mf=start(dir,keyHex);
 try{
  await seed(mf);const response=await mf.dispatchFetch(config.audience,{method:'POST',headers:{authorization:await authorization(keyHex)}});await response.body.cancel(); // simulation, not a real network fault
  await mf.dispose();mf=start(dir,keyHex);assert.equal((await call(mf,await authorization(keyHex))).outcome,'denied-replay');
  const db=await mf.getD1Database('TARGET');assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM maono_synthetic_pilot_result').all()).results[0].count,1);
 }finally{await mf.dispose();}
});
