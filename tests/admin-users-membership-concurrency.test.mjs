import assert from 'node:assert/strict';
import test from 'node:test';
import { adminUsersFixture } from './helpers/admin-users-sqlite.mjs';
import { onRequest } from '../functions/api/admin/users/[id]/organizations/[organizationId].js';
import { onRequest as legacyMembership } from '../functions/api/admin/organization-users/[id].js';
import { onRequest as organizationUser } from '../functions/api/organizations/[id]/users/[userId].js';
import { onRequest as globalUser } from '../functions/api/admin/users/[id].js';
import { onRequest as legacyAssignment } from '../functions/api/admin/organizations/[id]/users.js';

const change = (f, id, method) => onRequest({ env: f.env, request: f.request(method, method === 'PUT' ? { accessLevel: 'viewer' } : undefined), params: { id, organizationId: '1' } });

test('legacy assignment POST cannot demote both owners concurrently', async t => {
  const f = await adminUsersFixture(t); f.holdConcurrentWrites();
  const responses = await Promise.all([2,3].map(userId => legacyAssignment({
    env: f.env, request: f.request('POST', { userId, accessLevel: 'viewer' }), params: { id: '1' },
  })));
  assert.deepEqual(responses.map(response => response.status).sort(), [201,409]);
  assert.equal(f.owners(), 1);
});

test('legacy assignment POST preserves eligibility, missing-target and ACL boundaries', async t => {
  const f = await adminUsersFixture(t);
  const post = userId => legacyAssignment({ env: f.env, request: f.request('POST', { userId, accessLevel: 'viewer' }), params: { id: '1' } });
  f.db.exec('UPDATE users SET active=0 WHERE id=3');
  assert.equal((await post(2)).status, 409);
  assert.equal((await post(3)).status, 400);
  assert.equal((await post(99)).status, 404);
  f.db.exec("UPDATE users SET role='viewer' WHERE id=1");
  assert.equal((await post(2)).status, 403);
  assert.equal(f.owners(), 2);
});

test('the only owner cannot be demoted and keeps additional permissions', async t => {
  const f = await adminUsersFixture(t);
  f.db.exec('DELETE FROM organization_users WHERE user_id=3');
  assert.equal((await change(f, '2', 'PUT')).status, 409);
  assert.equal(f.owners(), 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_permissions WHERE user_id=2').get().n, 1);
});

const routes = {
  legacyUpdate: (f, id) => legacyMembership({ env: f.env, request: f.request('PATCH', { accessLevel: 'viewer' }), params: { id } }),
  legacyDelete: (f, id) => legacyMembership({ env: f.env, request: f.request('DELETE'), params: { id } }),
  organizationUpdate: (f, id) => organizationUser({ env: f.env, request: f.request('PATCH', { accessLevel: 'viewer', name: 'Changed' }), params: { id: '1', userId: id } }),
  organizationDelete: (f, id) => organizationUser({ env: f.env, request: f.request('DELETE'), params: { id: '1', userId: id } }),
  deactivate: (f, id) => globalUser({ env: f.env, request: f.request('PATCH', { active: false }), params: { id } }),
  deleteAccount: (f, id) => globalUser({ env: f.env, request: f.request('DELETE'), params: { id } }),
};
for (const [name, invoke] of Object.entries(routes)) test(`${name}: two concurrent requests cannot bypass owner retention`, async t => {
  const f = await adminUsersFixture(t);
  f.holdConcurrentWrites();
  const responses = await Promise.all(['2','3'].map(id => invoke(f, id)));
  assert.deepEqual(responses.map(response => response.status).sort(), [200,409]);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM organization_users m JOIN users u ON u.id=m.user_id WHERE m.organization_id=1 AND m.access_level='owner' AND u.active=1").get().n, 1);
});

test('rejected compound update preserves account, password, membership and audit', async t => {
  const f = await adminUsersFixture(t);
  f.db.exec('DELETE FROM organization_users WHERE user_id=3');
  const before = f.db.prepare('SELECT * FROM users WHERE id=2').get();
  const response = await organizationUser({ env: f.env, request: f.request('PATCH', { name: 'Changed', accessLevel: 'viewer', password: 'synthetic-new-password' }), params: { id: '1', userId: '2' } });
  assert.equal(response.status, 409);
  assert.deepEqual(f.db.prepare('SELECT * FROM users WHERE id=2').get(), before);
  assert.equal(f.owners(), 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='admin.users.password_changed'").get().n, 0);
});

test('inactive alternatives are not eligible owners and other organizations do not satisfy the guard', async t => {
  const f = await adminUsersFixture(t);
  f.db.exec("UPDATE users SET active=0 WHERE id=3; INSERT INTO organization_users (organization_id,user_id,access_level) VALUES (2,1,'owner')");
  assert.equal((await change(f, '2', 'PUT')).status, 409);
  assert.equal((await change(f, '2', 'DELETE')).status, 409);
});

test('authorization, missing target and valid assignment keep their existing boundaries', async t => {
  const f = await adminUsersFixture(t);
  assert.equal((await change(f, '99', 'PUT')).status, 404);
  f.db.exec("UPDATE users SET role='viewer' WHERE id=1");
  assert.equal((await change(f, '2', 'PUT')).status, 403);
  assert.equal(f.owners(), 2);
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=1; DELETE FROM organization_users WHERE user_id=3");
  assert.equal((await change(f, '3', 'PUT')).status, 200);
  assert.equal(f.db.prepare('SELECT access_level FROM organization_users WHERE user_id=3').get().access_level, 'viewer');
});

test('membership removal racing account deactivation preserves one eligible owner', async t => {
  const f = await adminUsersFixture(t); f.holdConcurrentWrites();
  const responses = await Promise.all([change(f, '2', 'DELETE'), routes.deactivate(f, '3')]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200,409]);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM organization_users m JOIN users u ON u.id=m.user_id WHERE m.organization_id=1 AND m.access_level='owner' AND u.active=1").get().n, 1);
});

test('permission cleanup failure rolls back the membership removal', async t => {
  const f = await adminUsersFixture(t);
  f.db.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON user_permissions BEGIN SELECT RAISE(ABORT, 'synthetic cleanup failure'); END");
  assert.equal((await change(f, '2', 'DELETE')).status, 500);
  assert.equal(f.owners(), 2);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_permissions').get().n, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='admin.user_organization.remove'").get().n, 0);
});

test('legacy schema without optional grants table keeps valid removal and owner protection', async t => {
  const f = await adminUsersFixture(t);
  f.db.exec('DROP TABLE user_permissions');
  assert.equal((await routes.legacyDelete(f, '2')).status, 200);
  assert.equal(f.owners(), 1);
  assert.equal((await routes.legacyDelete(f, '3')).status, 409);
  assert.equal(f.owners(), 1);
});

for (const methods of [['DELETE','DELETE'], ['PUT','PUT'], ['PUT','DELETE']]) test(`concurrent ${methods.join('/')} preserves one owner and rejects the losing write`, async t => {
  const f = await adminUsersFixture(t);
  f.holdConcurrentWrites();
  const responses = await Promise.all(methods.map((method, index) => change(f, String(index+2), method)));
  assert.deepEqual(responses.map(response => response.status).sort(), [200,409]);
  assert.equal(f.owners(), 1);
  const owner = f.db.prepare("SELECT user_id FROM organization_users WHERE access_level='owner'").get();
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_permissions WHERE user_id=?').get(owner.user_id).n, 1);
});
