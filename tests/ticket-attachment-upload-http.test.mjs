import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { executeTicketCreate } from "../functions/_lib/ticket-commands.js";
import { onRequestPost as attachmentPost } from "../functions/api/organizations/[id]/tickets/[ticketId]/attachments.js";
import { onRequestPatch as legacyAttachmentPatch } from "../functions/api/organizations/[id]/tickets/[ticketId]/attachments/[attachmentId].js";
import { onRequestGet as uploadList } from "../functions/api/organizations/[id]/tickets/[ticketId]/attachments/uploads.js";
import { onRequestHead as uploadHead } from "../functions/api/organizations/[id]/tickets/[ticketId]/attachments/uploads/[uploadId].js";
import { createTicketCommandDb, COMMAND_ACTORS } from "./helpers/ticket-command-db.mjs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const { owner } = COMMAND_ACTORS;

function markCommandReady(db) {
  db.sqlite.exec(`
    INSERT INTO ticket_command_backfills
      (organization_id,status,schema_version,source_count,canonical_count,pending_count,skipped_count,last_legacy_id,completed_at,updated_at,last_run_id)
    VALUES
      (1,'ready',1,0,0,0,0,NULL,'2026-09-27T00:00:00.000Z','2026-09-27T00:00:00.000Z','cc06-http');
  `);
}

async function fixture(t, { apply0029 = true, flag = true } = {}) {
  const db = await createTicketCommandDb(t, { marker: false });
  markCommandReady(db);
  db.sqlite.exec(source("../migrations/0028_ticket_conversations.sql"));
  if (apply0029) db.sqlite.exec(source("../migrations/0029_ticket_attachment_upload_sessions.sql"));
  db.env.MAONO_TICKET_CONVERSATIONS_ENABLED = "false";
  db.env.MAONO_TICKET_RESUMABLE_UPLOADS_ENABLED = flag ? "true" : "false";
  db.sqlite.exec(`UPDATE organizations SET storage_status='READY', storage_error=NULL,
    storage_checked_at='2026-09-27T00:00:00.000Z' WHERE id=1`);
  const created = await executeTicketCreate(db.env, 1, owner, {
    subject: "HTTP CC-06", description: "Rotas resumíveis", category: "support", priority: "normal",
  }, new Request("https://cc06.test/create", { method: "POST", headers: { "Idempotency-Key": "cc06-http-ticket" } }));
  return { db, ticket: created.ticket, cookie: db.sessionCookie(1, 1) };
}

function ctx(db, cookie, ticketId, { method = "GET", path = "", body, headers = {}, extraParams = {} } = {}) {
  return {
    env: db.env,
    params: { id: "1", ticketId: String(ticketId), ...extraParams },
    request: new Request(`https://cc06.test/api/organizations/1/tickets/${ticketId}/attachments${path}`, {
      method,
      headers: { Cookie: cookie, ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  };
}

function insertSession(db, ticketId, { id = "tau_http_session", userId = 1, offset = 0, version = 2 } = {}) {
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const storageKey = `/projects/org/tickets/${ticketId}/attachments/http.pdf`;
  db.sqlite.prepare(`INSERT INTO ticket_attachment_upload_sessions
    (id,organization_id,ticket_id,user_id,storage_key,expected_size,expected_content_hash,target_audience,draft_id,
     acknowledged_offset,version,state,idle_expires_at,hard_expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,12,?,'ticket',NULL,0,1,'RESERVED',?,?,?,?)`)
    .run(id, 1, ticketId, userId, storageKey, "a".repeat(64), now + 3_600_000, now + 86_400_000, createdAt, createdAt);
  db.sqlite.prepare(`INSERT INTO ticket_attachments
    (organization_id,ticket_id,original_name,stored_name,storage_key,mime_type,size_bytes,status,uploaded_by,created_at,updated_at,audience,upload_session_id)
    VALUES(?,?,?,?,?,'application/pdf',12,'PENDING',?,?,?,'ticket',?)`)
    .run(1, ticketId, "http.pdf", "http.pdf", storageKey, userId, createdAt, createdAt, id);
  db.sqlite.prepare(`UPDATE ticket_attachment_upload_sessions
    SET provider_session_id='provider-http', state='UPLOADING', version=version+1, acknowledged_offset=?, updated_at=? WHERE id=?`)
    .run(offset, createdAt, id);
  if (version > 2) {
    for (let current = 3; current <= version; current++) {
      db.sqlite.prepare(`UPDATE ticket_attachment_upload_sessions SET version=version+1, updated_at=? WHERE id=?`).run(createdAt, id);
    }
  }
  return db.sqlite.prepare("SELECT * FROM ticket_attachment_upload_sessions WHERE id=?").get(id);
}

test("CC-06 configured flag fails closed before 0029 instead of silently using legacy upload", async (t) => {
  const { db, ticket, cookie } = await fixture(t, { apply0029: false, flag: true });
  const response = await attachmentPost(ctx(db, cookie, ticket.id, {
    method: "POST",
    body: { name: "evidence.pdf", mimeType: "application/pdf", size: 12, contentHash: "a".repeat(64) },
  }));
  assert.equal(response.status, 503, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.code, "TICKET_RESUMABLE_UPLOADS_SCHEMA_OUTDATED");
});

test("CC-06 HEAD returns canonical offset/version and no-store, and list is owner scoped", async (t) => {
  const { db, ticket, cookie } = await fixture(t);
  const row = insertSession(db, ticket.id, { offset: 0 });

  const head = await uploadHead(ctx(db, cookie, ticket.id, {
    method: "HEAD", path: `/uploads/${row.id}`, extraParams: { uploadId: row.id },
  }));
  assert.equal(head.status, 204);
  assert.equal(head.headers.get("Cache-Control"), "private, no-store");
  assert.equal(head.headers.get("Upload-Offset"), "0");
  assert.equal(head.headers.get("Upload-Length"), "12");
  assert.match(head.headers.get("ETag") || "", /^"ticket-upload:/);
  assert.ok(head.headers.get("Upload-Expires"));

  const list = await uploadList(ctx(db, cookie, ticket.id, { path: "/uploads" }));
  assert.equal(list.status, 200, await list.clone().text());
  assert.equal(list.headers.get("Cache-Control"), "private, no-store");
  const payload = await list.json();
  assert.deepEqual(payload.sessions.map((session) => session.id), [row.id]);
});

test("CC-06 legacy attachment PATCH cannot bypass the dedicated resumable session endpoint", async (t) => {
  const { db, ticket, cookie } = await fixture(t);
  const row = insertSession(db, ticket.id);
  const attachment = db.sqlite.prepare("SELECT id FROM ticket_attachments WHERE upload_session_id=?").get(row.id);
  const response = await legacyAttachmentPatch(ctx(db, cookie, ticket.id, {
    method: "PATCH",
    path: `/${attachment.id}`,
    extraParams: { attachmentId: String(attachment.id) },
    headers: { "Content-Type": "application/octet-stream", "Upload-Offset": "0" },
  }));
  assert.equal(response.status, 409, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.code, "ATTACHMENT_UPLOAD_SESSION_ENDPOINT_REQUIRED");
});

test("CC-06 flag OFF preserves legacy path and does not expose upload-session API", async (t) => {
  const { db, ticket, cookie } = await fixture(t, { apply0029: true, flag: false });
  insertSession(db, ticket.id);
  const list = await uploadList(ctx(db, cookie, ticket.id, { path: "/uploads" }));
  assert.equal(list.status, 503);
  const payload = await list.json();
  assert.equal(payload.code, "TICKET_RESUMABLE_UPLOADS_DISABLED");
});
