import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(new URL("../migrations/0029_ticket_attachment_upload_sessions.sql", import.meta.url), "utf8");
const fullSchema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const MIB = 1024 * 1024;

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE organizations(id INTEGER PRIMARY KEY);
    CREATE TABLE organization_tickets(
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      UNIQUE(id, organization_id)
    );
    CREATE TABLE ticket_drafts(
      id TEXT PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      audience TEXT NOT NULL CHECK(audience IN ('ticket','internal')),
      body TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'active',
      consumed_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(id, organization_id, ticket_id)
    );
    CREATE TABLE ticket_attachments(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACTIVE','FAILED','DELETED')),
      uploaded_by INTEGER NOT NULL,
      dropbox_file_id TEXT,
      dropbox_rev TEXT,
      error_message TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT 'ticket' CHECK(audience IN ('ticket','internal','draft')),
      message_id TEXT,
      draft_id TEXT,
      FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id)
    );
    INSERT INTO users VALUES(1),(2);
    INSERT INTO organizations VALUES(1);
    INSERT INTO organization_tickets(id,organization_id,status) VALUES(10,1,'open');
    INSERT INTO ticket_drafts(id,organization_id,ticket_id,user_id,audience,body,state,created_at,updated_at)
      VALUES('d1',1,10,1,'internal','secret','active','now','now');
  `);
  db.exec(migration);
  return db;
}

function reserve(db, {
  id,
  size = 1,
  user = 1,
  audience = "ticket",
  draftId = null,
  idle = Date.now() + 60_000,
  hard = Date.now() + 120_000,
} = {}) {
  const sessionId = `session_${id}`;
  const key = `/tickets/10/${sessionId}.bin`;
  db.prepare(`INSERT INTO ticket_attachment_upload_sessions
    (id,organization_id,ticket_id,user_id,storage_key,expected_size,expected_content_hash,target_audience,draft_id,
     acknowledged_offset,version,state,idle_expires_at,hard_expires_at,created_at,updated_at)
    VALUES(?,1,10,?,?,?,'${"a".repeat(64)}',?,?,0,1,'RESERVED',?,?,'now','now')`)
    .run(sessionId, user, key, size, audience, draftId, idle, hard);
  db.prepare(`INSERT INTO ticket_attachments
    (organization_id,ticket_id,original_name,stored_name,storage_key,mime_type,size_bytes,status,uploaded_by,created_at,updated_at,
     audience,message_id,draft_id,upload_session_id)
    VALUES(1,10,?,?,?,'application/octet-stream',?,'PENDING',?,'now','now',?,NULL,?,?)`)
    .run(`${id}.bin`, `${id}.bin`, key, size, user, draftId ? 'draft' : 'ticket', draftId, sessionId);
  return sessionId;
}

test("0029 is additive and exposes the resumable session schema", (t) => {
  const db = fixture(t);
  const attachmentColumns = new Set(db.prepare("PRAGMA table_info(ticket_attachments)").all().map((row) => row.name));
  assert.equal(attachmentColumns.has("upload_session_id"), true);
  assert.equal(attachmentColumns.has("provider_content_hash"), true);
  const sessionColumns = new Set(db.prepare("PRAGMA table_info(ticket_attachment_upload_sessions)").all().map((row) => row.name));
  for (const column of ["expected_content_hash", "acknowledged_offset", "version", "state", "idle_expires_at", "hard_expires_at"]) {
    assert.equal(sessionColumns.has(column), true, column);
  }
  assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("atomic reservation guard rejects a sixth live file", (t) => {
  const db = fixture(t);
  for (let index = 1; index <= 5; index += 1) reserve(db, { id: `u${index}` });
  assert.throws(() => reserve(db, { id: "u6" }), /TICKET_ATTACHMENT_CAPACITY_EXCEEDED/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ticket_attachment_upload_sessions").get().n, 5);
});

test("reservation guard enforces the 150 MiB ticket limit under session reservations", (t) => {
  const db = fixture(t);
  reserve(db, { id: "a", size: 80 * MIB });
  reserve(db, { id: "b", size: 70 * MIB });
  assert.throws(() => reserve(db, { id: "c", size: 1 }), /TICKET_ATTACHMENT_CAPACITY_EXCEEDED/);
});

test("expired reservations stop consuming capacity without a mutating GET", (t) => {
  const db = fixture(t);
  reserve(db, { id: "expired", idle: Date.now() - 5_000, hard: Date.now() + 60_000 });
  for (let index = 1; index <= 5; index += 1) reserve(db, { id: `live${index}` });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ticket_attachment_upload_sessions").get().n, 6);
});

test("draft reservation must match owner and audience", (t) => {
  const db = fixture(t);
  reserve(db, { id: "internal", audience: "internal", draftId: "d1" });
  assert.throws(
    () => reserve(db, { id: "wrong-audience", audience: "ticket", draftId: "d1" }),
    /TICKET_ATTACHMENT_UPLOAD_DRAFT_SCOPE_INVALID/,
  );
  assert.throws(
    () => reserve(db, { id: "wrong-user", user: 2, audience: "internal", draftId: "d1" }),
    /TICKET_ATTACHMENT_UPLOAD_DRAFT_SCOPE_INVALID/,
  );
});

test("session offset is monotonic and every mutation increments exactly one version", (t) => {
  const db = fixture(t);
  const sessionId = reserve(db, { id: "u" });
  db.prepare("UPDATE ticket_attachment_upload_sessions SET provider_session_id='provider', state='UPLOADING', version=2 WHERE id=?").run(sessionId);
  db.prepare("UPDATE ticket_attachment_upload_sessions SET acknowledged_offset=1, state='FINALIZING', version=3 WHERE id=?").run(sessionId);
  assert.throws(() => db.prepare("UPDATE ticket_attachment_upload_sessions SET acknowledged_offset=0, state='RECONCILE', version=4 WHERE id=?").run(sessionId), /OFFSET_REGRESSION/);
  assert.throws(() => db.prepare("UPDATE ticket_attachment_upload_sessions SET state='RECONCILE', version=5 WHERE id=?").run(sessionId), /VERSION_CONFLICT/);
});

test("terminal session rows are retained and cannot be silently deleted", (t) => {
  const db = fixture(t);
  const sessionId = reserve(db, { id: "u" });
  db.prepare("UPDATE ticket_attachment_upload_sessions SET state='CANCELLED', cancelled_at='now', version=2 WHERE id=?").run(sessionId);
  assert.throws(() => db.prepare("DELETE FROM ticket_attachment_upload_sessions WHERE id=?").run(sessionId), /RETENTION_REQUIRED/);
});

test("fresh-install schema contains the complete CC-06 session contract", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(fullSchema);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='ticket_attachment_upload_sessions'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'cc06_%'").get().n >= 6, true);
  const columns = new Set(db.prepare("PRAGMA table_info(ticket_attachments)").all().map((row) => row.name));
  assert.equal(columns.has("upload_session_id"), true);
  assert.equal(columns.has("provider_content_hash"), true);
  assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
