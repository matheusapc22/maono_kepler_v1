import { onRequest as health } from "../functions/api/health.js";
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { transitionRequestLifecycle, ticketStatusForRequest, publicRequestLifecycle, isChangeRequestLifecycleSchemaReady, ensureChangeRequestLifecycleSchema } from '../functions/_lib/project-change-request-lifecycle.js';
import { updateTicket } from '../functions/_lib/ticket-center.js';

const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const domain = await readFile(new URL('../migrations/0020_project_change_requests.sql', import.meta.url), 'utf8');
const lifecycle = await readFile(new URL('../migrations/0021_change_request_lifecycle.sql', import.meta.url), 'utf8');
function fixture(t, legacyStatus = 'submitted', legacyFeedback = false) {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  database.exec(schema); database.exec(domain);
  database.exec(`INSERT INTO organizations(id,name,slug,dropbox_root_path) VALUES(1,'Org','org','/org');
    INSERT INTO users(id,name,email,role,password_hash) VALUES(1,'Editor','ed@test','editor','x');
    INSERT INTO projects(id,name,slug,organization_id,dropbox_root_path) VALUES(1,'Map','map',1,'/org/map');
    INSERT INTO organization_tickets(id,organization_id,code,subject,description,created_by) VALUES(1,1,'TKT-1','Request','Reason',1);
    INSERT INTO project_change_requests(id,organization_id,project_id,requested_by_user_id,ticket_id,base_revision,status,reason,idempotency_key,submission_hash)
      VALUES('cr-1',1,1,1,1,4,'${legacyStatus}','Reason','key','hash');`);
  if (legacyFeedback) database.exec(`INSERT INTO ticket_events(organization_id,ticket_id,event_type,actor_user_id,metadata,created_at)
    VALUES(1,1,'project.change_request.rejected',1,'{"comment":"Feedback legado"}','2026-09-01 10:00:00');`);
  database.exec(lifecycle);
  const db = { prepare(sql) { const statement = database.prepare(sql); let params = [];
    return { bind(...values) { params = values; return this; },
      async first() { return statement.get(...params) || null; },
      async all() { return { results: statement.all(...params) }; },
      async run() { return statement.run(...params); } };
  } };
  const row = () => database.prepare("SELECT * FROM project_change_requests WHERE id='cr-1'").get();
  const ticket = () => database.prepare('SELECT * FROM organization_tickets WHERE id=1').get();
  const events = () => database.prepare("SELECT * FROM project_change_request_events WHERE change_request_id='cr-1' ORDER BY version").all();
  const change = async (next, options = {}) => transitionRequestLifecycle(db, row(), row().status, next, { actor: { id: 1 }, ...options });
  return { database, db, row, ticket, events, change };
}

test('canonical approval/apply synchronizes Ticket, durable journal and applied revision', async t => {
  const f = fixture(t);
  for (const status of ['under_review','approved','applying','applied']) {
    await f.change(status, { appliedRevision: 5, feedback: status === 'approved' ? 'Validado' : null });
    assert.equal(f.ticket().status, ticketStatusForRequest(status));
  }
  assert.equal(f.row().lifecycle_version, 4);
  assert.equal(f.row().decision, 'approved');
  assert.equal(f.row().feedback, 'Validado');
  assert.equal(publicRequestLifecycle(f.row()).appliedRevision, 5);
  f.database.exec('UPDATE projects SET config_revision=99 WHERE id=1');
  assert.equal(publicRequestLifecycle(f.row()).appliedRevision, 5);
  assert.equal(f.events().length, 5);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ticket_events').get().n, 4);
  assert.ok(f.ticket().closed_at);
});

test('rejection retry is idempotent; differing feedback and stale competing decisions do not win', async t => {
  const f = fixture(t);
  const stale = f.row();
  await f.change('rejected', { feedback: 'Corrija a localização' });
  assert.equal(await f.change('rejected', { feedback: 'Corrija a localização' }), null);
  await assert.rejects(f.change('rejected', { feedback: 'Outro motivo' }), { code: 'CHANGE_REQUEST_DECISION_CONFLICT' });
  assert.equal(await transitionRequestLifecycle(f.db, stale, 'submitted', 'under_review', { actor: { id: 1 } }), null);
  assert.equal(f.row().feedback, 'Corrija a localização');
  assert.equal(f.row().decision, 'rejected');
  assert.equal(f.events().length, 2);
  assert.equal(f.ticket().status, 'closed');
});

test('an event write failure rolls back request, Ticket and journal without being hidden by retry', async t => {
  const f = fixture(t);
  f.database.exec("CREATE TRIGGER fail_event BEFORE INSERT ON ticket_events BEGIN SELECT RAISE(ABORT,'injected event failure'); END;");
  await assert.rejects(f.change('under_review'), /injected event failure/);
  assert.equal(f.row().status, 'submitted');
  assert.equal(f.row().lifecycle_version, 0);
  assert.equal(f.ticket().status, 'new');
  assert.equal(f.events().length, 1);
  f.database.exec('DROP TRIGGER fail_event');
  await f.change('under_review');
  assert.equal(f.events().length, 2);
});

test('generic Ticket writer and direct SQL cannot override canonical status', async t => {
  const f = fixture(t);
  await assert.rejects(updateTicket({ DB: f.db }, 1, 1, { id: 1 }, { status: 'closed' }, new Request('https://test')),
    { code: 'TICKET_CHANGE_REQUEST_LIFECYCLE_MANAGED' });
  assert.throws(() => f.database.exec("UPDATE organization_tickets SET status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=1"), /LIFECYCLE_MANAGED/);
  await f.change('under_review'); await f.change('rejected', { feedback: 'Corrigir' });
  assert.throws(() => f.database.exec('UPDATE organization_tickets SET closed_at=NULL WHERE id=1'), /LIFECYCLE_MANAGED/);
  assert.equal(f.row().status, 'rejected');
});

test('conflict preserves approval; null ticket works; terminal transitions and empty feedback fail', async t => {
  const f = fixture(t);
  await assert.rejects(f.change('rejected'), { code: 'CHANGE_REQUEST_REJECTION_REASON_REQUIRED' });
  await assert.rejects(f.change('rejected', { feedback: 'x'.repeat(2001) }), { code: 'CHANGE_REQUEST_FEEDBACK_TOO_LONG' });
  await f.change('under_review'); await f.change('approved');
  f.database.exec('DELETE FROM organization_tickets WHERE id=1');
  await f.change('conflict');
  assert.equal(f.row().decision, 'approved');
  assert.equal(f.row().ticket_id, null);
  assert.equal(f.events().length, 4);
  await assert.rejects(f.change('applied', { appliedRevision: 5 }), { code: 'CHANGE_REQUEST_INVALID_TRANSITION' });
});

test('migration backfill leaves missing historical feedback/author unknown', t => {
  const f = fixture(t, 'rejected');
  assert.equal(f.row().decision, 'rejected');
  assert.equal(f.row().feedback, null);
  assert.equal(f.row().decided_by_user_id, null);
  assert.equal(f.row().decided_at, null);
  assert.equal(f.ticket().status, 'closed');
});

test('SQL guards reject bypassed version, decision overwrite and wrong applied revision', async t => {
  const f = fixture(t);
  assert.throws(() => f.database.exec("UPDATE project_change_requests SET status='under_review' WHERE id='cr-1'"), /VERSION_REQUIRED/);
  await f.change('under_review'); await f.change('approved', { feedback: 'Aprovado' });
  assert.throws(() => f.database.exec("UPDATE project_change_requests SET feedback='changed' WHERE id='cr-1'"), /IMMUTABLE/);
  await f.change('applying');
  await assert.rejects(f.change('applied', { appliedRevision: 7 }), /APPLIED_REVISION_REQUIRED/);
  assert.equal(f.row().status, 'applying');
});


test('schema gate rejects a partial migration with a missing synchronization trigger', async t => {
  const f = fixture(t);
  assert.equal(await isChangeRequestLifecycleSchemaReady({ DB: f.db }), true);
  f.database.exec('DROP TRIGGER trg_change_request_lifecycle_sync');
  assert.equal(await isChangeRequestLifecycleSchemaReady({ DB: f.db }), false);
  await assert.rejects(ensureChangeRequestLifecycleSchema({ DB: f.db }), { code: 'CHANGE_REQUEST_LIFECYCLE_SCHEMA_OUTDATED' });
});


test('migration recovers recorded legacy rejection feedback without inventing a new decision date', t => {
  const f = fixture(t, 'rejected', true);
  assert.equal(f.row().feedback, 'Feedback legado');
  assert.equal(f.row().decided_by_user_id, 1);
  assert.equal(f.row().decided_at, '2026-09-01 10:00:00');
});


test('health reports the lifecycle gate as failed when synchronization is unavailable', async t => {
  const f = fixture(t);
  const env = { DB: f.db, DROPBOX_APP_KEY: 'configured', DROPBOX_APP_SECRET: 'configured', DROPBOX_REFRESH_TOKEN: 'configured' };
  let response = await health({ env, request: new Request('https://test/api/health') });
  assert.equal((await response.json()).checks.changeRequestLifecycleReady, true);
  f.database.exec('DROP TRIGGER trg_change_request_lifecycle_sync');
  response = await health({ env, request: new Request('https://test/api/health') });
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(result.checks.changeRequestLifecycleReady, false);
});


test('decision attribution cannot be rewritten or cleared, but supports actor deletion', async t => {
  const f = fixture(t);
  f.database.exec("INSERT INTO users(id,name,email,role,password_hash) VALUES(2,'Reviewer','reviewer@test','editor','x')");
  await f.change('rejected', { actor: { id: 2 }, feedback: 'Revise' });
  assert.throws(() => f.database.exec("UPDATE project_change_requests SET decided_by_user_id=1 WHERE id='cr-1'"), /DECISION_IMMUTABLE/);
  assert.throws(() => f.database.exec("UPDATE project_change_requests SET decided_by_user_id=NULL WHERE id='cr-1'"), /DECISION_IMMUTABLE/);
  f.database.exec('DELETE FROM users WHERE id=2');
  assert.equal(f.row().decided_by_user_id, null);
  assert.equal(f.row().feedback, 'Revise');
  assert.equal(f.row().lifecycle_version, 1);
});
