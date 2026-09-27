import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createTicketCommandDb, COMMAND_ACTORS } from "./helpers/ticket-command-db.mjs";
import { executeTicketCreate, executeTicketTransition } from "../functions/_lib/ticket-commands.js";
import { resolveTicketConversationContext } from "../functions/_lib/ticket-conversations.js";
import {
  cancelTicketAttachmentUpload,
  getTicketAttachmentUploadSession,
  getTicketResumableUploadCapability,
  initiateResumableTicketAttachmentUpload,
  listTicketAttachmentUploadSessions,
  reconcileTicketAttachmentUpload,
  uploadTicketAttachmentSessionChunk,
} from "../functions/_lib/ticket-attachment-uploads.js";
import { dropboxContentHashHex } from "../functions/_lib/dropbox-content-hash.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const { owner, viewer } = COMMAND_ACTORS;

function commandRequest(key) {
  return new Request("https://cc06.test/tickets", {
    method: "POST",
    headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
  });
}

function createPayload() {
  return {
    subject: "CC-06 upload",
    description: "Teste de upload resumível",
    priority: "normal",
    category: "support",
  };
}

function uploadRequest(offset, etag, bytes) {
  return new Request("https://cc06.test/upload", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Upload-Offset": String(offset),
      "If-Match": etag,
    },
    body: bytes,
  });
}

function providerHarness() {
  const session = { id: "provider-session-1", offset: 0, bytes: [], committed: null };
  let lostNextAppend = false;
  let lostNextFinish = false;
  let appendCalls = 0;
  let finishCalls = 0;
  let forcedCommitHash = null;

  async function metadata() {
    if (!session.committed) return null;
    return session.committed;
  }

  async function fetch(url, init = {}) {
    const textUrl = String(url);
    if (textUrl.includes("oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (textUrl.includes("files/create_folder_v2")) {
      return new Response(JSON.stringify({ metadata: { id: "folder", path_display: "/folder" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (textUrl.includes("files/upload_session/start")) {
      return new Response(JSON.stringify({ session_id: session.id }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (textUrl.includes("files/upload_session/append_v2")) {
      appendCalls += 1;
      const arg = JSON.parse(init.headers["Dropbox-API-Arg"]);
      const offset = Number(arg.cursor.offset);
      if (offset !== session.offset) {
        return new Response(JSON.stringify({ error: { ".tag": "incorrect_offset", correct_offset: session.offset } }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      session.bytes.push(bytes);
      session.offset += bytes.byteLength;
      if (lostNextAppend) {
        lostNextAppend = false;
        return new Response("provider response lost", { status: 502 });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (textUrl.includes("files/upload_session/finish")) {
      finishCalls += 1;
      const arg = JSON.parse(init.headers["Dropbox-API-Arg"]);
      const offset = Number(arg.cursor.offset);
      if (offset !== session.offset) {
        return new Response(JSON.stringify({ error: { ".tag": "incorrect_offset", correct_offset: session.offset } }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      if (bytes.byteLength) {
        session.bytes.push(bytes);
        session.offset += bytes.byteLength;
      }
      const all = new Uint8Array(session.bytes.reduce((n, part) => n + part.byteLength, 0));
      let cursor = 0;
      for (const part of session.bytes) { all.set(part, cursor); cursor += part.byteLength; }
      session.committed = {
        id: "id:ticket-file",
        rev: "rev-1",
        size: all.byteLength,
        content_hash: forcedCommitHash || await dropboxContentHashHex(all),
        path_display: arg.commit.path,
      };
      if (lostNextFinish) {
        lostNextFinish = false;
        return new Response("provider response lost", { status: 502 });
      }
      return new Response(JSON.stringify(session.committed), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (textUrl.includes("files/get_metadata")) {
      const value = await metadata();
      if (!value) {
        return new Response(JSON.stringify({ error_summary: "path/not_found/.." }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected provider URL: ${textUrl}`);
  }

  return {
    fetch,
    session,
    get appendCalls() { return appendCalls; },
    get finishCalls() { return finishCalls; },
    loseNextAppend() { lostNextAppend = true; },
    loseNextFinish() { lostNextFinish = true; },
    forceCommitHash(value) { forcedCommitHash = value; },
  };
}

function markCommandReady(db) {
  db.sqlite.exec(`
    INSERT INTO ticket_command_backfills
      (organization_id,status,schema_version,source_count,canonical_count,pending_count,skipped_count,last_legacy_id,completed_at,updated_at,last_run_id)
    VALUES
      (1,'ready',1,0,0,0,0,NULL,'2026-09-27T00:00:00.000Z','2026-09-27T00:00:00.000Z','cc06-local');
  `);
}

async function fixture(t) {
  const db = await createTicketCommandDb(t, { marker: false });
  markCommandReady(db);
  db.sqlite.exec(source("../migrations/0028_ticket_conversations.sql"));
  db.sqlite.exec(source("../migrations/0029_ticket_attachment_upload_sessions.sql"));
  db.env.MAONO_TICKET_CONVERSATIONS_ENABLED = "false";
  db.env.MAONO_TICKET_RESUMABLE_UPLOADS_ENABLED = "true";
  db.env.DROPBOX_APP_KEY = "key";
  db.env.DROPBOX_APP_SECRET = "secret";
  db.env.DROPBOX_REFRESH_TOKEN = "refresh";
  db.sqlite.exec(`UPDATE organizations SET storage_status='READY', storage_error=NULL,
    storage_checked_at='2026-09-27T00:00:00.000Z' WHERE id=1`);
  db.sqlite.exec(`INSERT OR IGNORE INTO role_permissions(role,permission,scope_type,active)
    VALUES ('owner','ticket.view','organization',1),('owner','ticket.comment','organization',1)`);
  const created = await executeTicketCreate(db.env, 1, owner, createPayload(), commandRequest(`create-${Math.random()}`));
  const ticket = created.ticket;
  const context = await resolveTicketConversationContext(db.env, 1, ticket.id, owner);
  const provider = providerHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = provider.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  return { db, ticket, etag: created.etag, context, provider };
}

test("capability fails closed until flag and 0029 schema are both present", async (t) => {
  const db = await createTicketCommandDb(t, { marker: false });
  db.env.MAONO_TICKET_RESUMABLE_UPLOADS_ENABLED = "true";
  assert.deepEqual(await getTicketResumableUploadCapability(db.env), { configured: true, schemaReady: false, enabled: false });
  db.sqlite.exec(source("../migrations/0028_ticket_conversations.sql"));
  db.sqlite.exec(source("../migrations/0029_ticket_attachment_upload_sessions.sql"));
  assert.deepEqual(await getTicketResumableUploadCapability(db.env), { configured: true, schemaReady: true, enabled: true });
});

test("lost append response reconciles Dropbox correct_offset without duplicating bytes", async (t) => {
  const { db, ticket, context, provider } = await fixture(t);
  const bytes = new TextEncoder().encode("%PDF-cc06-two-chunks");
  const expectedHash = await dropboxContentHashHex(bytes);
  const started = await initiateResumableTicketAttachmentUpload(
    db.env, 1, ticket.id, owner,
    { name: "evidence.pdf", mimeType: "application/pdf", size: bytes.byteLength, contentHash: expectedHash },
  );
  provider.loseNextAppend();
  const firstSize = 8;
  const first = await uploadTicketAttachmentSessionChunk(
    db.env, context, started.upload.sessionId, owner,
    uploadRequest(0, started.upload.etag, bytes.slice(0, firstSize)),
  );
  assert.equal(first.complete, false);
  assert.equal(first.session.offset, firstSize);
  assert.equal(provider.session.offset, firstSize);
  assert.equal(provider.appendCalls, 2, "retry probes the same cursor and provider answers incorrect_offset");

  provider.loseNextFinish();
  const second = await uploadTicketAttachmentSessionChunk(
    db.env, context, started.upload.sessionId, owner,
    uploadRequest(firstSize, first.session.etag, bytes.slice(firstSize)),
  );
  assert.equal(second.complete, true);
  assert.equal(second.attachment.status, "ACTIVE");
  assert.equal(provider.session.offset, bytes.byteLength);
  const stored = db.sqlite.prepare("SELECT status,provider_content_hash FROM ticket_attachments WHERE id=?").get(second.attachment.id);
  assert.equal(stored.status, "ACTIVE");
  assert.equal(stored.provider_content_hash, expectedHash);
  const session = db.sqlite.prepare("SELECT state,acknowledged_offset,provider_content_hash FROM ticket_attachment_upload_sessions WHERE id=?").get(started.upload.sessionId);
  assert.deepEqual({ ...session }, { state: "COMPLETED", acknowledged_offset: bytes.byteLength, provider_content_hash: expectedHash });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM ticket_events WHERE event_type='ticket.attachment.added'").get().n, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='ticket.attachment.added'").get().n, 1);
});

test("concurrent starts reserve at most five files atomically", async (t) => {
  const { db, ticket } = await fixture(t);
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, async (_, index) => {
    const bytes = new TextEncoder().encode(`%PDF-capacity-${index}`);
    return initiateResumableTicketAttachmentUpload(
      db.env, 1, ticket.id, owner,
      { name: `capacity-${index}.pdf`, mimeType: "application/pdf", size: bytes.byteLength, contentHash: await dropboxContentHashHex(bytes) },
    );
  }));
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 5);
  const rejected = attempts.filter((result) => result.status === "rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "ATTACHMENT_CAPACITY_LIMIT");
  assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ticket_attachment_upload_sessions
    WHERE state IN ('RESERVED','UPLOADING','FINALIZING','RECONCILE')`).get().n, 5);
});

test("provider commit followed by D1 publish failure enters RECONCILE and publishes once later", async (t) => {
  const { db, ticket, context, provider } = await fixture(t);
  const bytes = new TextEncoder().encode("%PDF-finalize-gap");
  const expectedHash = await dropboxContentHashHex(bytes);
  const started = await initiateResumableTicketAttachmentUpload(
    db.env, 1, ticket.id, owner,
    { name: "gap.pdf", mimeType: "application/pdf", size: bytes.byteLength, contentHash: expectedHash },
  );
  db.failNextBatchAt(1);
  await assert.rejects(
    uploadTicketAttachmentSessionChunk(
      db.env, context, started.upload.sessionId, owner,
      uploadRequest(0, started.upload.etag, bytes),
    ),
    /FIXTURE_STATEMENT_FAILURE_1/,
  );
  assert.equal(provider.session.committed?.content_hash, expectedHash);
  assert.equal(db.sqlite.prepare("SELECT state FROM ticket_attachment_upload_sessions WHERE id=?").get(started.upload.sessionId).state, "RECONCILE");
  assert.equal(db.sqlite.prepare("SELECT status FROM ticket_attachments WHERE upload_session_id=?").get(started.upload.sessionId).status, "PENDING");

  const reconciled = await reconcileTicketAttachmentUpload(db.env, context, started.upload.sessionId, owner, new Request("https://cc06.test/reconcile", { method: "POST" }));
  assert.equal(reconciled.complete, true);
  assert.equal(reconciled.attachment.status, "ACTIVE");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM ticket_events WHERE event_type='ticket.attachment.added'").get().n, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='ticket.attachment.added'").get().n, 1);
});


test("final publication CAS race rolls back attachment, event and audit without phantom effects", async (t) => {
  const { db, ticket, context } = await fixture(t);
  const bytes = new TextEncoder().encode("%PDF-final-cas-race");
  const started = await initiateResumableTicketAttachmentUpload(
    db.env, 1, ticket.id, owner,
    { name: "race.pdf", mimeType: "application/pdf", size: bytes.byteLength, contentHash: await dropboxContentHashHex(bytes) },
  );
  db.beforeNextBatch((sqlite) => {
    sqlite.prepare(`UPDATE ticket_attachment_upload_sessions
      SET state='RECONCILE', version=version+1, updated_at='2026-09-27T00:00:01.000Z'
      WHERE id=? AND state='FINALIZING'`).run(started.upload.sessionId);
  });
  await assert.rejects(
    uploadTicketAttachmentSessionChunk(
      db.env, context, started.upload.sessionId, owner,
      uploadRequest(0, started.upload.etag, bytes),
    ),
  );
  assert.equal(db.sqlite.prepare("SELECT state FROM ticket_attachment_upload_sessions WHERE id=?").get(started.upload.sessionId).state, "RECONCILE");
  assert.equal(db.sqlite.prepare("SELECT status FROM ticket_attachments WHERE upload_session_id=?").get(started.upload.sessionId).status, "PENDING");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM ticket_events WHERE event_type='ticket.attachment.added'").get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='ticket.attachment.added'").get().n, 0);
});

test("provider hash mismatch never publishes ACTIVE and leaves session reconcilable", async (t) => {
  const { db, ticket, context, provider } = await fixture(t);
  const bytes = new TextEncoder().encode("%PDF-integrity-mismatch");
  const expectedHash = await dropboxContentHashHex(bytes);
  const started = await initiateResumableTicketAttachmentUpload(
    db.env, 1, ticket.id, owner,
    { name: "integrity.pdf", mimeType: "application/pdf", size: bytes.byteLength, contentHash: expectedHash },
  );
  provider.forceCommitHash("b".repeat(64));
  await assert.rejects(
    uploadTicketAttachmentSessionChunk(
      db.env, context, started.upload.sessionId, owner,
      uploadRequest(0, started.upload.etag, bytes),
    ),
    { code: "ATTACHMENT_UPLOAD_INTEGRITY_MISMATCH" },
  );
  assert.equal(db.sqlite.prepare("SELECT state FROM ticket_attachment_upload_sessions WHERE id=?").get(started.upload.sessionId).state, "RECONCILE");
  assert.equal(db.sqlite.prepare("SELECT status FROM ticket_attachments WHERE upload_session_id=?").get(started.upload.sessionId).status, "PENDING");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM ticket_events WHERE event_type='ticket.attachment.added'").get().n, 0);
});

test("closed ticket blocks further chunks without advancing provider bytes", async (t) => {
  const { db, ticket, etag, context, provider } = await fixture(t);
  const bytes = new TextEncoder().encode("%PDF-close-race");
  const started = await initiateResumableTicketAttachmentUpload(
    db.env, 1, ticket.id, owner,
    { name: "close.pdf", mimeType: "application/pdf", size: bytes.byteLength, contentHash: await dropboxContentHashHex(bytes) },
  );
  await executeTicketTransition(db.env, 1, ticket.id, owner, {
    status: "closed",
    closure: {
      outcomeCode: "answered",
      summary: "Atendimento encerrado durante upload",
      evidence: "Teste CC-06 de fechamento concorrente",
      communication: "Encerramento de fixture",
      pendingChangeAcknowledged: true,
    },
  }, new Request("https://cc06.test/tickets/close", { method: "POST", headers: { "If-Match": etag } }));
  const closedContext = await resolveTicketConversationContext(db.env, 1, ticket.id, owner);
  await assert.rejects(
    uploadTicketAttachmentSessionChunk(db.env, closedContext, started.upload.sessionId, owner, uploadRequest(0, started.upload.etag, bytes)),
    { code: "TICKET_CLOSED" },
  );
  assert.equal(provider.session.offset, 0);
});

test("revoking ticket.comment blocks the next resumable operation", async (t) => {
  const { db, ticket } = await fixture(t);
  db.sqlite.exec(`INSERT OR IGNORE INTO role_permissions(role,permission,scope_type,active)
    VALUES ('viewer','ticket.view','organization',1),('viewer','ticket.comment','organization',1)`);
  let viewerContext = await resolveTicketConversationContext(db.env, 1, ticket.id, viewer);
  assert.equal(viewerContext.ticketComment, true);
  const bytes = new TextEncoder().encode("%PDF-revocation");
  const started = await initiateResumableTicketAttachmentUpload(
    db.env, 1, ticket.id, viewer,
    { name: "revocation.pdf", mimeType: "application/pdf", size: bytes.byteLength, contentHash: await dropboxContentHashHex(bytes) },
  );
  db.sqlite.prepare("DELETE FROM role_permissions WHERE role='viewer' AND permission='ticket.comment' AND scope_type='organization'").run();
  viewerContext = await resolveTicketConversationContext(db.env, 1, ticket.id, viewer);
  assert.equal(viewerContext.ticketComment, false);
  await assert.rejects(
    getTicketAttachmentUploadSession(db.env, viewerContext, started.upload.sessionId),
    { status: 403, code: "ATTACHMENT_UPLOAD_FORBIDDEN" },
  );
});

test("internal draft upload becomes unreadable when the draft is discarded", async (t) => {
  const { db, ticket, context } = await fixture(t);
  assert.equal(context.noteCreate, true);
  db.sqlite.prepare(`INSERT INTO ticket_drafts
    (id,organization_id,ticket_id,user_id,audience,body,version,state,created_at,updated_at)
    VALUES('cc06-internal-draft',1,?,1,'internal','private upload',1,'active','2026-09-27T00:00:00.000Z','2026-09-27T00:00:00.000Z')`).run(ticket.id);
  const bytes = new TextEncoder().encode("%PDF-internal-draft");
  const started = await initiateResumableTicketAttachmentUpload(
    db.env, 1, ticket.id, owner,
    { name: "internal.pdf", mimeType: "application/pdf", size: bytes.byteLength, contentHash: await dropboxContentHashHex(bytes) },
    { draft: { id: "cc06-internal-draft", audience: "internal" } },
  );
  const before = await getTicketAttachmentUploadSession(db.env, context, started.upload.sessionId);
  assert.equal(before.targetAudience, "internal");
  assert.equal(before.draftId, "cc06-internal-draft");
  db.sqlite.prepare(`UPDATE ticket_drafts SET state='discarded', version=version+1, updated_at='2026-09-27T00:00:01.000Z'
    WHERE id='cc06-internal-draft'`).run();
  await assert.rejects(
    getTicketAttachmentUploadSession(db.env, context, started.upload.sessionId),
    { status: 404, code: "ATTACHMENT_UPLOAD_NOT_FOUND" },
  );
});

test("cancel is explicit, terminal and releases the live-session list", async (t) => {
  const { db, ticket, context } = await fixture(t);
  const bytes = new TextEncoder().encode("%PDF-cancel");
  const started = await initiateResumableTicketAttachmentUpload(
    db.env, 1, ticket.id, owner,
    { name: "cancel.pdf", mimeType: "application/pdf", size: bytes.byteLength, contentHash: await dropboxContentHashHex(bytes) },
  );
  assert.equal((await listTicketAttachmentUploadSessions(db.env, context)).length, 1);
  await cancelTicketAttachmentUpload(db.env, context, started.upload.sessionId);
  assert.equal((await listTicketAttachmentUploadSessions(db.env, context)).length, 0);
  assert.equal(db.sqlite.prepare("SELECT state FROM ticket_attachment_upload_sessions WHERE id=?").get(started.upload.sessionId).state, "CANCELLED");
  assert.equal(db.sqlite.prepare("SELECT status FROM ticket_attachments WHERE upload_session_id=?").get(started.upload.sessionId).status, "FAILED");
});
