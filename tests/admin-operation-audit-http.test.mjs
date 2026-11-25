import assert from 'node:assert/strict';
import test from 'node:test';
import { persistenceFixture } from './helpers/project-persistence-fixture.mjs';
import { onRequest as management } from '../functions/api/admin/organization-management/[[path]].js';
import { onRequest as list } from '../functions/api/admin/audit/index.js';
import { onRequest as detail } from '../functions/api/admin/audit/[eventId].js';
import { onRequest as retry } from '../functions/api/admin/audit/[eventId]/retry.js';
import { onRequest as link } from '../functions/api/admin/audit/operations/[operationId].js';
import { requirePermission } from '../functions/_lib/permissions.js';

function fixture(t) {
  const f = persistenceFixture(t);
  f.env.ORGANIZATION_MANAGEMENT_V1 = 'true';
  f.env.ADMIN_AUDIT_OPERATIONS_V1 = 'true';
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=1");
  f.request = (path, body, user = 1, headers = {}) => new Request(`https://local.invalid${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...f.headers(user), Origin: 'https://local.invalid', 'Content-Type': 'application/json', 'X-Maono-Management': '1', 'X-Maono-Audit': 'operations-v1', 'X-Maono-UI-Route': '/admin', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  f.start = async (kind, items) => {
    const response = await management({ env: f.env, request: f.request('/api/admin/organization-management/operations', { kind, items }, 1, { 'Idempotency-Key': crypto.randomUUID() }) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  f.latest = id => `frame:${f.db.prepare('SELECT id FROM audit_operation_frames WHERE operation_id=? ORDER BY id DESC LIMIT 1').get(id).id}`;
  f.command = async (eventId, body, user = 1, headers = {}) => {
    const response = await retry({ env: f.env, params: { eventId }, request: f.request(`/api/admin/audit/${eventId}/retry`, body, user, headers) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
  return f;
}

test('real authenticated API separates permission granted from a completed business change', async t => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT management_version FROM organizations WHERE id=1').get().management_version;
  await requirePermission(f.env, f.request('/api/admin/organizations'), 'admin.panel.access', { scopeType: 'global' }, { audit: true });
  const stored = f.db.prepare('SELECT details FROM audit_logs ORDER BY id DESC LIMIT 1').get();
  assert.equal(JSON.parse(stored.details).result, 'authorized'); assert.equal(JSON.parse(stored.details).phase, 'authorization');
  assert.equal(f.db.prepare('SELECT management_version FROM organizations WHERE id=1').get().management_version, before);
  const response = await list({ env: f.env, request: f.request('/api/admin/audit?result=authorized') });
  assert.equal(response.status, 200); assert.ok((await response.json()).entries.every(entry => entry.result === 'authorized'));
});

test('an audit recovery command uses the original domain operation and idempotency prevents duplicate effects', async t => {
  const f = fixture(t);
  const op = await f.start('pause', [{ id: 1, version: 0, reason: 'Maintenance in synthetic fixture' }]);
  const eventId = f.latest(op.id);
  const detailResponse = await detail({ env: f.env, params: { eventId }, request: f.request(`/api/admin/audit/${eventId}`) });
  const detailBody = await detailResponse.json();
  assert.equal(detailResponse.status, 200, JSON.stringify(detailBody));
  assert.ok(detailBody.actions.some(action => action.kind === 'resume' && action.enabled));
  const command = { action: 'resume', expectedVersion: 0, requestKey: crypto.randomUUID() };
  const first = await f.command(eventId, command);
  assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(first.data.operation.items[0].state, 'succeeded');
  const again = await f.command(eventId, command);
  assert.equal(again.status, 200, JSON.stringify(again.data)); assert.equal(again.data.operation.items[0].state, 'succeeded');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM organization_management_events WHERE organization_id=1 AND action='organization.paused'").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_operation_frames WHERE source='audit_recovery_request'").get().n, 1);
  assert.match(first.headers.get('Cache-Control'), /no-store/);
});

test('a confirmed no-effect reconciliation keeps the original failed item and appends current evidence', async t => {
  const f = fixture(t);
  const op = await f.start('change', [{ id: 1, version: 0, name: 'Should not overwrite', reason: 'Synthetic concurrency test' }]);
  f.db.exec("UPDATE organizations SET name='Concurrent edit' WHERE id=1");
  const stepped = await management({ env: f.env, request: f.request(`/api/admin/organization-management/operations/${op.id}/step`, {}) });
  const result = await stepped.json(); assert.equal(stepped.status, 200); assert.equal(result.items[0].state, 'failed');
  const eventId = f.latest(op.id), before = f.db.prepare('SELECT * FROM organization_management_operation_items WHERE operation_id=?').get(op.id);
  const response = await f.command(eventId, { action: 'query' });
  assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.data.reconciled, true);
  assert.equal(response.data.disposition, 'confirmed_no_effect');
  assert.deepEqual(f.db.prepare('SELECT * FROM organization_management_operation_items WHERE operation_id=?').get(op.id), before);
  assert.equal(f.db.prepare('SELECT name FROM organizations WHERE id=1').get().name, 'Concurrent edit');
  assert.equal(f.db.prepare("SELECT outcome FROM audit_operation_frames WHERE operation_id=? ORDER BY id DESC LIMIT 1").get(op.id).outcome, 'no_change');
});

test('global detail remains readable to another Super Admin but execution rechecks original ownership and current role', async t => {
  const f = fixture(t), op = await f.start('pause', [{ id: 1, version: 0, reason: 'Synthetic ownership test' }]);
  const eventId = f.latest(op.id);
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=2");
  const response = await detail({ env: f.env, params: { eventId }, request: f.request(`/api/admin/audit/${eventId}`, undefined, 2) });
  const body = await response.json(); assert.equal(response.status, 200);
  assert.ok(body.actions.every(action => !action.enabled));
  assert.ok([403, 409].includes((await f.command(eventId, { action: 'resume', expectedVersion: 0, requestKey: crypto.randomUUID() }, 2)).status));
  f.db.exec("UPDATE users SET role='client' WHERE id=1");
  assert.equal((await f.command(eventId, { action: 'resume', expectedVersion: 0, requestKey: crypto.randomUUID() })).status, 403);
  assert.equal(f.db.prepare('SELECT active FROM organizations WHERE id=1').get().active, 1);
});

test('transport rejects cross-origin, raw replay commands, excessive body and legacy replay before executing any effect', async t => {
  const f = fixture(t), op = await f.start('pause', [{ id: 1, version: 0, reason: 'Synthetic transport test' }]);
  const eventId = f.latest(op.id), command = { action: 'resume', expectedVersion: 0, requestKey: crypto.randomUUID() };
  assert.equal((await f.command(eventId, command, 1, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await f.command(eventId, command, 1, { 'Sec-Fetch-Site': 'same-site' })).status, 403);
  assert.equal((await f.command(eventId, command, 1, { 'X-Maono-Management': '0' })).status, 403);
  for (const extra of [{ sql: 'DELETE FROM organizations' }, { url: 'https://external.invalid' }, { payload: { active: false } }, { organizationId: 2 }]) assert.equal((await f.command(eventId, { ...command, ...extra })).status, 400);
  assert.equal((await f.command(eventId, { ...command, confirmation: 'x'.repeat(17000) })).status, 413);
  const id = f.db.prepare("INSERT INTO audit_logs(action,details) VALUES('organization.update','{}')").run().lastInsertRowid;
  assert.equal((await f.command(`legacy:${id}`, command)).status, 409);
  assert.equal(f.db.prepare('SELECT active FROM organizations WHERE id=1').get().active, 1);
});

test('operation links only locate recorded evidence and never manufacture old history', async t => {
  const f = fixture(t), op = await f.start('pause', [{ id: 1, version: 0, reason: 'Synthetic link test' }]);
  const count = f.db.prepare('SELECT COUNT(*) n FROM audit_operation_frames').get().n;
  const response = await link({ env: f.env, params: { operationId: op.id }, request: f.request(`/api/admin/audit/operations/${op.id}`) });
  assert.equal(response.status, 200); assert.equal((await response.json()).eventId, f.latest(op.id));
  const missing = crypto.randomUUID();
  assert.equal((await link({ env: f.env, params: { operationId: missing }, request: f.request(`/api/admin/audit/operations/${missing}`) })).status, 404);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit_operation_frames').get().n, count);
});
