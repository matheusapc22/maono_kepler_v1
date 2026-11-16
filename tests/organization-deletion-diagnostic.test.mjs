import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {DIAGNOSTIC_QUERIES,dependencyQuery,collectDeletionDiagnostic,validateDiagnosticContext} from '../scripts/migrations/organization-deletion-diagnostic.mjs';
import {IDENTITY_MIGRATION,IDENTITY_MIGRATION_SHA256,IDENTITY_SNAPSHOT_SQL} from '../scripts/migrations/organization-identity-0043.mjs';
import {PRODUCTION_DATABASE_NAME,PRODUCTION_DATABASE_ID} from '../scripts/migrations/production-migration-lib.mjs';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(source('schema.sql').split('-- Organization permanent deletion (migration 0044)')[0]);
 db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');
 ['0007_create_organization_limit_requests.sql','0016_map_panel_navigation_and_quota.sql','0042_organization_management.sql',IDENTITY_MIGRATION].forEach((n,i)=>db.prepare('INSERT INTO d1_migrations VALUES(?,?,?)').run(i+1,n,'2026-11-16 00:00:00'));
 db.prepare('INSERT INTO organizations(id,name,slug,dropbox_root_path,active,storage_status) VALUES(?,?,?,?,?,?)')
   .run(10,'PRIVATE QA NAME','maono-qa-organizacoes-20261102','/projects/maono-qa-organizacoes-20261102',0,'READY');
 return db;
}
function runner(db,calls,{drift=false,extra=false}={}){
 let snapshots=0;
 return {runProcess:async(_cmd,args)=>{
  const sql=args[args.indexOf('--command')+1];
  if(args.includes('--command')){
   assert.ok(sql===IDENTITY_SNAPSHOT_SQL || Object.values(DIAGNOSTIC_QUERIES).includes(sql) || /^SELECT COUNT\(\*\) AS n FROM "[a-zA-Z_][a-zA-Z_0-9]*" WHERE organization_id=10;$/.test(sql));
   assert.equal(db.prepare(sql).columns().length>0,true);
   calls.push(sql);
   let rows=db.prepare(sql).all();
   if(sql===DIAGNOSTIC_QUERIES.target){snapshots++; if(drift&&snapshots===2) rows[0].version++;if(extra)rows[0].secret='PRIVATE';}
   return {code:0,stdout:JSON.stringify([{success:true,results:rows}]),stderr:''};
  }
  assert.ok(args.includes('time-travel')&&args.includes('info'));
  return {code:0,stdout:JSON.stringify({bookmark:'00000001-00000001-00000001-00000001'}),stderr:''};
 }};
}
const remote=db=>({identity:{name:PRODUCTION_DATABASE_NAME,id:PRODUCTION_DATABASE_ID},
 ledger:db.prepare('SELECT id,name,applied_at AS appliedAt FROM d1_migrations ORDER BY id').all(),localMigrations:[IDENTITY_MIGRATION]});
const migration={name:IDENTITY_MIGRATION,sha256:IDENTITY_MIGRATION_SHA256};
test('post-0043 fixed-target collector performs reads only and minimizes evidence',async t=>{
 const db=fixture(t),calls=[],before=db.prepare('SELECT total_changes() n').get().n;
 const report=await collectDeletionDiagnostic('fake',remote(db),migration,runner(db,calls));
 assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
 assert.equal(report.organizationId,10); assert.equal(report.writesPerformed,false);
 for(const key of ['storageProviderVerified','flagsObserved','deletionEligibilityVerified','migrationAuthorized','activationAuthorized'])assert.equal(report[key],false);
 assert.ok(!JSON.stringify(report).includes('PRIVATE'));assert.ok(!JSON.stringify(report).includes('/projects/'));
 assert.equal(calls.filter(s=>s===DIAGNOSTIC_QUERIES.target).length,2);
});
test('drift and unexpected returned fields fail closed',async t=>{
 for(const option of [{drift:true},{extra:true}]){
  const db=fixture(t);await assert.rejects(collectDeletionDiagnostic('fake',remote(db),migration,runner(db,[],option)),{code:'DELETION_DIAGNOSTIC_BLOCKED'});
 }
});
test('missing or substituted target fails without granting eligibility',async t=>{
 const db=fixture(t);db.exec('DELETE FROM organizations WHERE id=10');
 await assert.rejects(collectDeletionDiagnostic('fake',remote(db),migration,runner(db,[])));
});
test('identifier and execution scope reject arbitrary SQL/local use',()=>{
 for(const bad of ['x"; DROP TABLE organizations;--','x.y','',null])assert.throws(()=>dependencyQuery(bad));
 assert.throws(()=>validateDiagnosticContext({}, {}, IDENTITY_MIGRATION));
 const code=source('scripts/migrations/diagnose-organization-deletion-production.mjs');
 assert.ok(code.indexOf('validateDiagnosticContext(process.env')<code.indexOf('requireCloudflareEnvironment();'));
 assert.ok(!code.includes('runWranglerApply'));
});
test('existing operator keeps protected environment, fixed migration and no free-form query input',()=>{
 const y=source('.github/workflows/production-d1-migration-operator.yml');
 assert.ok(y.includes('environment: production-d1-migrations'));
 assert.ok(y.includes('- organization-deletion-diagnostic'));
 assert.ok(y.includes('node scripts/migrations/diagnose-organization-deletion-production.mjs --migration "$MIGRATION"'));
 assert.ok(y.includes('test "$MIGRATION" = "0043_organization_creation_identity.sql"'));
 assert.ok(!y.includes('organization_id:')); assert.ok(!y.includes('sql:'));
});

test('missing results cannot masquerade as empty dependency or integrity evidence',async t=>{
 for(const sql of [DIAGNOSTIC_QUERIES.dependencies,DIAGNOSTIC_QUERIES.foreign]) for(const malformed of ['[]','{"results":[]}','[{"success":true}]']){
  const db=fixture(t),valid=runner(db,[]);
  const injected={runProcess:async(cmd,args,opts)=>args.includes(sql)?{code:0,stdout:malformed,stderr:''}:valid.runProcess(cmd,args,opts)};
  await assert.rejects(collectDeletionDiagnostic('fake',remote(db),migration,injected),{code:'DELETION_DIAGNOSTIC_BLOCKED'});
 }
});

test('context accepts only the fixed protected invocation and rejects each altered field',()=>{
 const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'matheusapc22/maono_kepler_v1',
 GITHUB_REF_NAME:'main',GITHUB_REPOSITORY_OWNER:'matheusapc22',GITHUB_ACTOR:'matheusapc22',
 MODE:'organization-deletion-diagnostic',MIGRATION:IDENTITY_MIGRATION,APPROVAL_HASH:'',
 CLOUDFLARE_ACCOUNT_ID:'09d455fa1cf988b0d9db89987b73eaff',PRODUCT_BRANCH:'mano_kepler_v1',
 PRODUCTION_D1_NAME:PRODUCTION_DATABASE_NAME,PRODUCTION_D1_ID:PRODUCTION_DATABASE_ID,VALIDATED_RELEASE_SHA:'a'.repeat(40)};
 const git={sha:'a'.repeat(40),clean:true};validateDiagnosticContext(env,git,IDENTITY_MIGRATION);
 for(const key of Object.keys(env))assert.throws(()=>validateDiagnosticContext({...env,[key]:'wrong'},git,IDENTITY_MIGRATION));
 assert.throws(()=>validateDiagnosticContext(env,{...git,clean:false},IDENTITY_MIGRATION));
 assert.throws(()=>validateDiagnosticContext(env,git,'0044_organization_permanent_deletion.sql'));
});

// Failure evidence must remain useful without exposing arbitrary upstream data.
import {diagnosticFailure} from '../scripts/migrations/organization-deletion-diagnostic.mjs';
import {gateError} from '../scripts/migrations/production-migration-lib.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('failure projection keeps fixed stage/code but never raw messages, rows or streams',()=>{
 const secret='PRIVATE_TOKEN_NAME_EMAIL_PATH';
 for(const error of [new Error(secret),{code:secret,message:secret},gateError(secret,secret),
   gateError('IDENTITY_0043_SCHEMA_INCOMPATIBLE',secret,{rows:[secret]}),
   gateError('WRANGLER_COMMAND_FAILED',secret,{stage:secret,stdout:secret+' no such table',stderr:secret,exitCode:1})]){
  const report=diagnosticFailure(error,'identity-before');
  assert.equal(report.stage,'identity-before');assert.equal(report.status,'blocked');
  assert.equal(report.writesPerformed,false);assert.ok(!JSON.stringify(report).includes(secret));
 }
 assert.equal(diagnosticFailure(gateError('IDENTITY_0043_SCHEMA_INCOMPATIBLE','secret'),'identity-before').code,'IDENTITY_0043_SCHEMA_INCOMPATIBLE');
 const transport=diagnosticFailure(gateError('WRANGLER_COMMAND_FAILED','secret',{stage:'D1_INFO',stderr:'authentication error 10000 PRIVATE',exitCode:1}),'remote-state').transport;
 assert.deepEqual(transport.categories,['CLOUDFLARE_AUTH']);assert.equal(transport.stage,'D1_INFO');
 assert.equal(diagnosticFailure(new Error('secret'),'PRIVATE_STAGE').stage,'unknown');
});
test('collector progress labels identify reads without adding requests or changing results',async t=>{
 const db=fixture(t),stages=[];
 const report=await collectDeletionDiagnostic('fake',remote(db),migration,{...runner(db,[]),onStage:s=>stages.push(s)});
 assert.deepEqual(stages,['identity-before','integrity','target-first','target-second','identity-after']);
 assert.equal(report.writesPerformed,false);
});
test('real CLI writes minimized failure artifact before any remote access on invalid input',t=>{
 const cwd=mkdtempSync(join(tmpdir(),'org-diagnostic-failure-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/migrations/diagnose-organization-deletion-production.mjs',import.meta.url)),
 '--PRIVATE_ARGUMENT','PRIVATE_VALUE'],{cwd,encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});
 assert.equal(result.status,1);assert.ok(!result.stderr.includes('PRIVATE'));
 const report=JSON.parse(readFileSync(join(cwd,'.tmp/production-migrations/organization-deletion-diagnostic-failure.json'),'utf8'));
 assert.equal(report.stage,'arguments');assert.equal(report.code,'ARGUMENT_INVALID');assert.equal(report.status,'blocked');
 assert.equal(report.writesPerformed,false);assert.equal(report.deletionEligibilityVerified,false);
});
