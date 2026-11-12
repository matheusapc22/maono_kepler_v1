import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureSql} from './helpers/deletion-historical-fixture.mjs';
import {DELETION_SCHEMA_QUERIES} from '../scripts/migrations/organization-deletion-schema-0044.mjs';
import {HISTORICAL_CANDIDATE_PATH,HISTORICAL_CANDIDATE_NAME,HISTORICAL_CANDIDATE_SHA256,HISTORICAL_CATALOG_QUERY,HISTORICAL_LEDGER_QUERY,lifecycleDigest,buildHistoricalLocalEvidence} from '../scripts/migrations/organization-deletion-historical-lifecycle.mjs';
import {reconcileHistoricalSanitizedOutcome} from '../scripts/migrations/organization-deletion-historical-recovery.mjs';
const source=readFileSync(new URL('../'+HISTORICAL_CANDIDATE_PATH,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const integrity={quickCheck:'ok',quickCheckOk:true,foreignKeyCheckOk:true,foreignKeyViolations:[]};
const snapshot=db=>({catalog:db.prepare(HISTORICAL_CATALOG_QUERY).all(),metadata:Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([k,q])=>[k,db.prepare(q).all()])),ledger:db.prepare(HISTORICAL_LEDGER_QUERY).all(),pragmas:Object.fromEntries(['foreign_keys','recursive_triggers','defer_foreign_keys'].map(k=>[k,db.prepare('PRAGMA '+k).get()[k]]))});
function durable(t,{apply=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'historical-recovery-local-')),file=join(dir,'synthetic.sqlite');
 const audit=(()=>{
  const db=new DatabaseSync(file);try{
   db.exec(fixtureSql);db.exec("PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT); INSERT INTO d1_migrations VALUES(1,'0001_old.sql','2020-01-01 00:00:00');");
   const s=snapshot(db),e=buildHistoricalLocalEvidence(s,{localFiles:[{name:HISTORICAL_CANDIDATE_NAME,sha256:HISTORICAL_CANDIDATE_SHA256},{name:'0044_organization_permanent_deletion.sql',sha256:'a'.repeat(64)}],gitSha:'a'.repeat(40),database:{name:'maono_maps',uuid:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'},integrity,fullSnapshotDigests:[lifecycleDigest(s),lifecycleDigest(s)]});return JSON.stringify(e);
  }finally{db.close();}
 })(); // No original private snapshot or connection leaves this scope.
 const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');t.after(()=>{db.close();unlinkSync(file);rmdirSync(dir);});
 if(apply)db.exec(source+";INSERT INTO d1_migrations(name,applied_at) VALUES('"+HISTORICAL_CANDIDATE_NAME+"','2026-11-12 00:00:00');");
 return {db,audit,file};
}
const blocked=result=>{assert.equal(result.outcome,'blocked-or-partial');assert.equal(result.retryAllowed,false);assert.equal(result.operationalAuthorization,false);assert.equal(result.artifactAuthenticityVerified,false);};
test('serialized sanitized audit alone recovers reopened physical poststate without writes or retained prestate',t=>{
 const {db,audit,file}=durable(t),bytes=readFileSync(file),s=snapshot(db);assert.doesNotMatch(audit,/CREATE TABLE|fixture_scope|dflt_value|\browid\b/);
 const result=reconcileHistoricalSanitizedOutcome(audit,s,integrity);assert.equal(result.outcome,'poststate-corresponds-to-supplied-artifact');assert.equal(result.reconstructedSnapshotDigest,JSON.parse(audit).fullSnapshotDigest);assert.equal(result.retryAllowed,false);assert.equal(result.artifactAuthenticityVerified,false);assert.equal(result.operationalAuthorization,false);assert.deepEqual(readFileSync(file),bytes);
});
test('unapplied physical prestate corresponds but never grants retry',t=>{const {db,audit}=durable(t,{apply:false});const r=reconcileHistoricalSanitizedOutcome(audit,snapshot(db),integrity);assert.equal(r.outcome,'prestate-corresponds-to-supplied-artifact');assert.equal(r.retryAllowed,false);});
for(const [name,change] of [
 ['extra old index',db=>db.exec('CREATE INDEX unexpected_ticket_index ON tickets(priority)')],
 ['old index changed',db=>db.exec('DROP INDEX idx_tickets_org_status; CREATE INDEX idx_tickets_org_status ON tickets(status,organization_id)')],
 ['partial new trigger',db=>db.exec('DROP TRIGGER '+db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'org_delete_%' LIMIT 1").get().name)],
 ['changed new trigger definition',db=>{const r=db.prepare("SELECT name,tbl_name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'org_delete_%' LIMIT 1").get();db.exec('DROP TRIGGER '+r.name+'; CREATE TRIGGER '+r.name+' BEFORE INSERT ON '+r.tbl_name+' BEGIN SELECT 1; END;');}],
 ['missing historical ledger',db=>db.exec("DELETE FROM d1_migrations WHERE name='"+HISTORICAL_CANDIDATE_NAME+"'")],
 ['dual canonical ledger',db=>db.exec("INSERT INTO d1_migrations(name,applied_at) VALUES('0044_organization_permanent_deletion.sql','2026-11-12 00:00:00')")],
 ['old ledger timestamp',db=>db.exec("UPDATE d1_migrations SET applied_at='2021-01-01 00:00:00' WHERE id=1")],
 ['old ledger missing',db=>db.exec('DELETE FROM d1_migrations WHERE id=1')],
])test('durable reconstruction blocks physical '+name,t=>{const {db,audit}=durable(t);change(db);blocked(reconcileHistoricalSanitizedOutcome(audit,snapshot(db),integrity));});
for(const [name,change] of [
 ['opaque scalar default',s=>{for(const r of s.catalog)if(r.name==='role_permissions')r.sql=r.sql.replace('DEFAULT 11','DEFAULT 29');for(const r of s.metadata.objects)if(r.name==='role_permissions')r.sql=r.sql.replace('DEFAULT 11','DEFAULT 29');s.metadata.columns.find(r=>r.table_name==='role_permissions'&&r.name==='active').dflt_value='29';}],
 ['old rowid',s=>{const r=s.catalog.find(r=>r.name==='tickets');r.rowid=99999;s.catalog.sort((a,b)=>a.rowid-b.rowid);}],
 ['catalog row order',s=>s.catalog.reverse()],
 ['metadata row order',s=>s.metadata.columns.reverse()],
 ['index sequence',s=>s.metadata.indexes.find(r=>r.index_name==='idx_tickets_org_status').seq=99],
 ['connection pragma',s=>s.pragmas.recursive_triggers=1-s.pragmas.recursive_triggers],
 ['duplicate metadata row',s=>s.metadata.indexColumns.push({...s.metadata.indexColumns[0]})],
 ['duplicate historical ledger',s=>s.ledger.push({...s.ledger.find(r=>r.name===HISTORICAL_CANDIDATE_NAME),id:99})],
])test('durable reconstruction blocks fresh snapshot '+name,t=>{const {db,audit}=durable(t),s=snapshot(db);change(s);blocked(reconcileHistoricalSanitizedOutcome(audit,s,integrity));});
for(const [name,change] of [
 ['extra raw artifact field',e=>e.rawSql='PRIVATE_UNEXPECTED_SQL'],
 ['full digest',e=>e.fullSnapshotDigest='0'.repeat(64)],
 ['catalog digest',e=>e.catalogDigest='0'.repeat(64)],
 ['metadata digest',e=>e.metadataDigest='0'.repeat(64)],
 ['ledger digest',e=>e.ledgerDigest='0'.repeat(64)],
 ['connection digest',e=>e.connectionDigest='0'.repeat(64)],
 ['source contract',e=>e.contractSha256='0'.repeat(64)],
 ['pending checksum',e=>e.migrations.pending[0].sha256='0'.repeat(64)],
 ['missing local pending candidate',e=>e.migrations.pending=[]],
 ['fabricated unavailable checksum',e=>e.migrations.ledger[0].sourceChecksum='0'.repeat(64)],
])test('durable reconstruction blocks artifact '+name,t=>{const {db,audit}=durable(t),e=JSON.parse(audit);change(e);const result=reconcileHistoricalSanitizedOutcome(JSON.stringify(e),snapshot(db),integrity);blocked(result);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_UNEXPECTED_SQL/);});
test('artifact correspondence never authenticates its origin or Git claim',t=>{const {db,audit}=durable(t),e=JSON.parse(audit);e.gitSha='b'.repeat(40);const r=reconcileHistoricalSanitizedOutcome(JSON.stringify(e),snapshot(db),integrity);assert.equal(r.outcome,'poststate-corresponds-to-supplied-artifact');assert.equal(r.artifactAuthenticityVerified,false);assert.equal(r.operationalAuthorization,false);});
test('integrity absent or serialization malformed never permits recovery or retry',t=>{const {db,audit}=durable(t),s=snapshot(db);for(const text of ['{','null',audit+'x',' '.repeat(2000001)])blocked(reconcileHistoricalSanitizedOutcome(text,s,integrity));blocked(reconcileHistoricalSanitizedOutcome(audit,s,{}));});
