import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ORGANIZATION_MIGRATION, ORGANIZATION_MIGRATION_SHA256, ORGANIZATION_SCHEMA_QUERIES,
  expectedOrganizationSchema, evaluateOrganizationSchema, readOrganizationSchema, collectOrganizationPostValidation,
} from '../scripts/migrations/organization-management-schema.mjs';
import { PRODUCTION_DATABASE_NAME, PRODUCTION_DATABASE_ID } from '../scripts/migrations/production-migration-lib.mjs';
import { ORGANIZATION_SCHEMA_PROFILES, ORGANIZATION_SCHEMA_SOURCES, buildOrganizationSchemaReferences } from '../scripts/migrations/organization-schema-references.mjs';
import { installMigratedOrganizationSchema } from './helpers/organization-schema-history.mjs';

for (const profile of ORGANIZATION_SCHEMA_PROFILES) {
const reference = expectedOrganizationSchema(profile);
const migration = { name: ORGANIZATION_MIGRATION, sha256: ORGANIZATION_MIGRATION_SHA256 };
const prerequisiteNames = profile === 'canonical-bootstrap-v1'
  ? ['0007_create_organization_limit_requests.sql', '0016_map_panel_navigation_and_quota.sql', ORGANIZATION_MIGRATION]
  : Object.keys(ORGANIZATION_SCHEMA_SOURCES).filter(path => path.startsWith('migrations/')).map(path => path.slice(11));
const ledger = prerequisiteNames
  .map((name, i) => ({ id: i + 1, name, appliedAt: '2026-10-30 01:49:42' }));
const remote = {
  identity: { name: PRODUCTION_DATABASE_NAME, id: PRODUCTION_DATABASE_ID }, ledger,
  localMigrations: ['0001_earlier_pending.sql', ...ledger.map(r => r.name), '0043_later_pending.sql'],
};
function fixture(t, prepare = () => {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  if (profile === 'migrated-0002-0042-v1') installMigratedOrganizationSchema(db);
  else db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');
  for (const row of ledger) db.prepare('INSERT INTO d1_migrations VALUES(?,?,?)').run(row.id, row.name, row.appliedAt);
  db.exec("INSERT INTO users(email,password_hash) VALUES('synthetic-only@example.test','SYNTHETIC_SECRET');");
  prepare(db);
  db.exec('PRAGMA query_only=ON;');
  const calls = [], allowed = new Set(Object.values(ORGANIZATION_SCHEMA_QUERIES));
  const injected = { runProcess: async (command, args) => {
    assert.equal(command, 'npx');
    assert.ok(args.includes(PRODUCTION_DATABASE_NAME));
    calls.push(args);
    if (args.includes('time-travel')) {
      assert.deepEqual(args.slice(2,6), ['d1','time-travel','info',PRODUCTION_DATABASE_NAME]);
      return { stdout: JSON.stringify({ bookmark: 'synthetic-bookmark-123456789' }) };
    }
    const sql = args[args.indexOf('--command') + 1];
    assert.ok(allowed.has(sql) || sql === 'SELECT id, name, applied_at FROM d1_migrations ORDER BY id;', sql);
    assert.ok(args.includes('--remote'));
    return { stdout: JSON.stringify([{ results: db.prepare(sql).all(), success: true }]) };
  } };
  return { db, calls, injected };
}

test('0042 reference and independent SQLite fixture agree through fixed read-only queries: ' + profile, async t => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT * FROM users').all();
  const result = await readOrganizationSchema('synthetic-config', f.injected);
  assert.equal(result.compatible, true);
  assert.equal(result.profile, profile);
  assert.equal(result.profiles.filter(p => p.compatible).length, 1);
  assert.equal(result.checks.length, 68);
  assert.ok(result.checks.every(c => c.ok));
  assert.deepEqual(result.expectedCounts, { addedColumns:12,tables:4,namedIndexes:5,triggers:11 });
  assert.equal(f.calls.length, 27);
  assert.deepEqual(f.db.prepare('SELECT * FROM users').all(), before);
  assert.equal(f.db.prepare('PRAGMA query_only').get().query_only, 1);
  assert.throws(() => f.db.exec('UPDATE users SET active=0'), /readonly/);
  assert.throws(() => f.db.exec('CREATE TABLE forbidden(id INTEGER)'), /readonly/);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'), false);
  assert.equal(JSON.stringify(result).includes('CREATE TRIGGER'), false);
});

const mutations = [
  ['missing trigger', r => { r.objects = r.objects.filter(o => o.name !== 'org_management_owner_valid'); }],
  ['missing table', r => { r.objects = r.objects.filter(o => o.name !== 'organization_management_operations'); }],
  ['missing index', r => { r.objects = r.objects.filter(o => o.name !== 'idx_org_management_creation'); }],
  ['changed quota predicate', r => { const o=r.objects.find(o=>o.name==='org_management_quota_reserve_insert'); o.sql=o.sql.replace('>=','>'); }],
  ['changed CHECK literal', r => { const o=r.objects.find(o=>o.name==='organizations'); o.sql=o.sql.replace("'enterprise'","'Enterprise'"); }],
  ['changed literal whitespace', r => { const o=r.objects.find(o=>o.name==='org_management_owner_valid'); o.sql=o.sql.replace("'owner'","' owner '"); }],
  ['changed default', r => { r['columns:organizations'].find(c=>c.name==='management_version').dflt_value='1'; }],
  ['changed nullability', r => { r['columns:organizations'].find(c=>c.name==='management_version').notnull=0; }],
  ['missing added column', r => { r['columns:organizations']=r['columns:organizations'].filter(c=>c.name!=='plan'); }],
  ['changed FK action', r => { r['foreignKeys:organizations'].find(c=>c.from==='management_owner_id').on_delete='CASCADE'; }],
  ['changed partial index', r => { r['indexes:organizations'].find(c=>c.name==='idx_org_management_creation').partial=0; }],
  ['changed index order', r => { r['indexColumns:idx_org_management_events_org'][1].desc=0; }],
  ['changed unique constraint', r => { r['indexes:organization_management_operations'].find(c=>c.name.endsWith('_2')).unique=0; }],
  ['unexpected namespace object', r => { r.objects.push({type:'table',name:'organization_management_SECRET',tbl_name:'organization_management_SECRET',sql:'SECRET'}); }],
];
for (const [label, mutate] of mutations) test(profile + ' 0042 fails closed: ' + label, () => {
  const observed = structuredClone(reference);
  mutate(observed);
  const report = evaluateOrganizationSchema(observed, reference);
  assert.equal(report.compatible, false);
  assert.equal(evaluateOrganizationSchema(observed).compatible, false);
  assert.ok(report.mismatches.length > 0);
  assert.equal(JSON.stringify(report).includes('SECRET'), false);
});

test(profile + ' 0042 accepts formatting/comments without changing SQL literals', () => {
  const observed = structuredClone(reference);
  // SQLite autoindexes have no SQL text; formatting must not invent a "null" DDL.
  for (const o of observed.objects) if (o.sql !== null) o.sql = '\n /* metadata formatting */ \n' + o.sql + ' \n';
  assert.equal(evaluateOrganizationSchema(observed, reference).compatible, true);
});

test(profile + ' 0042 postvalidation exports complete ledger, pending set/digest and a fresh bookmark without writes', async t => {
  const f=fixture(t);
  const result=await collectOrganizationPostValidation('synthetic-config',remote,migration,f.injected);
  assert.deepEqual(result.ledger.rows,ledger);
  assert.equal(result.ledger.appliedCount,ledger.length);
  assert.deepEqual(result.pending.pending,['0001_earlier_pending.sql','0043_later_pending.sql']);
  assert.equal(result.pending.selectedPending,false);
  assert.match(result.pending.pendingDigest,/^[a-f0-9]{64}$/);
  assert.equal(result.backup.bookmark,'synthetic-bookmark-123456789');
  assert.equal(result.ledgerStableAcrossCollection,true);
  assert.equal(result.atomicDatabaseSnapshot,false);
  assert.equal(f.calls.length,30);
});

test('0042 refuses wrong database or SQL hash before any remote call', async () => {
  let calls=0;
  const injected={runProcess:async()=>{calls++;throw new Error('must not run');}};
  for (const [target, source] of [
    [{...remote,identity:{...remote.identity,id:'wrong'}},migration],
    [remote,{...migration,sha256:'a'.repeat(64)}],
    [remote,{...migration,name:'0043_other.sql'}],
  ]) await assert.rejects(collectOrganizationPostValidation('synthetic',target,source,injected),
    {code:'ORGANIZATION_POSTVALIDATE_TARGET_INVALID'});
  assert.equal(calls,0);
});

test('0042 refuses duplicate or missing prerequisite ledger before collection', async () => {
  let calls=0;
  const injected={runProcess:async()=>{calls++;throw new Error('must not run');}};
  await assert.rejects(collectOrganizationPostValidation('synthetic',{...remote,ledger:[...ledger,ledger[0]]},migration,injected),
    {code:'ORGANIZATION_LEDGER_INVALID'});
  await assert.rejects(collectOrganizationPostValidation('synthetic',{...remote,ledger:ledger.filter(row => row.name !== ORGANIZATION_MIGRATION)},migration,injected),
    {code:'ORGANIZATION_LEDGER_REQUIRED'});
  assert.equal(calls,0);
});

test('0042 detects ledger drift before collection and does not retry', async t => {
  const f=fixture(t);
  const initial={...remote,ledger:ledger.map(r=>({...r,appliedAt:'2026-10-29 00:00:00'}))};
  await assert.rejects(collectOrganizationPostValidation('synthetic',initial,migration,f.injected),
    {code:'ORGANIZATION_POSTVALIDATE_LEDGER_DRIFT'});
  assert.equal(f.calls.length,1);
});

test('0042 collector propagates a denied query without trying another route', async () => {
  let calls=0;
  await assert.rejects(readOrganizationSchema('synthetic',{runProcess:async()=>{calls++;throw new Error('denied');}}),/denied/);
  assert.equal(calls,1);
});

if (profile === 'migrated-0002-0042-v1') {
  for (const name of prerequisiteNames.filter(n => !['0007_create_organization_limit_requests.sql', '0016_map_panel_navigation_and_quota.sql', ORGANIZATION_MIGRATION].includes(n))) {
    test('0042 refuses historical profile without source ledger: ' + name, async t => {
      const f = fixture(t, db => db.prepare('DELETE FROM d1_migrations WHERE name=?').run(name));
      const target = { ...remote, ledger: ledger.filter(row => row.name !== name) };
      await assert.rejects(collectOrganizationPostValidation('synthetic', target, migration, f.injected), {code:'ORGANIZATION_LEDGER_REQUIRED'});
      assert.equal(f.calls.length, 28); // initial ledger + fixed metadata; no bookmark/retry
    });
  }
}

// Rebuild only an empty synthetic table, preserving every pre-existing index
// and trigger. Read the resulting real SQLite metadata through the collector.
function addTableConstraint(db, name, constraint) {
  const sql = db.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').get('table', name).sql;
  const dependents = db.prepare('SELECT sql FROM sqlite_schema WHERE tbl_name=? AND sql IS NOT NULL AND type IN (?,?)')
    .all(name, 'index', 'trigger');
  db.exec('DROP TABLE ' + name);
  db.exec(sql.replace(/\)\s*$/, ', ' + constraint + ')'));
  for (const row of dependents) db.exec(row.sql);
}

const restrictiveSchema = [
  ['organizations table CHECK', db => {
    addTableConstraint(db, 'organizations', "CHECK (plan IS NULL OR plan = 'free')");
    assert.throws(() => db.exec("INSERT INTO organizations(name,slug,dropbox_root_path,plan) VALUES('Synthetic','synthetic','synthetic','pro')"), /CHECK constraint failed/);
  }],
  ['requests table CHECK', db => addTableConstraint(db, 'organization_limit_requests', 'CHECK (management_version = 0)')],
  ['organizations named UNIQUE', db => addTableConstraint(db, 'organizations', 'CONSTRAINT extra_unique UNIQUE (management_version)')],
  ['requests named UNIQUE', db => addTableConstraint(db, 'organization_limit_requests', 'CONSTRAINT extra_unique UNIQUE (management_version)')],
  ['organizations extra FK', db => addTableConstraint(db, 'organizations', 'FOREIGN KEY (active) REFERENCES users(id)')],
  ['requests extra FK', db => addTableConstraint(db, 'organization_limit_requests', 'FOREIGN KEY (status) REFERENCES users(email)')],
  ['organizations arbitrary unique index', db => db.exec('CREATE UNIQUE INDEX unexpected_restrictive_index ON organizations(management_version)')],
  ['requests arbitrary unique index', db => db.exec('CREATE UNIQUE INDEX unexpected_restrictive_index ON organization_limit_requests(management_version)')],
  ['organizations arbitrary restrictive trigger', db => db.exec("CREATE TRIGGER unexpected_restrictive_trigger BEFORE INSERT ON organizations BEGIN SELECT RAISE(ABORT,'SYNTHETIC_RESTRICTION'); END")],
  ['requests arbitrary restrictive trigger', db => db.exec("CREATE TRIGGER unexpected_restrictive_trigger BEFORE INSERT ON organization_limit_requests BEGIN SELECT RAISE(ABORT,'SYNTHETIC_RESTRICTION'); END")],
];
for (const [label, prepare] of restrictiveSchema) test(profile + ' 0042 rejects real SQLite drift: ' + label, async t => {
  const f = fixture(t, prepare);
  const report = await readOrganizationSchema('synthetic-config', f.injected);
  assert.equal(report.compatible, false);
  assert.ok(report.mismatches.length > 0);
  assert.equal(f.db.prepare('PRAGMA query_only').get().query_only, 1);
  assert.doesNotMatch(JSON.stringify(report), /unexpected_restrictive|extra_unique|SYNTHETIC_RESTRICTION/);
});

const invalidRawLedger = [
  ['empty name', row => ({ ...row, name: '' })],
  ['null name', row => ({ ...row, name: null })],
  ['numeric name', row => ({ ...row, name: 1234 })],
  ['numeric timestamp', row => ({ ...row, applied_at: 1234 })],
  ['string id', row => ({ ...row, id: '4' })],
  ['null row', () => null],
];
for (const phase of ['initial', 'final']) for (const [label, invalidate] of invalidRawLedger) {
  test(profile + ' 0042 rejects invalid raw ledger ' + phase + ': ' + label, async t => {
    const f = fixture(t);
    let ledgerReads = 0;
    const injected = { runProcess: async (command, args) => {
      const result = await f.injected.runProcess(command, args);
      if (args.includes('SELECT id, name, applied_at FROM d1_migrations ORDER BY id;')) {
        ledgerReads++;
        if (ledgerReads === (phase === 'initial' ? 1 : 2)) {
          const raw = JSON.parse(result.stdout);
          raw[0].results.push(invalidate({id:ledger.length+1,name:'0043_synthetic.sql',applied_at:'2026-10-30 01:49:42'}));
          return { stdout: JSON.stringify(raw) };
        }
      }
      return result;
    } };
    await assert.rejects(collectOrganizationPostValidation('synthetic', remote, migration, injected),
      { code: 'ORGANIZATION_LEDGER_INVALID' });
    assert.equal(ledgerReads, phase === 'initial' ? 1 : 2);
    assert.equal(f.calls.length, phase === 'initial' ? 1 : 30);
  });
}

for (const phase of ['initial', 'final']) for (const [label, mutate, code] of [
  ['duplicate id', rows => rows.push({...rows[0],name:'0043_synthetic.sql'}), 'ORGANIZATION_LEDGER_INVALID'],
  ['duplicate name', rows => rows.push({...rows[0],id:4}), 'ORGANIZATION_LEDGER_INVALID'],
  ['missing prerequisite', rows => rows.splice(rows.findIndex(r => r.name === ORGANIZATION_MIGRATION),1), 'ORGANIZATION_LEDGER_REQUIRED'],
]) test(profile + ' 0042 rejects raw ledger ' + phase + ': ' + label, async t => {
  const f = fixture(t);
  let ledgerReads = 0;
  const injected = { runProcess: async (command, args) => {
    const result = await f.injected.runProcess(command, args);
    if (args.includes('SELECT id, name, applied_at FROM d1_migrations ORDER BY id;') &&
        ++ledgerReads === (phase === 'initial' ? 1 : 2)) {
      const raw = JSON.parse(result.stdout);
      mutate(raw[0].results);
      return { stdout: JSON.stringify(raw) };
    }
    return result;
  } };
  await assert.rejects(collectOrganizationPostValidation('synthetic', remote, migration, injected), {code});
  assert.equal(ledgerReads, phase === 'initial' ? 1 : 2);
  assert.equal(f.calls.length, phase === 'initial' ? 1 : 30);
});

for (const [label, mutate] of [
  ['changed timestamp', rows => { rows[0].applied_at='2026-10-30 02:00:00'; }],
  ['added valid row', rows => rows.push({id:ledger.length+1,name:'0043_later_pending.sql',applied_at:'2026-10-30 02:00:00'})],
]) test(profile + ' 0042 detects raw ledger drift across collection: ' + label, async t => {
  const f = fixture(t);
  let ledgerReads = 0;
  const injected = { runProcess: async (command, args) => {
    const result = await f.injected.runProcess(command, args);
    if (args.includes('SELECT id, name, applied_at FROM d1_migrations ORDER BY id;') && ++ledgerReads === 2) {
      const raw = JSON.parse(result.stdout);
      mutate(raw[0].results);
      return { stdout: JSON.stringify(raw) };
    }
    return result;
  } };
  await assert.rejects(collectOrganizationPostValidation('synthetic', remote, migration, injected),
    {code:'ORGANIZATION_POSTVALIDATE_LEDGER_DRIFT'});
  assert.equal(ledgerReads, 2);
  assert.equal(f.calls.length, 30);
});
}

test('0042 preserves the original historical failure and recognizes a complete historical profile', () => {
  const historical = expectedOrganizationSchema('migrated-0002-0042-v1');
  const oldComparison = evaluateOrganizationSchema(historical, expectedOrganizationSchema());
  // The old full DDL mismatch remains reproducible; full legacy PRAGMAs now
  // correctly show the semantic nullability/default difference as well.
  assert.equal(oldComparison.compatible, false);
  const definition = oldComparison.checks.find(c => c.name === 'organizations');
  assert.equal(definition.ok, false);
  assert.equal(definition.observedDigest, '34da4f6a89d01b79690fdff132f5e2a330537b06f0c2ac76c649b7e718ee4d54');
  assert.equal(definition.expectedDigest, '7f8b0b0c2d08afadf8ea69b98c2ce1f5110350720cc293f5d27bad3caa11b1a7');
  const result = evaluateOrganizationSchema(historical);
  assert.equal(result.compatible, true);
  assert.equal(result.profile, 'migrated-0002-0042-v1');
  assert.equal(result.referenceSources.length, 8);
});

for (const profile of ORGANIZATION_SCHEMA_PROFILES) {
  for (const [label, mutate] of [
    ['legacy nullability', r => { r['columns:organizations'].find(c => c.name === 'storage_status').notnull ^= 1; }],
    ['legacy default', r => { r['columns:organizations'].find(c => c.name === 'storage_status').dflt_value = "'UNEXPECTED'"; }],
    ['legacy FK action', r => { r['foreignKeys:organization_limit_requests'][0].on_delete = 'CASCADE'; }],
    ['legacy index constraint', r => { r['indexes:organizations'].find(c => c.name === 'idx_organizations_active').unique = 1; }],
  ]) test(profile + ' rejects equivalent legacy metadata drift: ' + label, () => {
    const observed = expectedOrganizationSchema(profile);
    mutate(observed);
    assert.equal(evaluateOrganizationSchema(observed).compatible, false);
  });
  test(profile + ' rejects a hybrid DDL/metadata profile', () => {
    const observed = expectedOrganizationSchema(profile);
    const other = expectedOrganizationSchema(ORGANIZATION_SCHEMA_PROFILES.find(p => p !== profile));
    observed.objects.find(o => o.name === 'organizations').sql = other.objects.find(o => o.name === 'organizations').sql;
    assert.equal(evaluateOrganizationSchema(observed).compatible, false);
  });
}

test('0042 rejects real hybrid historical ordering with canonical nullability/default', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  installMigratedOrganizationSchema(db);
  const objects = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='organizations' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  const sql = db.prepare("SELECT sql FROM sqlite_schema WHERE name='organizations'").get().sql;
  db.exec('DROP TABLE organizations');
  db.exec(sql.replace('storage_status TEXT', "storage_status TEXT NOT NULL DEFAULT 'PENDING'"));
  for (const object of objects) db.exec(object.sql);
  const observed = Object.fromEntries(Object.entries(ORGANIZATION_SCHEMA_QUERIES).map(([key, query]) => [key, db.prepare(query).all()]));
  assert.equal(evaluateOrganizationSchema(observed).compatible, false);
});

test('0042 rejects the complete historical baseline before 0042', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  installMigratedOrganizationSchema(db, { include0042: false });
  const observed = Object.fromEntries(Object.entries(ORGANIZATION_SCHEMA_QUERIES).map(([key, query]) => [key, db.prepare(query).all()]));
  assert.equal(evaluateOrganizationSchema(observed).compatible, false);
});

for (const changed of Object.keys(ORGANIZATION_SCHEMA_SOURCES)) test('0042 rejects changed reference source: ' + changed, () => {
  assert.throws(() => buildOrganizationSchemaReferences(ORGANIZATION_SCHEMA_QUERIES, path =>
    readFileSync(new URL('../' + path, import.meta.url), 'utf8') + (path === changed ? '\n-- changed source' : '')),
  { code: 'ORGANIZATION_SCHEMA_SOURCE_DRIFT' });
});

test('0042 missing local reference fails closed without leaking a path/error payload', () => {
  assert.throws(() => buildOrganizationSchemaReferences(ORGANIZATION_SCHEMA_QUERIES, () => { throw new Error('PRIVATE_PATH'); }),
    error => error.code === 'ORGANIZATION_SCHEMA_SOURCE_DRIFT' && !error.message.includes('PRIVATE_PATH'));
});

test('0042 rejects ambiguous complete profile matches', async () => {
  const references = buildOrganizationSchemaReferences(ORGANIZATION_SCHEMA_QUERIES);
  const observed = references[0].schema;
  const injected = { runProcess: async (_command, args) => {
    const sql = args[args.indexOf('--command') + 1];
    const key = Object.keys(ORGANIZATION_SCHEMA_QUERIES).find(k => ORGANIZATION_SCHEMA_QUERIES[k] === sql);
    assert.ok(key);
    return { stdout: JSON.stringify([{ success:true, results:observed[key] }]) };
  } };
  const result = await readOrganizationSchema('synthetic', injected, [references[0], references[0]]);
  assert.equal(result.compatible, false);
  assert.equal(result.profile, null);
  assert.ok(result.mismatches.includes('ambiguous_schema_profiles'));
});

test('0042 strict ledger collection preserves the legacy queryLedger consumer contract', async () => {
  const {queryLedger} = await import('../scripts/migrations/production-migration-lib.mjs');
  const raw = [
    {id:1,name:'0042_organization_management.sql',applied_at:'2026-10-30 01:49:42'},
    {id:2,name:'',applied_at:null},
    {id:3,name:null,applied_at:null},
    {id:4,name:1234,applied_at:null},
  ];
  const result = await queryLedger('synthetic', {runProcess:async()=>({stdout:JSON.stringify([{results:raw,success:true}])})});
  assert.deepEqual(result, [
    {id:1,name:'0042_organization_management.sql',appliedAt:'2026-10-30 01:49:42'},
    {id:4,name:'1234',appliedAt:null},
  ]);
});
