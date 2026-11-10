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
  db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');
  for(const n of ['0007_create_organization_limit_requests.sql','0016_map_panel_navigation_and_quota.sql','0042_organization_management.sql'])
    db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').run(n,'2026-11-06 20:00:00');
  db.exec("INSERT INTO organizations(id,name,slug,dropbox_root_path) VALUES(1,'PRIVATE SYNTHETIC NAME','private-slug','/private/path')");db.close();
  const report=join(root,'audit.json'),post=join(root,'post.json');
  function run(script,args=[],fault=''){
    return spawnSync(process.execPath,['--import',preload,fileURLToPath(new URL('../scripts/migrations/'+script,import.meta.url)),
      '--migration',migration,...args],{encoding:'utf8',windowsHide:true,timeout:30000,
      env:{...process.env,IDENTITY_FIXTURE_ROOT:root,IDENTITY_FIXTURE_FAULT:fault,
        NODE_NO_WARNINGS:'1',
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

const readStages=['D1_INFO','D1_LEDGER','D1_QUICK_CHECK','D1_FOREIGN_KEY_CHECK','ORGANIZATION_IDENTITY_SNAPSHOT'];
function assertSanitizedFailure(result,stage,code='WRANGLER_COMMAND_FAILED',exit=17) {
  assert.equal(result.status,1,result.stderr);
  assert.equal(result.stdout,'');
  assert.doesNotMatch(result.stderr,/PRIVATE|Bearer|SELECT|private\.example|private-slug|synthetic-not-a-real-token/);
  const failure=JSON.parse(result.stderr);
  assert.equal(failure.error.code,code);
  assert.equal(failure.error.diagnostic.stage,stage);
  assert.equal(failure.error.diagnostic.exitCode,exit);
  assert.deepEqual(Object.keys(failure.error).sort(),['code','diagnostic','message']);
  return failure;
}
for(const script of ['audit-production.mjs','post-validate-production.mjs']) {
  const stages=script==='audit-production.mjs'?[...readStages,'D1_TIME_TRAVEL_INFO']:readStages;
  for(const stage of stages)test('offline '+script+' reports only sanitized read failure: '+stage,t=>{
    const f=fixture(t);
    if(script==='post-validate-production.mjs') {
      const applied=f.run('apply-production.mjs',['--audit-report',f.report,'--approval',f.content.approval.token,'--report',f.post]);
      assert.equal(applied.status,0,applied.stderr);
    }
    const path=join(f.root,'must-not-exist.json');
    const failure=assertSanitizedFailure(f.run(script,['--report',path],'read-failure:'+stage),stage);
    assert.deepEqual(Object.keys(failure).sort(),['error','ok','writesPerformed']);
    assert.equal(failure.ok,false);assert.equal(failure.writesPerformed,false);
    assert.deepEqual(failure.error.diagnostic.categories,['SQLITE_AUTH','NETWORK_TIMEOUT']);
    assert.equal(existsSync(path),false);assert.equal(existsSync(path+'.failure.json'),false);
    if(script==='audit-production.mjs')assert.equal(existsSync(join(f.root,'writes.log')),false);
    else assert.equal(readFileSync(join(f.root,'writes.log'),'utf8'),'apply-attempt\n');
  });
  for(const [fault,code,exit] of [['spawn-failure','WRANGLER_COMMAND_FAILED',null],['empty-json','WRANGLER_EMPTY_JSON',0],['invalid-json','WRANGLER_INVALID_JSON',0]]) {
    test('offline '+script+' fails closed on '+fault,t=>{
      const f=fixture(t),path=join(f.root,'invalid-response.json');
      const failure=assertSanitizedFailure(f.run(script,['--report',path],fault+':D1_INFO'),'D1_INFO',code,exit);
      assert.equal(failure.writesPerformed,false);assert.equal(existsSync(path),false);
      assert.equal(existsSync(join(f.root,'writes.log')),false);
    });
  }
}
for(const afterWrite of [false,true])test('offline apply read failure preserves write uncertainty: '+afterWrite,t=>{
  const f=fixture(t),stage='ORGANIZATION_IDENTITY_SNAPSHOT';
  const result=f.run('apply-production.mjs',['--audit-report',f.report,'--approval',f.content.approval.token,'--report',f.post],
    (afterWrite?'post-read-failure:':'read-failure:')+stage);
  const failure=assertSanitizedFailure(result,stage);
  assert.equal(failure.complete,false);assert.equal(failure.applyStarted,afterWrite);
  assert.equal(failure.applyCompleted,afterWrite);assert.equal(failure.writesMayHaveOccurred,afterWrite);
  assert.equal(existsSync(f.post),false);
  assert.deepEqual(JSON.parse(readFileSync(f.post+'.failure.json','utf8')),failure);
  if(afterWrite)assert.equal(readFileSync(join(f.root,'writes.log'),'utf8'),'apply-attempt\n');
  else assert.equal(existsSync(join(f.root,'writes.log')),false);
});
