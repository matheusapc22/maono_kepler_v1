import assert from 'node:assert/strict';
import test from 'node:test';
import { persistenceFixture } from './helpers/project-persistence-fixture.mjs';
import { onRequest as organizations } from '../functions/api/admin/organizations/index.js';
import { onRequest as organization } from '../functions/api/admin/organizations/[id].js';
import { runScheduledStorageRecovery } from '../workers/organization-storage-recovery.js';
import { repairActiveOrganizationStorages, ensureOrganizationStorage } from '../functions/_lib/organization-storage.js';

function fixture(t, hooks = {}) {
  const f = persistenceFixture(t, hooks);
  f.env.ADMIN_AUDIT_OPERATIONS_V1 = 'true';
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=1");
  f.request = (path, body, method = 'POST') => new Request(`https://local.invalid${path}`, { method,
    headers: { ...f.headers(1), 'Content-Type': 'application/json', 'X-Maono-UI-Route': '/admin' }, body: JSON.stringify(body) });
  return f;
}

test('legacy create and edit carry authenticated attribution in the same transaction as their effects', async t => {
  const f = fixture(t);
  const created = await organizations({ env: f.env, request: f.request('/api/admin/organizations', { name: 'Legacy local', slug: 'legacy-local', active: false }) });
  const body = await created.json(); assert.equal(created.status, 201, JSON.stringify(body));
  let row = f.db.prepare("SELECT * FROM audit_operation_frames WHERE source='organization_lifecycle' AND action='organization.create' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.actor_id, 1); assert.equal(row.executor_kind, 'user'); assert.equal(row.ui_route, '/admin');
  assert.equal(row.technical_origin, 'api:POST:/api/admin/organizations'); assert.equal(row.organization_id, body.organization.id);
  assert.equal(row.organization_name, 'Legacy local'); assert.equal(JSON.parse(row.after_json).active, 0);
  const edited = await organization({ env: f.env, params: { id: String(body.organization.id) }, request: f.request(`/api/admin/organizations/${body.organization.id}`, { name: 'Legacy edited', active: false }, 'PATCH') });
  assert.equal(edited.status, 200, await edited.text());
  row = f.db.prepare("SELECT * FROM audit_operation_frames WHERE source='organization_lifecycle' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.actor_id, 1); assert.equal(JSON.parse(row.before_json).name, 'Legacy local');
  assert.equal(JSON.parse(row.after_json).name, 'Legacy edited'); assert.equal(row.organization_name, 'Legacy edited');
});

test('mandatory attributed receipt failure rolls back the legacy mutation and its trigger projection', async t => {
  const f = fixture(t);
  f.db.exec("CREATE TRIGGER reject_attributed_receipt AFTER INSERT ON audit_operation_frames WHEN NEW.source='organization_lifecycle' BEGIN SELECT RAISE(ABORT,'AUDIT_INJECTED_FAILURE'); END;");
  const before = f.db.prepare('SELECT name,management_version FROM organizations WHERE id=1').get();
  const frames = f.db.prepare('SELECT COUNT(*) n FROM audit_operation_frames').get().n;
  const response = await organization({ env: f.env, params: { id: '1' }, request: f.request('/api/admin/organizations/1', { name: 'Must roll back' }, 'PATCH') });
  assert.ok(response.status >= 500);
  assert.deepEqual(f.db.prepare('SELECT name,management_version FROM organizations WHERE id=1').get(), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit_operation_frames').get().n, frames);
  assert.doesNotMatch(await response.text(), /AUDIT_INJECTED_FAILURE|INSERT|SELECT/);
});

test('scheduled storage records the Worker and current job correlation through claim and confirmation', async t => {
  const f = fixture(t);
  f.env.MAONO_STORAGE_RECOVERY_ENABLED = 'true'; f.env.MAONO_STORAGE_RECOVERY_DRY_RUN = 'false';
  f.db.exec("UPDATE organizations SET dropbox_root_path='/projects/offline-a',storage_status='ERROR',storage_error='DROPBOX_NETWORK_ERROR',storage_checked_at='2000-01-01T00:00:00.000Z' WHERE id=1");
  let calls = 0;
  const correlationId = crypto.randomUUID();
  const result = await runScheduledStorageRecovery(f.env, { correlationId, repair: (env, options) => repairActiveOrganizationStorages(env, { ...options, ensureFolder: async () => { calls++; } }) });
  assert.equal(result.result.ready, 1); assert.equal(calls, 1);
  const frames = f.db.prepare("SELECT * FROM audit_operation_frames WHERE source='organization_lifecycle' AND operation_id=? ORDER BY id").all(correlationId);
  assert.equal(frames.length, 2); assert.deepEqual(frames.map(row => row.outcome), ['running', 'succeeded']);
  assert.ok(frames.every(row => row.actor_id === null && row.executor_kind === 'worker' && row.technical_origin === 'worker:organization-storage-recovery'));
  assert.ok(frames.every(row => row.organization_id === 1)); assert.equal(frames[0].attempt_id, frames[1].attempt_id);
  assert.deepEqual(JSON.parse(frames[0].before_json), { storageStatus: 'ERROR' });
  assert.deepEqual(JSON.parse(frames[1].after_json), { storageStatus: 'READY' });
});

test('storage audit failure prevents external work and a superseded claim emits no attributed completion', async t => {
  const f = fixture(t);
  f.db.exec("UPDATE organizations SET dropbox_root_path='/projects/offline-a',storage_status='ERROR',storage_error='DROPBOX_NETWORK_ERROR',storage_checked_at='2000-01-01T00:00:00.000Z' WHERE id=1");
  f.db.exec("CREATE TRIGGER reject_storage_receipt AFTER INSERT ON audit_operation_frames WHEN NEW.source='organization_lifecycle' BEGIN SELECT RAISE(ABORT,'AUDIT_INJECTED_FAILURE'); END;");
  let calls = 0;
  await assert.rejects(ensureOrganizationStorage(f.env, { id: 1 }, { ensureFolder: async () => { calls++; } }), /AUDIT_INJECTED_FAILURE/);
  assert.equal(calls, 0); assert.equal(f.db.prepare('SELECT storage_status FROM organizations WHERE id=1').get().storage_status, 'ERROR');
  f.db.exec('DROP TRIGGER reject_storage_receipt');
  const result = await ensureOrganizationStorage(f.env, { id: 1 }, { ensureFolder: async () => { calls++; f.db.exec("UPDATE organizations SET active=0,storage_status='DISABLED' WHERE id=1"); } });
  assert.equal(result.superseded, true);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_operation_frames WHERE source='organization_lifecycle' AND event_type='attempt_finished'").get().n, 0);
});

test('disabled storage observation distinguishes state change from a repeated check', async t => {
  const f = fixture(t);
  f.db.exec("UPDATE organizations SET active=0,storage_status='ERROR',storage_error='PREVIOUS_ERROR' WHERE id=1");
  const first = await ensureOrganizationStorage(f.env, { id: 1 });
  assert.equal(first.organization.storage_status, 'DISABLED');
  let frame = f.db.prepare("SELECT * FROM audit_operation_frames WHERE source='organization_lifecycle' ORDER BY id DESC LIMIT 1").get();
  assert.equal(frame.outcome, 'succeeded'); assert.equal(JSON.parse(frame.before_json).storageStatus, 'ERROR');
  await ensureOrganizationStorage(f.env, { id: 1 });
  frame = f.db.prepare("SELECT * FROM audit_operation_frames WHERE source='organization_lifecycle' ORDER BY id DESC LIMIT 1").get();
  assert.equal(frame.outcome, 'no_change'); assert.equal(JSON.parse(frame.before_json).storageStatus, 'DISABLED');
  assert.equal(JSON.parse(frame.after_json).storageStatus, 'DISABLED');
});

test('a disabled-state race cannot emit a receipt from a stale before-image', async t => {
  let armed = true;
  const f = fixture(t, { beforeBatch({ db, statements }) {
    if (armed && statements.some(statement => statement.sql.includes("SET storage_status = 'DISABLED'"))) {
      armed = false; db.exec("UPDATE organizations SET storage_status='ERROR',storage_error='CONCURRENT_ERROR' WHERE id=1");
    }
  } });
  f.db.exec("UPDATE organizations SET active=0,storage_status='DISABLED',storage_error=NULL WHERE id=1");
  const result = await ensureOrganizationStorage(f.env, { id: 1 });
  assert.equal(result.superseded, true); assert.equal(result.organization.storage_status, 'ERROR');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_operation_frames WHERE source='organization_lifecycle'").get().n, 0);
});
