import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ownerRetention } from '../functions/_lib/owner-retention.js';

function fixture(t) {
  const temporaryRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'maono-admin-rehearsal-'));
  assert.ok(resolve(directory).startsWith(temporaryRoot + sep));
  const path = join(directory, 'synthetic.sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO users(id,email,password_hash,role) VALUES(2,'owner-a@example.test','synthetic','viewer'),(3,'owner-b@example.test','synthetic','viewer');
    INSERT INTO organizations(id,name,slug,dropbox_root_path) VALUES(1,'Synthetic race','synthetic-race','/synthetic-race');
    INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(1,2,'owner'),(1,3,'owner');
    UPDATE organizations SET management_owner_id=2 WHERE id=1;`);
  const workers = [];
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.terminate()));
    db.close();
    assert.ok(resolve(directory).startsWith(temporaryRoot + sep));
    rmSync(directory, { recursive: true });
  });
  const env = { DB: { prepare: sql => ({ all: async () => ({ results: db.prepare(sql).all() }) }) } };
  async function race(operations) {
    const barrier = new SharedArrayBuffer(4);
    const ready = [], done = [];
    for (const operation of operations) {
      const worker = new Worker(new URL('./helpers/admin-owner-schema-worker.mjs', import.meta.url), { workerData: { path, barrier, ...operation } });
      workers.push(worker);
      ready.push(new Promise((yes, no) => { worker.on('message', value => { if (value === 'ready') yes(); }); worker.once('error', no); }));
      done.push(new Promise((yes, no) => {
        worker.on('message', value => { if (value !== 'ready') yes(value); });
        worker.once('error', no); worker.once('exit', code => { if (code) no(new Error(`worker exit ${code}`)); });
      }));
    }
    await Promise.all(ready);
    Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0);
    return Promise.all(done);
  }
  function integrity() {
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare(`SELECT count(*) n FROM organizations o JOIN organization_users m
      ON m.organization_id=o.id AND m.user_id=o.management_owner_id JOIN users u ON u.id=m.user_id
      WHERE o.id=1 AND m.access_level='owner' AND u.active=1`).get().n, 1);
  }
  return { db, env, race, integrity };
}

for (const methods of [['UPDATE', 'UPDATE'], ['DELETE', 'DELETE'], ['UPDATE', 'DELETE']]) {
  test(`full 0042 schema: independent ${methods.join('/')} race preserves designated and final owner`, async t => {
    const f = fixture(t), operations = [];
    for (const [index, method] of methods.entries()) {
      const userId = index + 2;
      const guard = await ownerRetention(f.env, { userId, organizationId: 1, accessLevel: 'viewer', removing: method === 'DELETE' });
      operations.push({ sql: `${method === 'DELETE' ? 'DELETE FROM' : 'UPDATE'} organization_users ${method === 'UPDATE' ? "SET access_level='viewer'" : ''} WHERE user_id=? AND ${guard.sql}`, args: [userId, ...guard.args] });
    }
    const results = await f.race(operations);
    assert.deepEqual(results.map(result => result.changes).sort(), [0, 1]);
    for (const result of results) if (result.error) assert.equal(result.error, 'MANAGEMENT_OWNER_REASSIGN_REQUIRED');
    assert.equal(f.db.prepare("SELECT user_id FROM organization_users WHERE access_level='owner'").get().user_id, 2);
    f.integrity();
  });
}

for (const mutation of ['demote', 'deactivate']) {
  test(`full 0042 schema: reassignment racing ${mutation} cannot commit an ineligible manager`, async t => {
    const f = fixture(t);
    const guard = await ownerRetention(f.env, { userId: 3, organizationId: 1, ...(mutation === 'demote' ? { accessLevel: 'viewer' } : { active: 0 }) });
    const results = await f.race([
      { sql: 'UPDATE organizations SET management_owner_id=3 WHERE id=1', args: [] },
      { sql: `${mutation === 'demote' ? "UPDATE organization_users SET access_level='viewer' WHERE user_id=3" : 'UPDATE users SET active=0 WHERE id=3'} AND ${guard.sql}`, args: guard.args },
    ]);
    assert.deepEqual(results.map(result => result.changes).sort(), [0, 1]);
    assert.ok(results.some(result => ['MANAGEMENT_OWNER_REASSIGN_REQUIRED', 'MANAGEMENT_OWNER_INELIGIBLE'].includes(result.error)));
    f.integrity();
  });
}

test('full 0042 schema: independent reservations cannot exceed the persisted quota', async t => {
  const f = fixture(t);
  f.db.exec('UPDATE organizations SET project_limit=1 WHERE id=1');
  const sql = `INSERT INTO organization_resource_reservations(organization_id,resource_type,idempotency_key,actor_user_id,status,expires_at)
    VALUES(1,'project',?,2,'RESERVED','2099-01-01T00:00:00.000Z')`;
  const results = await f.race([{ sql, args: ['synthetic-reservation-a'] }, { sql, args: ['synthetic-reservation-b'] }]);
  assert.deepEqual(results.map(result => result.changes).sort(), [0, 1]);
  assert.equal(results.find(result => result.error).error, 'ORGANIZATION_PROJECT_LIMIT_REACHED');
  assert.equal(f.db.prepare('SELECT count(*) n FROM organization_resource_reservations').get().n, 1);
  f.integrity();
});
