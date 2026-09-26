import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { executeTicketCreate } from "../functions/_lib/ticket-commands.js";
import {
  assertConversationAttachmentRead,
  createTicketDraft,
  createTicketMessage,
  editTicketMessage,
  getTicketConversationCapability,
  listTicketDrafts,
  listTicketMessageRevisions,
  listTicketMessages,
  readTicketConversationBundle,
  resolveTicketConversationContext,
  updateTicketDraft,
} from "../functions/_lib/ticket-conversations.js";
import { listTicketAttachments } from "../functions/_lib/ticket-center.js";
import { createTicketCommandDb, COMMAND_ACTORS } from "./helpers/ticket-command-db.mjs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const { owner, viewer } = COMMAND_ACTORS;
const createPayload = () => ({
  subject: "Conversa CC-05",
  description: "Chamado para validar conversa",
  category: "support",
  priority: "normal",
  assignedTo: 2,
  demandNature: "question_request",
  expectedResult: "Resposta registrada",
  context: "Teste",
  impact: "team",
  urgency: "soon",
  priorityReason: "",
  triageAnswers: {},
  triageFormVersion: 1,
});
function commandRequest(key) {
  return new Request("https://cc05.test/tickets", {
    method: "POST",
    headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
  });
}
function markCommandReady(db) {
  db.sqlite.exec(`
    INSERT INTO ticket_command_backfills
      (organization_id,status,schema_version,source_count,canonical_count,pending_count,skipped_count,last_legacy_id,completed_at,updated_at,last_run_id)
    VALUES
      (1,'ready',1,0,0,0,0,NULL,'2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z','cc05-local'),
      (2,'ready',1,0,0,0,0,NULL,'2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z','cc05-local');
  `);
}
async function fixture(t) {
  const db = await createTicketCommandDb(t, { marker: false });
  markCommandReady(db);
  db.sqlite.exec(source("../migrations/0028_ticket_conversations.sql"));
  db.env.MAONO_TICKET_CONVERSATIONS_ENABLED = "true";
  db.sqlite.exec(`
    INSERT OR IGNORE INTO role_permissions(role, permission, scope_type, active)
      VALUES ('viewer', 'ticket.view', 'organization', 1),
             ('viewer', 'ticket.comment', 'organization', 1);
  `);
  const created = await executeTicketCreate(db.env, 1, owner, createPayload(), commandRequest("cc05-ticket-create"));
  return { db, ticket: created.ticket };
}
function messageRequest(key, etag = null) {
  const headers = new Headers({ "Idempotency-Key": key, "Content-Type": "application/json" });
  if (etag) headers.set("If-Match", etag);
  return new Request("https://cc05.test/message", { method: etag ? "PATCH" : "POST", headers });
}

// The integration tests use the literal migration and the same D1 SQL adapter
// used by the CC-03 command tests. No query-pattern mocks are involved.
test("CC-05 capability requires the flag and the complete 0028 schema", async (t) => {
  const db = await createTicketCommandDb(t, { marker: false });
  markCommandReady(db);
  db.env.MAONO_TICKET_CONVERSATIONS_ENABLED = "true";
  assert.deepEqual(await getTicketConversationCapability(db.env), {
    configured: true,
    schemaReady: false,
    enabled: false,
  });
  db.sqlite.exec(source("../migrations/0028_ticket_conversations.sql"));
  assert.deepEqual(await getTicketConversationCapability(db.env), {
    configured: true,
    schemaReady: true,
    enabled: true,
  });
});

test("CC-05 creates public and internal messages atomically and keeps internal content out of receipts/audit", async (t) => {
  const { db, ticket } = await fixture(t);
  const context = await resolveTicketConversationContext(db.env, 1, ticket.id, owner);
  assert.equal(context.noteView, true);
  assert.equal(context.noteCreate, true);
  assert.equal(context.ticketComment, true);

  const response = await createTicketMessage(
    db.env,
    context,
    { kind: "response", body: "Resposta pública" },
    messageRequest("public-message-1"),
  );
  assert.equal(response.replayed, false);
  assert.equal(response.message.audience, "ticket");
  assert.equal(db.rows("ticket_message_revisions").length, 1);

  let draft = await createTicketDraft(db.env, context, { kind: "internal", body: "" });
  draft = await updateTicketDraft(db.env, context, draft.id, { body: "Nota interna secreta" }, draft.etag);
  db.sqlite.prepare(`INSERT INTO ticket_attachments
    (organization_id, ticket_id, original_name, stored_name, storage_key, mime_type, size_bytes, sha256,
     status, uploaded_by, dropbox_file_id, dropbox_rev, error_message, deleted_at, created_at, updated_at,
     audience, message_id, draft_id)
    VALUES (1, ?, 'segredo.txt', 'segredo.txt', '/test/segredo.txt', 'text/plain', 12, NULL,
      'ACTIVE', 1, 'file', 'rev', NULL, NULL, '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z',
      'draft', NULL, ?)`)
    .run(ticket.id, draft.id);
  const attachmentId = Number(db.sqlite.prepare("SELECT last_insert_rowid() AS id").get().id);

  const internal = await createTicketMessage(
    db.env,
    context,
    {
      kind: "internal",
      body: draft.body,
      draftId: draft.id,
      draftVersion: draft.version,
      attachmentIds: [attachmentId],
    },
    messageRequest("internal-message-1"),
  );
  assert.equal(internal.message.audience, "internal");
  assert.equal(internal.message.attachments.length, 1);
  assert.equal(db.sqlite.prepare("SELECT state FROM ticket_drafts WHERE id = ?").get(draft.id).state, "sent");
  const linked = db.sqlite.prepare("SELECT audience, message_id, draft_id FROM ticket_attachments WHERE id = ?").get(attachmentId);
  assert.equal(linked.audience, "internal");
  assert.equal(linked.message_id, internal.message.id);
  assert.equal(linked.draft_id, null);
  const event = db.sqlite.prepare("SELECT * FROM ticket_events WHERE message_id = ?").get(internal.message.id);
  assert.equal(event.audience, "internal");
  assert.equal(event.event_type, "ticket.note.created");
  const receipt = db.sqlite.prepare("SELECT result_json, request_hash FROM ticket_commands WHERE operation = 'ticket.message.created' AND idempotency_key = 'internal-message-1'").get();
  assert.equal(receipt.result_json.includes("Nota interna secreta"), false);
  assert.equal(receipt.request_hash.includes("Nota interna secreta"), false);
  const audit = db.sqlite.prepare("SELECT details FROM audit_logs WHERE action = 'ticket.note.created'").get();
  assert.equal(audit.details.includes("Nota interna secreta"), false);
  assert.equal(audit.details.includes("segredo.txt"), false);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS total FROM ticket_command_outbox WHERE event_type = 'ticket.note.created'").get().total, 1);
});

test("CC-05 reauthorizes reads: viewer can see the public response but not notes, internal attachment or draft", async (t) => {
  const { db, ticket } = await fixture(t);
  const ownerContext = await resolveTicketConversationContext(db.env, 1, ticket.id, owner);
  await createTicketMessage(db.env, ownerContext, { kind: "response", body: "Visível" }, messageRequest("read-public"));
  const draft = await createTicketDraft(db.env, ownerContext, { kind: "internal", body: "Rascunho privado" });
  db.sqlite.prepare(`INSERT INTO ticket_attachments
    (organization_id, ticket_id, original_name, stored_name, storage_key, mime_type, size_bytes, status,
     uploaded_by, created_at, updated_at, audience, message_id, draft_id)
    VALUES (1, ?, 'interno.txt', 'interno.txt', '/x', 'text/plain', 1, 'ACTIVE', 1,
      '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 'draft', NULL, ?)`)
    .run(ticket.id, draft.id);
  const attachmentId = Number(db.sqlite.prepare("SELECT last_insert_rowid() AS id").get().id);
  const internal = await createTicketMessage(db.env, ownerContext, {
    kind: "internal", body: draft.body, draftId: draft.id, draftVersion: draft.version, attachmentIds: [attachmentId],
  }, messageRequest("read-internal"));

  const viewerContext = await resolveTicketConversationContext(db.env, 1, ticket.id, viewer);
  assert.equal(viewerContext.ticketView, true);
  assert.equal(viewerContext.noteView, false);
  assert.equal(viewerContext.noteCreate, false);
  const page = await listTicketMessages(db.env, viewerContext);
  assert.deepEqual(page.messages.map((message) => message.body), ["Visível"]);
  assert.deepEqual(await listTicketDrafts(db.env, viewerContext), []);
  const generalAttachments = await listTicketAttachments(db.env, 1, ticket.id, { canViewInternal: false });
  assert.equal(generalAttachments.length, 0);
  const attachment = db.sqlite.prepare("SELECT * FROM ticket_attachments WHERE message_id = ?").get(internal.message.id);
  await assert.rejects(assertConversationAttachmentRead(db.env, viewerContext, attachment), { status: 404 });
});

test("CC-05 idempotency, edit history and draft CAS fail closed without duplicate side effects", async (t) => {
  const { db, ticket } = await fixture(t);
  const context = await resolveTicketConversationContext(db.env, 1, ticket.id, owner);
  const request = messageRequest("same-send");
  const first = await createTicketMessage(db.env, context, { kind: "response", body: "Primeira" }, request);
  const snapshot = db.snapshot();
  const replay = await createTicketMessage(db.env, context, { kind: "response", body: "Primeira" }, messageRequest("same-send"));
  assert.equal(replay.replayed, true);
  assert.equal(replay.message.id, first.message.id);
  assert.deepEqual(db.snapshot(), snapshot);
  await assert.rejects(
    createTicketMessage(db.env, context, { kind: "response", body: "Conteúdo diferente" }, messageRequest("same-send")),
    { status: 409, code: "TICKET_CONVERSATION_IDEMPOTENCY_KEY_REUSED" },
  );

  const edited = await editTicketMessage(
    db.env,
    context,
    first.message.id,
    { body: "Primeira corrigida", reason: "Corrigir informação" },
    messageRequest("edit-one", first.message.etag),
  );
  assert.equal(edited.message.version, 2);
  assert.equal(edited.message.body, "Primeira corrigida");
  const revisions = await listTicketMessageRevisions(db.env, context, first.message.id);
  assert.deepEqual(revisions.map(({ version, body }) => ({ version, body })), [
    { version: 1, body: "Primeira" },
    { version: 2, body: "Primeira corrigida" },
  ]);

  const draft = await createTicketDraft(db.env, context, { kind: "response", body: "v1" });
  const saved = await updateTicketDraft(db.env, context, draft.id, { body: "v2" }, draft.etag);
  assert.equal(saved.version, draft.version + 1);
  await assert.rejects(updateTicketDraft(db.env, context, draft.id, { body: "stale" }, draft.etag), { status: 412 });
});

test("CC-05 flag OFF hides the composer/bundle but confidentiality filters remain enforceable", async (t) => {
  const { db, ticket } = await fixture(t);
  const context = await resolveTicketConversationContext(db.env, 1, ticket.id, owner);
  const draft = await createTicketDraft(db.env, context, { kind: "internal", body: "Persistida" });
  await createTicketMessage(db.env, context, { kind: "internal", body: draft.body, draftId: draft.id, draftVersion: draft.version }, messageRequest("off-note"));
  db.env.MAONO_TICKET_CONVERSATIONS_ENABLED = "false";
  const viewerContext = await resolveTicketConversationContext(db.env, 1, ticket.id, viewer);
  const bundle = await readTicketConversationBundle(db.env, viewerContext);
  assert.equal(bundle.enabled, false);
  assert.deepEqual(bundle.messages, []);
  assert.equal(bundle.permissions.noteView, false);
});
