import test from 'node:test';
import {renderHistoricalExecution} from '../scripts/migrations/organization-deletion-historical-execution.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fixtureSql,fixtureManifest} from './helpers/deletion-historical-fixture.mjs';
import {DELETION_SCHEMA_QUERIES} from '../scripts/migrations/organization-deletion-schema-0044.mjs';
import {assertOperationalMigration} from '../scripts/migrations/production-migration-lib.mjs';
import {HISTORICAL_CANDIDATE_PATH,HISTORICAL_CANDIDATE_NAME,HISTORICAL_CANDIDATE_SHA256,HISTORICAL_CATALOG_QUERY,HISTORICAL_LEDGER_QUERY,lifecycleDigest,validateLifecycleSnapshot,minimizedMigrationEvidence,buildHistoricalLocalEvidence,historicalExpectedDelta,reconcileHistoricalLocalOutcome,historicalLocalActionBinding} from '../scripts/migrations/organization-deletion-historical-lifecycle.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const source=read(HISTORICAL_CANDIDATE_PATH);
const copy=x=>JSON.parse(JSON.stringify(x));
const integrity={quickCheck:'ok',quickCheckOk:true,foreignKeyCheckOk:true,foreignKeyViolations:[]};
function make(t,sql=fixtureSql){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(sql);db.exec('PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');return db;}
const capture=db=>({catalog:db.prepare(HISTORICAL_CATALOG_QUERY).all(),metadata:Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([k,q])=>[k,db.prepare(q).all()])),ledger:db.prepare(HISTORICAL_LEDGER_QUERY).all(),pragmas:Object.fromEntries(['foreign_keys','recursive_triggers','defer_foreign_keys'].map(k=>[k,db.prepare('PRAGMA '+k).get()[k]]))});
const localFiles=[{name:HISTORICAL_CANDIDATE_NAME,sha256:HISTORICAL_CANDIDATE_SHA256},{name:'0044_organization_permanent_deletion.sql',sha256:'a'.repeat(64)}];
const context=s=>({localFiles,gitSha:'a'.repeat(40),database:{name:'maono_maps',uuid:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'},integrity,fullSnapshotDigests:[lifecycleDigest(s),lifecycleDigest(s)]});
const apply=db=>db.exec(source+"; INSERT INTO d1_migrations(name,applied_at) VALUES ('"+HISTORICAL_CANDIDATE_NAME+"','2026-11-12 00:00:00');");
test('complete private snapshot includes SQLite internals but public local evidence does not leak definitions',t=>{
 const s=capture(make(t)),r=buildHistoricalLocalEvidence(s,context(s));assert.equal(r.phase,'local-proof-only');assert.equal(r.readyForAuthorization,false);assert.equal(r.operationalAuthorization,false);assert.ok(s.catalog.some(r=>r.name==='sqlite_sequence'));assert.ok(s.catalog.some(r=>r.name.startsWith('sqlite_autoindex_')));assert.doesNotMatch(JSON.stringify(r),/CREATE TABLE|fixture_scope|dflt_value/);assert.equal(r.migrations.pending.find(x=>x.name==='0044_organization_permanent_deletion.sql').selection,'excluded-mutually-exclusive-alternative');assert.throws(()=>assertOperationalMigration(HISTORICAL_CANDIDATE_NAME));
});
test('ledger source checksums are separately labeled, absent source remains absent',()=>{const r=minimizedMigrationEvidence([{id:1,name:'0001_old.sql',appliedAt:'2020-01-01 00:00:00'}],localFiles);assert.equal(r.persistedChecksumAvailable,false);assert.equal(r.ledger[0].sourceChecksum,null);assert.equal(r.ledger[0].sourceChecksumUnavailable,true);assert.equal(r.ledgerDigest,lifecycleDigest([{id:1,name:'0001_old.sql',appliedAt:'2020-01-01 00:00:00'}]));assert.equal(r.pendingDigest,lifecycleDigest(r.pending));});
for(const name of ['0044_organization_permanent_deletion.sql',HISTORICAL_CANDIDATE_NAME,'0044_unknown.sql'])test('ledger mutual exclusion '+name,()=>assert.throws(()=>minimizedMigrationEvidence([{id:1,name,appliedAt:'2020-01-01 00:00:00'}],localFiles)));
for(const [name,mutate] of [
 ['extra catalog row',s=>s.catalog.push({...s.catalog[0],rowid:99999,name:'unknown'})],
 ['missing catalog row',s=>s.catalog.splice(s.catalog.findIndex(r=>r.name==='tickets'),1)],
 ['unknown reserved object',s=>s.catalog.push({rowid:99999,type:'table',name:'sqlite_unknown',tbl_name:'sqlite_unknown',sql:'CREATE TABLE sqlite_unknown(id)'})],
 ['duplicate rowid',s=>s.catalog[1].rowid=s.catalog[0].rowid],
 ['foreign keys disabled',s=>s.pragmas.foreign_keys=0],
 ['deferred foreign keys',s=>s.pragmas.defer_foreign_keys=1],
 ['catalog metadata mismatch',s=>s.catalog.find(r=>r.name==='tickets').sql+=' '],
])test('snapshot rejects '+name,t=>{const s=capture(make(t));mutate(s);assert.throws(()=>validateLifecycleSnapshot(s));});
test('source candidate delta is exact 3 tables and 147 triggers plus implicit indexes',()=>{const d=historicalExpectedDelta();assert.equal(d.catalog.filter(r=>r.type==='table').length,3);assert.equal(d.catalog.filter(r=>r.type==='trigger').length,147);assert.equal(d.catalog.filter(r=>r.sql!==null).length,150);});
test('physical complete candidate plus ledger matches exact poststate and never permits replay',t=>{const db=make(t),before=capture(db);apply(db);const r=reconcileHistoricalLocalOutcome(before,capture(db),integrity);assert.equal(r.outcome,'committed-poststate-observed');assert.equal(r.retryAllowed,false);assert.equal(r.operationalAuthorization,false);});
test('unchanged prestate does not grant retry',t=>{const s=capture(make(t));assert.deepEqual(reconcileHistoricalLocalOutcome(s,s,integrity),{outcome:'prestate-observed',retryAllowed:false,operationalAuthorization:false});});
for(const [name,change] of [
 ['missing ledger',db=>db.exec('DELETE FROM d1_migrations')],
 ['canonical dual ledger',db=>db.exec("INSERT INTO d1_migrations(name,applied_at) VALUES('0044_organization_permanent_deletion.sql','2026-11-12 00:00:00')")],
 ['changed existing object',db=>db.exec('DROP INDEX idx_tickets_org_status; CREATE INDEX idx_tickets_org_status ON tickets(status,organization_id)')],
 ['missing new trigger',db=>db.exec('DROP TRIGGER '+db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'org_delete_%' LIMIT 1").get().name)],
 ['extra object',db=>db.exec('CREATE TABLE unexpected(id INTEGER)')],
])test('partial or drifted poststate blocks '+name,t=>{const db=make(t),s=capture(db);apply(db);change(db);assert.equal(reconcileHistoricalLocalOutcome(s,capture(db),integrity).outcome,'blocked-or-partial');});
test('bad integrity blocks both prestate and poststate',t=>{const db=make(t),s=capture(db);assert.equal(reconcileHistoricalLocalOutcome(s,s,{}).outcome,'blocked-or-partial');apply(db);assert.equal(reconcileHistoricalLocalOutcome(s,capture(db),{...integrity,foreignKeyCheckOk:false}).outcome,'blocked-or-partial');});
test('full snapshot drift cannot reuse previous local evidence',t=>{const s=capture(make(t));assert.throws(()=>buildHistoricalLocalEvidence(s,{...context(s),fullSnapshotDigests:['0'.repeat(64),'0'.repeat(64)]}));});
test('local binding recomputes renderer and rejects swapped snapshots and forged hashes',t=>{
 const db=make(t),s=capture(db),e=buildHistoricalLocalEvidence(s,context(s));
 const render=s=>renderHistoricalExecution({catalog:s.catalog,ledger:s.ledger,pragmas:s.pragmas,indexList:s.metadata.indexes,fullSnapshotDigest:lifecycleDigest(s)},source);
 const x=render(s),a=historicalLocalActionBinding(e,s,x);assert.equal(a.approvalHash,undefined);assert.equal(a.readyForAuthorization,false);
 assert.throws(()=>historicalLocalActionBinding({status:'matched-prestate'},s,x));
 for(const k of ['sha256','requestSha256','requestBodySha256','requestHashDomain','sourceSha256','fullSnapshotDigest'])assert.throws(()=>historicalLocalActionBinding(e,s,{...x,[k]:'d'.repeat(64)}));
 assert.throws(()=>historicalLocalActionBinding(e,s,{...x,sql:x.sql+' '}));
 db.exec("INSERT INTO d1_migrations VALUES(1,'0001_old.sql','2020-01-01 00:00:00')");const s2=capture(db);
 assert.throws(()=>historicalLocalActionBinding(e,s,render(s2)));assert.throws(()=>historicalLocalActionBinding(e,s2,render(s2)));
 const e2=buildHistoricalLocalEvidence(s2,context(s2)),b=historicalLocalActionBinding(e2,s2,render(s2));assert.notEqual(a.localActionDigest,b.localActionDigest);
});
test('poststate preserves every old ledger row exactly',t=>{const db=make(t);db.exec("INSERT INTO d1_migrations VALUES(1,'0001_old.sql','2020-01-01 00:00:00')");const s=capture(db);apply(db);assert.equal(reconcileHistoricalLocalOutcome(s,capture(db),integrity).outcome,'committed-poststate-observed');db.exec("UPDATE d1_migrations SET applied_at='2021-01-01 00:00:00' WHERE id=1");assert.equal(reconcileHistoricalLocalOutcome(s,capture(db),integrity).outcome,'blocked-or-partial');});
test('metadata-only corruption is detected even when full catalog is unchanged',t=>{const db=make(t),s=capture(db);apply(db);const after=copy(capture(db));after.metadata.indexes[0].seq=99;assert.equal(reconcileHistoricalLocalOutcome(s,after,integrity).outcome,'blocked-or-partial');});

test('allowed opaque scalar default still invalidates the complete execution binding',t=>{
 const object=fixtureManifest.objects.find(o=>o.name==='role_permissions');
 const changed=fixtureSql.replace(object.sql,object.sql.replace('DEFAULT 11','DEFAULT 29'));assert.notEqual(changed,fixtureSql);
 const a=capture(make(t)),b=capture(make(t,changed)),e=buildHistoricalLocalEvidence(a,context(a));
 const render=s=>renderHistoricalExecution({catalog:s.catalog,ledger:s.ledger,pragmas:s.pragmas,indexList:s.metadata.indexes,fullSnapshotDigest:lifecycleDigest(s)},source);
 assert.notEqual(lifecycleDigest(a),lifecycleDigest(b));assert.throws(()=>historicalLocalActionBinding(e,a,render(b)));assert.throws(()=>historicalLocalActionBinding(e,b,render(b)));
});
