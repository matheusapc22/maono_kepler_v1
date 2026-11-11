import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {DELETION_MIGRATION,DELETION_SCHEMA_QUERIES,deletionSchemaReference,evaluateDeletionSchema,assertDeletionSchema,readDeletionSchema} from '../scripts/migrations/organization-deletion-schema-0044.mjs';
import {buildApproval} from '../scripts/migrations/production-migration-lib.mjs';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function fixture(t,extra=''){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(source('schema.sql').split('-- Organization permanent deletion (migration 0044)')[0]);if(extra)db.exec(extra);
 const snapshot=()=>Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([k,q])=>[k,db.prepare(q).all()]));
 return {db,snapshot};
}
test('canonical pre-0044 metadata and planned guard coverage',t=>{
 const f=fixture(t),r=evaluateDeletionSchema(f.snapshot());assert.equal(r.compatible,true);assert.equal(r.tableCount,102);
 assert.equal(r.dependencies.find(d=>d.name==='sessions').handling,'session-detach');
 assert.equal(r.dependencies.find(d=>d.name==='project_config_revisions').handling,'indirect');
 assert.equal(r.plannedGuards.length,127);assert.equal(r.applicationRowsRead,false);
});
test('real historical 0006 and 0011 tables fail closed even empty',t=>{
 const f=fixture(t,source('migrations/0006_create_organization_exports.sql')+source('migrations/0011_roadmap_gantt.sql'));
 const r=evaluateDeletionSchema(f.snapshot());assert.equal(r.compatible,false);
 assert.deepEqual(r.dependencies.filter(d=>d.handling==='UNGUARDED').map(d=>d.name),['organization_exports','organization_roadmaps','roadmap_comments','roadmap_dependencies','roadmap_events','roadmap_phases','roadmap_tasks']);
 assert.throws(()=>assertDeletionSchema(r),{code:'DELETION_SCHEMA_BLOCKED'});
});
for(const [label,sql] of [
 ['unknown direct','CREATE TABLE unknown_tenant(id INTEGER PRIMARY KEY,organization_id INTEGER)'],
 ['alternate org FK','CREATE TABLE unknown_tenant(id INTEGER PRIMARY KEY,tenant_id INTEGER REFERENCES organizations(id))'],
 ['unknown indirect','CREATE TABLE unknown_child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES projects(id))'],
 ['view','CREATE VIEW unknown_view AS SELECT id FROM organizations'],
 ['trigger',"CREATE TRIGGER unknown_trigger AFTER DELETE ON organizations BEGIN SELECT 'Private Literal'; END"],
 ['virtual','CREATE VIRTUAL TABLE unknown_search USING fts5(content)'],
])test('fails closed for '+label,t=>{const f=fixture(t,sql);assert.equal(evaluateDeletionSchema(f.snapshot()).compatible,false);});
test('schema literals stay exact and are not exported',t=>{
 const f=fixture(t),s=f.snapshot();const row=s.objects.find(r=>r.type==='table'&&r.sql.includes("'READY'"));assert.ok(row);
 row.sql=row.sql.replace("'READY'","'Private Secret'");const r=evaluateDeletionSchema(s);assert.equal(r.compatible,false);
 assert.doesNotMatch(JSON.stringify(r),/Private Secret|CREATE TABLE|dflt_value/);
});
for(const fault of ['missing','duplicate','extra','invalidName','missingColumns','invalidFk'])test('invalid metadata '+fault,t=>{
 const f=fixture(t),s=f.snapshot();
 if(fault==='missing')delete s.columns;
 if(fault==='duplicate')s.objects.push(s.objects[0]);
 if(fault==='extra')s.foreignKeys[0].payload='Private Secret';
 if(fault==='invalidName')s.objects[0].name='bad; SELECT';
 if(fault==='missingColumns')s.columns=s.columns.filter(r=>r.table_name!=='organizations');
 if(fault==='invalidFk')s.foreignKeys[0].parent_table='untrusted name';
 assert.throws(()=>evaluateDeletionSchema(s),e=>/^DELETION_METADATA_/.test(e.code)&&!JSON.stringify(e).includes('Private Secret'));
});
test('fixed remote reads repeated and drift rejected without application reads',async t=>{
 const f=fixture(t);let calls=0;const runProcess=async(command,args)=>{
  assert.equal(command,'npx');const q=args[args.indexOf('--command')+1];assert.ok(Object.values(DELETION_SCHEMA_QUERIES).includes(q));calls++;
  return {stdout:JSON.stringify([{success:true,results:f.db.prepare(q).all()}])};
 };
 const r=await readDeletionSchema('unused',{runProcess});assert.equal(r.compatible,true);assert.equal(calls,6);
 calls=0;await assert.rejects(()=>readDeletionSchema('unused',{runProcess:async(...args)=>{if(calls===3)f.db.exec('CREATE TABLE drift(id INTEGER)');return runProcess(...args);}}),{code:'DELETION_METADATA_DRIFT'});
});
test('source drift is blocked',()=>assert.throws(()=>deletionSchemaReference(p=>source(p)+' '),{code:'DELETION_SOURCE_DRIFT'}));
test('0044 approval requires and binds evidence; unrelated migration stays generic',()=>{
 const args={migration:DELETION_MIGRATION,migrationSha256:'a'.repeat(64),gitSha:'b'.repeat(40),pendingDigest:'c'.repeat(64)};
 assert.throws(()=>buildApproval(args),{code:'DELETION_EVIDENCE_REQUIRED'});
 assert.notEqual(buildApproval({...args,evidenceDigest:'d'.repeat(64)}).approvalHash,buildApproval({...args,evidenceDigest:'e'.repeat(64)}).approvalHash);
 assert.ok(buildApproval({...args,migration:'0042_organization_management.sql'}).approvalHash);
});
test('audit and apply wire mandatory 0044 metadata checks',()=>{
 const audit=source('scripts/migrations/audit-production.mjs'),apply=source('scripts/migrations/apply-production.mjs');
 assert.match(audit,/migration.name===DELETION_MIGRATION \? await readDeletionSchema/);
 assert.match(audit,/assertDeletionSchema\(schemaPreflight\)/);
 assert.match(audit,/schemaPreflight.digest/);
 assert.match(apply,/audit.evidenceDigest!==deletionSchema.digest/);
 assert.match(apply,/finalSchema.digest!==evidenceDigest/);
 assert.ok(apply.indexOf('finalSchema.digest!==evidenceDigest')<apply.indexOf('applyStarted = true'));
});
test('remote read failure is sanitized and labelled',async()=>{
 await assert.rejects(()=>readDeletionSchema('unused',{runProcess:async()=>{throw Object.assign(new Error('PRIVATE SQL'),{details:{exitCode:17,stdout:'PRIVATE ROW',stderr:'PRIVATE TOKEN'}});}}),e=>e.code==='WRANGLER_COMMAND_FAILED'&&!JSON.stringify(e).includes('PRIVATE')&&e.details.stage==='DELETION_METADATA');
});
import {mkdtempSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
function cliFixture(t,extra=''){
 const root=mkdtempSync(join(tmpdir(),'deletion-audit-offline-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const db=new DatabaseSync(join(root,'fixture.sqlite'));
 db.exec(source('schema.sql').split('-- Organization permanent deletion (migration 0044)')[0]);
 db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');
 if(extra)db.exec(extra);db.close();
 const report=join(root,'audit.json');
 const run=(script,args=[])=>spawnSync(process.execPath,['--import',new URL('./helpers/identity-operator-preload.mjs',import.meta.url).href,fileURLToPath(new URL('../scripts/migrations/'+script,import.meta.url)),'--migration',DELETION_MIGRATION,...args],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,IDENTITY_FIXTURE_ROOT:root,IDENTITY_FIXTURE_FAULT:'',NODE_NO_WARNINGS:'1',CLOUDFLARE_API_TOKEN:'synthetic-not-real',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}});
 return {root,report,run};
}
test('offline actual 0044 audit writes metadata-bound approval; tampering blocks apply before writes',t=>{
 const f=cliFixture(t);const result=f.run('audit-production.mjs',['--report',f.report]);assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(readFileSync(f.report,'utf8'));assert.equal(report.schemaPreflight.compatible,true);assert.equal(report.evidenceDigest,report.schemaPreflight.digest);
 report.evidenceDigest='0'.repeat(64);writeFileSync(f.report,JSON.stringify(report));
 const refused=f.run('apply-production.mjs',['--audit-report',f.report,'--approval',report.approval.token]);assert.notEqual(refused.status,0);assert.match(refused.stderr,/DELETION_METADATA_DRIFT/);assert.equal(existsSync(join(f.root,'writes.log')),false);
});
test('offline historical 0044 audit retains blocked metadata with no approval or private defaults',t=>{
 const f=cliFixture(t,source('migrations/0006_create_organization_exports.sql')+source('migrations/0011_roadmap_gantt.sql')+"CREATE TABLE custom_secret(id INTEGER, note TEXT DEFAULT 'PRIVATE DEFAULT');");
 const result=f.run('audit-production.mjs',['--report',f.report]);assert.notEqual(result.status,0,result.stderr);
 const text=readFileSync(f.report,'utf8'),report=JSON.parse(text);assert.equal(report.readyForAuthorization,false);assert.equal(report.writesPerformed,false);assert.equal(report.approval,undefined);assert.doesNotMatch(text,/PRIVATE DEFAULT|CREATE TABLE/);assert.equal(existsSync(join(f.root,'writes.log')),false);
});
for(const prefix of ['d1_','_cf_'])test('unknown prefixed business dependency is never hidden: '+prefix,t=>{
 const f=fixture(t,`CREATE TABLE ${prefix}business(id INTEGER PRIMARY KEY,organization_id INTEGER REFERENCES organizations(id)); CREATE TABLE ${prefix}child(id INTEGER,project_id INTEGER REFERENCES projects(id));`);
 const r=evaluateDeletionSchema(f.snapshot());assert.equal(r.compatible,false);assert.ok(r.tables.includes(prefix+'business'));assert.ok(r.dependencies.some(d=>d.name===prefix+'child'));
});
test('missing source rejects without propagating local diagnostics',()=>assert.throws(()=>deletionSchemaReference(()=>{throw new Error('PRIVATE SOURCE PATH');}),e=>e.code==='DELETION_SOURCE_DRIFT'&&!e.message.includes('PRIVATE')));
