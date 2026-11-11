import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistenceFixture } from './helpers/project-persistence-fixture.mjs';
import { onRequest } from '../functions/api/admin/organization-management/[[path]].js';
import { canonicalOrganizationName } from '../functions/_lib/organization-name.js';
const bootstrap=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
const preIdentity=bootstrap.split('-- Organization creation identity (migration 0043)')[0];

test('pinned preparation runtime retains its original real-route proofs before and after 0043', t=>{
  // Run the original test and product sources verbatim: preparation compatibility
  // is historical evidence, distinct from the new runtime's schema requirement.
  const revision='4386083dec4522f380559d3871e3140451e7e8d7';
  const root=mkdtempSync(join(tmpdir(),'identity-runtime-historical-'));
  t.after(()=>{
    assert.equal(dirname(resolve(root)),resolve(tmpdir()));
    assert.ok(basename(root).startsWith('identity-runtime-historical-'));
    rmSync(root,{recursive:true,force:true});
  });
  const archive=execFileSync('git',['archive',revision,'functions','migrations','schema.sql','package.json',
    'tests/helpers/project-persistence-fixture.mjs','tests/production-migration-identity-runtime.test.mjs'],
  {cwd:fileURLToPath(new URL('..',import.meta.url)),maxBuffer:64*1024*1024,windowsHide:true});
  execFileSync('tar',['-x','-C',root],{input:archive,windowsHide:true});
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/production-migration-identity-runtime.test.mjs'],
    {cwd:root,env,encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(result.status,0,result.error?.message || result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/# tests 2\b/);assert.match(result.stdout,/# pass 2\b/);
});

function fixture(t,schemaSql=bootstrap){
  const f=persistenceFixture(t,{schemaSql});
  f.env.ORGANIZATION_MANAGEMENT_V1='true';f.db.exec("UPDATE users SET role='super_admin' WHERE id=1");
  f.call=async(path,body,headers={})=>{
    const request=new Request('https://local.invalid/api/admin/organization-management'+path,{method:body===undefined?'GET':'POST',
      headers:{...f.headers(1),Origin:'https://local.invalid','Content-Type':'application/json','X-Maono-Management':'1',...headers},
      body:body===undefined?undefined:JSON.stringify(body)});
    const result=await onRequest({env:f.env,request});return {status:result.status,data:await result.json()};
  };
  f.ok=async(...args)=>{const result=await f.call(...args);assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};
  return f;
}

test('functional runtime refuses 0042 before reads or creation can advance',async t=>{
  const f=fixture(t,preIdentity);
  const before=f.db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n;
  for(const [path,body] of [['/organizations',undefined],['/operations',{kind:'create',items:[{name:'Requires identity',plan:'pro',ownerEmail:'other@offline.invalid'}]}]]){
    const result=await f.call(path,body,{'Idempotency-Key':crypto.randomUUID()});
    assert.equal(result.status,503);assert.equal(result.data.error.code,'ORGANIZATION_MANAGEMENT_SCHEMA_REQUIRED');
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n,before);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM organization_management_operations').get().n,0);
});

test('functional runtime creates and renames with canonical identities after import retirement',async t=>{
  // Current real route/session/ACL/lifecycle; only external Dropbox is simulated.
  const f=fixture(t);await f.ok('/organizations');
  for(const kind of ['create']){
    const slug='legacy-'+kind;
    const name='Functional runtime '+kind;
    const operation=await f.ok('/operations',{kind,items:[{name,slug,description:'Offline',plan:'pro',ownerEmail:'other@offline.invalid'}]},
      {'Idempotency-Key':crypto.randomUUID()});
    const result=await f.ok(`/operations/${operation.id}/step`,{});assert.equal(result.items[0].state,'succeeded',JSON.stringify(result));
    const row=f.db.prepare('SELECT * FROM organizations WHERE id=?').get(result.items[0].result.id);
    assert.equal(row.management_owner_id,2);assert.equal(row.storage_status,'READY');
    if(kind==='create')assert.match(row.slug,/^functional-runtime-create-\d{9}$/);else assert.equal(row.slug,slug);
    assert.equal(row.canonical_name,canonicalOrganizationName(name));
    const change=await f.ok('/operations',{kind:'change',items:[{id:row.id,version:row.management_version,name:'Renamed '+kind,reason:'Offline compatibility'}]},
      {'Idempotency-Key':crypto.randomUUID()});
    assert.equal((await f.ok(`/operations/${change.id}/step`,{})).items[0].state,'succeeded');
    const renamed=f.db.prepare('SELECT * FROM organizations WHERE id=?').get(row.id);
    assert.equal(renamed.canonical_name,canonicalOrganizationName('Renamed '+kind));
    assert.equal(renamed.slug,row.slug);assert.equal(renamed.dropbox_root_path,row.dropbox_root_path);
    const detail=await f.ok('/organizations/'+row.id);
    assert.equal(detail.organization.owner.id,2);assert.equal(detail.organization.storageStatus,'READY');
    assert.equal(detail.organization.active,true);assert.equal(detail.creationConfirmed,true);
  }
});

test('current runtime rejects new imports without changing retained organization data',async t=>{
  const f=fixture(t);const before=f.db.prepare('SELECT COUNT(*) n FROM organizations').get().n;
  const result=await f.call('/operations',{kind:'import',items:[{name:'Retired import',slug:'retired-import',plan:'pro',ownerEmail:'other@offline.invalid'}]},{'Idempotency-Key':crypto.randomUUID()});
  assert.equal(result.status,410);assert.equal(result.data.error.code,'ORGANIZATION_IMPORT_RETIRED');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organizations').get().n,before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_management_operations').get().n,0);
});
