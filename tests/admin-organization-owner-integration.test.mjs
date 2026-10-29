import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { adminUsersFixture } from './helpers/admin-users-sqlite.mjs';
import { onRequest as membership } from '../functions/api/admin/users/[id]/organizations/[organizationId].js';
import { onRequest as legacyMembership } from '../functions/api/admin/organization-users/[id].js';
import { onRequest as organizationUser } from '../functions/api/organizations/[id]/users/[userId].js';
import { onRequestPost as organizationPost } from '../functions/api/organizations/[id]/users.js';
import { onRequest as globalUser } from '../functions/api/admin/users/[id].js';
import { onRequest as legacyAssignment } from '../functions/api/admin/organizations/[id]/users.js';
import { onRequest as management } from '../functions/api/admin/organization-management/[[path]].js';

// Full composed product schema, real handlers/session/ACL and disposable SQLite.
// No provider, credentials, deployed flags or remote database is reachable.
const change = (f, userId, method) => membership({ env: f.env,
  request: f.request(method, method === 'PUT' ? { accessLevel: 'viewer' } : undefined),
  params: { id: String(userId), organizationId: '1' } });
const routes = {
  assignmentPut: f => change(f, 2, 'PUT'),
  assignmentDelete: f => change(f, 2, 'DELETE'),
  legacyPut: f => legacyMembership({ env: f.env, request: f.request('PATCH', { accessLevel: 'viewer' }), params: { id: '2' } }),
  legacyDelete: f => legacyMembership({ env: f.env, request: f.request('DELETE'), params: { id: '2' } }),
  organizationPut: f => organizationUser({ env: f.env, request: f.request('PATCH', { accessLevel: 'viewer', name: 'Rejected name', password: 'synthetic-new-password' }), params: { id: '1', userId: '2' } }),
  organizationDelete: f => organizationUser({ env: f.env, request: f.request('DELETE'), params: { id: '1', userId: '2' } }),
  organizationPost: f => organizationPost({ env: f.env, request: f.request('POST', { email: 'a@example.test', name: 'Rejected POST name', role: 'viewer', accessLevel: 'viewer' }), params: { id: '1' } }),
  globalDeactivate: f => globalUser({ env: f.env, request: f.request('PATCH', { active: false, name: 'Rejected name', password: 'synthetic-new-password' }), params: { id: '2' } }),
  globalDelete: f => globalUser({ env: f.env, request: f.request('DELETE'), params: { id: '2' } }),
  legacyAssignment: f => legacyAssignment({ env: f.env, request: f.request('POST', { userId: 2, accessLevel: 'viewer' }), params: { id: '1' } }),
};
const protectedSnapshot = f => Object.fromEntries(['users', 'sessions', 'organizations', 'organization_users', 'user_permissions', 'audit_logs']
  .map(table => [table, f.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));

const schemaBefore0042 = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
  .split('-- Organization management (migration 0042)')[0];

const postUser = (f, email = 'a@example.test', overrides = {}) => organizationPost({ env: f.env,
  request: f.request('POST', { email, name: 'Atomic synthetic profile', role: 'editor', accessLevel: 'viewer', ...overrides }), params: { id: '1' } });
const atomicWrites = {
  existingPost: f => postUser(f),
  newPost: f => postUser(f, 'new@example.test'),
  legacyAssignment: f => routes.legacyAssignment(f),
  legacyUpdate: f => routes.legacyPut(f),
  legacyDelete: f => routes.legacyDelete(f),
  assignmentPut: f => routes.assignmentPut(f),
  assignmentDelete: f => routes.assignmentDelete(f),
  organizationDelete: f => routes.organizationDelete(f),
};
for (const email of ['new@example.test', 'A@EXAMPLE.TEST']) {
  test(`POST ${email}: valid profile/link/audit changes commit together and return the committed profile`, async t => {
    const f = await adminUsersFixture(t);
    const response = await postUser(f, email);
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.user.name, 'Atomic synthetic profile');
    assert.equal(body.user.role, 'editor');
    const user = f.db.prepare('SELECT * FROM users WHERE LOWER(email)=LOWER(?)').get(email);
    assert.equal(user.name, body.user.name);
    assert.equal(f.db.prepare('SELECT access_level FROM organization_users WHERE user_id=? AND organization_id=1').get(user.id).access_level, 'viewer');
    const audit = f.db.prepare("SELECT details FROM audit_logs WHERE action='users.create'").all();
    assert.equal(audit.length, 1);
    assert.equal(JSON.parse(audit[0].details).resourceId, user.id);
    assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n, 1);
  });
}
test('POST does not downgrade an existing role and enforces actor assignment permissions before writes', async t => {
  const f = await adminUsersFixture(t);
  f.db.exec("UPDATE users SET role='admin' WHERE id=2");
  assert.equal((await postUser(f, 'a@example.test', { role: 'viewer', accessLevel: 'owner' })).status, 201);
  assert.equal(f.db.prepare('SELECT role FROM users WHERE id=2').get().role, 'admin');
  f.db.exec("UPDATE users SET role='viewer' WHERE id=1");
  const before = protectedSnapshot(f);
  assert.equal((await postUser(f, 'new@example.test')).status, 403);
  const after = protectedSnapshot(f);
  // Permission denial may add its own denial audit; it cannot mutate accounts.
  assert.deepEqual({ ...after, audit_logs: [] }, { ...before, audit_logs: [] });
  assert.equal(after.audit_logs.filter(row => row.action === 'users.create' && JSON.parse(row.details).result === 'success').length, 1);
  assert.equal(after.audit_logs.length, before.audit_logs.length + 1);
  assert.equal(JSON.parse(after.audit_logs.at(-1).details).result, 'denied');
});
for (const email of ['a@example.test', 'new@example.test']) {
  test(`POST ${email}: a failing response read rolls back profile, membership and audit`, async t => {
    const f = await adminUsersFixture(t);
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    f.env.DB.prepare = sql => {
      const statement = prepare(sql);
      if (/SELECT u\.id AS id[\s\S]*FROM organization_users ou/.test(sql)) statement.execute = () => { throw new Error('synthetic response read failure'); };
      return statement;
    };
    const before = protectedSnapshot(f);
    const response = await postUser(f, email);
    assert.equal(response.status, 500);
    assert.deepEqual(protectedSnapshot(f), before);
  });
}
test('POST: two prepared owner demotions keep the losing profile and exactly one success audit', async t => {
  const f = await adminUsersFixture(t);
  const before = f.db.prepare('SELECT * FROM users ORDER BY id').all();
  f.holdConcurrentWrites();
  const responses = await Promise.all(['a@example.test', 'b@example.test'].map(email => postUser(f, email)));
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const loser = responses[0].status === 409 ? 2 : 3;
  assert.deepEqual(f.db.prepare('SELECT * FROM users WHERE id=?').get(loser), before.find(user => user.id === loser));
  assert.equal(f.owners(), 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM audit_logs WHERE action='users.create'").get().n, 1);
});
for (const schema of ['pre-0042', 'post-0042']) for (const flag of [undefined, 'false', 'true']) {
  for (const [route, invoke] of Object.entries(atomicWrites)) {
    test(`${schema} flag ${flag ?? 'absent'}: ${route} audit failure rolls back the complete mutation`, async t => {
      const f = await adminUsersFixture(t, schema === 'pre-0042' ? { schemaSql: schemaBefore0042 } : {});
      if (flag !== undefined) f.env.ORGANIZATION_MANAGEMENT_V1 = flag;
      f.db.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END");
      const before = protectedSnapshot(f);
      const response = await invoke(f);
      assert.deepEqual(protectedSnapshot(f), before, `No partial mutation after audit failure; HTTP ${response.status}`);
      assert.equal(response.status, 500);
      assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    });
  }
  for (const existing of [false, true]) {
    test(`${schema} flag ${flag ?? 'absent'}: ${existing ? 'existing' : 'new'} POST membership failure leaves no profile or orphan`, async t => {
      const f = await adminUsersFixture(t, schema === 'pre-0042' ? { schemaSql: schemaBefore0042 } : {});
      if (flag !== undefined) f.env.ORGANIZATION_MANAGEMENT_V1 = flag;
      if (existing) f.db.exec('DELETE FROM organization_users WHERE user_id=2');
      f.db.exec("CREATE TRIGGER synthetic_membership_failure BEFORE INSERT ON organization_users BEGIN SELECT RAISE(ABORT, 'synthetic membership failure'); END");
      const before = protectedSnapshot(f);
      const response = await postUser(f, existing ? 'a@example.test' : 'new@example.test');
      assert.equal(response.status, 500);
      assert.deepEqual(protectedSnapshot(f), before, 'No account/profile/role/session/link/grant/audit mutation');
    });
  }
}
for (const flag of [undefined, 'false']) {
  test(`pre-0042 flag ${flag ?? 'absent'}: valid removal and profile edit remain available`, async t => {
    const f = await adminUsersFixture(t, { schemaSql: schemaBefore0042 });
    if (flag !== undefined) f.env.ORGANIZATION_MANAGEMENT_V1 = flag;
    assert.equal((await change(f, 2, 'DELETE')).status, 200);
    assert.equal(f.owners(), 1);
    const response = await globalUser({ env: f.env, request: f.request('PATCH', { name: 'Updated synthetic owner' }), params: { id: '3' } });
    assert.equal(response.status, 200);
    assert.equal(f.db.prepare('SELECT name FROM users WHERE id=3').get().name, 'Updated synthetic owner');
    assert.equal((await change(f, 3, 'DELETE')).status, 409);
    assert.equal(f.owners(), 1);
  });
  for (const [route, invoke] of Object.entries(routes)) {
    test(`pre-0042 flag ${flag ?? 'absent'}: ${route} keeps atomic last-owner protection without management schema`, async t => {
      const f = await adminUsersFixture(t, { schemaSql: schemaBefore0042 });
      if (flag !== undefined) f.env.ORGANIZATION_MANAGEMENT_V1 = flag;
      assert.equal(f.db.prepare("SELECT name FROM pragma_table_info('organizations') WHERE name='management_owner_id'").get(), undefined);
      f.db.exec('DELETE FROM organization_users WHERE user_id=3');
      const before = protectedSnapshot(f);
      const response = await invoke(f);
      assert.equal(response.status, 409, JSON.stringify(await response.json()));
      assert.deepEqual(protectedSnapshot(f), before, 'No partial legacy account/password/session/link/grant/audit change');
      assert.equal(f.owners(), 1);
      assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    });
  }
}

for (const flag of [undefined, 'false', 'true']) {
  for (const [route, invoke] of Object.entries(routes)) {
    test(`post-0042 flag ${flag ?? 'absent'}: ${route} preserves designated owner and reports reassignment conflict`, async t => {
      const f = await adminUsersFixture(t);
      if (flag !== undefined) f.env.ORGANIZATION_MANAGEMENT_V1 = flag;
      f.db.exec('UPDATE organizations SET management_owner_id=2 WHERE id=1');
      const before = protectedSnapshot(f);
      const response = await invoke(f);
      const body = await response.json();
      assert.deepEqual(protectedSnapshot(f), before, 'No partial account/password/session/link/grant change');
      assert.equal(response.status, 409, JSON.stringify(body));
      assert.equal(body.error.code, 'MANAGEMENT_OWNER_REASSIGN_REQUIRED');
      assert.equal(body.error.retryable, false);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
      assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    });
  }
}

async function managerCall(f, path, body) {
  const request = new Request(`https://synthetic.invalid/api/admin/organization-management${path}`, {
    method: 'POST', headers: { Cookie: 'maono_session=synthetic-admin', Origin: 'https://synthetic.invalid',
      'Content-Type': 'application/json', 'X-Maono-Management': '1', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const response = await management({ env: f.env, request });
  assert.equal(response.status, 200);
  return response.json();
}

test('real manager reassignment permits former-owner removal and retains the final owner', async t => {
  const f = await adminUsersFixture(t);
  f.env.ORGANIZATION_MANAGEMENT_V1 = 'true';
  f.env.PROJECT_QUOTA_RESERVATION_V1 = 'true';
  f.db.exec('UPDATE organizations SET management_owner_id=2 WHERE id=1');
  const version = f.db.prepare('SELECT management_version FROM organizations WHERE id=1').get().management_version;
  const operation = await managerCall(f, '/operations', { kind: 'change', items: [{ id: 1, version, ownerId: 3, reason: 'Synthetic reassignment' }] });
  const result = await managerCall(f, `/operations/${operation.id}/step`, {});
  assert.equal(result.items[0].state, 'succeeded', JSON.stringify(result));
  assert.equal(f.db.prepare('SELECT management_owner_id FROM organizations WHERE id=1').get().management_owner_id, 3);
  assert.equal((await change(f, 2, 'DELETE')).status, 200);
  assert.equal((await change(f, 3, 'DELETE')).status, 409);
  assert.equal(f.owners(), 1);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('global deactivation protects a manager in another organization atomically', async t => {
  const f = await adminUsersFixture(t);
  f.env.ORGANIZATION_MANAGEMENT_V1 = 'false';
  f.db.exec("INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(2,2,'owner'),(2,3,'owner'); UPDATE organizations SET management_owner_id=2 WHERE id=2");
  const before = protectedSnapshot(f);
  const response = await routes.globalDeactivate(f);
  const body = await response.json();
  assert.deepEqual(protectedSnapshot(f), before);
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error.code, 'MANAGEMENT_OWNER_REASSIGN_REQUIRED');
});
