import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { executeTicketCreate } from "../functions/_lib/ticket-commands.js";
import { onRequestGet as ticketDetail } from "../functions/api/organizations/[id]/tickets/[ticketId].js";
import { onRequestGet as ticketList } from "../functions/api/organizations/[id]/tickets.js";
import { onRequestGet as messageList, onRequestPost as messageCreate } from "../functions/api/organizations/[id]/tickets/[ticketId]/messages.js";
import { onRequestPost as draftCreate } from "../functions/api/organizations/[id]/tickets/[ticketId]/drafts.js";
import { createTicketCommandDb, COMMAND_ACTORS } from "./helpers/ticket-command-db.mjs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const { owner } = COMMAND_ACTORS;

function markCommandReady(db) {
  db.sqlite.exec(`
    INSERT INTO ticket_command_backfills
      (organization_id,status,schema_version,source_count,canonical_count,pending_count,skipped_count,last_legacy_id,completed_at,updated_at,last_run_id)
    VALUES
      (1,'ready',1,0,0,0,0,NULL,'2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z','cc05-http'),
      (2,'ready',1,0,0,0,0,NULL,'2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z','cc05-http');
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
  const request = new Request("https://cc05.test/create", {
    method: "POST",
    headers: { "Idempotency-Key": "cc05-http-ticket", "Content-Type": "application/json" },
  });
  const created = await executeTicketCreate(db.env, 1, owner, {
    subject: "HTTP CC-05", description: "Validação das rotas", category: "support", priority: "normal",
    assignedTo: 2, demandNature: "question_request", expectedResult: "Conversa funcional", context: "HTTP",
    impact: "team", urgency: "soon", priorityReason: "", triageAnswers: {}, triageFormVersion: 1,
  }, request);
  return { db, ticket: created.ticket };
}

function routeContext(db, cookie, ticketId, {
  method = "GET", body, headers = {}, query = "", path = "",
} = {}) {
  return {
    env: db.env,
    params: { id: "1", ticketId: String(ticketId) },
    request: new Request(`https://cc05.test/api/organizations/1/tickets/${ticketId}${path}${query}`, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  };
}

test("CC-05 HTTP detail and message endpoints expose public/internal content according to current grants", async (t) => {
  const { db, ticket } = await fixture(t);
  const ownerCookie = db.sessionCookie(1, 1);
  const viewerCookie = db.sessionCookie(3, 1);

  const publicResponse = await messageCreate(routeContext(db, ownerCookie, ticket.id, {
    method: "POST", body: { kind: "response", body: "Resposta HTTP pública" },
    headers: { "Idempotency-Key": "cc05-http-public" }, path: "/messages",
  }));
  assert.equal(publicResponse.status, 201, await publicResponse.clone().text());

  const internalResponse = await messageCreate(routeContext(db, ownerCookie, ticket.id, {
    method: "POST", body: { kind: "internal", body: "Nota HTTP confidencial" },
    headers: { "Idempotency-Key": "cc05-http-internal" }, path: "/messages",
  }));
  assert.equal(internalResponse.status, 201, await internalResponse.clone().text());

  const ownerDetailResponse = await ticketDetail(routeContext(db, ownerCookie, ticket.id));
  assert.equal(ownerDetailResponse.status, 200, await ownerDetailResponse.clone().text());
  const ownerDetail = await ownerDetailResponse.json();
  assert.equal(ownerDetail.conversation.enabled, true);
  assert.equal(ownerDetail.conversation.permissions.noteView, true);
  assert.deepEqual(ownerDetail.conversation.messages.map((message) => message.body), ["Resposta HTTP pública", "Nota HTTP confidencial"]);

  const viewerDetailResponse = await ticketDetail(routeContext(db, viewerCookie, ticket.id));
  assert.equal(viewerDetailResponse.status, 200, await viewerDetailResponse.clone().text());
  const viewerDetail = await viewerDetailResponse.json();
  assert.equal(viewerDetail.conversation.permissions.noteView, false);
  assert.deepEqual(viewerDetail.conversation.messages.map((message) => message.body), ["Resposta HTTP pública"]);
  assert.equal(viewerDetail.events.some((event) => event.type === "ticket.note.created"), false);

  const viewerMessagesResponse = await messageList(routeContext(db, viewerCookie, ticket.id, { path: "/messages" }));
  assert.equal(viewerMessagesResponse.status, 200, await viewerMessagesResponse.clone().text());
  const viewerMessages = await viewerMessagesResponse.json();
  assert.deepEqual(viewerMessages.messages.map((message) => message.body), ["Resposta HTTP pública"]);

  const deniedNote = await messageCreate(routeContext(db, viewerCookie, ticket.id, {
    method: "POST", body: { kind: "internal", body: "Tentativa indevida" },
    headers: { "Idempotency-Key": "cc05-http-denied-note" }, path: "/messages",
  }));
  assert.equal(deniedNote.status, 403);
});

test("CC-05 HTTP drafts are server-side, own-user scoped and list counters do not leak internal attachments", async (t) => {
  const { db, ticket } = await fixture(t);
  const ownerCookie = db.sessionCookie(1, 1);
  const viewerCookie = db.sessionCookie(3, 1);

  const createdDraftResponse = await draftCreate(routeContext(db, ownerCookie, ticket.id, {
    method: "POST", body: { kind: "internal", body: "Rascunho só do operador" }, path: "/drafts",
  }));
  assert.equal(createdDraftResponse.status, 201, await createdDraftResponse.clone().text());
  const createdDraft = (await createdDraftResponse.json()).draft;
  assert.match(createdDraft.etag, /^"cc05:/);

  db.sqlite.prepare(`INSERT INTO ticket_attachments
    (organization_id,ticket_id,original_name,stored_name,storage_key,mime_type,size_bytes,status,uploaded_by,created_at,updated_at,audience,message_id,draft_id)
    VALUES (1,?,'privado.txt','privado.txt','/private','text/plain',3,'ACTIVE',1,'2026-09-26T00:00:00Z','2026-09-26T00:00:00Z','draft',NULL,?)`)
    .run(ticket.id, createdDraft.id);

  const viewerListResponse = await ticketList({
    env: db.env,
    params: { id: "1" },
    request: new Request("https://cc05.test/api/organizations/1/tickets", { headers: { Cookie: viewerCookie } }),
  });
  assert.equal(viewerListResponse.status, 200, await viewerListResponse.clone().text());
  const viewerList = await viewerListResponse.json();
  assert.equal(viewerList.tickets.find((item) => String(item.id) === String(ticket.id)).attachmentsCount, 0);

  const viewerDetailResponse = await ticketDetail(routeContext(db, viewerCookie, ticket.id));
  const viewerDetail = await viewerDetailResponse.json();
  assert.deepEqual(viewerDetail.conversation.drafts, []);
  assert.deepEqual(viewerDetail.attachments, []);
});
