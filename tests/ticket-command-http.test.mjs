import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet as list, onRequestPost as create } from "../functions/api/organizations/[id]/tickets.js";
import { onRequestGet as detail, onRequestPatch as update } from "../functions/api/organizations/[id]/tickets/[ticketId].js";
import { onRequest as state } from "../functions/api/organizations/[id]/tickets/[ticketId]/state.js";
import { onRequest as transition } from "../functions/api/organizations/[id]/tickets/[ticketId]/transitions.js";
import { onRequest as correction } from "../functions/api/organizations/[id]/tickets/[ticketId]/events/[eventId]/corrections.js";
import { createTicketCommandDb } from "./helpers/ticket-command-db.mjs";

const payload = () => ({ subject: "Atendimento via API", description: "Contexto HTTP", category: "map", priority: "normal",
  assignedTo: 2, demandNature: "question_request", expectedResult: "Dúvida esclarecida", context: "Operação",
  impact: "team", urgency: "soon", priorityReason: "", triageAnswers: {}, triageFormVersion: 1 });
function context(db, cookie, { method = "GET", ticketId, organizationId = 1, body, headers = {}, eventId, path = "" } = {}) {
  return { env: db.env, params: { id: String(organizationId), ticketId: String(ticketId), eventId: String(eventId) },
    request: new Request(`https://cc03.test/api/organizations/${organizationId}/tickets${ticketId ? `/${ticketId}` : ""}${path}`, {
      method, headers: { Cookie: cookie, "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) };
}
async function created(db, cookie, key = "http-create") {
  const response = await create(context(db, cookie, { method: "POST", body: payload(), headers: { "Idempotency-Key": key } }));
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).ticket;
}

test("HTTP create requires a key and persists one success audit through replay", async (t) => {
  const db = await createTicketCommandDb(t);
  const cookie = db.sessionCookie();
  const before = db.snapshot();
  const invalid = await create(context(db, cookie, { method: "POST", body: payload() }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(db.snapshot(), before);
  const first = await created(db, cookie);
  const committed = db.snapshot();
  const replay = await create(context(db, cookie, { method: "POST", body: payload(), headers: { "Idempotency-Key": "http-create" } }));
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("Idempotency-Replayed"), "true");
  assert.deepEqual((await replay.json()).ticket, first);
  assert.deepEqual(db.snapshot(), committed);
  assert.equal(db.rows("audit_logs").filter((row) => row.action.startsWith("ticket.")).length, 1);
});

test("HTTP state owns its ETag; list, detail and state GET perform no DML after cutover", async (t) => {
  const db = await createTicketCommandDb(t);
  const cookie = db.sessionCookie();
  const ticket = await created(db, cookie);
  const before = db.snapshot();
  const start = db.statements.length;
  const responses = await Promise.all([
    list(context(db, cookie)), detail(context(db, cookie, { ticketId: ticket.id })),
    state(context(db, cookie, { ticketId: ticket.id, path: "/state" })),
  ]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  assert.equal(responses[0].headers.get("ETag"), null);
  assert.equal(responses[1].headers.get("ETag"), null);
  const tag = responses[2].headers.get("ETag");
  assert.match(tag, /^"[^"\r\n]+"$/);
  assert.equal(responses[2].headers.get("Cache-Control"), "private, no-store");
  assert.equal(responses[2].headers.get("Content-Location"), `/api/organizations/1/tickets/${ticket.id}/state`);
  assert.deepEqual(db.snapshot(), before);
  assert.equal(db.statements.slice(start).filter(({ sql }) => /\b(?:INSERT|UPDATE|DELETE|REPLACE)\s/i.test(sql)).length, 0);
  // User-name changes enrich detail, but do not change the canonical Ticket resource.
  db.sqlite.exec("UPDATE users SET name = 'Nome atualizado' WHERE id = 2");
  const again = await state(context(db, cookie, { ticketId: ticket.id, path: "/state" }));
  assert.equal(again.headers.get("ETag"), tag);
});

test("HTTP retry after disabling commands cannot fall through to non-idempotent legacy creation", async (t) => {
  const db = await createTicketCommandDb(t);
  const cookie = db.sessionCookie();
  await created(db, cookie, "lost-response-before-disable");
  db.env.MAONO_TICKET_COMMANDS_ENABLED = "false";
  const before = db.snapshot();
  const retry = await create(context(db, cookie, { method: "POST", body: payload(), headers: { "Idempotency-Key": "lost-response-before-disable" } }));
  assert.equal(retry.status, 503);
  assert.deepEqual(db.snapshot(), before);
});

test("HTTP mutation rejects missing and stale validators with no successful audit or side effects", async (t) => {
  const db = await createTicketCommandDb(t);
  const cookie = db.sessionCookie();
  const ticket = await created(db, cookie);
  const read = await state(context(db, cookie, { ticketId: ticket.id, path: "/state" }));
  const tag = read.headers.get("ETag");
  const before = db.snapshot();
  const missing = await update(context(db, cookie, { method: "PATCH", ticketId: ticket.id, body: { subject: "Sem condição" } }));
  assert.equal(missing.status, 428);
  assert.deepEqual(db.snapshot(), before);
  const accepted = await update(context(db, cookie, { method: "PATCH", ticketId: ticket.id, body: { subject: "Alteração aceita" }, headers: { "If-Match": tag } }));
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const committed = db.snapshot();
  const stale = await transition(context(db, cookie, { method: "POST", ticketId: ticket.id, path: "/transitions", body: { status: "open", nextAction: "Atender" }, headers: { "If-Match": tag } }));
  assert.equal(stale.status, 412);
  assert.deepEqual(db.snapshot(), committed);
  assert.equal(db.rows("audit_logs").filter((row) => row.action.startsWith("ticket.")).length, 2);
});

test("HTTP GET fails closed on a new legacy source row without importing it", async (t) => {
  const db = await createTicketCommandDb(t);
  const cookie = db.sessionCookie();
  const ticket = await created(db, cookie);
  db.createLegacySource();
  db.sqlite.exec("INSERT INTO tickets (id, organization_id, subject, status, category, created_by) VALUES (99, 1, 'Ainda não conciliado', 'open', 'map', 1)");
  const before = db.snapshot();
  for (const route of [list, detail, state]) {
    const response = await route(context(db, cookie, { ticketId: ticket.id }));
    assert.equal(response.status, 503);
  }
  assert.deepEqual(db.snapshot(), before);
});

test("HTTP authorization denies cross-organization reads and viewer commands before mutation", async (t) => {
  const db = await createTicketCommandDb(t);
  const owner = db.sessionCookie();
  const ticket = await created(db, owner);
  const outsider = db.sessionCookie(4, 2);
  const deniedRead = await state(context(db, outsider, { ticketId: ticket.id, path: "/state" }));
  assert.equal(deniedRead.status, 403);
  const viewer = db.sessionCookie(3, 1);
  const beforeTickets = db.rows("organization_tickets");
  const events = db.rows("ticket_events");
  const deniedWrite = await transition(context(db, viewer, { method: "POST", ticketId: ticket.id, body: { status: "closed" }, headers: { "If-Match": ticket.etag } }));
  assert.equal(deniedWrite.status, 403);
  assert.deepEqual(db.rows("organization_tickets"), beforeTickets);
  assert.deepEqual(db.rows("ticket_events"), events);
  assert.equal(db.rows("ticket_commands").length, 1);
  // Security-denial logs are intentionally independent of successful command audit.
});

test("HTTP correction scopes the event from the route and preserves the original event", async (t) => {
  const db = await createTicketCommandDb(t);
  const cookie = db.sessionCookie();
  const ticket = await created(db, cookie);
  const original = db.rows("ticket_events")[0];
  const response = await correction(context(db, cookie, { method: "POST", ticketId: ticket.id, eventId: original.id,
    body: { eventId: 999999, reason: "Esclarecer registro", correction: "Contexto corrigido, sem apagar o registro original" },
    headers: { "If-Match": ticket.etag } }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(db.rows("ticket_events")[0], original);
  assert.equal(db.rows("ticket_events").at(-1).corrects_event_id, original.id);
  const unsupported = await state(context(db, cookie, { method: "DELETE", ticketId: ticket.id }));
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Allow"), "GET");
});
