import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixtureManifest as m,fixtureSql,fixtureSnapshot,openHistoricalFixture,verifyFixtureProvenance,assertHistoricalSafetyProjection,historicalMissingGuardTables} from './helpers/deletion-historical-fixture.mjs';
import {evaluateDeletionSchema} from '../scripts/migrations/organization-deletion-schema-0044.mjs';
const use=(t,sql=fixtureSql)=>{const db=openHistoricalFixture(sql);t.after(()=>db.close());return db;};
test('complete source provenance: 469 canonical +30 reconstructed +31 reviewed structural objects',()=>{assert.deepEqual(verifyFixtureProvenance(),{canonical:469,reconstructed:30,structural:31,operationalApproval:false});});
test('complete 530-object projection has exact observed columns, FKs, index components and definitions except seven literal values',t=>{const db=use(t),snapshot=fixtureSnapshot(db),r=assertHistoricalSafetyProjection(snapshot);assert.equal(r.completeObjectProjection,true);assert.equal(r.generalDdlEquivalent,false);assert.equal(r.operationalApproval,false);assert.equal(r.productionCompatible,false);assert.equal(snapshot.objects.length,530);assert.equal(snapshot.columns.length,1080);assert.equal(snapshot.foreignKeys.length,286);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);});
test('internal envelope accounts for both audited internal objects without materializing protected tables',t=>{const db=use(t);assert.deepEqual(m.internalEnvelope.map(x=>x.name).sort(),['_cf_KV','d1_migrations']);assert.equal(fixtureSnapshot(db).objects.some(x=>x.name==='_cf_KV'),false);assert.match(m.observedMetadataDigest,/^[a-f0-9]{64}$/);assert.match(m.observedReportDigest,/^[a-f0-9]{64}$/);});
for(const [slot,spec] of Object.entries(m.syntheticDefaults))test('only declared scalar default may vary: '+slot,t=>{
 const db=use(t),before=assertHistoricalSafetyProjection(fixtureSnapshot(db));
 const object=m.objects.find(o=>o.name===slot.split('.')[0]);const old=typeof spec.representative==='number'?String(spec.representative):"'"+spec.representative+"'";
 const replacement=spec.literalType==='number'?'29':"'different synthetic fixture value'";
 const changed=fixtureSql.replace(object.sql,object.sql.replace('DEFAULT '+old,'DEFAULT '+replacement));assert.notEqual(changed,fixtureSql);
 const db2=use(t,changed),after=assertHistoricalSafetyProjection(fixtureSnapshot(db2));assert.notEqual(before.fullSnapshotDigest,after.fullSnapshotDigest);assert.equal(after.operationalApproval,false);
});
for(const [label,mutate] of [
 ['missing table',s=>{s.objects=s.objects.filter(o=>o.name!=='ticket_comments');}],
 ['extra object',s=>s.objects.push({type:'table',name:'unreviewed_tenant',tbl_name:'unreviewed_tenant',sql:'CREATE TABLE unreviewed_tenant(id INTEGER)'})],
 ['altered FK',s=>{s.foreignKeys.find(f=>f.table_name==='tickets'&&f.parent_table==='organizations').on_delete='RESTRICT';}],
 ['new constraint',s=>{const o=s.objects.find(o=>o.name==='tickets');o.sql=o.sql.replace('"title" TEXT NOT NULL','"title" TEXT NOT NULL CHECK(length(title)>0)');}],
 ['changed partial predicate',s=>{const o=s.objects.find(o=>o.name==='idx_user_permissions_unique_global');o.sql=o.sql.replace('IS NULL','IS NOT NULL');}],
 ['default function',s=>{const o=s.objects.find(o=>o.name==='tickets');o.sql=o.sql.replace("DEFAULT 'fixture_status'","DEFAULT (random())");}],
 ['default class',s=>{const o=s.objects.find(o=>o.name==='tickets');o.sql=o.sql.replace("DEFAULT 'fixture_status'",'DEFAULT 23');}],
 ['unknown default slot',s=>{const o=s.objects.find(o=>o.name==='organization_limits');o.sql=o.sql.replace('"value" TEXT NOT NULL',"\"value\" TEXT NOT NULL DEFAULT 'unexpected'");}],
 ['altered trigger',s=>{const o=s.objects.find(o=>o.name==='trg_access_delegation_membership_removed');o.sql=o.sql.replace('enabled = 0','enabled = 1');}],
])test('projection fails closed: '+label,t=>{const s=fixtureSnapshot(use(t));mutate(s);assert.throws(()=>assertHistoricalSafetyProjection(s));});
test('existing canonical migration compiles but explicitly leaves ten historical guard gaps',t=>{const db=use(t);db.exec(readFileSync(new URL('../migrations/0044_organization_permanent_deletion.sql',import.meta.url),'utf8'));const names=new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all().map(x=>x.name));for(const table of historicalMissingGuardTables){assert.equal(names.has('org_delete_guard_'+table+'_insert'),false);assert.equal(names.has('org_delete_guard_'+table+'_update'),false);}assert.equal([...names].filter(n=>n.startsWith('org_delete_guard_')&&n.endsWith('_update')).length,62);});
test('preflight remains blocked for all historical missing guard targets',t=>{const r=evaluateDeletionSchema(fixtureSnapshot(use(t)));assert.equal(r.compatible,false);assert.deepEqual(r.dependencies.filter(d=>d.handling==='UNGUARDED').map(d=>d.name).sort(),[...historicalMissingGuardTables].sort());});
