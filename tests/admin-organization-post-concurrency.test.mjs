import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { adminUsersFixture } from './helpers/admin-users-sqlite.mjs';

const pre0042 = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').split('-- Organization management (migration 0042)')[0];
const actors = [2, 3];
const eventTypes = ['prepared', 'begin-attempt', 'begin-acquired', 'transaction-end', 'response'];
const tables = ['users', 'sessions', 'organizations', 'organization_users', 'user_permissions', 'audit_logs'];
const snapshot = db => Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(row => ({ ...row }))]));

function observe(worker, userId) {
  const thread = worker.threadId, seen = new Map(), errors = [], pending = new Map();
  const waits = Object.fromEntries(eventTypes.map(type => [type, new Promise((resolve, reject) => pending.set(type, { resolve, reject }))]));
  Object.values(waits).forEach(wait => wait.catch(() => {}));
  const fail = error => { errors.push(error); pending.forEach(item => item.reject(error)); };
  worker.on('error', fail);
  worker.on('exit', code => { if (code || !seen.has('response')) fail(new Error(`worker ${userId} exited ${code} before completion`)); });
  worker.on('message', message => {
    try {
      assert.equal(message.userId, userId);
      assert.equal(message.threadId, thread);
      assert.ok(pending.has(message.type), 'known transaction event');
      assert.ok(!seen.has(message.type), `exactly one ${message.type} for actor ${userId}`);
      seen.set(message.type, message);
      pending.get(message.type).resolve(message);
    } catch (error) { fail(error); }
  });
  return { thread, seen, errors, waits };
}

function generatedTimestamp(value, startedAt) {
  const timestamp = Date.parse(value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`);
  assert.ok(Number.isFinite(timestamp), `valid timestamp: ${value}`);
  assert.ok(timestamp >= Math.floor(startedAt / 1000) * 1000 && timestamp <= Date.now(), 'timestamp belongs to this operation');
  return value;
}

function assertWinnerDelta(before, after, winnerId, remove, startedAt) {
  const expected = structuredClone(before);
  const deleting = remove && winnerId === 3;
  const membership = expected.organization_users.find(row => row.user_id === winnerId && row.organization_id === 1);
  if (deleting) {
    expected.organization_users = expected.organization_users.filter(row => row.id !== membership.id);
    expected.user_permissions = expected.user_permissions.filter(row => row.user_id !== winnerId || row.organization_id !== 1);
  } else {
    const user = expected.users.find(row => row.id === winnerId), changed = after.users.find(row => row.id === winnerId);
    user.name = 'Committed synthetic profile'; user.role = 'editor';
    user.updated_at = generatedTimestamp(changed.updated_at, startedAt);
    membership.access_level = 'viewer';
    if ('active' in membership) membership.active = 1;
    if ('updated_at' in membership) membership.updated_at = generatedTimestamp(after.organization_users.find(row => row.id === membership.id).updated_at, startedAt);
  }
  assert.equal(after.audit_logs.length, before.audit_logs.length + 1, 'exactly one committed audit');
  const audit = after.audit_logs.at(-1);
  assert.ok(Number.isInteger(audit.id) && audit.id > Math.max(0, ...before.audit_logs.map(row => row.id)));
  const details = deleting
    ? { organizationUserId: membership.id, organizationId: 1, targetUserId: winnerId, previousAccessLevel: 'owner' }
    : { organizationId: 1, resourceType: 'user', resourceId: winnerId, result: 'success', metadata: { role: 'editor', accessLevel: 'viewer' }, userAgent: null };
  assert.deepEqual(JSON.parse(audit.details), details);
  // SQLite json_object can serialize a numeric binding as 1.0; the complete
  // parsed payload above is exact, and the original stored bytes stay in snapshot.
  expected.audit_logs.push({ id: audit.id, user_id: 1, project_id: null, action: deleting ? 'admin.organization_users.delete' : 'users.create', details: audit.details, created_at: generatedTimestamp(audit.created_at, startedAt) });
  assert.deepEqual(after, expected, 'complete snapshots differ only by the successful operation and its unique audit');
}

function expectedOutcome(order, mode, remove) {
  // The oracle uses fixture invariants and acquired lock order, never responses.
  const designated = mode === 'designated-manager';
  const winnerId = designated ? 3 : order[0], loserId = actors.find(id => id !== winnerId);
  const triggerConflict = designated && order[0] === 2;
  return {
    winnerId, loserId, triggerConflict,
    successStatus: remove && winnerId === 3 ? 200 : 201,
    code: triggerConflict ? 'MANAGEMENT_OWNER_REASSIGN_REQUIRED' : 'LAST_OWNER_REQUIRED',
    structured: triggerConflict || (remove && loserId === 3),
  };
}

function assertResponses(results, expected) {
  const winner = results.find(row => row.userId === expected.winnerId), loser = results.find(row => row.userId === expected.loserId);
  assert.equal(winner.status, expected.successStatus);
  assert.equal(JSON.parse(winner.rawBody).ok, true);
  assert.equal(loser.status, 409);
  const body = JSON.parse(loser.rawBody);
  assert.equal(body.ok, false);
  if (expected.structured) {
    assert.equal(typeof body.error, 'object');
    assert.equal(body.error.code, expected.code);
    assert.equal(body.error.retryable, false);
    assert.equal(Object.hasOwn(body, 'code'), false, 'structured error must not be disguised as the legacy envelope');
  } else {
    assert.equal(typeof body.error, 'string');
    assert.equal(body.code, expected.code);
    assert.equal(Object.hasOwn(body.error, 'code'), false);
  }
}

async function runRace(t, mode, remove, first = null) {
  const temporaryRoot = resolve(tmpdir()), directory = mkdtempSync(join(temporaryRoot, 'maono-atomic-post-'));
  assert.ok(resolve(directory).startsWith(temporaryRoot + sep));
  const path = join(directory, 'synthetic.sqlite'), cleanup = [], workers = [];
  const f = await adminUsersFixture({ after: callback => cleanup.push(callback) }, { databasePath: path, ...(mode === 'pre-0042' ? { schemaSql: pre0042 } : {}) });
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.terminate()));
    cleanup.forEach(callback => callback());
    assert.ok(resolve(directory).startsWith(temporaryRoot + sep));
    rmSync(directory, { recursive: true });
  });
  f.db.exec('PRAGMA journal_mode=WAL');
  if (mode === 'designated-manager') f.db.exec('UPDATE organizations SET management_owner_id=2 WHERE id=1');
  const before = snapshot(f.db), startedAt = Date.now();
  // Count, two acquired actors, two preparation permits, two execution gates.
  const barrier = new SharedArrayBuffer(7 * Int32Array.BYTES_PER_ELEMENT), control = new Int32Array(barrier), observers = new Map();
  for (const userId of actors) {
    const worker = new Worker(new URL('./helpers/organization-post-worker.mjs', import.meta.url), {
      workerData: { path, barrier, userId, remove: remove && userId === 3, flag: mode === 'pre-0042' ? 'false' : 'true', controlled: first !== null },
    });
    workers.push(worker); observers.set(userId, observe(worker, userId));
  }
  assert.equal(new Set([...observers.values()].map(row => row.thread)).size, 2, 'independent workers and SQLite connections');
  await Promise.all([...observers.values()].map(row => row.waits.prepared));
  assert.equal(Atomics.load(control, 0), 0, 'both workers prepared before any transaction acquires');
  const release = index => { Atomics.store(control, index, 1); Atomics.notify(control, index); };
  if (first === null) {
    // Release both contenders without imposing a winner or serializing routes.
    actors.forEach(id => Atomics.store(control, id + 1, 1));
    actors.forEach(id => Atomics.notify(control, id + 1));
  } else {
    const second = actors.find(id => id !== first), leading = observers.get(first), following = observers.get(second);
    release(first + 1);
    assert.equal((await leading.waits['begin-acquired']).ordinal, 1);
    release(second + 1);
    await following.waits['begin-attempt'];
    assert.equal(following.seen.has('begin-acquired'), false, 'second connection is pending while first owns the write lock');
    assert.equal(following.seen.has('response'), false);
    assert.equal(Atomics.load(control, 0), 1);
    release(first + 3);
    await leading.waits.response;
    assert.equal((await following.waits['begin-acquired']).ordinal, 2);
    const middle = snapshot(f.db);
    if (first === 2) assert.deepEqual(middle, before, 'manager trigger rollback leaves every table intact');
    else assertWinnerDelta(before, middle, 3, remove, startedAt);
    release(second + 3);
    await following.waits.response;
    if (second === 2) assert.deepEqual(snapshot(f.db), middle, 'last-owner rejection changes no table');
  }
  const results = await Promise.all([...observers.values()].map(row => row.waits.response));
  assert.equal(Atomics.load(control, 0), 2);
  const order = [Atomics.load(control, 1), Atomics.load(control, 2)];
  assert.deepEqual([...order].sort(), actors, 'exactly the two expected actors acquired once each');
  if (first !== null) assert.deepEqual(order, [first, actors.find(id => id !== first)]);
  const expected = expectedOutcome(order, mode, remove);
  assertResponses(results, expected);
  for (const [id, observer] of observers) {
    assert.deepEqual(observer.errors, []);
    assert.deepEqual([...observer.seen.keys()], eventTypes, 'complete transaction lifecycle exactly once per actor');
    assert.equal(observer.seen.get('begin-acquired').ordinal, order.indexOf(id) + 1);
    assert.equal(observer.seen.get('transaction-end').ordinal, order.indexOf(id) + 1);
    assert.equal(observer.seen.get('transaction-end').outcome, expected.triggerConflict && id === 2 ? 'rollback' : 'commit');
  }
  const after = snapshot(f.db);
  assertWinnerDelta(before, after, expected.winnerId, remove, startedAt);
  assert.deepEqual(after.users.find(row => row.id === expected.loserId), before.users.find(row => row.id === expected.loserId));
  assert.equal(f.owners(), 1);
  if (mode === 'designated-manager') assert.equal(after.organizations.find(row => row.id === 1).management_owner_id, 2);
  assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  t.diagnostic(JSON.stringify({ mode, operation: remove ? 'POST/DELETE' : 'POST/POST', controlledFirst: first, order, workers: [...observers.values()].map(row => row.thread), outcomes: [...observers.values()].map(row => row.seen.get('transaction-end')), responses: results }));
}

for (const mode of ['pre-0042', 'post-0042', 'designated-manager']) for (const remove of [false, true]) {
  test(`${mode}: independent POST/${remove ? 'DELETE' : 'POST'} batches preserve the losing profile and owner`, t => runRace(t, mode, remove));
}
for (const remove of [false, true]) for (const first of actors) {
  test(`designated-manager: controlled POST/${remove ? 'DELETE' : 'POST'} acquisition ${first} first preserves exact error and full snapshots`, t => runRace(t, 'designated-manager', remove, first));
}
