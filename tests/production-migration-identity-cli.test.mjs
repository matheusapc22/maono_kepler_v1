import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const migration='0043_organization_creation_identity.sql';
const preload=new URL('./helpers/identity-operator-preload.mjs',import.meta.url).href;
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'identity-cli-offline-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const db=new DatabaseSync(join(root,'fixture.sqlite'));
  // This fixture audits/applies 0043, so start from its certified pre-state.
  db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8').split('-- Organization creation identity (migration 0043)')[0]);
  db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');
  for(const n of ['0007_create_organization_limit_requests.sql','0016_map_panel_navigation_and_quota.sql','0042_organization_management.sql'])
    db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').run(n,'2026-11-06 20:00:00');
  db.exec("INSERT INTO organizations(id,name,slug,dropbox_root_path) VALUES(1,'PRIVATE SYNTHETIC NAME','private-slug','/private/path')");db.close();
  const report=join(root,'audit.json'),post=join(root,'post.json');
  function run(script,args=[],fault=''){
    return spawnSync(process.execPath,['--import',preload,fileURLToPath(new URL('../scripts/migrations/'+script,import.meta.url)),
      '--migration',migration,...args],{encoding:'utf8',windowsHide:true,timeout:30000,
      env:{...process.env,IDENTITY_FIXTURE_ROOT:root,IDENTITY_FIXTURE_FAULT:fault,
        CLOUDFLARE_API_TOKEN:'synthetic-not-a-real-token',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}});
  }
  const audit=run('audit-production.mjs',['--report',report]);assert.equal(audit.status,0,audit.stderr);
  const content=JSON.parse(readFileSync(report,'utf8'));
  assert.doesNotMatch(readFileSync(report,'utf8'),/PRIVATE SYNTHETIC NAME|private-slug|\/private\/path/);
  assert.ok(content.execution.sha256);assert.ok(content.evidenceDigest);
  return {root,report,post,content,run};
}
test('offline actual audit/apply/postvalidate CLI pipeline reports structural proof',t=>{
  const f=fixture(t);const result=f.run('apply-production.mjs',['--audit-report',f.report,'--approval',f.content.approval.token,'--report',f.post]);
  assert.equal(result.status,0,result.stderr);
  const post=JSON.parse(readFileSync(f.post,'utf8'));
  assert.equal(post.complete,true);assert.equal(post.identityPostValidation.schema.compatible,true);
  assert.equal(post.execution.sha256,f.content.execution.sha256);
  assert.doesNotMatch(readFileSync(f.post,'utf8'),/PRIVATE SYNTHETIC NAME|private-slug|\/private\/path/);
  const verify=f.run('post-validate-production.mjs',['--report',join(f.root,'verify.json')]);assert.equal(verify.status,0,verify.stderr);
});
for(const fault of ['final-drift','transaction-drift','post-schema','uncertain-response'])test('offline CLI fails closed: '+fault,t=>{
  const f=fixture(t);const result=f.run('apply-production.mjs',['--audit-report',f.report,'--approval',f.content.approval.token,'--report',f.post],fault);
  assert.notEqual(result.status,0);assert.equal(existsSync(f.post),false);
  const failure=JSON.parse(readFileSync(f.post+'.failure.json','utf8'));
  assert.equal(failure.complete,false);assert.equal(failure.applyStarted,fault!=='final-drift');
  if(fault==='final-drift')assert.equal(existsSync(join(f.root,'writes.log')),false);
  else assert.equal(readFileSync(join(f.root,'writes.log'),'utf8'),'apply-attempt\n');
  const db=new DatabaseSync(join(f.root,'fixture.sqlite'));
  assert.equal(Boolean(db.prepare('SELECT 1 FROM d1_migrations WHERE name=?').get(migration)),['post-schema','uncertain-response'].includes(fault));db.close();
});
test('fresh audit changes approval after same-count rename, so dispatcher cannot bless drift',t=>{
  const f=fixture(t);const db=new DatabaseSync(join(f.root,'fixture.sqlite'));db.exec("UPDATE organizations SET name='New name' WHERE id=1");db.close();
  const report=join(f.root,'fresh.json');const result=f.run('audit-production.mjs',['--report',report]);assert.equal(result.status,0,result.stderr);
  assert.notEqual(JSON.parse(readFileSync(report,'utf8')).approval.hash,f.content.approval.hash);
  const refused=f.run('apply-production.mjs',['--audit-report',report,'--approval',f.content.approval.token,'--report',f.post]);
  assert.notEqual(refused.status,0);assert.equal(existsSync(join(f.root,'writes.log')),false);
});
