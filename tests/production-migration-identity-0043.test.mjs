import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { installMigratedOrganizationSchema } from './helpers/organization-schema-history.mjs';
import { auditOrganizationIdentities } from '../scripts/migrations/preflight-organization-identity.mjs';
import { IDENTITY_MIGRATION, IDENTITY_MIGRATION_SHA256, IDENTITY_SNAPSHOT_SQL, IDENTITY_SCHEMA_QUERIES,
  validateIdentitySnapshot, collectIdentityEvidence, collectIdentityPostValidation,
  guardedIdentityMigration, identityApprovalEvidence, assertIdentityEvidenceUnchanged,
  evaluateIdentitySchema, canonicalOrganizationName } from '../scripts/migrations/organization-identity-0043.mjs';
import { ORGANIZATION_SCHEMA_QUERIES, evaluateOrganizationSchema } from '../scripts/migrations/organization-management-schema.mjs';
import { ORGANIZATION_SCHEMA_SOURCES } from '../scripts/migrations/organization-schema-references.mjs';
import { buildApproval, PRODUCTION_DATABASE_ID, PRODUCTION_DATABASE_NAME, makeTemporaryWranglerConfig,
  sha256Text } from '../scripts/migrations/production-migration-lib.mjs';

const source = readFileSync(new URL('../migrations/' + IDENTITY_MIGRATION, import.meta.url), 'utf8');
const migration = { name:IDENTITY_MIGRATION, sha256:IDENTITY_MIGRATION_SHA256,
  path:new URL('../migrations/' + IDENTITY_MIGRATION, import.meta.url) };
const canonical = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const row = { id:1,name:'Synthetic Équipe',slug:'synthetic-000000001',dropbox_root_path:'/projects/synthetic-000000001' };
function seed(db, r = row, active = 1) {
  db.prepare('INSERT INTO organizations(id,name,slug,dropbox_root_path,active) VALUES(?,?,?,?,?)')
    .run(r.id,r.name,r.slug,r.dropbox_root_path,active);
}
function fixture(t, profile = 'canonical') {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  if(profile==='canonical')db.exec(canonical);else installMigratedOrganizationSchema(db);
  db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');
  const names=profile==='canonical' ? ['0007_create_organization_limit_requests.sql','0016_map_panel_navigation_and_quota.sql','0042_organization_management.sql']
    : Object.keys(ORGANIZATION_SCHEMA_SOURCES).filter(p=>p.startsWith('migrations/')).map(p=>p.slice(11));
  names.forEach((n,i)=>db.prepare('INSERT INTO d1_migrations VALUES(?,?,?)').run(i+1,n,'2026-11-06 20:00:00'));
  seed(db);seed(db,{id:2,name:'Paused',slug:'paused',dropbox_root_path:'/projects/paused'},0);
  return db;
}
const snapshot=db=>db.prepare(IDENTITY_SNAPSHOT_SQL).get();
const evidence=db=>validateIdentitySnapshot(snapshot(db),'pre');
const observe=db=>Object.fromEntries(Object.entries(IDENTITY_SCHEMA_QUERIES).map(([k,sql])=>[k,db.prepare(sql).all()]));
function remote(db) {
  return { identity:{ name:PRODUCTION_DATABASE_NAME,id:PRODUCTION_DATABASE_ID },
    ledger:db.prepare('SELECT id,name,applied_at AS appliedAt FROM d1_migrations ORDER BY id').all().map(r=>({...r})),
    localMigrations:[...db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(r=>r.name),IDENTITY_MIGRATION,'0044_future.sql'].filter((n,i,a)=>a.indexOf(n)===i) };
}
function injected(db, mutate = x=>x) {
  return {runProcess:async(command,args)=>{
    assert.equal(command,'npx');
    if(args.includes('time-travel'))return {stdout:JSON.stringify({bookmark:'synthetic-bookmark-123456'})};
    assert.equal(args[args.indexOf('--command')+1],IDENTITY_SNAPSHOT_SQL);
    return {stdout:JSON.stringify(mutate([{success:true,results:[snapshot(db)]}]))};
  }};
}
function apply(db, sql) {
  db.exec('BEGIN IMMEDIATE');
  try {db.exec(sql);db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').run(IDENTITY_MIGRATION,'2026-11-06 21:00:00');db.exec('COMMIT');}
  catch(e){db.exec('ROLLBACK');throw e;}
}

test('pure normalizer matches the exact functional Unicode rule',()=>{
  const original=name=>String(name).normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase().normalize('NFKC');
  for(const s of [' ÉQUIPE ','E\u0301QUIPE','Ｆｕｌｌ　Ｗｉｄｔｈ','K','ﬃ','A\u00a0\u2003B','\t A\n B \r','İ','ẞ','ação','açao','東京','😀',''])assert.equal(canonicalOrganizationName(s),original(s));
  assert.equal(canonicalOrganizationName('E\u0301QUIPE'),canonicalOrganizationName('Équipe'));
  assert.notEqual(canonicalOrganizationName('ação'),canonicalOrganizationName('acao'));
});
for(const invalid of [null,{},'', [null],[[]],[{}], [{...row,id:0}],[{...row,id:1.5}],[{...row,id:'1'}],
  [{...row,name:''}],[{...row,name:5}],[{...row,slug:null}],[{...row,dropbox_root_path:null}],
  [{...row,dropbox_root_path:' '}],[row,row],...['id','name','slug','dropbox_root_path'].map(k=>[Object.fromEntries(Object.entries(row).filter(([n])=>n!==k))])]) {
  test('preflight rejects malformed inventory '+JSON.stringify(invalid),()=>assert.throws(()=>auditOrganizationIdentities(invalid)));
}
for(const [kind,other] of [
  ['name',{name:'  SYNTHETIC   E\u0301QUIPE  ',slug:'other',dropbox_root_path:'/other'}],
  ['suffix',{name:'Other',slug:'other-000000001',dropbox_root_path:'/other'}],
  ['path',{name:'Other',slug:'other',dropbox_root_path:'/PROJECTS/SYNTHETIC-000000001'}],
]) test('preflight catches '+kind,()=>assert.ok(auditOrganizationIdentities([row,{id:2,...other}]).conflicts.some(c=>c.kind===kind)));

for(const profile of ['canonical','historical']) {
  test(profile+' complete read-only snapshot includes paused organizations and exports no raw identity',async t=>{
    const db=fixture(t,profile);db.exec('PRAGMA query_only=ON');
    const result=await collectIdentityEvidence('synthetic',remote(db),migration,'pre',injected(db));
    assert.equal(result.report.inventory.total,2);assert.equal(result.report.atomicDatabaseSnapshot,true);
    assert.equal(result.rows[1].name,'Paused');assert.equal(result.report.schema.compatible,true);
    assert.doesNotMatch(JSON.stringify(result.report),/Synthetic Équipe|\/projects\/|"Paused"|CREATE TABLE/);
    assert.throws(()=>db.exec('UPDATE organizations SET active=0'),/readonly/);
  });
  test(profile+' guarded SQL applies exact source, preserves historical fields and certifies post schema',async t=>{
    const db=fixture(t,profile);const before=JSON.parse(snapshot(db).inventory_json);
    const e=evidence(db), executable=guardedIdentityMigration(e);
    assert.equal(guardedIdentityMigration(e).sha256,executable.sha256);
    assert.ok(executable.sql.endsWith(source));assert.equal(sha256Text(source),IDENTITY_MIGRATION_SHA256);
    apply(db,executable.sql);
    assert.deepEqual(JSON.parse(snapshot(db).inventory_json),before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM organizations WHERE canonical_name IS NOT NULL').get().n,0);
    const post=await collectIdentityPostValidation('synthetic',remote(db),migration,injected(db));
    assert.equal(post.schema.compatible,true);assert.equal(post.pending.selectedPending,false);
    assert.equal(post.rolloutRequiresFreshValidation,true);
    assert.equal(evaluateOrganizationSchema(Object.fromEntries(Object.entries(ORGANIZATION_SCHEMA_QUERIES).map(([k,s])=>[k,db.prepare(s).all()]))).compatible,false);
  });
  for(const [label,change] of [
    ['same-count rename',db=>db.exec("UPDATE organizations SET name='Renamed' WHERE id=1")],
    ['Unicode-only spelling',db=>db.prepare('UPDATE organizations SET name=? WHERE id=1').run('Synthetic E\u0301quipe')],
    ['same-count replacement',db=>db.exec("UPDATE organizations SET id=3 WHERE id=1")],
    ['slug',db=>db.exec("UPDATE organizations SET slug='changed' WHERE id=1")],
    ['path',db=>db.exec("UPDATE organizations SET dropbox_root_path='/changed' WHERE id=1")],
    ['insert',db=>seed(db,{id:3,name:'Added',slug:'added',dropbox_root_path:'/added'})],
    ['delete',db=>db.exec('DELETE FROM organizations WHERE id=2')],
    ['ledger timestamp',db=>db.exec("UPDATE d1_migrations SET applied_at='2026-11-06 22:00:00' WHERE id=1")],
    ['schema index',db=>db.exec('CREATE INDEX changed_index ON organizations(name)')],
  ]) test(profile+' invalidates authorization and atomically refuses drift: '+label,t=>{
    const db=fixture(t,profile),before=evidence(db), executable=guardedIdentityMigration(before);
    change(db);
    assert.throws(()=>assertIdentityEvidenceUnchanged(before.report,evidence(db).report));
    assert.throws(()=>apply(db,executable.sql),/integer overflow/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('organizations') WHERE name='canonical_name'").get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM d1_migrations WHERE name=?').get(IDENTITY_MIGRATION).n,0);
  });
  test(profile+' old runtime writes remain compatible but Unicode duplicates block rollout',t=>{
    const db=fixture(t,profile);apply(db,guardedIdentityMigration(evidence(db)).sql);
    db.exec("UPDATE organizations SET name='Ordinary edit' WHERE id=1");
    seed(db,{id:3,name:'ORDINARY EDIT',slug:'legacy',dropbox_root_path:'/legacy'});
    assert.equal(db.prepare('SELECT canonical_name FROM organizations WHERE id=3').get().canonical_name,null);
    assert.throws(()=>validateIdentitySnapshot(snapshot(db),'post'),{code:'IDENTITY_0043_CONFLICTS'});
  });
  for(const phase of ['pre','post'])for(const [label,mutate] of [
    ['extra table',db=>db.exec('CREATE TABLE organization_creation_unreviewed(x)')],
    ['extra trigger',db=>db.exec('CREATE TRIGGER unexpected AFTER UPDATE ON organizations BEGIN SELECT 1; END')],
    ['missing index',db=>db.exec('DROP INDEX idx_org_management_creation')],
    ['missing trigger',db=>db.exec('DROP TRIGGER org_management_owner_valid')],
  ])test(profile+' '+phase+' rejects schema drift '+label,t=>{
    const db=fixture(t,profile);if(phase==='post')apply(db,guardedIdentityMigration(evidence(db)).sql);
    mutate(db);assert.equal(evaluateIdentitySchema(observe(db),phase).compatible,false);
  });
}

for(const [label,mutate] of [
  ['subset',r=>{r.inventory_json=JSON.stringify([row]);}],
  ['empty truncated',r=>{r.inventory_json='[]';}],
  ['invalid total',r=>{r.total='2';}],
  ['reordered',r=>{r.inventory_json=JSON.stringify(JSON.parse(r.inventory_json).reverse());}],
  ['duplicate IDs',r=>{r.inventory_json=JSON.stringify([row,row]);}],
  ['missing prerequisite',r=>{r.ledger_json=JSON.stringify(JSON.parse(r.ledger_json).slice(1));}],
  ['missing0042',r=>{r.ledger_json=JSON.stringify(JSON.parse(r.ledger_json).slice(0,-1));}],
  ['malformed ledger',r=>{r.ledger_json=JSON.stringify([{id:1,name:'',applied_at:''}]);}],
  ['duplicate ledger',r=>{const a=JSON.parse(r.ledger_json);r.ledger_json=JSON.stringify([...a,a[0]]);}],
  ['truncated JSON',r=>{r.schema_json=r.schema_json.slice(0,-10);}],
])test('snapshot refuses '+label,t=>{const db=fixture(t),r=snapshot(db);mutate(r);assert.throws(()=>validateIdentitySnapshot(r,'pre'));});

for(const [label,mutate] of [
  ['failure',a=>[{...a[0],success:false}]],['no explicit success',a=>[{results:a[0].results}]],
  ['empty response',()=>[]],['multiple responses',a=>[...a,...a]],['no row',()=>[{success:true,results:[]}]],
  ['multiple rows',a=>[{success:true,results:[...a[0].results,...a[0].results]}]],
])test('collector refuses D1 '+label,async t=>{
  const db=fixture(t);await assert.rejects(collectIdentityEvidence('synthetic',remote(db),migration,'pre',injected(db,mutate)),{code:'IDENTITY_0043_RESPONSE_INVALID'});
});
test('empty complete database is distinguished from truncated nonempty response',t=>{
  const db=fixture(t);db.exec('DELETE FROM organizations');assert.equal(evidence(db).report.inventory.total,0);
  apply(db,guardedIdentityMigration(evidence(db)).sql);
});
test('0043 hash binds raw inventory, ledger, exact schema and guarded execution; generic hash cannot approve it',t=>{
  const db=fixture(t),e=evidence(db),execution=guardedIdentityMigration(e);
  const args={migration:IDENTITY_MIGRATION,migrationSha256:IDENTITY_MIGRATION_SHA256,gitSha:'a'.repeat(40),pendingDigest:'b'.repeat(64)};
  assert.throws(()=>buildApproval(args),{code:'IDENTITY_EVIDENCE_REQUIRED'});
  const hash=x=>buildApproval({...args,evidenceDigest:identityApprovalEvidence(x,guardedIdentityMigration(x))}).approvalHash;
  const before=hash(e);db.exec("UPDATE organizations SET name='Same count change' WHERE id=1");assert.notEqual(hash(evidence(db)),before);
  assert.notEqual(identityApprovalEvidence(e,{...execution,sha256:'f'.repeat(64)}),identityApprovalEvidence(e,execution));
});
test('isolated directory contains precisely the audited guarded file and unguarded 0043 is refused',async t=>{
  const db=fixture(t),execution=guardedIdentityMigration(evidence(db));
  const temp=await makeTemporaryWranglerConfig('f'.repeat(32),{isolatedMigration:migration,identityExecution:execution});
  try {assert.deepEqual(await readdir(join(temp.root,'migrations')),[IDENTITY_MIGRATION]);
    assert.equal(sha256Text(await readFile(join(temp.root,'migrations',IDENTITY_MIGRATION),'utf8')),execution.sha256);
  } finally {await temp.cleanup();}
  await assert.rejects(makeTemporaryWranglerConfig('f'.repeat(32),{isolatedMigration:migration}),{code:'IDENTITY_EXECUTION_REQUIRED'});
});
test('quoted strings and SQL-like names stay binary data in guards',t=>{
  const db=fixture(t);db.prepare('UPDATE organizations SET name=? WHERE id=1').run("é'; DROP TABLE users; --\n😀");
  const e=evidence(db);apply(db,guardedIdentityMigration(e).sql);
  assert.equal(db.prepare('SELECT name FROM organizations WHERE id=1').get().name,e.rows[0].name);
});
test('all protected entry points select 0043 explicitly including internal postvalidate',()=>{
  for(const path of ['audit-production.mjs','apply-production.mjs','post-validate-production.mjs']) {
    const text=readFileSync(new URL('../scripts/migrations/'+path,import.meta.url),'utf8');
    assert.match(text,/IDENTITY_MIGRATION/);assert.match(text,/collectIdentity/);
  }
  const apply=readFileSync(new URL('../scripts/migrations/apply-production.mjs',import.meta.url),'utf8');
  assert.ok(apply.indexOf('assertIdentityEvidenceUnchanged')<apply.indexOf('applyStarted = true'));
  assert.match(apply,/identityPostValidation/);
});

for(const name of ['idx_organization_canonical_name','idx_organization_numeric_suffix','org_identity_insert','org_identity_update','org_identity_reservation']) {
  test('post profile rejects missing 0043 object '+name,t=>{
    const db=fixture(t);apply(db,guardedIdentityMigration(evidence(db)).sql);
    db.exec('DROP '+(name.startsWith('idx_')?'INDEX ':'TRIGGER ')+name);
    assert.equal(evaluateIdentitySchema(observe(db),'post').compatible,false);
  });
}
for(const [label,mutate] of [
  ['nullable canonical key',r=>{r['columns:organizations'].find(c=>c.name==='canonical_name').notnull=1;}],
  ['reservation FK delete',r=>{r['foreignKeys:organization_creation_identities'][0].on_delete='CASCADE';}],
  ['path collation',r=>{r.objects.find(o=>o.name==='organization_creation_identities').sql=r.objects.find(o=>o.name==='organization_creation_identities').sql.replace('COLLATE NOCASE','COLLATE BINARY');}],
  ['suffix length',r=>{r.objects.find(o=>o.name==='organization_creation_identities').sql=r.objects.find(o=>o.name==='organization_creation_identities').sql.replace('length(suffix)=9','length(suffix)=8');}],
  ['trigger predicate',r=>{r.objects.find(o=>o.name==='org_identity_update').sql=r.objects.find(o=>o.name==='org_identity_update').sql.replace("':0'","':1'");}],
  ['unique index',r=>{r['indexes:organizations'].find(i=>i.name==='idx_organization_canonical_name').unique=0;}],
])test('post profile rejects changed 0043 semantics: '+label,t=>{
  const db=fixture(t);apply(db,guardedIdentityMigration(evidence(db)).sql);const observed=observe(db);mutate(observed);
  assert.equal(evaluateIdentitySchema(observed,'post').compatible,false);
});
test('SQLite uniqueness and identity reservations reject conflicting old/new writers',t=>{
  const db=fixture(t);apply(db,guardedIdentityMigration(evidence(db)).sql);
  assert.throws(()=>seed(db,{id:3,name:'Unique name',slug:'another-000000001',dropbox_root_path:'/different'}),/UNIQUE/);
  db.exec("UPDATE organizations SET canonical_name='unique' WHERE id=1");
  assert.throws(()=>db.exec("UPDATE organizations SET canonical_name='unique' WHERE id=2"),/UNIQUE/);
  db.exec("INSERT INTO users(id,email,password_hash) VALUES(1,'synthetic@example.test','synthetic'); INSERT INTO organization_management_operations(id,actor_id,idempotency_key,payload_hash,kind,payload_json) VALUES('op',1,'synthetic','hash','create','{}')");
  assert.throws(()=>db.exec("INSERT INTO organization_creation_identities VALUES('op','000000001','different','/different')"),/COLLISION/);
  db.exec("INSERT INTO organization_creation_identities VALUES('op','000000009','reserved-000000009','/reserved')");
  assert.throws(()=>seed(db,{id:3,name:'Other',slug:'reserved-000000009',dropbox_root_path:'/unused'}),/COLLISION/);
  assert.throws(()=>db.exec("UPDATE organizations SET dropbox_root_path='/RESERVED' WHERE id=2"),/COLLISION/);
  db.exec("INSERT INTO organizations(name,slug,dropbox_root_path,management_create_key) VALUES('Authorized item','reserved-000000009','/reserved','op:0')");
});
test('size budgets block authorization instead of truncating an inventory or guard',t=>{
  const db=fixture(t);const raw=snapshot(db);raw.inventory_json=' '.repeat(1800001);
  assert.throws(()=>validateIdentitySnapshot(raw,'pre'),{code:'IDENTITY_0043_SNAPSHOT_SIZE'});
  db.prepare('UPDATE organizations SET name=? WHERE id=1').run('x'.repeat(50000));
  assert.throws(()=>guardedIdentityMigration(evidence(db)),{code:'IDENTITY_0043_GUARD_TOO_LARGE'});
});
test('snapshot uses SQL function argument counts supported by D1',()=>{
  assert.match(IDENTITY_SNAPSHOT_SQL,/json_group_object/);
  for(const args of IDENTITY_SNAPSHOT_SQL.matchAll(/json_object\(([^()]*)\)/g))assert.ok(args[1].split(',').length<=32);
  assert.ok(Buffer.byteLength(IDENTITY_SNAPSHOT_SQL)<90000);
});
