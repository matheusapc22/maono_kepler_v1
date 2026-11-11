import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {persistenceFixture} from './helpers/project-persistence-fixture.mjs';
import {onRequest} from '../functions/api/admin/organization-management/[[path]].js';
import {onRequest as legacy} from '../functions/api/admin/organizations/[id].js';
const phrase='EXCLUIR PERMANENTEMENTE';
function fixture(t,options={}) {
  let exists=true,removeCount=0,fail=options.fail||false,changed=false;
  const f=persistenceFixture(t,{...options.hooks,beforeProvider:async call=>{
    const {op,args}=call;
    if(op==='get_metadata'&&args.path.startsWith('/organizations/'))return options.legacy?Response.json({'.tag':'folder',id:'id:legacy',path_lower:args.path}):Response.json({error_summary:'path/not_found/...'}, {status:409});
    if(options.provider)return options.provider(call);
    if(op==='get_metadata')return exists?Response.json({'.tag':'folder',id:changed?'id:replacement':'id:delete-qa',path_lower:'/projects/delete-qa'}):Response.json({error_summary:'path/not_found/...'}, {status:409});
    if(op==='list_folder')return Response.json({entries:options.entries||[],has_more:false});
    if(op==='delete_v2'){removeCount++;assert.equal(args.path,'id:delete-qa');if(fail)return Response.json({error_summary:'permission_denied'}, {status:403});exists=false;return Response.json({metadata:{'.tag':'folder',id:'id:delete-qa'}});}
    throw new Error('Unexpected provider '+op);
  }});
  f.env.ORGANIZATION_MANAGEMENT_V1='true';f.env.ORGANIZATION_PERMANENT_DELETE_V1='true';
  f.db.exec(`UPDATE users SET role='super_admin' WHERE id=1;
    INSERT INTO organizations(id,name,slug,dropbox_root_path,active,storage_status,updated_at) VALUES(3,'Delete QA','delete-qa','/projects/delete-qa',0,'DISABLED','2020-01-01 00:00:00');
    INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(3,1,'owner');
    UPDATE organizations SET management_owner_id=1 WHERE id=3;
    UPDATE organizations SET updated_at='2020-01-01 00:00:00' WHERE id=3;`);
  f.version=()=>f.db.prepare('SELECT management_version v FROM organizations WHERE id=3').get().v;
  f.call=async(path,body,headers={},user=1)=>{const response=await onRequest({env:f.env,request:new Request('https://local.invalid/api/admin/organization-management'+path,{method:body===undefined?'GET':'POST',headers:{...f.headers(user),Origin:'https://local.invalid','Content-Type':'application/json','X-Maono-Management':'1',...headers},body:body===undefined?undefined:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
  f.start=async(key=crypto.randomUUID())=>{const r=await f.call('/organizations/3/permanent-delete',{version:f.version(),confirmation:phrase},{'Idempotency-Key':key});assert.equal(r.status,200,JSON.stringify(r.data));f.db.prepare("UPDATE organization_deletions SET not_before='2020-01-01T00:00:00Z' WHERE id=?").run(r.data.deletion.id);return r.data.deletion;};
  f.step=async d=>(await f.call(`/deletions/${d.id}/step`,{})).data.deletion;
  f.removeCount=()=>removeCount;f.setFail=x=>fail=x;f.changeFolder=()=>changed=true;
  return f;
}
test('empty organization: real HTTP, session, ACL, SQL and Dropbox adapter delete by immutable ID; audit and global users survive',async t=>{
  const f=fixture(t);const p=await f.call('/organizations/3/deletion-preview');assert.equal(p.status,200);assert.equal(p.data.eligible,true,JSON.stringify(p.data));
  const d=await f.start();assert.equal(d.state,'pending');assert.equal(f.removeCount(),0);
  assert.equal((await f.step(d)).state,'completed');assert.equal(f.removeCount(),1);
  assert.equal(f.db.prepare('SELECT * FROM organizations WHERE id=3').get(),undefined);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n,2);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organizations').get().n,2);
  assert.ok(f.db.prepare('SELECT COUNT(*) n FROM organization_deleted_management_events WHERE organization_id=3').get().n>0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_deletion_audit').get().n,3);
  assert.equal((await f.step(d)).state,'completed');assert.equal(f.removeCount(),1);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
test('confirmation must match literally, metadata version must match, and cross-origin/non-super-admin fail before provider',async t=>{
  const f=fixture(t);
  for(const confirmation of ['',phrase+' ',phrase.toLowerCase(),' '+phrase]){const r=await f.call('/organizations/3/permanent-delete',{version:f.version(),confirmation},{'Idempotency-Key':crypto.randomUUID()});assert.equal(r.status,400);}
  assert.equal((await f.call('/organizations/3/permanent-delete',{version:999,confirmation:phrase},{'Idempotency-Key':crypto.randomUUID()})).status,412);
  assert.equal((await f.call('/organizations/3/permanent-delete',{version:f.version(),confirmation:phrase},{Origin:'https://evil.invalid','Idempotency-Key':crypto.randomUUID()})).status,403);
  assert.equal((await f.call('/organizations/3/deletion-preview',undefined,{},2)).status,403);
  assert.equal(f.removeCount(),0);
});
test('flag disabled and missing migration fail closed',async t=>{
  const f=fixture(t);f.env.ORGANIZATION_PERMANENT_DELETE_V1='false';assert.equal((await f.call('/organizations/3/deletion-preview')).status,503);
  f.env.ORGANIZATION_PERMANENT_DELETE_V1='true';f.db.exec('DROP TABLE organization_deleted_management_events');assert.equal((await f.call('/organizations/3/deletion-preview')).status,503);assert.equal(f.removeCount(),0);
});
test('paused drain required and active organization blocked',async t=>{
  const f=fixture(t);f.db.exec("UPDATE organizations SET active=1,updated_at=CURRENT_TIMESTAMP WHERE id=3");
  const p=(await f.call('/organizations/3/deletion-preview')).data;assert.ok(p.blockers.some(x=>x.code==='PAUSE_REQUIRED'));assert.ok(p.blockers.some(x=>x.code==='STORAGE_DRAIN_REQUIRED'));
});
test('inactive business data blocks and is never cascaded',async t=>{
  const f=fixture(t);f.db.exec("INSERT INTO projects(id,organization_id,name,slug,active,dropbox_root_path) VALUES(90,3,'Dormant','dormant',0,'/projects/delete-qa/dormant')");
  assert.equal((await f.call('/organizations/3/deletion-preview')).data.eligible,false);assert.equal(f.removeCount(),0);
});
for(const ddl of ["CREATE TABLE unknown_data(id INTEGER PRIMARY KEY,organization_id INTEGER)","CREATE TABLE custom_tenant(id INTEGER PRIMARY KEY,tenant_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE)"])
test('unknown dependency fails closed: '+ddl,async t=>{const f=fixture(t);f.db.exec(ddl);const p=(await f.call('/organizations/3/deletion-preview')).data;assert.ok(p.blockers.some(x=>x.code==='UNGUARDED_DEPENDENCY'));});
test('exclusive canonical path required',async t=>{
  const f=fixture(t);f.db.exec("UPDATE organizations SET dropbox_root_path='/projects' WHERE id=3");assert.equal((await f.call('/organizations/3/deletion-preview')).data.eligible,false);
  f.db.exec("UPDATE organizations SET dropbox_root_path='/projects/delete-qa' WHERE id=3; UPDATE organizations SET dropbox_root_path='/projects/delete-qa/child' WHERE id=2;");assert.equal((await f.call('/organizations/3/deletion-preview')).data.eligible,false);
});
test('claim blocks concurrent updates, new business rows, path overlaps and replay after completion',async t=>{
  const f=fixture(t),d=await f.start();
  assert.throws(()=>f.db.exec('UPDATE organizations SET active=1 WHERE id=3'),/ORGANIZATION_DELETION_LOCKED/);
  assert.throws(()=>f.db.exec("INSERT INTO projects(id,organization_id,name,slug) VALUES(91,3,'Race','race')"),/ORGANIZATION_DELETION_LOCKED/);
  assert.throws(()=>f.db.exec("UPDATE organizations SET dropbox_root_path='/projects/delete-qa/nested' WHERE id=2"),/ORGANIZATION_DELETION_LOCKED/);
  assert.equal((await f.step(d)).state,'completed');
  assert.throws(()=>f.db.exec("INSERT INTO organizations(name,slug,dropbox_root_path) VALUES('Replay','delete-qa','/projects/delete-qa')"),/ORGANIZATION_DELETION_LOCKED/);
});
test('provider failure is retained as pending with sanitized audit and explicit retry; replaced folder cannot be deleted',async t=>{
  const f=fixture(t,{fail:true}),d=await f.start();const first=await f.step(d);assert.equal(first.state,'pending');assert.equal(first.errorCode,'ORGANIZATION_DELETE_PROVIDER_FAILED');assert.ok(f.db.prepare('SELECT 1 FROM organizations WHERE id=3').get());
  f.setFail(false);f.changeFolder();const next=await f.step(d);assert.equal(next.state,'pending');assert.equal(next.errorCode,'ORGANIZATION_DELETE_FOLDER_CHANGED');assert.equal(f.removeCount(),1);
});
test('unindexed files in provider block deletion',async t=>{const f=fixture(t,{entries:[{'.tag':'file',path_lower:'/projects/delete-qa/unknown.txt'}]}),d=await f.start();assert.equal((await f.step(d)).errorCode,'ORGANIZATION_DELETE_STORAGE_NOT_EMPTY');assert.equal(f.removeCount(),0);});
test('lost D1 finalization retries from storage checkpoint without deleting twice',async t=>{
  let once=true;
  const f=fixture(t,{hooks:{beforeBatch:({statements})=>{if(once&&statements.some(s=>s.sql.startsWith('INSERT INTO organization_deleted_management_events'))){once=false;throw new Error('Injected D1 interruption');}}}}),d=await f.start();
  assert.equal((await f.step(d)).state,'storage_deleted');assert.equal(f.removeCount(),1);assert.ok(f.db.prepare('SELECT 1 FROM organizations WHERE id=3').get());
  assert.equal((await f.step(d)).state,'completed');assert.equal(f.removeCount(),1);
});
test('idempotency survives lost start response, conflicting key rejected and other actors cannot read operation',async t=>{
  const f=fixture(t),key=crypto.randomUUID(),version=f.version(),d=await f.start(key);
  const again=await f.call('/organizations/3/permanent-delete',{version,confirmation:phrase},{'Idempotency-Key':key});assert.equal(again.data.deletion.id,d.id);
  assert.equal((await f.call('/deletions/by-key?key='+key)).data.deletion.id,d.id);
  assert.equal((await f.call('/organizations/2/permanent-delete',{version,confirmation:phrase},{'Idempotency-Key':key})).status,409);
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=2");assert.equal((await f.call(`/deletions/${d.id}`,undefined,{},2)).status,404);
});
test('import APIs and pending import steps retired while stored history remains readable',async t=>{
  const f=fixture(t);assert.equal((await f.call('/import/validate',{csv:'anything'})).status,410);
  assert.equal((await f.call('/operations',{kind:'import',items:[]},{'Idempotency-Key':crypto.randomUUID()})).status,410);
  f.db.exec(`INSERT INTO organization_management_operations(id,actor_id,idempotency_key,payload_hash,kind,payload_json) VALUES('historic',1,'historic-import-key','hash','import','[]');`);
  assert.equal((await f.call('/operations/historic')).status,200);assert.equal((await f.call('/operations/historic/step',{})).status,410);assert.equal(f.removeCount(),0);
});
test('legacy DELETE cannot bypass exact confirmation/new lifecycle',async t=>{
  const f=fixture(t);const r=await legacy({env:f.env,params:{id:'3'},request:new Request('https://local.invalid/api/admin/organizations/3?dropbox=true',{method:'DELETE',headers:f.headers()})});assert.equal(r.status,410);assert.ok(f.db.prepare('SELECT 1 FROM organizations WHERE id=3').get());assert.equal(f.removeCount(),0);
});
test('migration and canonical bootstrap match with foreign keys enabled',()=>{
  const source=readFileSync(new URL('../schema.sql',import.meta.url),'utf8'),db=new DatabaseSync(':memory:');
  try{db.exec(source.split('-- Organization permanent deletion (migration 0044)')[0]);db.exec(readFileSync(new URL('../migrations/0044_organization_permanent_deletion.sql',import.meta.url),'utf8'));assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
});

test('durable post-claim drain performs no provider calls until deadline',async t=>{
  const f=fixture(t),version=f.version();const started=await f.call('/organizations/3/permanent-delete',{version,confirmation:phrase},{'Idempotency-Key':crypto.randomUUID()});
  assert.equal(started.status,200);const d=started.data.deletion;
  assert.ok(Date.parse(d.notBefore)>Date.now());const result=await f.step(d);
  assert.equal(result.state,'pending');assert.equal(result.errorCode,'ORGANIZATION_DELETE_DRAINING');assert.equal(f.calls.length,0);
});
test('missing original path does not certify deletion of a moved pinned folder',async t=>{
  let moved=false;
  const missing=()=>Response.json({error_summary:'path/not_found/...'}, {status:409});
  const f=fixture(t,{provider:({op,args})=>{
    if(op==='get_metadata')return moved&&args.path==='/projects/delete-qa'?missing():Response.json({'.tag':'folder',id:'id:delete-qa',path_lower:moved?'/outside/moved':'/projects/delete-qa'});
    if(op==='list_folder')return Response.json({entries:[],has_more:false});
    if(op==='delete_v2')return Response.json({error_summary:'permission_denied'},{status:403});
    throw new Error('Unexpected '+op);
  }}),d=await f.start();
  assert.equal((await f.step(d)).state,'pending');moved=true;
  const retry=await f.step(d);assert.equal(retry.state,'pending');assert.equal(retry.errorCode,'ORGANIZATION_DELETE_STORAGE_UNVERIFIED');assert.ok(f.db.prepare('SELECT 1 FROM organizations WHERE id=3').get());
});
test('storage checkpoint retry rechecks replacement root before D1 finalization',async t=>{
  let once=true,exists=true,replaced=false;
  const missing=()=>Response.json({error_summary:'path/not_found/...'}, {status:409});
  const f=fixture(t,{hooks:{beforeBatch:({statements})=>{if(once&&statements.some(s=>s.sql.startsWith('INSERT INTO organization_deleted_management_events'))){once=false;throw new Error('D1 interruption');}}},provider:({op,args})=>{
    if(op==='get_metadata')return (exists||(replaced&&args.path==='/projects/delete-qa'))?Response.json({'.tag':'folder',id:replaced?'id:replacement':'id:delete-qa',path_lower:'/projects/delete-qa'}):missing();
    if(op==='list_folder')return Response.json({entries:[],has_more:false});
    if(op==='delete_v2'){exists=false;return Response.json({metadata:{'.tag':'folder'}});}
    throw new Error('Unexpected '+op);
  }}),d=await f.start();
  assert.equal((await f.step(d)).state,'storage_deleted');replaced=true;
  const retry=await f.step(d);assert.equal(retry.state,'storage_deleted');assert.equal(retry.errorCode,'ORGANIZATION_DELETE_STORAGE_UNVERIFIED');assert.ok(f.db.prepare('SELECT 1 FROM organizations WHERE id=3').get());
});
test('Super Admin revocation after inventory is rechecked before provider removal',async t=>{
  let f,removes=0;
  f=fixture(t,{provider:({op,db})=>{
    if(op==='get_metadata')return Response.json({'.tag':'folder',id:'id:delete-qa',path_lower:'/projects/delete-qa'});
    if(op==='list_folder'){db.exec("UPDATE users SET role='client' WHERE id=1");return Response.json({entries:[],has_more:false});}
    if(op==='delete_v2'){removes++;throw new Error('Must not delete');}
  }});
  const d=await f.start();await f.call(`/deletions/${d.id}/step`,{});assert.equal(removes,0);assert.ok(f.db.prepare('SELECT 1 FROM organizations WHERE id=3').get());
});

test('unindexed legacy organization storage blocks instead of deleting an unapproved second root',async t=>{
  const f=fixture(t,{legacy:true}),d=await f.start();const r=await f.step(d);
  assert.equal(r.state,'pending');assert.equal(r.errorCode,'ORGANIZATION_DELETE_LEGACY_STORAGE');assert.equal(f.removeCount(),0);assert.ok(f.db.prepare('SELECT 1 FROM organizations WHERE id=3').get());
});

test('real routes stay below Free D1 invocation budget with bounded read batches and unchanged safeguards',async t=>{
  const f=fixture(t),original=f.env.DB;let calls=0,batchSizes=[];
  f.env.DB={...original,prepare(sql){const result=original.prepare(sql);for(const method of ['first','all','run']){const execute=result[method];result[method]=function(...args){calls++;return execute.apply(this,args);};}return result;},batch(statements){calls++;batchSizes.push(statements.length);return original.batch(statements);}};
  async function measured(label,run){calls=0;batchSizes=[];const value=await run();assert.ok(calls<50,`${label}: ${calls} D1 calls exceed Free invocation budget`);assert.ok(batchSizes.every(size=>size<=64),`${label}: oversized batch`);t.diagnostic(`${label}: ${calls} D1 calls; batches ${batchSizes.join(',')}`);return value;}
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n,107);
  const p=await measured('preview',()=>f.call('/organizations/3/deletion-preview'));assert.equal(p.data.eligible,true);
  const d=await measured('start',()=>f.start());
  assert.equal((await measured('step with real Dropbox adapter',()=>f.step(d))).state,'completed');
  assert.equal((await measured('status',()=>f.call(`/deletions/${d.id}`))).status,200);
});
test('failed or incomplete batched introspection stops before claiming or provider access',async t=>{
  for(const mode of ['throw','missing-result','empty-columns']){
    const f=fixture(t),original=f.env.DB.batch.bind(f.env.DB);
    f.env.DB.batch=async statements=>{
      if(statements[0]?.sql.startsWith('PRAGMA table_info')){
        if(mode==='throw')throw new Error('Synthetic read failure');
        const results=await original(statements);if(mode==='missing-result')return results.slice(1);results[0]={results:[]};return results;
      }
      return original(statements);
    };
    const p=await f.call('/organizations/3/deletion-preview');assert.ok(p.status>=500,mode);assert.equal(f.removeCount(),0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_deletions').get().n,0);
  }
});
