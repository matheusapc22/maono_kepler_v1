import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ownerRetention } from '../functions/_lib/owner-retention.js';

for (const methods of [['UPDATE','UPDATE'], ['DELETE','DELETE'], ['UPDATE','DELETE']]) test(`independent SQLite connections race ${methods.join('/')}`, async t => {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, 'maono-owner-test-'));
  const path = join(directory, 'synthetic.sqlite');
  assert.ok(resolve(directory).startsWith(root + sep));
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, active INTEGER);
    CREATE TABLE organization_users (id INTEGER PRIMARY KEY, organization_id INTEGER, user_id INTEGER, access_level TEXT);
    INSERT INTO users VALUES (1,'viewer',1),(2,'viewer',1);
    INSERT INTO organization_users VALUES (1,1,1,'owner'),(2,1,2,'owner');`);
  const workers = [];
  t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); db.close(); rmSync(directory, { recursive: true }); });
  const env = { DB: { prepare: sql => ({ all: async () => ({ results: db.prepare(sql).all() }) }) } };
  const barrier = new SharedArrayBuffer(4);
  const ready = [], done = [];
  for (const [index, method] of methods.entries()) {
    const guard = await ownerRetention(env, { userId: index+1, organizationId: 1, accessLevel: 'viewer', removing: method === 'DELETE' });
    const sql = `${method === 'DELETE' ? 'DELETE FROM' : "UPDATE"} organization_users ${method === 'UPDATE' ? "SET access_level='viewer'" : ''} WHERE user_id=? AND ${guard.sql}`;
    const worker = new Worker(new URL('./helpers/owner-retention-worker.mjs', import.meta.url), { workerData: { path, sql, args: [index+1,...guard.args], barrier } });
    workers.push(worker);
    ready.push(new Promise((yes, no) => { worker.on('message', value => { if (value === 'ready') yes(); }); worker.once('error', no); }));
    done.push(new Promise((yes, no) => { worker.on('message', value => { if (value !== 'ready') yes(value.changes); }); worker.once('error', no); worker.once('exit', code => { if (code) no(new Error(`worker exit ${code}`)); }); }));
  }
  await Promise.all(ready);
  Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0);
  assert.deepEqual((await Promise.all(done)).sort(), [0,1]);
  assert.equal(db.prepare("SELECT count(*) n FROM organization_users WHERE access_level='owner'").get().n, 1);
});
