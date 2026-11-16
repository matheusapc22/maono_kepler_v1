// Actual local workerd scaffold tests. No deployment, remote access or credentials.
import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {join} from 'node:path';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';
import {DENY_ALL_SCAFFOLD} from '../scripts/d1-synthetic-provision/fixed-core.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));const pkg=process.env.MAONO_LOCAL_WRANGLER_PACKAGE||join(repo,'.tmp/d1-batch-rehearsal-runtime/node_modules/wrangler');const require=createRequire(join(pkg,'package.json'));const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
assert.equal(require('./package.json').version,'4.140.0');assert.equal(require('workerd/package.json').version,'1.20260923.1');
test('local workerd scaffold denies all tested HTTP paths/methods and never touches D1',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:DENY_ALL_SCAFFOLD,host:'127.0.0.1',port:0,cf:false,compatibilityDate:'2026-09-23',resourcePersistencePath:mkdtempSync(join(tmpdir(),'maono-deny-scaffold-')),durableObjects:{REGISTRY:{className:'SyntheticClaimRegistry',useSQLite:true}},d1Databases:{TARGET:'00000000-0000-4000-8000-000000000044'}}));
 try{
  for(const path of ['/','/fixed-batch','/admin','/health','/?sql=DROP'])for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){
   const r=await mf.dispatchFetch('https://local-scaffold.invalid'+path,{method});assert.equal(r.status,403);assert.equal(await r.text(),method==='HEAD'?'':'SYNTHETIC_PILOT_NOT_ENABLED');
  }
  const namespace=await mf.getDurableObjectNamespace('REGISTRY');const stub=namespace.get(namespace.idFromName('local-diagnostic-only'));
  const r=await stub.fetch('https://local-scaffold.invalid/claim',{method:'POST',body:'never processed'});assert.equal(r.status,403);assert.equal(await r.text(),'SYNTHETIC_PILOT_NOT_ENABLED');
  const db=await mf.getD1Database('TARGET');assert.deepEqual((await db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'maono_%'").all()).results,[]);
 }finally{await mf.dispose();}
});
test('source-level fake bindings throw on any access, and all method labels still deny',async()=>{
 const source=DENY_ALL_SCAFFOLD.replace(/^import .*;$/m,'').replace('export class SyntheticClaimRegistry','class SyntheticClaimRegistry').replace('export default','const handler=')+'\nreturn {handler,SyntheticClaimRegistry};';
 const {handler,SyntheticClaimRegistry}=new Function('DurableObject','Response',source)(class {},Response);
 const forbidden=new Proxy({}, {get(){throw Error('BINDING_ACCESS_FORBIDDEN');}});
 for(const method of ['TRACE','CONNECT','GET','POST','UNRECOGNIZED']){
  assert.equal((await handler.fetch({method,url:'https://any.invalid/private'},forbidden)).status,403);
  const instance=new SyntheticClaimRegistry(forbidden,forbidden);assert.equal((await instance.fetch({method},forbidden)).status,403);
 }
});
