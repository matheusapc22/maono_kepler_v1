import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { adminUsersFixture } from './helpers/admin-users-sqlite.mjs';
import { onRequest as membership } from '../functions/api/admin/users/[id]/organizations/[organizationId].js';
import { onRequest as legacyMembership } from '../functions/api/admin/organization-users/[id].js';
import { onRequest as organizationUser } from '../functions/api/organizations/[id]/users/[userId].js';
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
  globalDeactivate: f => globalUser({ env: f.env, request: f.request('PATCH', { active: false, name: 'Rejected name', password: 'synthetic-new-password' }), params: { id: '2' } }),
  globalDelete: f => globalUser({ env: f.env, request: f.request('DELETE'), params: { id: '2' } }),
  legacyAssignment: f => legacyAssignment({ env: f.env, request: f.request('POST', { userId: 2, accessLevel: 'viewer' }), params: { id: '1' } }),
};
const protectedSnapshot = f => Object.fromEntries(['users', 'sessions', 'organizations', 'organization_users', 'user_permissions', 'audit_logs']
  .map(table => [table, f.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));

const schemaBefore0042 = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
  .split('-- Organization management (migration 0042)')[0];
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
