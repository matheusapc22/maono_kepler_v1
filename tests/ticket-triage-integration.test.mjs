import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createTicket,
  getTicketDetails,
  listTickets,
  parseTicketListOptions,
  updateTicket,
} from "../functions/_lib/ticket-center.js";
import { submitProjectChangeRequest } from "../functions/_lib/project-change-requests.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const actor = { id: 1, role: "owner", activeOrganizationId: 1 };
const reviewer = { id: 2, role: "owner", activeOrganizationId: 1 };
const request = new Request("https://cc02.test/api/organizations/1/tickets");
const listOptions = () => parseTicketListOptions(request.url);

// This adapter executes the production SQL unchanged in real SQLite. Batch
// uses an actual transaction; no query patterns return precomputed fixtures.
function fixture(t, { expanded = true, enabled = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  t.after(() => sqlite.close());
  sqlite.exec(source("../schema.sql"));
  // schema.sql is a fresh-install snapshot that already includes CC-02. Rebuild
  // only the empty ticket tables from the actual 0010 migration to exercise an
  // upgrade of the old schema, not a hand-written approximation of its columns.
  sqlite.exec("DROP TABLE ticket_attachments; DROP TABLE ticket_events; DROP TABLE organization_tickets;");
  sqlite.exec(`
    CREATE TABLE role_permissions (
      id INTEGER PRIMARY KEY, role TEXT, permission TEXT,
      scope_type TEXT, active INTEGER DEFAULT 1,
      UNIQUE(role, permission, scope_type)
    );
    CREATE TABLE user_permissions (
      id INTEGER PRIMARY KEY, user_id INTEGER, permission TEXT,
      organization_id INTEGER, project_id INTEGER,
      expires_at TEXT, active INTEGER DEFAULT 1
    );
    INSERT INTO users (id, email, name, role, password_hash) VALUES
      (1, 'opener@cc02.test', 'Abertura', 'owner', 'fixture'),
      (2, 'reviewer@cc02.test', 'Triagem', 'owner', 'fixture'),
      (3, 'viewer@cc02.test', 'Viewer', 'viewer', 'fixture');
    INSERT INTO organizations (id, name, slug, dropbox_root_path) VALUES
      (1, 'Organização A', 'org-a', '/projects/org-a'),
      (2, 'Organização B', 'org-b', '/projects/org-b');
    INSERT INTO organization_users (organization_id, user_id, access_level)
      VALUES (1, 1, 'owner'), (1, 2, 'owner'), (1, 3, 'viewer');
  `);
  sqlite.exec(source("../migrations/0010_ticket_center.sql"));
  sqlite.exec(source("../migrations/0020_project_change_requests.sql"));
  if (expanded) sqlite.exec(source("../migrations/0025_ticket_triage_classification.sql"));
  const statements = [];
  let beforeBatch = null;
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() {
          statements.push({ sql, args });
          const row = sqlite.prepare(sql).get(...args);
          return row ? { ...row } : null;
        },
        async all() {
          statements.push({ sql, args });
          return { success: true, results: sqlite.prepare(sql).all(...args).map((row) => ({ ...row })) };
        },
        async run() {
          statements.push({ sql, args });
          const statement = sqlite.prepare(sql);
          const results = statement.columns().length ? statement.all(...args).map((row) => ({ ...row })) : [];
          if (!statement.columns().length) statement.run(...args);
          const meta = sqlite.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get();
          return { success: true, results, meta: { ...meta } };
        },
      };
    },
    async batch(batch) {
      // A deterministic competing commit after the service read, immediately
      // before its transaction starts. The callback is consumed once.
      const hook = beforeBatch;
      beforeBatch = null;
      hook?.(sqlite);
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of batch) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const env = { DB };
  if (enabled !== undefined) env.MAONO_TICKET_TRIAGE_ENABLED = String(enabled);
  return {
    env, sqlite, statements,
    beforeNextBatch(callback) { beforeBatch = callback; },
    row: (id) => ({ ...sqlite.prepare("SELECT * FROM organization_tickets WHERE id = ?").get(id) }),
    events: (id) => sqlite.prepare("SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY id").all(id)
      .map((row) => ({ ...row, metadata: JSON.parse(row.metadata || "{}") })),
    counts: () => ({
      tickets: sqlite.prepare("SELECT count(*) AS n FROM organization_tickets").get().n,
      events: sqlite.prepare("SELECT count(*) AS n FROM ticket_events").get().n,
    }),
  };
}

const answers = {
  question_request: {},
  incident: { startedAt: "desconhecido", impactDescription: "A equipe não consegue consultar", workaround: "Consulta manual" },
  defect: { stepsToReproduce: "Abrir o projeto e consultar", actualResult: "Resultado inconsistente", affectedVersion: "v1" },
  improvement_change: { problemToSolve: "Consulta repetitiva", expectedBenefit: "Reduzir o esforço manual" },
  recurring_problem: { recurrenceFrequency: "Semanal", relatedContext: "Ocorrências no mesmo conjunto" },
};

function legacyPayload(category = "map") {
  return { subject: "Consulta ao domínio", description: "Informações para atendimento", category, priority: "normal" };
}

function triagePayload(nature = "question_request", category = "map") {
  return {
    ...legacyPayload(category), demandNature: nature,
    expectedResult: "Consulta disponível e compreendida", context: "Equipe de operação",
    impact: "team", urgency: "soon", priorityReason: "", triageAnswers: { ...answers[nature] },
    triageFormVersion: 1,
  };
}

for (const nature of Object.keys(answers)) {
  for (const category of ["map", "database"]) {
    test(`CT-03: persists ${nature} independently of ${category}, exposes list/detail`, async (t) => {
      const db = fixture(t);
      const payload = triagePayload(nature, category);
      const created = await createTicket(db.env, 1, actor, payload, request);
      const stored = db.row(created.id);
      assert.equal(stored.demand_nature, nature);
      assert.equal(stored.category, category);
      assert.equal(stored.expected_result, payload.expectedResult);
      assert.equal(stored.context, payload.context);
      assert.equal(stored.impact, payload.impact);
      assert.equal(stored.urgency, payload.urgency);
      assert.deepEqual(JSON.parse(stored.triage_answers), payload.triageAnswers);
      assert.equal(stored.triage_form_version, 1);
      assert.equal(stored.triage_source, "human");
      assert.equal(stored.triaged_by, actor.id);
      assert.ok(Number.isFinite(Date.parse(stored.triaged_at)));
      for (const dto of [created, (await getTicketDetails(db.env, 1, created.id)).ticket]) {
        assert.equal(dto.demandNature, nature);
        assert.equal(dto.category, category);
        assert.equal(dto.needsTriage, false);
        assert.deepEqual(dto.triageAnswers, payload.triageAnswers);
      }
      const listing = await listTickets(db.env, 1, listOptions());
      assert.equal(listing.triageEnabled, true);
      assert.equal(listing.tickets.length, 1);
      assert.equal(listing.tickets[0].demandNature, nature);
      const detail = await getTicketDetails(db.env, 1, created.id);
      assert.equal(detail.triageEnabled, true);
      const classified = db.events(created.id).find((event) => event.event_type === "ticket.triage.changed");
      assert.equal(classified.actor_user_id, actor.id);
      assert.equal(classified.metadata.from, null);
      assert.equal(classified.metadata.to.demandNature, nature);
      assert.equal(classified.metadata.to.triagedBy, actor.id);
      assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM project_change_requests").get().n, 0);
    });
  }
}

test("CT-04: priority and domain changes record persisted before/after values, justification and real actor without changing nature", async (t) => {
  const db = fixture(t);
  const created = await createTicket(db.env, 1, actor, triagePayload("incident"), request);
  const reason = "Organização impedida de consultar dados";
  const updated = await updateTicket(db.env, 1, created.id, reviewer, { priority: "high", category: "database", priorityReason: reason }, request);
  assert.equal(updated.priority, "high");
  assert.equal(updated.category, "database");
  assert.equal(updated.demandNature, "incident");
  assert.equal(updated.status, "new");
  const events = db.events(created.id);
  const priority = events.find((event) => event.event_type === "ticket.priority.changed");
  const domain = events.find((event) => event.event_type === "ticket.category.changed");
  assert.equal(priority.actor_user_id, reviewer.id);
  assert.deepEqual(priority.metadata, { from: "normal", to: "high", reason });
  assert.equal(domain.actor_user_id, reviewer.id);
  assert.deepEqual(domain.metadata, { from: "map", to: "database", reason });
  const triage = events.filter((event) => event.event_type === "ticket.triage.changed").at(-1);
  assert.equal(triage.actor_user_id, reviewer.id);
  assert.equal(triage.metadata.from.demandNature, "incident");
  assert.equal(triage.metadata.to.demandNature, "incident");
  assert.equal(triage.metadata.from.priorityReason, "");
  assert.equal(triage.metadata.to.priorityReason, reason);
  assert.equal(db.row(created.id).priority_reason, reason);
  assert.equal(events.some((event) => event.event_type === "ticket.status.changed"), false);
});

test("CT-04: reclassification requires justification and new answers, retaining the previous nature in the event", async (t) => {
  const db = fixture(t);
  const created = await createTicket(db.env, 1, actor, triagePayload("incident"), request);
  const before = db.row(created.id);
  const counts = db.counts();
  await assert.rejects(updateTicket(db.env, 1, created.id, reviewer, { demandNature: "defect", triageAnswers: answers.defect }, request), { status: 400, code: "TICKET_TRIAGE_REASON_REQUIRED" });
  await assert.rejects(updateTicket(db.env, 1, created.id, reviewer, { demandNature: "defect", priorityReason: "Reprodução confirmada" }, request), { status: 400 });
  await assert.rejects(updateTicket(db.env, 1, created.id, reviewer, { priority: "high" }, request), { status: 400, code: "TICKET_TRIAGE_REASON_REQUIRED" });
  await assert.rejects(updateTicket(db.env, 1, created.id, reviewer, { category: "database" }, request), { status: 400, code: "TICKET_TRIAGE_REASON_REQUIRED" });
  assert.deepEqual(db.row(created.id), before);
  assert.deepEqual(db.counts(), counts);
  const updated = await updateTicket(db.env, 1, created.id, reviewer, {
    demandNature: "defect", triageAnswers: answers.defect, priorityReason: "Reprodução confirmada",
  }, request);
  assert.equal(updated.demandNature, "defect");
  assert.deepEqual(updated.triageAnswers, answers.defect);
  assert.equal(updated.priority, "normal");
  const event = db.events(created.id).filter((entry) => entry.event_type === "ticket.triage.changed").at(-1);
  assert.equal(event.actor_user_id, reviewer.id);
  assert.equal(event.metadata.from.demandNature, "incident");
  assert.deepEqual(event.metadata.from.triageAnswers, answers.incident);
  assert.equal(event.metadata.to.demandNature, "defect");
  assert.deepEqual(event.metadata.to.triageAnswers, answers.defect);
  assert.equal(event.metadata.to.triagedBy, reviewer.id);
  assert.equal(db.row(created.id).triaged_by, reviewer.id);
});

test("partial and invalid triage create payloads fail without persisting a ticket or event", async (t) => {
  const db = fixture(t);
  const invalid = [
    { ...legacyPayload(), demandNature: "incident" },
    { ...triagePayload("incident"), triageAnswers: {} },
    { ...triagePayload(), triageFormVersion: 2 },
    { ...triagePayload(), expectedResult: " " },
    { ...triagePayload(), expectedResult: "x".repeat(2001) },
    { ...triagePayload(), priority: "high" },
    { ...triagePayload(), triageAnswers: { undeclaredQuestion: "answer" } },
  ];
  for (const payload of invalid) {
    await assert.rejects(createTicket(db.env, 1, actor, payload, request), { status: 400 });
    assert.deepEqual(db.counts(), { tickets: 0, events: 0 });
  }
});

test("triage creation and updates roll back ticket data and all events when SQLite rejects an event", async (t) => {
  const db = fixture(t);
  const created = await createTicket(db.env, 1, actor, triagePayload(), request);
  const before = db.row(created.id);
  const counts = db.counts();
  db.sqlite.exec(`CREATE TRIGGER fixture_reject_triage_event BEFORE INSERT ON ticket_events
    WHEN NEW.event_type = 'ticket.triage.changed'
    BEGIN SELECT RAISE(ABORT, 'FIXTURE_TRIAGE_EVENT_REJECTED'); END;`);
  await assert.rejects(createTicket(db.env, 1, actor, triagePayload("incident"), request), /FIXTURE_TRIAGE_EVENT_REJECTED/);
  assert.deepEqual(db.counts(), counts);
  await assert.rejects(updateTicket(db.env, 1, created.id, reviewer, { priority: "high", priorityReason: "Indisponível", expectedResult: "Restaurar" }, request), /FIXTURE_TRIAGE_EVENT_REJECTED/);
  assert.deepEqual(db.row(created.id), before);
  assert.deepEqual(db.counts(), counts);
});

test("concurrent reclassification after the server read rejects the whole partial PATCH without events or audit", async (t) => {
  const db = fixture(t);
  assert.equal(db.sqlite.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  const created = await createTicket(db.env, 1, actor, triagePayload("incident"), request);
  const eventsBefore = db.events(created.id);
  const auditsBefore = db.sqlite.prepare("SELECT * FROM audit_logs ORDER BY id").all();
  let concurrentRow;
  db.beforeNextBatch((sqlite) => {
    sqlite.prepare(`UPDATE organization_tickets
      SET demand_nature = 'defect', triage_answers = ?, priority_reason = 'Reprodução confirmada',
          triaged_by = ?, triaged_at = '2026-09-25T13:00:00.000Z'
      WHERE id = ?`).run(JSON.stringify(answers.defect), actor.id, created.id);
    concurrentRow = db.row(created.id);
  });
  await assert.rejects(updateTicket(db.env, 1, created.id, reviewer, {
    context: "Edição validada contra incidente", status: "in_progress",
    priority: "high", category: "database", priorityReason: "Atendimento bloqueado",
  }, request), { status: 409, code: "TICKET_TRIAGE_CONFLICT" });
  assert.ok(concurrentRow, "the competing commit ran between the read and batch");
  assert.deepEqual(db.row(created.id), concurrentRow);
  assert.equal(concurrentRow.demand_nature, "defect");
  assert.equal(concurrentRow.status, "new");
  assert.equal(concurrentRow.priority, "normal");
  assert.equal(concurrentRow.category, "map");
  assert.deepEqual(db.events(created.id), eventsBefore);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM audit_logs ORDER BY id").all(), auditsBefore);
});

test("same-nature concurrent answers and context survive a rejected structured PATCH with no losing events", async (t) => {
  const db = fixture(t);
  const created = await createTicket(db.env, 1, actor, triagePayload("incident"), request);
  const eventsBefore = db.events(created.id);
  const auditsBefore = db.sqlite.prepare("SELECT * FROM audit_logs ORDER BY id").all();
  const concurrentAnswers = { ...answers.incident, impactDescription: "Impacto confirmado por outra pessoa" };
  let concurrentRow;
  db.beforeNextBatch((sqlite) => {
    // Keep nature and provenance unchanged: the guard must compare the actual
    // answer/context snapshot, not merely the nature or a timestamp token.
    sqlite.prepare("UPDATE organization_tickets SET triage_answers = ?, context = ? WHERE id = ?")
      .run(JSON.stringify(concurrentAnswers), "Contexto confirmado por outra pessoa", created.id);
    concurrentRow = db.row(created.id);
  });
  await assert.rejects(updateTicket(db.env, 1, created.id, reviewer, {
    triageAnswers: { ...answers.incident, workaround: "Resposta da tentativa perdedora" },
    context: "Contexto da tentativa perdedora", assignedTo: reviewer.id,
  }, request), { status: 409, code: "TICKET_TRIAGE_CONFLICT" });
  assert.ok(concurrentRow);
  assert.deepEqual(db.row(created.id), concurrentRow);
  assert.equal(concurrentRow.demand_nature, "incident");
  assert.equal(concurrentRow.assigned_to, null);
  assert.deepEqual(JSON.parse(concurrentRow.triage_answers), concurrentAnswers);
  assert.deepEqual(db.events(created.id), eventsBefore);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM audit_logs ORDER BY id").all(), auditsBefore);
});

test("a context-only PATCH preserves concurrent status, assignment and exact due date outside the triage snapshot", async (t) => {
  const db = fixture(t);
  const created = await createTicket(db.env, 1, actor, triagePayload("incident"), request);
  const eventsBefore = db.events(created.id).length;
  const dueAt = "2026-10-02T19:27:13.456Z";
  db.beforeNextBatch((sqlite) => {
    sqlite.prepare("UPDATE organization_tickets SET status = 'in_progress', assigned_to = ?, due_at = ? WHERE id = ?")
      .run(actor.id, dueAt, created.id);
  });
  const result = await updateTicket(db.env, 1, created.id, reviewer, { context: "Contexto complementar" }, request);
  assert.equal(result.context, "Contexto complementar");
  const row = db.row(created.id);
  assert.equal(row.status, "in_progress");
  assert.equal(row.assigned_to, actor.id);
  assert.equal(row.due_at, dueAt);
  const newEvents = db.events(created.id).slice(eventsBefore);
  assert.equal(newEvents.length, 1);
  assert.equal(newEvents[0].event_type, "ticket.triage.changed");
  assert.equal(newEvents[0].actor_user_id, reviewer.id);
});

test("CT-05: additive migration preserves legacy categories, identities, counts and history without inferring nature", async (t) => {
  const db = fixture(t, { expanded: false, enabled: false });
  for (const [category, subject] of [["map", "Alterar mapa ou esclarecer dúvida"], ["map", "Falha recorrente"], ["database", "Banco indisponível"]]) {
    await createTicket(db.env, 1, actor, { ...legacyPayload(category), subject }, request);
  }
  const before = db.sqlite.prepare("SELECT * FROM organization_tickets ORDER BY id").all().map((row) => ({ ...row }));
  const eventsBefore = db.sqlite.prepare("SELECT * FROM ticket_events ORDER BY id").all();
  const countsBefore = db.counts();
  db.sqlite.exec(source("../migrations/0025_ticket_triage_classification.sql"));
  assert.deepEqual(db.counts(), countsBefore);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM ticket_events ORDER BY id").all(), eventsBefore);
  for (const old of before) {
    const row = db.row(old.id);
    for (const [key, value] of Object.entries(old)) assert.equal(row[key], value, key);
    assert.equal(row.demand_nature, null);
    assert.equal(row.triage_source, "legacy");
    assert.equal(row.triaged_by, null);
    assert.equal(row.triaged_at, null);
    assert.equal(row.triage_form_version, null);
    assert.deepEqual(JSON.parse(row.triage_answers), {});
  }
  db.env.MAONO_TICKET_TRIAGE_ENABLED = "true";
  const listing = await listTickets(db.env, 1, listOptions());
  assert.equal(listing.triageEnabled, true);
  assert.equal(listing.tickets.length, 3);
  assert.ok(listing.tickets.every((ticket) => ticket.demandNature === null && ticket.needsTriage));
});

for (const expanded of [false, true]) {
  test(`flag off: old client create/update/read works on ${expanded ? "expanded" : "old"} schema; new fields fail explicitly`, async (t) => {
    const db = fixture(t, { expanded, enabled: false });
    const created = await createTicket(db.env, 1, actor, legacyPayload(), request);
    const edited = await updateTicket(db.env, 1, created.id, reviewer, { priority: "high", category: "database" }, request);
    assert.equal(edited.priority, "high");
    assert.equal(edited.category, "database");
    assert.equal((await listTickets(db.env, 1, listOptions())).triageEnabled, false);
    assert.equal((await getTicketDetails(db.env, 1, created.id)).triageEnabled, false);
    const before = db.counts();
    await assert.rejects(createTicket(db.env, 1, actor, triagePayload(), request), { status: 503, code: "TICKET_TRIAGE_DISABLED" });
    await assert.rejects(updateTicket(db.env, 1, created.id, reviewer, { expectedResult: "Novo resultado" }, request), { status: 503, code: "TICKET_TRIAGE_DISABLED" });
    assert.deepEqual(db.counts(), before);
    assert.equal(db.row(created.id).category, "database");
  });
}

test("missing feature flag defaults to the legacy contract on an unmigrated schema", async (t) => {
  const db = fixture(t, { expanded: false, enabled: false });
  delete db.env.MAONO_TICKET_TRIAGE_ENABLED;
  const created = await createTicket(db.env, 1, actor, legacyPayload(), request);
  assert.equal((await getTicketDetails(db.env, 1, created.id)).triageEnabled, false);
  await assert.rejects(createTicket(db.env, 1, actor, triagePayload(), request), { status: 503, code: "TICKET_TRIAGE_DISABLED" });
  assert.equal(db.counts().tickets, 1);
});

test("flag on without migration fails closed before mutating old schema", async (t) => {
  const db = fixture(t, { expanded: false, enabled: false });
  const created = await createTicket(db.env, 1, actor, legacyPayload(), request);
  db.env.MAONO_TICKET_TRIAGE_ENABLED = "true";
  const before = db.counts();
  const old = db.row(created.id);
  assert.equal((await listTickets(db.env, 1, listOptions())).triageEnabled, false);
  await assert.rejects(createTicket(db.env, 1, actor, triagePayload(), request), { status: 503, code: "TICKET_TRIAGE_SCHEMA_OUTDATED" });
  await assert.rejects(updateTicket(db.env, 1, created.id, reviewer, triagePayload(), request), { status: 503, code: "TICKET_TRIAGE_SCHEMA_OUTDATED" });
  assert.deepEqual(db.counts(), before);
  assert.deepEqual(db.row(created.id), old);
  // Enabling the flag early must not silently route old payloads around the
  // write guard either, even though their cached shape contains no new fields.
  await assert.rejects(createTicket(db.env, 1, actor, legacyPayload(), request), { status: 503, code: "TICKET_TRIAGE_SCHEMA_OUTDATED" });
  await assert.rejects(updateTicket(db.env, 1, created.id, reviewer, { subject: "Novo assunto" }, request), { status: 503, code: "TICKET_TRIAGE_SCHEMA_OUTDATED" });
  assert.deepEqual(db.counts(), before);
});

test("flag on with only part of the expansion also refuses writes and reports no capability", async (t) => {
  const db = fixture(t, { expanded: false, enabled: true });
  db.sqlite.exec("ALTER TABLE organization_tickets ADD COLUMN demand_nature TEXT;");
  const listing = await listTickets(db.env, 1, listOptions());
  assert.equal(listing.triageEnabled, false);
  await assert.rejects(createTicket(db.env, 1, actor, triagePayload(), request), { status: 503, code: "TICKET_TRIAGE_SCHEMA_OUTDATED" });
  assert.deepEqual(db.counts(), { tickets: 0, events: 0 });
});

test("enabled rollout preserves cached legacy creates and priority/domain-only updates as unclassified", async (t) => {
  const db = fixture(t);
  const created = await createTicket(db.env, 1, actor, legacyPayload(), request);
  assert.equal(created.demandNature, null);
  assert.equal(created.needsTriage, true);
  const updated = await updateTicket(db.env, 1, created.id, reviewer, { priority: "high", category: "database", priorityReason: "Atendimento bloqueado" }, request);
  assert.equal(updated.priority, "high");
  const row = db.row(created.id);
  assert.equal(row.demand_nature, null);
  assert.equal(row.triage_source, "legacy");
  assert.equal(row.triaged_by, null);
  assert.equal(updated.needsTriage, true);
});

test("CT-05: a human explicitly classifies a legacy ticket and cannot spoof provenance or affect another organization", async (t) => {
  const db = fixture(t);
  const created = await createTicket(db.env, 1, actor, legacyPayload(), request);
  const updated = await updateTicket(db.env, 1, created.id, reviewer, {
    ...triagePayload("defect"), triageSource: "legacy", triagedBy: 999, triagedAt: "1900-01-01T00:00:00Z",
  }, request);
  assert.equal(updated.demandNature, "defect");
  assert.equal(updated.triageSource, "human");
  assert.equal(updated.triagedBy, reviewer.id);
  assert.equal(updated.needsTriage, false);
  assert.notEqual(updated.triagedAt, "1900-01-01T00:00:00Z");
  const event = db.events(created.id).filter((entry) => entry.event_type === "ticket.triage.changed").at(-1);
  assert.equal(event.actor_user_id, reviewer.id);
  assert.equal(event.metadata.from.demandNature, null);
  assert.equal(event.metadata.from.triageSource, "legacy");
  assert.equal(event.metadata.to.demandNature, "defect");
  assert.equal(event.metadata.to.triageSource, "human");
  const before = db.row(created.id);
  const counts = db.counts();
  await assert.rejects(getTicketDetails(db.env, 2, created.id), { status: 404 });
  await assert.rejects(updateTicket(db.env, 2, created.id, reviewer, { expectedResult: "Não autorizado" }, request), { status: 404 });
  assert.deepEqual(db.row(created.id), before);
  assert.deepEqual(db.counts(), counts);
  assert.equal((await listTickets(db.env, 2, listOptions())).tickets.length, 0);
});

for (const enabled of [false, true]) {
  test(`existing Viewer CR writer remains compatible with expanded schema, flag ${enabled}`, async (t) => {
    const db = fixture(t, { enabled });
    db.sqlite.exec(source("../migrations/0020_project_change_requests.sql"));
    db.sqlite.exec(`
      INSERT INTO projects (id, organization_id, name, slug, dropbox_root_path, created_by, config_revision)
        VALUES (1, 1, 'Projeto QA', 'projeto-qa', '/projects/org-a/projeto-qa', 1, 0);
      INSERT INTO user_projects (user_id, project_id, access_level) VALUES (3, 1, 'viewer');
    `);
    const token = "cc02-local-viewer-fixture";
    db.sqlite.prepare("INSERT INTO sessions (user_id, token_hash, active_organization_id, expires_at) VALUES (3, ?, 1, '2099-01-01T00:00:00.000Z')")
      .run(createHash("sha256").update(token).digest("hex"));
    const viewerRequest = new Request("https://cc02.test/api/projects/projeto-qa/change-requests", {
      headers: { Cookie: `maono_session=${token}`, "Idempotency-Key": "cc02-legacy-writer-fixture" },
    });
    const submission = {
      baseRevision: 0, reason: "Proposta ainda depende de revisão",
      operations: [{ id: "op-1", type: "point.create", version: 1, payload: { latitude: -15.78, longitude: -47.92 }, createdAt: "2026-09-25T12:00:00.000Z" }],
    };
    const result = await submitProjectChangeRequest(db.env, viewerRequest, "projeto-qa", submission);
    assert.equal(result.status, 201);
    assert.equal(result.changeRequest.status, "submitted");
    const row = db.row(result.changeRequest.ticketId);
    assert.equal(row.category, "map");
    assert.equal(row.status, "new");
    assert.equal(row.demand_nature, null);
    assert.equal(row.triage_source, "legacy");
    assert.equal(row.triaged_by, null);
    assert.equal(db.sqlite.prepare("SELECT config_revision FROM projects WHERE id = 1").get().config_revision, 0);
    const replay = await submitProjectChangeRequest(db.env, viewerRequest, "projeto-qa", submission);
    assert.equal(replay.replayed, true);
    assert.equal(replay.changeRequest.ticketId, result.changeRequest.ticketId);
    assert.equal(db.counts().tickets, 1);
  });
}
