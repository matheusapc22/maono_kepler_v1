import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  executeTicketCreate, executeTicketUpdate, executeTicketTransition,
  executeTicketWait, executeTicketReopen, executeTicketEventCorrection,
  readTicketCommandState,
} from "../functions/_lib/ticket-commands.js";
import { createTicket, updateTicket } from "../functions/_lib/ticket-center.js";
import { submitProjectChangeRequest } from "../functions/_lib/project-change-requests.js";
import { submitAnalysisAwareProjectChangeRequest } from "../functions/_lib/project-change-request-analysis-submission.js";
import { COMMAND_ACTORS, createTicketCommandDb } from "./helpers/ticket-command-db.mjs";

const { owner, peer, viewer, otherOwner } = COMMAND_ACTORS;
const createPayload = () => ({
  subject: "Solicitação acompanhada", description: "Contexto para atendimento",
  category: "map", priority: "normal", assignedTo: peer.id,
  demandNature: "question_request", expectedResult: "Dúvida esclarecida",
  context: "Equipe de operação", impact: "team", urgency: "soon",
  priorityReason: "", triageAnswers: {}, triageFormVersion: 1,
});
function request({ key, etag, method = "POST", cookie } = {}) {
  const headers = {};
  if (key !== undefined) headers["Idempotency-Key"] = key;
  if (etag !== undefined) headers["If-Match"] = etag;
  if (cookie) headers.Cookie = cookie;
  return new Request("https://cc03.test/api/organizations/1/tickets", { method, headers });
}
async function create(db, { payload = createPayload(), actor = owner, organizationId = 1, key = randomUUID() } = {}) {
  return executeTicketCreate(db.env, organizationId, actor, payload, request({ key }));
}
async function transition(db, current, status, extras = {}) {
  return executeTicketTransition(db.env, 1, current.ticket.id, owner, {
    status, nextAction: "Continuar atendimento", ...extras,
  }, request({ etag: current.etag }));
}
const closure = () => ({
  outcomeCode: "answered", summary: "Dúvida esclarecida e atendimento concluído",
  evidence: "Registro do esclarecimento enviado", communication: "Resposta comunicada ao solicitante",
  pendingChangeAcknowledged: true,
});
async function openTicket(db) { return transition(db, await create(db), "open"); }
async function progressTicket(db) { return transition(db, await openTicket(db), "in_progress"); }
async function ticketAtStatus(db, status) {
  if (status === "new") return create(db);
  if (status === "open") return openTicket(db);
  if (status === "in_progress") return progressTicket(db);
  if (status === "in_review") return transition(db, await progressTicket(db), "in_review", { evidence: "Pronto para conferência" });
  return transition(db, await create(db), "closed", { closure: closure() });
}

test("CT-07: create replay returns its persisted result after later edits, without duplicating durable records", async (t) => {
  const db = await createTicketCommandDb(t);
  const payload = createPayload();
  const key = "create-replay-persisted";
  const first = await create(db, { payload, key });
  const afterCreate = db.snapshot();
  const immediate = await create(db, { payload, key });
  assert.equal(immediate.replayed, true);
  assert.deepEqual(immediate.ticket, first.ticket);
  assert.deepEqual(immediate.state, first.state);
  assert.equal(immediate.etag, first.etag);
  assert.deepEqual(db.snapshot(), afterCreate);
  await executeTicketUpdate(db.env, 1, first.ticket.id, peer, { subject: "Assunto posteriormente alterado" }, request({ method: "PATCH", etag: first.etag }));
  const afterEdit = db.snapshot();
  const replay = await create(db, { payload, key });
  assert.deepEqual(replay.ticket, first.ticket);
  assert.deepEqual(replay.state, first.state);
  assert.equal(replay.etag, first.etag);
  assert.equal(replay.replayed, true);
  assert.deepEqual(db.snapshot(), afterEdit);
  assert.equal(db.row(first.ticket.id).subject, "Assunto posteriormente alterado");
  assert.equal(db.rows("organization_tickets").length, 1);
  assert.equal(db.rows("ticket_events").filter((row) => row.event_type === "ticket.created").length, 1);
});

test("CT-07: parallel retries with the same key persist one creation and return the same result", async (t) => {
  const db = await createTicketCommandDb(t);
  const options = { key: "parallel-create", payload: createPayload() };
  const [first, second] = await Promise.all([create(db, options), create(db, options)]);
  assert.equal(first.ticket.id, second.ticket.id);
  assert.deepEqual(first.ticket, second.ticket);
  assert.deepEqual(first.state, second.state);
  assert.equal(first.etag, second.etag);
  assert.equal([first, second].filter((result) => result.replayed).length, 1);
  assert.equal(db.rows("organization_tickets").length, 1);
  assert.equal(db.rows("ticket_commands").length, 1);
  assert.equal(db.rows("ticket_cycles").length, 1);
});

test("CT-08: a divergent payload conflicts within its key scope, while actors and tenants remain independent", async (t) => {
  const db = await createTicketCommandDb(t);
  const key = "shared-key-different-scopes";
  const payload = createPayload();
  const first = await create(db, { key, payload });
  const before = db.snapshot();
  await assert.rejects(create(db, { key, payload: { ...payload, description: "Outra intenção" } }), { status: 409 });
  assert.deepEqual(db.snapshot(), before);
  const otherActor = await create(db, { key, payload, actor: peer });
  const otherOrg = await create(db, { key, payload: { ...payload, assignedTo: otherOwner.id }, actor: { ...owner, activeOrganizationId: 2 }, organizationId: 2 });
  assert.notEqual(first.ticket.id, otherActor.ticket.id);
  assert.notEqual(first.ticket.id, otherOrg.ticket.id);
  assert.equal(db.row(otherOrg.ticket.id).organization_id, 2);
  const rows = db.rows("ticket_commands");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => [row.organization_id, row.actor_user_id]).sort(), [[1, 1], [1, 2], [2, 1]]);
});

test("creation requires an idempotency key before any persistent effect", async (t) => {
  const db = await createTicketCommandDb(t);
  const before = db.snapshot();
  await assert.rejects(executeTicketCreate(db.env, 1, owner, createPayload(), request()), { status: 400 });
  assert.deepEqual(db.snapshot(), before);
});

test("CT-09: absent, stale and foreign If-Match validators reject updates without events, audit or outbox", async (t) => {
  const db = await createTicketCommandDb(t);
  const first = await create(db);
  const second = await create(db);
  const before = db.snapshot();
  await assert.rejects(executeTicketUpdate(db.env, 1, first.ticket.id, owner, { subject: "Sem condição" }, request({ method: "PATCH" })), { status: 428 });
  await assert.rejects(executeTicketUpdate(db.env, 1, first.ticket.id, owner, { subject: "Outro ticket" }, request({ method: "PATCH", etag: second.etag })), { status: 412 });
  assert.deepEqual(db.snapshot(), before);
  const accepted = await executeTicketUpdate(db.env, 1, first.ticket.id, owner, { subject: "Atualização aceita" }, request({ method: "PATCH", etag: first.etag }));
  const afterAccepted = db.snapshot();
  assert.notEqual(accepted.etag, first.etag);
  assert.equal(db.row(first.ticket.id).version, before.organization_tickets[0].version + 1);
  await assert.rejects(executeTicketUpdate(db.env, 1, first.ticket.id, peer, { subject: "Reenvio obsoleto" }, request({ method: "PATCH", etag: first.etag })), { status: 412 });
  assert.deepEqual(db.snapshot(), afterAccepted);
});

test("CT-09: a competing command between server read and batch wins once; the losing CAS creates no records", async (t) => {
  const db = await createTicketCommandDb(t);
  const created = await create(db);
  let winner;
  let winnerSnapshot;
  db.beforeNextBatch(async () => {
    winner = await executeTicketUpdate(db.env, 1, created.ticket.id, peer, { context: "Escrita vencedora" }, request({ method: "PATCH", etag: created.etag }));
    winnerSnapshot = db.snapshot();
  });
  await assert.rejects(executeTicketUpdate(db.env, 1, created.ticket.id, owner, { subject: "Escrita perdedora" }, request({ method: "PATCH", etag: created.etag })), { status: 412 });
  assert.ok(winner);
  assert.equal(db.row(created.ticket.id).context, "Escrita vencedora");
  assert.equal(db.row(created.ticket.id).subject, createPayload().subject);
  assert.deepEqual(db.snapshot(), winnerSnapshot);
});

test("an isolated next-action edit uses CAS and records one command without changing status or triage", async (t) => {
  const db = await createTicketCommandDb(t);
  const created = await create(db);
  const before = db.row(created.ticket.id);
  const eventsBefore = db.rows("ticket_events").length;
  const result = await executeTicketUpdate(db.env, 1, created.ticket.id, peer, { nextAction: "Confirmar evidência com o solicitante" }, request({ method: "PATCH", etag: created.etag }));
  assert.equal(result.ticket.nextAction, "Confirmar evidência com o solicitante");
  assert.equal(db.row(created.ticket.id).status, before.status);
  assert.equal(db.row(created.ticket.id).triage_answers, before.triage_answers);
  assert.equal(db.row(created.ticket.id).version, before.version + 1);
  assert.equal(db.rows("ticket_events").length, eventsBefore + 1);
});

test("flag-off remains compatible with CC-02 on the schema before 0026", async (t) => {
  const db = await createTicketCommandDb(t, { commandsSchema: false, commandsEnabled: false, marker: false });
  const created = await createTicket(db.env, 1, owner, createPayload(), request());
  const updated = await updateTicket(db.env, 1, created.id, peer, { context: "Fluxo CC-02 preservado" }, request({ method: "PATCH" }));
  assert.equal(updated.context, "Fluxo CC-02 preservado");
  assert.equal(db.rows("organization_tickets").length, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'ticket_commands'").get().n, 0);
});

for (const missing of ["schema", "marker"]) {
  test(`flag-on fails closed with missing ${missing}, without compatibility writes`, async (t) => {
    const db = await createTicketCommandDb(t, { commandsSchema: missing !== "schema", marker: false });
    const before = db.snapshot();
    await assert.rejects(create(db), { status: 503 });
    assert.deepEqual(db.snapshot(), before);
  });
}

test("commands remain unavailable if the prerequisite triage flag is disabled", async (t) => {
  const db = await createTicketCommandDb(t, { triageEnabled: false });
  const before = db.snapshot();
  await assert.rejects(create(db), { status: 503 });
  assert.deepEqual(db.snapshot(), before);
});

for (const [label, sql] of [
  ["running", "status = 'running'"], ["failed", "status = 'failed'"],
  ["pending rows", "pending_count = 1"], ["skipped rows", "skipped_count = 1"],
  ["missing completion", "completed_at = NULL"],
]) {
  test(`a marker with ${label} cannot enable commands or trigger compatibility writes`, async (t) => {
    const db = await createTicketCommandDb(t);
    db.sqlite.exec(`UPDATE ticket_command_backfills SET ${sql} WHERE organization_id = 1`);
    const before = db.snapshot();
    await assert.rejects(create(db), { status: 503 });
    assert.deepEqual(db.snapshot(), before);
  });
}

test("a new eligible legacy row invalidates a ready marker until explicit backfill reconciles it", async (t) => {
  const db = await createTicketCommandDb(t);
  db.createLegacySource();
  db.sqlite.exec(`INSERT INTO tickets (id, organization_id, subject, description, status, category, created_by)
    VALUES (1, 1, 'Legado posterior', 'Ainda não conciliado', 'open', 'map', 1)`);
  const before = db.snapshot();
  await assert.rejects(create(db), { status: 503 });
  assert.deepEqual(db.snapshot(), before);
  const report = await db.ready(1);
  assert.equal(report.complete, true);
  assert.equal(report.pendingCount, 0);
  assert.equal(report.migrated, 1);
  const created = await create(db);
  assert.ok(created.ticket.id);
  assert.equal(db.rows("organization_tickets").length, 2);
});

test("CT-06: closure requires outcome, result and communication; reopening preserves the prior closed cycle", async (t) => {
  const db = await createTicketCommandDb(t);
  const created = await create(db);
  for (const invalidClosure of [undefined, { ...closure(), outcomeCode: "" }, { ...closure(), summary: "" }, { ...closure(), evidence: "" }, { ...closure(), communication: "" }]) {
    const before = db.snapshot();
    await assert.rejects(transition(db, created, "closed", { closure: invalidClosure }), { status: 400 });
    assert.deepEqual(db.snapshot(), before);
  }
  const closed = await transition(db, created, "closed", { closure: closure() });
  assert.equal(db.row(created.ticket.id).status, "closed");
  const firstCycle = db.rows("ticket_cycles").find((row) => row.ticket_id === created.ticket.id && row.cycle_number === 1);
  assert.ok(firstCycle.closed_at);
  assert.equal(JSON.parse(firstCycle.closure_json).summary, closure().summary);
  const beforeInvalidReopen = db.snapshot();
  await assert.rejects(executeTicketReopen(db.env, 1, created.ticket.id, owner, { reason: "", nextAction: "Verificar novamente" }, request({ etag: closed.etag })), { status: 400 });
  assert.deepEqual(db.snapshot(), beforeInvalidReopen);
  const reopened = await executeTicketReopen(db.env, 1, created.ticket.id, peer, { reason: "Sintoma voltou a ocorrer", nextAction: "Confirmar reprodução" }, request({ etag: closed.etag }));
  const stored = db.row(created.ticket.id);
  assert.equal(stored.status, "open");
  assert.equal(stored.closed_at, null);
  assert.equal(stored.current_cycle_number, 2);
  assert.notEqual(reopened.etag, closed.etag);
  assert.deepEqual(db.rows("ticket_cycles").find((row) => row.ticket_id === created.ticket.id && row.cycle_number === 1), firstCycle);
  const nextCycle = db.rows("ticket_cycles").find((row) => row.ticket_id === created.ticket.id && row.cycle_number === 2);
  assert.equal(nextCycle.origin, "reopened");
  assert.equal(nextCycle.opened_by, peer.id);
  assert.equal(nextCycle.closed_at, null);
});

test("CT-06: state path enforces triage, assignment, next action, review evidence and return justification", async (t) => {
  const db = await createTicketCommandDb(t);
  const unassigned = await create(db, { payload: { ...createPayload(), assignedTo: null } });
  await assert.rejects(transition(db, unassigned, "open"), { status: 400 });
  const unclassified = await create(db, { payload: {
    subject: "Cliente antigo", description: "Ainda sem triagem humana", priority: "normal", category: "map", assignedTo: peer.id,
  } });
  await assert.rejects(transition(db, unclassified, "open"), { status: 409, code: "TICKET_TRIAGE_REQUIRED" });
  let current = await create(db);
  await assert.rejects(executeTicketTransition(db.env, 1, current.ticket.id, owner, { status: "open" }, request({ etag: current.etag })), { status: 400 });
  await assert.rejects(transition(db, current, "in_progress"), { status: 409 });
  current = await transition(db, current, "open");
  current = await transition(db, current, "in_progress");
  await assert.rejects(transition(db, current, "in_review"), { status: 400 });
  await assert.rejects(transition(db, current, "open"), { status: 400 });
  current = await transition(db, current, "open", { reason: "Redistribuição necessária" });
  current = await transition(db, current, "in_progress");
  current = await transition(db, current, "in_review", { evidence: "Resultado pronto para conferência" });
  await assert.rejects(transition(db, current, "in_progress"), { status: 400 });
  current = await transition(db, current, "in_progress", { reason: "Conferência identificou ajuste" });
  assert.equal(current.ticket.status, "in_progress");
});

const allowedTransitions = {
  new: ["open", "closed"], open: ["in_progress", "closed"],
  in_progress: ["open", "in_review", "closed"], in_review: ["in_progress", "closed"], closed: [],
};
for (const from of Object.keys(allowedTransitions)) {
  test(`CT-06: transition matrix from ${from}, with reopening kept as an explicit command`, async (t) => {
    for (const to of Object.keys(allowedTransitions)) {
      await t.test(`${from} -> ${to}`, async (subtest) => {
        const db = await createTicketCommandDb(subtest);
        const current = await ticketAtStatus(db, from);
        const before = db.snapshot();
        const run = () => transition(db, current, to, {
          reason: "Decisão de atendimento justificada", evidence: "Resultado para conferência",
          ...(to === "closed" ? { closure: closure() } : {}),
        });
        if (allowedTransitions[from].includes(to)) {
          const result = await run();
          assert.equal(result.ticket.status, to);
          assert.equal(db.row(current.ticket.id).version, before.organization_tickets[0].version + 1);
        } else {
          await assert.rejects(run(), (error) => [400, 409].includes(error.status));
          assert.deepEqual(db.snapshot(), before);
        }
      });
    }
  });
}

test("CT-06: waiting records responsible person, dates and reasons independently of status or SLA", async (t) => {
  const db = await createTicketCommandDb(t);
  let current = await openTicket(db);
  const id = current.ticket.id;
  const validWait = { action: "start", reason: "Aguardando evidência do solicitante", responsibleId: peer.id, nextAction: "Solicitar arquivo", expectedAt: "2026-10-03T15:20:00.000Z" };
  for (const invalid of [{ ...validWait, reason: "" }, { ...validWait, responsibleId: otherOwner.id }, { ...validWait, nextAction: "" }, { ...validWait, expectedAt: "data inválida" }]) {
    const before = db.snapshot();
    await assert.rejects(executeTicketWait(db.env, 1, id, owner, invalid, request({ etag: current.etag })), { status: 400 });
    assert.deepEqual(db.snapshot(), before);
  }
  current = await executeTicketWait(db.env, 1, id, owner, validWait, request({ etag: current.etag }));
  const waiting = db.rows("ticket_wait_intervals")[0];
  assert.equal(waiting.reason, validWait.reason);
  assert.equal(waiting.responsible_id, peer.id);
  assert.equal(waiting.expected_at, validWait.expectedAt);
  assert.ok(Number.isFinite(Date.parse(waiting.started_at)));
  assert.equal(waiting.ended_at, null);
  assert.equal(db.row(id).status, "open");
  await assert.rejects(executeTicketWait(db.env, 1, id, owner, validWait, request({ etag: current.etag })), { status: 409 });
  const beforeInvalidEnd = db.snapshot();
  await assert.rejects(executeTicketWait(db.env, 1, id, owner, { action: "end" }, request({ etag: current.etag })), { status: 400 });
  assert.deepEqual(db.snapshot(), beforeInvalidEnd);
  await executeTicketWait(db.env, 1, id, peer, { action: "end", reason: "Evidência recebida", nextAction: "Conferir arquivo" }, request({ etag: current.etag }));
  const ended = db.rows("ticket_wait_intervals")[0];
  assert.equal(ended.started_at, waiting.started_at);
  assert.equal(ended.reason, waiting.reason);
  assert.ok(Number.isFinite(Date.parse(ended.ended_at)));
  assert.equal(ended.end_reason, "Evidência recebida");
  assert.equal(ended.ended_by, peer.id);
  assert.equal(db.row(id).active_wait_json, null);
  assert.equal(db.row(id).status, "open");
  assert.equal(db.row(id).due_at, null, "a wait expectation is not the ticket deadline or an inferred SLA");
});

test("state ETag excludes event/attachment aggregates but changes when a legacy writer updates a core field", async (t) => {
  const db = await createTicketCommandDb(t);
  const created = await create(db);
  const before = await readTicketCommandState(db.env, 1, created.ticket.id);
  assert.match(before.etag, /^"[^"\s]+"$/);
  db.sqlite.prepare(`INSERT INTO ticket_events (organization_id, ticket_id, event_type, actor_user_id, metadata)
    VALUES (1, ?, 'ticket.fixture.evidence', 1, '{}')`).run(created.ticket.id);
  db.sqlite.prepare(`INSERT INTO ticket_attachments (
    organization_id, ticket_id, original_name, stored_name, storage_key, mime_type, size_bytes, status, uploaded_by
    ) VALUES (1, ?, 'evidencia.txt', 'fixture.txt', '/cc03/fixture.txt', 'text/plain', 10, 'ACTIVE', 1)`).run(created.ticket.id);
  db.sqlite.exec("UPDATE users SET name = 'Nome de exibição atualizado' WHERE id = 1");
  const withEvidence = await readTicketCommandState(db.env, 1, created.ticket.id);
  assert.equal(withEvidence.etag, before.etag);
  assert.deepEqual(withEvidence.state, before.state);
  const version = db.row(created.ticket.id).version;
  db.sqlite.prepare("UPDATE organization_tickets SET description = 'Atualização por writer legado' WHERE id = ?").run(created.ticket.id);
  const changed = await readTicketCommandState(db.env, 1, created.ticket.id);
  assert.equal(db.row(created.ticket.id).version, version + 1);
  assert.notEqual(changed.etag, before.etag);
  await assert.rejects(executeTicketUpdate(db.env, 1, created.ticket.id, owner, { subject: "Validador anterior" }, request({ etag: before.etag, method: "PATCH" })), { status: 412 });
});

test("CT-49: past events and ticket audit cannot be edited/deleted; scoped correction appends a new event", async (t) => {
  const db = await createTicketCommandDb(t);
  const created = await create(db);
  const event = db.rows("ticket_events").find((row) => row.ticket_id === created.ticket.id);
  const audit = db.rows("audit_logs").find((row) => row.action.startsWith("ticket."));
  const before = db.snapshot();
  assert.throws(() => db.sqlite.prepare("UPDATE ticket_events SET metadata = '{}' WHERE id = ?").run(event.id), /APPEND_ONLY/);
  assert.throws(() => db.sqlite.prepare("DELETE FROM ticket_events WHERE id = ?").run(event.id), /APPEND_ONLY/);
  assert.throws(() => db.sqlite.prepare("UPDATE audit_logs SET details = '{}' WHERE id = ?").run(audit.id), /APPEND_ONLY/);
  assert.throws(() => db.sqlite.prepare("DELETE FROM audit_logs WHERE id = ?").run(audit.id), /APPEND_ONLY/);
  assert.deepEqual(db.snapshot(), before);
  const corrected = await executeTicketEventCorrection(db.env, 1, created.ticket.id, peer, {
    eventId: event.id, reason: "Informação complementar verificada", correction: "Esclarecimento registrado sem reescrever a evidência original",
  }, request({ etag: created.etag }));
  const correction = db.rows("ticket_events").find((row) => row.corrects_event_id === event.id);
  assert.ok(correction);
  assert.equal(correction.event_type, "ticket.event.corrected");
  assert.equal(correction.actor_user_id, peer.id);
  assert.deepEqual(db.rows("ticket_events").find((row) => row.id === event.id), event);
  assert.deepEqual(db.rows("audit_logs").find((row) => row.id === audit.id), audit);
  assert.equal(corrected.state.version, created.state.version + 1);
  assert.notEqual(corrected.etag, created.etag, "the explicit correction command advances the core version");
  const another = await create(db);
  const beforeCrossTicket = db.snapshot();
  await assert.rejects(executeTicketEventCorrection(db.env, 1, another.ticket.id, owner, { eventId: event.id, reason: "Tentativa inválida", correction: "Não deve atravessar chamado" }, request({ etag: another.etag })), { status: 404 });
  assert.deepEqual(db.snapshot(), beforeCrossTicket);
});

async function prepareAtomicCommand(db, kind) {
  if (kind === "create") return () => create(db, { key: "atomic-create-intent" });
  let current = await create(db);
  const id = current.ticket.id;
  if (kind === "update") return () => executeTicketUpdate(db.env, 1, id, peer, { context: "Atualização atômica" }, request({ method: "PATCH", etag: current.etag }));
  if (kind === "close") return () => transition(db, current, "closed", { closure: closure() });
  if (kind === "wait") {
    current = await transition(db, current, "open");
    return () => executeTicketWait(db.env, 1, id, owner, { action: "start", reason: "Aguardando insumo", responsibleId: peer.id, nextAction: "Cobrar insumo" }, request({ etag: current.etag }));
  }
  if (kind === "reopen") {
    current = await transition(db, current, "closed", { closure: closure() });
    return () => executeTicketReopen(db.env, 1, id, peer, { reason: "Retorno do sintoma", nextAction: "Investigar retorno" }, request({ etag: current.etag }));
  }
  const event = db.rows("ticket_events").find((row) => row.ticket_id === id);
  return () => executeTicketEventCorrection(db.env, 1, id, peer, { eventId: event.id, reason: "Correção necessária", correction: "Esclarecimento correto" }, request({ etag: current.etag }));
}

for (const kind of ["create", "update", "close", "wait", "reopen", "correction"]) {
  test(`CT-10: ${kind} rolls back at every transaction statement, including mandatory audit and outbox`, async (t) => {
    const reference = await createTicketCommandDb(t);
    await (await prepareAtomicCommand(reference, kind))();
    const batch = reference.batches.at(-1);
    assert.ok(batch.some(({ sql }) => /INSERT INTO audit_logs/.test(sql)), "audit must be inside this batch");
    assert.ok(batch.some(({ sql }) => /INSERT INTO ticket_command_outbox/.test(sql)), "outbox intent must be inside this batch");
    for (let index = 0; index < batch.length; index += 1) {
      await t.test(`statement ${index + 1}/${batch.length}`, async (subtest) => {
        const db = await createTicketCommandDb(subtest);
        const run = await prepareAtomicCommand(db, kind);
        const before = db.snapshot();
        db.failNextBatchAt(index);
        await assert.rejects(run());
        assert.deepEqual(db.snapshot(), before);
      });
    }
  });
}

for (const [name, submit] of [["original", submitProjectChangeRequest], ["analysis-aware", submitAnalysisAwareProjectChangeRequest]]) {
  test(`existing ${name} CR writer uses additive defaults and lazy cycles without authorization or automatic CR approval`, async (t) => {
    const db = await createTicketCommandDb(t);
    db.sqlite.exec(`
      INSERT INTO projects (id, organization_id, name, slug, dropbox_root_path, created_by, config_revision)
        VALUES (1, 1, 'Projeto QA', 'projeto-qa', '/projects/org-a/projeto-qa', 1, 0);
      INSERT INTO user_projects (user_id, project_id, access_level) VALUES (3, 1, 'viewer');
    `);
    const crRequest = request({ key: "direct-cr-writer", cookie: db.sessionCookie(viewer.id, 1) });
    const submission = {
      baseRevision: 0, reason: "Proposta ainda sujeita a revisão",
      operations: [{ id: "op-1", type: "point.create", version: 1, payload: { latitude: -15.78, longitude: -47.92 }, createdAt: "2026-09-25T12:00:00.000Z" }],
    };
    const permissionsBefore = db.rows("user_permissions");
    const result = await submit(db.env, crRequest, "projeto-qa", submission);
    const id = result.changeRequest.ticketId;
    assert.equal(result.changeRequest.status, "submitted");
    assert.equal(db.row(id).demand_nature, null);
    assert.equal(db.row(id).triage_source, "legacy");
    assert.equal(db.row(id).current_cycle_number, 0);
    const state = await readTicketCommandState(db.env, 1, id);
    const updated = await executeTicketUpdate(db.env, 1, id, owner, { subject: "Atendimento da proposta" }, request({ method: "PATCH", etag: state.etag }));
    const observed = db.rows("ticket_cycles").find((row) => row.ticket_id === id);
    assert.equal(observed.origin, "observed_baseline");
    assert.equal(db.row(id).demand_nature, null);
    const beforeUnacknowledgedClose = db.snapshot();
    await assert.rejects(transition(db, updated, "closed", { closure: { ...closure(), pendingChangeAcknowledged: false } }), { status: 409 });
    assert.deepEqual(db.snapshot(), beforeUnacknowledgedClose);
    await transition(db, updated, "closed", { closure: closure() });
    const storedCr = db.sqlite.prepare("SELECT * FROM project_change_requests WHERE id = ?").get(result.changeRequest.id);
    assert.equal(storedCr.status, "submitted");
    assert.equal(db.row(id).status, "closed");
    assert.equal(db.sqlite.prepare("SELECT config_revision FROM projects WHERE id = 1").get().config_revision, 0);
    assert.deepEqual(db.rows("user_permissions"), permissionsBefore);
    const replay = await submit(db.env, crRequest, "projeto-qa", submission);
    assert.equal(replay.replayed, true);
    assert.equal(replay.changeRequest.ticketId, id);
    assert.equal(db.rows("organization_tickets").length, 1);
  });
}
