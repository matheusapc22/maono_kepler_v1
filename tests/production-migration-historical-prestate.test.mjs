import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {evaluateHistoricalDeletionPrestate,historicalDeletionReference} from '../scripts/migrations/deletion-historical-prestate.mjs';
import {DELETION_SCHEMA_QUERIES,evaluateDeletionSchema,assertDeletionSchema} from '../scripts/migrations/organization-deletion-schema-0044.mjs';
import {fixtureManifest,fixtureSql} from './helpers/deletion-historical-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
function make(t,sql=fixtureSql){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(sql);db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');return db;}
const snap=db=>Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([k,q])=>[k,db.prepare(q).all()]));
const context=s=>({integrity:{quickCheck:'ok',quickCheckOk:true,foreignKeyCheckOk:true,foreignKeyViolations:[]},ledger:[],snapshotDigests:Array(2).fill(evaluateDeletionSchema(s).metadataDigest),gitSha:'a'.repeat(40),pendingDigest:'b'.repeat(64)});
const checkBlocked=r=>{assert.equal(r.status,'blocked');assert.equal(r.compatible,false);assert.equal(r.readyForAuthorization,false);assert.equal(r.approvalEligible,false);assert.equal(r.approval,undefined);};
test('supplement matches full prestate but canonical remains blocked and no apply material exists',t=>{
 const s=snap(make(t)),r=evaluateHistoricalDeletionPrestate(s,context(s));assert.equal(r.status,'matched-prestate');assert.equal(r.applicationObjects,530);assert.equal(r.plannedGuardCount,147);assert.equal(r.guards,'planned-not-installed');assert.equal(r.atomicDatabaseSnapshot,false);assert.equal(r.ongoingMonitoring,false);assert.equal(r.integrityObservation,'same-audit-before-metadata-reads');assert.equal(r.compatible,false);assert.equal(r.readyForAuthorization,false);assert.equal(r.approvalEligible,false);
 for(const key of ['approval','approvalHash','token','applyCommand','approvalMaterial'])assert.equal(r[key],undefined);
 assert.throws(()=>assertDeletionSchema(evaluateDeletionSchema(s)),{code:'DELETION_SCHEMA_BLOCKED'});
 assert.doesNotMatch(JSON.stringify(r),/CREATE TABLE|fixture_scope|fixture_status|dflt_value/);
});
for(const [slot,spec] of Object.entries(fixtureManifest.syntheticDefaults))test('allowed scalar class remains deletion-only and full audit digest changes: '+slot,t=>{
 const before=snap(make(t)),object=fixtureManifest.objects.find(o=>o.name===slot.split('.')[0]);const old=typeof spec.representative==='number'?String(spec.representative):"'"+spec.representative+"'";
 const value=spec.literalType==='number'?'37':"'PRIVATE_SCALAR_VALUE'";
 const sql=fixtureSql.replace(object.sql,object.sql.replace('DEFAULT '+old,'DEFAULT '+value));assert.notEqual(sql,fixtureSql);
 const after=snap(make(t,sql)),a=evaluateHistoricalDeletionPrestate(before,context(before)),b=evaluateHistoricalDeletionPrestate(after,context(after));
 assert.equal(a.status,'matched-prestate');assert.equal(b.status,'matched-prestate');assert.notEqual(a.observedSnapshotDigest,b.observedSnapshotDigest);assert.notEqual(a.evidenceDigest,b.evidenceDigest);assert.doesNotMatch(JSON.stringify(b),/PRIVATE_SCALAR_VALUE/);
 checkBlocked(evaluateHistoricalDeletionPrestate(after,context(before)));
});
for(const [label,change] of [
 ['extra business table',s=>s.objects.push({type:'table',name:'extra_business',tbl_name:'extra_business',sql:'CREATE TABLE extra_business(id INTEGER)'})],
 ['missing historical object',s=>{s.objects=s.objects.filter(o=>o.name!=='idx_tickets_org_status');s.indexes=s.indexes.filter(i=>i.index_name!=='idx_tickets_org_status');s.indexColumns=s.indexColumns.filter(i=>i.index_name!=='idx_tickets_org_status');}],
 ['changed source trigger',s=>{const o=s.objects.find(o=>o.name==='project_save_auth_user_permissions_delete');o.sql=o.sql.replace('version + 1','version + 2');}],
 ['changed partial predicate',s=>{const o=s.objects.find(o=>o.name==='idx_user_permissions_unique_global');o.sql=o.sql.replace('IS NULL','IS NOT NULL');}],
 ['new check on opaque slot',s=>{const o=s.objects.find(o=>o.name==='tickets');o.sql=o.sql.replace('"status" TEXT NOT NULL','"status" TEXT NOT NULL CHECK(status<>\'PRIVATE_CHECK\')');}],
 ['changed ownership FK',s=>{const f=s.foreignKeys.find(f=>f.table_name==='tickets'&&f.parent_table==='organizations');f.on_delete='SET NULL';}],
 ['changed unique index metadata',s=>{s.indexes.find(i=>i.index_name==='idx_tickets_org_status').unique=1;}],
 ['opaque default function',s=>{const o=s.objects.find(o=>o.name==='tickets');o.sql=o.sql.replace("DEFAULT 'fixture_status'",'DEFAULT (random())');}],
 ['opaque default expression',s=>{const o=s.objects.find(o=>o.name==='tickets');o.sql=o.sql.replace("DEFAULT 'fixture_status'","DEFAULT ('PRIVATE_A'||'PRIVATE_B')");}],
 ['wrong scalar class',s=>{const o=s.objects.find(o=>o.name==='tickets');o.sql=o.sql.replace("DEFAULT 'fixture_status'",'DEFAULT 1');}],
])test('unknown structural/default effects cannot match: '+label,t=>{
 const s=snap(make(t)),c=context(s);change(s);try{c.snapshotDigests=Array(2).fill(evaluateDeletionSchema(s).metadataDigest);}catch{}
 const r=evaluateHistoricalDeletionPrestate(s,c);checkBlocked(r);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|CREATE TABLE|dflt_value/);
});
for(const [label,change] of [
 ['no integrity',c=>delete c.integrity],['bad quick check',c=>c.integrity.quickCheck='bad'],['FK violation',c=>c.integrity.foreignKeyViolations=[{rowid:123456,table:'PRIVATE_TABLE'}]],
 ['single snapshot',c=>c.snapshotDigests.pop()],['snapshot drift',c=>c.snapshotDigests[1]='c'.repeat(64)],['missing Git',c=>delete c.gitSha],['missing pending digest',c=>delete c.pendingDigest],
 ['canonical applied',c=>c.ledger=[{id:1,name:'0044_organization_permanent_deletion.sql',appliedAt:'2026-01-01'}]],
 ['historical applied',c=>c.ledger=[{id:1,name:'0044_organization_permanent_deletion_historical.sql',appliedAt:'2026-01-01'}]],
 ['duplicate ledger',c=>c.ledger=[{id:1,name:'0001_init.sql',appliedAt:'2026-01-01'},{id:2,name:'0001_init.sql',appliedAt:'2026-01-01'}]],
])test('evidence precondition fails closed: '+label,t=>{const s=snap(make(t)),c=context(s);change(c);const r=evaluateHistoricalDeletionPrestate(s,c);checkBlocked(r);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_TABLE|123456/);});
for(const path of ['functions/_lib/organization-permanent-deletion.js','functions/_lib/permissions.js','functions/_lib/auth.js','functions/_lib/organization-management-http.js','functions/api/admin/organization-management/[[path]].js','scripts/migrations/candidates/0044_organization_permanent_deletion_historical.sql'])test('source/auth/candidate drift blocks supplement: '+path,t=>{const s=snap(make(t));checkBlocked(evaluateHistoricalDeletionPrestate(s,context(s),{readSource:p=>read(p)+(p===path?'\n// unreviewed change':'')}));});
test('partial or full installed guards are not accepted as historical prestate',t=>{
 for(const sql of ['CREATE TABLE organization_deletions(id TEXT);',read('scripts/migrations/candidates/0044_organization_permanent_deletion_historical.sql')]){const db=make(t);db.exec(sql);const s=snap(db);checkBlocked(evaluateHistoricalDeletionPrestate(s,context(s)));}
});
test('finite seven-slot effects are versioned and six epoch triggers end at a leaf',()=>{
 const r=historicalDeletionReference();assert.equal(Object.keys(r.contract.slots).length,7);assert.equal(r.contract.triggerContract.names.length,6);assert.equal(r.contract.triggerContract.readsDefaultSlots,false);assert.equal(r.contract.triggerContract.destinationIsTriggerAndForeignKeyLeaf,true);assert.equal(r.contract.operationalApproval,false);
 for(const slot of Object.keys(r.contract.slots)){const [table,name]=slot.split('.');assert.ok(r.report.structuralMetadata.columns.some(c=>c.table===table&&c.name===name&&c.notNull===1));assert.equal(r.report.structuralMetadata.foreignKeys.some(f=>f.table_name===table&&f.from_column===name),false);}
});
function cli(t){const root=mkdtempSync(join(tmpdir(),'historical-prestate-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const db=new DatabaseSync(join(root,'fixture.sqlite'));db.exec(fixtureSql);db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');db.close();const report=join(root,'audit.json');const run=(script,args)=>spawnSync(process.execPath,['--import',new URL('./helpers/identity-operator-preload.mjs',import.meta.url).href,fileURLToPath(new URL('../scripts/migrations/'+script,import.meta.url)),...args],{encoding:'utf8',windowsHide:true,timeout:60000,env:{...process.env,NODE_NO_WARNINGS:'1',IDENTITY_FIXTURE_ROOT:root,CLOUDFLARE_API_TOKEN:'synthetic-not-real',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}});return{root,report,run};}
test('offline canonical CLI retains blocked report with supplemental matched prestate and cannot apply it',t=>{
 const f=cli(t),r=f.run('audit-production.mjs',['--migration','0044_organization_permanent_deletion.sql','--report',f.report]);assert.equal(r.status,1,r.stderr);assert.ok(existsSync(f.report));const raw=readFileSync(f.report,'utf8'),report=JSON.parse(raw);
 assert.equal(report.phase,'schema-preflight-blocked');assert.equal(report.schemaPreflight.compatible,false);assert.equal(report.readyForAuthorization,false);assert.equal(report.deletionSafetyCertification.status,'matched-prestate');assert.equal(report.approval,undefined);assert.equal(report.applyCommand,undefined);assert.doesNotMatch(raw,/fixture_scope|fixture_status|synthetic-not-real/);
 for(const mode of ['present','absent','forged-ready']){const candidate=structuredClone(report);if(mode==='absent')delete candidate.deletionSafetyCertification;if(mode==='forged-ready'){candidate.readyForAuthorization=true;candidate.deletionSafetyCertification.readyForAuthorization=true;}writeFileSync(f.report,JSON.stringify(candidate));const applied=f.run('apply-production.mjs',['--migration','0044_organization_permanent_deletion.sql','--audit-report',f.report,'--approval','forged-not-authorized']);assert.equal(applied.status,1);assert.equal(existsSync(join(f.root,'writes.log')),false);}
});

for(const ddl of ['CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB)','CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID'])test('reviewed protected internal stays inside full digest: '+ddl.split(' ')[2],t=>{
 const db=make(t),before=snap(db),a=evaluateHistoricalDeletionPrestate(before,context(before));db.exec(ddl);const after=snap(db),b=evaluateHistoricalDeletionPrestate(after,context(after));assert.equal(b.status,'matched-prestate');assert.notEqual(a.observedSnapshotDigest,b.observedSnapshotDigest);assert.notEqual(a.evidenceDigest,b.evidenceDigest);
});
test('unknown internal-like business table never receives an envelope exemption',t=>{
 const db=make(t);db.exec('CREATE TABLE _cf_business(id INTEGER PRIMARY KEY,organization_id INTEGER REFERENCES organizations(id))');const s=snap(db);let r;try{r=evaluateHistoricalDeletionPrestate(s,context(s));}catch{r=evaluateHistoricalDeletionPrestate(s,{});}checkBlocked(r);
});
