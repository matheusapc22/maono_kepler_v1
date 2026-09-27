import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { draftWriteSql } from '../functions/_lib/ticket-conversation-policy.js';
const migration = readFileSync(new URL('../migrations/0028_ticket_conversations.sql', import.meta.url), 'utf8');
// Minimal, explicit pre-0028 fixture derived from the 0010/0026 parent columns.
// This is not a claim that every historical migration or production was tested.
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE organizations(id INTEGER PRIMARY KEY);
    CREATE TABLE organization_tickets(id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', UNIQUE(id, organization_id));
    CREATE TABLE ticket_commands(id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT,
      request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)),
      response_status INTEGER NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(organization_id, actor_user_id, operation, idempotency_key));
    CREATE TABLE ticket_attachments(id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL, uploaded_by INTEGER NOT NULL, storage_key TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING');
    CREATE TABLE ticket_events(id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL, event_type TEXT, metadata TEXT);
    INSERT INTO users VALUES(1),(2);
    INSERT INTO organizations VALUES(1),(2);
    INSERT INTO organization_tickets(id,organization_id) VALUES(10,1),(20,2);
    INSERT INTO ticket_attachments VALUES(1,1,10,1,'legacy','ACTIVE');
    INSERT INTO ticket_events VALUES(1,1,10,'ticket.created','{}');`);
  db.exec(migration);
  return db;
}
function receipt(db, id, org = 1, user = 1) {
  db.prepare(`INSERT INTO ticket_commands VALUES(?,?,?,'ticket.message',?,'hash','{}',201,'2026-09-26T20:00:00Z')`).run(id, org, user, id);
}
function message(db, id = 'm1', audience = 'internal', org = 1, ticket = 10, user = 1) {
  receipt(db, id, org, user);
  db.prepare(`INSERT INTO ticket_messages(id,organization_id,ticket_id,author_user_id,kind,audience,body,
    command_id,last_command_id,created_at) VALUES(?,?,?,?,?,?,'hello',?,?, '2026-09-26T20:00:00Z')`)
    .run(id, org, ticket, user, audience === 'internal' ? 'internal' : 'response', audience, id, id);
}
function draft(db, id = 'd1', audience = 'internal', user = 1) {
  db.prepare(`INSERT INTO ticket_drafts(id,organization_id,ticket_id,user_id,audience,body,created_at,updated_at)
    VALUES(?,1,10,?,?,'hello','2026-09-26T20:00:00Z','2026-09-26T20:00:00Z')`).run(id, user, audience);
}
test('migration is additive and preserves legacy attachment/event audience', t => {
  const db = fixture(t);
  assert.deepEqual({ ...db.prepare('SELECT audience,message_id,draft_id FROM ticket_attachments WHERE id=1').get() },
    { audience: 'ticket', message_id: null, draft_id: null });
  assert.equal(db.prepare('SELECT audience FROM ticket_events WHERE id=1').get().audience, 'ticket');
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
test('initial revision is atomic and cannot be inserted twice', t => {
  const db = fixture(t); message(db);
  assert.equal(db.prepare('SELECT count(*) AS n FROM ticket_message_revisions').get().n, 1);
  assert.throws(() => db.exec(`INSERT INTO ticket_message_revisions SELECT * FROM ticket_message_revisions`));
});
test('cross-tenant ticket message is rejected by composite FK', t => {
  const db = fixture(t);
  assert.throws(() => message(db, 'm1', 'internal', 1, 20));
});
test('command receipt must belong to message tenant and actor', t => {
  const db = fixture(t); receipt(db, 'c', 2, 2);
  assert.throws(() => db.exec(`INSERT INTO ticket_messages(id,organization_id,ticket_id,author_user_id,kind,audience,body,
    command_id,last_command_id,created_at) VALUES('m',1,10,1,'response','ticket','hello','c','c','now')`));
});
test('message audience and kind must agree', t => {
  const db = fixture(t); receipt(db, 'c');
  assert.throws(() => db.exec(`INSERT INTO ticket_messages(id,organization_id,ticket_id,author_user_id,kind,audience,body,
    command_id,last_command_id,created_at) VALUES('m',1,10,1,'response','internal','hello','c','c','now')`));
});
for (const mutation of ["audience='ticket',kind='response'", "author_user_id=2", "organization_id=2,ticket_id=20", "created_at='changed'", "id='other'"]) {
  test(`message identity cannot change: ${mutation}`, t => {
    const db = fixture(t); message(db); receipt(db, 'edit');
    assert.throws(() => db.exec(`UPDATE ticket_messages SET ${mutation},version=2,last_command_id='edit',edited_at='now',edit_reason='fix' WHERE id='m1'`));
  });
}
test('edit generates immutable second revision preserving initial body', t => {
  const db = fixture(t); message(db); receipt(db, 'edit');
  db.exec(`UPDATE ticket_messages SET body='corrected',version=2,last_command_id='edit',edited_at='now',edit_reason='typo' WHERE id='m1'`);
  assert.deepEqual(db.prepare('SELECT body FROM ticket_message_revisions ORDER BY version').all().map(r => r.body), ['hello', 'corrected']);
  assert.throws(() => db.exec("UPDATE ticket_message_revisions SET body='tampered'"), /APPEND_ONLY/);
  assert.throws(() => db.exec('DELETE FROM ticket_message_revisions'), /APPEND_ONLY/);
  assert.throws(() => db.exec('DELETE FROM ticket_messages'), /RETENTION_REQUIRED/);
});
for (const edit of ["body='new'", "version=3", "version=2,edit_reason=NULL", "version=2,edit_reason=''", "version=2,last_command_id='m1'"]) {
  test(`invalid edit precondition is rejected: ${edit}`, t => {
    const db = fixture(t); message(db); receipt(db, 'edit');
    assert.throws(() => db.exec(`UPDATE ticket_messages SET last_command_id='edit',edited_at='now',edit_reason='fix',${edit} WHERE id='m1'`));
  });
}
test('receipt uniqueness prevents duplicate send and SQL batch failure rolls back', t => {
  const db = fixture(t); message(db);
  assert.throws(() => receipt(db, 'm1'));
  db.exec('BEGIN');
  try { message(db, 'm2'); db.exec("INSERT INTO ticket_message_revisions SELECT * FROM ticket_message_revisions WHERE message_id='m2'"); db.exec('COMMIT'); }
  catch { db.exec('ROLLBACK'); }
  assert.equal(db.prepare("SELECT count(*) AS n FROM ticket_messages WHERE id='m2'").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM ticket_commands WHERE id='m2'").get().n, 0);
});
test('one active draft per user, tenant, ticket and audience', t => {
  const db = fixture(t); draft(db);
  assert.throws(() => draft(db, 'd2'));
  draft(db, 'd2', 'ticket'); draft(db, 'd3', 'internal', 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM ticket_drafts').get().n, 3);
});
test('two-tab compare-and-swap preserves last confirmed version and detects zero rows', t => {
  const db = fixture(t); draft(db);
  const save = db.prepare(draftWriteSql());
  assert.equal(save.get('tab one', 'now', 'd1', 1, 10, 1, 'internal', 1).version, 2);
  assert.equal(save.get('tab two', 'later', 'd1', 1, 10, 1, 'internal', 1), undefined);
  assert.equal(db.prepare("SELECT body FROM ticket_drafts WHERE id='d1'").get().body, 'tab one');
  assert.equal(save.get('wrong actor', 'later', 'd1', 1, 10, 2, 'internal', 2), undefined);
  assert.equal(save.get('wrong org', 'later', 'd1', 2, 10, 1, 'internal', 2), undefined);
  assert.equal(save.get('wrong audience', 'later', 'd1', 1, 10, 1, 'ticket', 2), undefined);
});
test('draft ownership, audience and scope are immutable', t => {
  const db = fixture(t); draft(db);
  for (const change of ["user_id=2", "audience='ticket'", "organization_id=2,ticket_id=20", "created_at='other'"]) {
    assert.throws(() => db.exec(`UPDATE ticket_drafts SET ${change},version=2 WHERE id='d1'`));
  }
});
test('consumed draft is terminal, needs matching message and does not clear newer text', t => {
  const db = fixture(t); draft(db); message(db);
  db.exec("UPDATE ticket_drafts SET body='newer',version=2 WHERE id='d1'");
  assert.throws(() => db.exec("UPDATE ticket_drafts SET state='sent',consumed_message_id='m1',version=3 WHERE id='d1'"), /SCOPE_INVALID/);
  db.exec("UPDATE ticket_drafts SET body='hello',version=3 WHERE id='d1'");
  db.exec("UPDATE ticket_drafts SET state='sent',consumed_message_id='m1',version=4 WHERE id='d1'");
  assert.throws(() => db.exec("UPDATE ticket_drafts SET state='active',consumed_message_id=NULL,version=5 WHERE id='d1'"), /VERSION_CONFLICT/);
  draft(db, 'd2');
});
test('draft attachment is private from insertion and can promote only to matching message', t => {
  const db = fixture(t); draft(db); message(db);
  db.exec("INSERT INTO ticket_attachments VALUES(2,1,10,1,'draft-object','ACTIVE','draft',NULL,'d1')");
  db.exec("UPDATE ticket_attachments SET audience='internal',message_id='m1',draft_id=NULL WHERE id=2");
  assert.equal(db.prepare('SELECT audience FROM ticket_attachments WHERE id=2').get().audience, 'internal');
  assert.throws(() => db.exec("UPDATE ticket_attachments SET audience='ticket',message_id=NULL WHERE id=2"), /AUDIENCE_IMMUTABLE/);
});
test('legacy attachments cannot be silently reclassified as confidential', t => {
  const db = fixture(t); draft(db); message(db);
  assert.throws(() => db.exec("UPDATE ticket_attachments SET audience='draft',draft_id='d1' WHERE id=1"));
  assert.throws(() => db.exec("UPDATE ticket_attachments SET audience='internal',message_id='m1' WHERE id=1"));
});
test('attachment cross-tenant, cross-author and direct message inserts are denied', t => {
  const db = fixture(t); draft(db); message(db);
  for (const values of ["2,2,20,1,'bad','ACTIVE','draft',NULL,'d1'",
    "2,1,10,2,'bad','ACTIVE','draft',NULL,'d1'", "2,1,10,1,'bad','ACTIVE','internal','m1',NULL"]) {
    assert.throws(() => db.exec(`INSERT INTO ticket_attachments VALUES(${values})`));
  }
});
test('pending upload cannot be promoted before storage finalization', t => {
  const db = fixture(t); draft(db); message(db);
  db.exec("INSERT INTO ticket_attachments VALUES(2,1,10,1,'pending','PENDING','draft',NULL,'d1')");
  assert.throws(() => db.exec("UPDATE ticket_attachments SET status='ACTIVE',audience='internal',message_id='m1',draft_id=NULL WHERE id=2"));
});
test('internal event cannot be relabelled ticket-visible or cross-tenant', t => {
  const db = fixture(t); message(db);
  db.exec("INSERT INTO ticket_events VALUES(2,1,10,'ticket.message.created','{}','internal','m1')");
  assert.throws(() => db.exec("INSERT INTO ticket_events VALUES(3,1,10,'ticket.message.created','{}','ticket','m1')"));
  assert.throws(() => db.exec("INSERT INTO ticket_events VALUES(3,2,20,'ticket.message.created','{}','internal','m1')"));
  assert.throws(() => db.exec("INSERT INTO ticket_events VALUES(3,1,10,'ticket.message.created','{}','internal',NULL)"));
});
test('repeat application stops instead of silently masking a prior application', t => {
  const db = fixture(t); assert.throws(() => db.exec(migration), /already exists/);
});
const fullSchema = new URL('../schema.sql', import.meta.url);
test('fresh-install schema.sql already contains the complete 0028 conversation schema', { skip: !existsSync(fullSchema) }, t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(readFileSync(fullSchema, 'utf8'));
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
    ('ticket_messages','ticket_message_revisions','ticket_drafts') ORDER BY name`).all().map((row) => row.name);
  assert.deepEqual(tables, ['ticket_drafts', 'ticket_message_revisions', 'ticket_messages']);
  const attachmentColumns = new Set(db.prepare('PRAGMA table_info(ticket_attachments)').all().map((row) => row.name));
  assert.equal(attachmentColumns.has('audience'), true);
  assert.equal(attachmentColumns.has('message_id'), true);
  assert.equal(attachmentColumns.has('draft_id'), true);
  const eventColumns = new Set(db.prepare('PRAGMA table_info(ticket_events)').all().map((row) => row.name));
  assert.equal(eventColumns.has('audience'), true);
  assert.equal(eventColumns.has('message_id'), true);
  assert.equal(db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'cc05_%'`).get().n > 0, true);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
