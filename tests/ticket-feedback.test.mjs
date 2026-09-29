import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createTicketCommandDb,
  COMMAND_ACTORS as A,
} from "./helpers/ticket-command-db.mjs";
import {
  feedbackReady,
  publishFeedbackInstrument,
  reconcileFeedback,
  listFeedback,
  respondFeedback,
  withdrawFeedback,
  feedbackMetricSource,
} from "../functions/_lib/ticket-feedback.js";
import { aggregateFeedback } from "../functions/_lib/ticket-feedback-domain.js";
import { consumeTicketNotifications } from "../functions/_lib/ticket-notifications.js";
import {
  readMetrics,
  replayMetrics,
} from "../functions/_lib/ticket-metrics.js";
import {
  executeTicketCreate,
  executeTicketTransition,
  executeTicketReopen,
} from "../functions/_lib/ticket-commands.js";
import { onRequest as collection } from "../functions/api/organizations/[id]/ticket-feedback.js";
import { onRequest as respondRoute } from "../functions/api/organizations/[id]/ticket-feedback/[inviteId].js";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
export const definition = {
  resultQuestion: "Resultado alcançado?",
  effortQuestion: "Quanto esforço?",
  consentText:
    "Fixture explícita: participação voluntária; métricas para a gestão autorizada.",
  windowHours: 24,
  outcomes: ["Sim", "Não", "Parcial"],
  effortLabels: ["Baixo", "Médio", "Alto"],
  effortDirection: "ascending",
  individualAudience: "requester",
  aggregateAudience: "ticket.manage",
  eligibleActor: "requester",
  approved: true,
};
async function fixture(t, { schema = true, configured = true } = {}) {
  const f = await createTicketCommandDb(t);
  for (const n of [
    "0027_ticket_selective_access.sql",
    "0028_ticket_conversations.sql",
    "0030_ticket_notifications.sql",
    "0031_ticket_change_reconciliation.sql",
    "0033_ticket_sla_policies.sql",
    "0034_ticket_metric_rollups.sql",
    "0035_ticket_report_exports.sql",
    "0036_ticket_incidents_problems.sql",
    "0037_ticket_knowledge.sql",
    ...(schema ? ["0038_ticket_feedback.sql"] : []),
  ])
    f.sqlite.exec(read("migrations/" + n));
  Object.assign(f.env, {
    MAONO_RUNTIME_ENV: "local",
    MAONO_TICKET_FEEDBACK_ENABLED: "true",
    MAONO_TICKET_FEEDBACK_ORGANIZATION_IDS: "1",
    MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: "true",
    MAONO_TICKET_CONVERSATIONS_ENABLED: "true",
    MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED: "true",
    MAONO_TICKET_NOTIFICATIONS_ENABLED: "true",
    MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS: "1",
    MAONO_TICKET_NOTIFICATION_START_AT: "2026-01-01T00:00:00.000Z",
    MAONO_TICKET_METRICS_ENABLED: "true",
    MAONO_TICKET_METRICS_ORGANIZATION_IDS: "1",
    MAONO_TICKET_SLA_ENABLED: "true",
    MAONO_TICKET_SLA_ORGANIZATION_IDS: "1",
  });
  f.sqlite.exec(
    "INSERT INTO role_permissions(role,permission,scope_type) VALUES('viewer','ticket.view','organization')",
  );
  if (schema && configured)
    await publishFeedbackInstrument(f.env, 1, A.owner, {
      definition,
      expectedVersion: 0,
      requestKey: crypto.randomUUID(),
    });
  return f;
}
function seed(f, id = 1, org = 1, cycle = 1) {
  const at = new Date(Date.now() + 1).toISOString();
  if (cycle === 1)
    f.sqlite
      .prepare(
        "INSERT INTO organization_tickets(id,organization_id,subject,description,status,created_by,visibility,created_at) VALUES(?,?,'Feedback','test','closed',1,'organization',?)",
      )
      .run(id, org, at);
  f.sqlite
    .prepare(
      "INSERT INTO ticket_cycles(organization_id,ticket_id,cycle_number,origin,opened_at,closed_at) VALUES(?,?,?,'created',?,?)",
    )
    .run(org, id, cycle, at, at);
}
async function issued(f) {
  seed(f);
  assert.equal((await reconcileFeedback(f.env, 1, A.owner)).issued, 1);
  return (await listFeedback(f.env, 1, A.owner)).items[0];
}
const value = {
  outcome: "Não",
  effort: 2,
  comment: "<script>PRIVATE</script>",
  consent: true,
};
const win = () => ({
  from: "2026-01-01T00:00:00.000Z",
  to: "2027-01-01T00:00:00.000Z",
  asOf: "2027-01-01T00:00:00.000Z",
});

test("instrument publication validates all business inputs, CAS, immutable versions and durable replay", async (t) => {
  const f = await fixture(t, { configured: false });
  const body = {
    definition,
    expectedVersion: 0,
    requestKey: crypto.randomUUID(),
  };
  await assert.rejects(
    publishFeedbackInstrument(f.env, 1, A.owner, {
      ...body,
      definition: { ...definition, windowHours: undefined },
    }),
  );
  await publishFeedbackInstrument(f.env, 1, A.owner, body);
  assert.equal(
    (await publishFeedbackInstrument(f.env, 1, A.owner, body)).replayed,
    true,
  );
  await assert.rejects(
    publishFeedbackInstrument(f.env, 1, A.owner, {
      ...body,
      requestKey: crypto.randomUUID(),
    }),
    { status: 409 },
  );
  assert.throws(
    () => f.sqlite.exec("UPDATE ticket_feedback_instruments SET version=2"),
    /IMMUTABLE/,
  );
  await assert.rejects(
    publishFeedbackInstrument(f.env, 1, A.viewer, {
      ...body,
      expectedVersion: 1,
    }),
    { status: 404 },
  );
});
test("unconfigured, historical, unknown legacy and foreign organization cycles emit no invites", async (t) => {
  const f = await fixture(t, { configured: false });
  seed(f);
  assert.equal((await reconcileFeedback(f.env, 1, A.owner)).issued, 0);
  await publishFeedbackInstrument(f.env, 1, A.owner, {
    definition,
    expectedVersion: 0,
    requestKey: crypto.randomUUID(),
  });
  f.sqlite.exec(
    "UPDATE ticket_cycles SET closed_at='2020-01-01T00:00:00.000Z'",
  );
  seed(f, 2);
  f.sqlite.exec(
    "UPDATE ticket_cycles SET origin='observed_baseline' WHERE ticket_id=2",
  );
  seed(f, 3, 2);
  assert.equal((await reconcileFeedback(f.env, 1, A.owner)).issued, 0);
});
test("issuance replay and concurrent issuance retain one invite, one event and requester-only candidate", async (t) => {
  const f = await fixture(t);
  seed(f);
  await Promise.all([
    reconcileFeedback(f.env, 1, A.owner),
    reconcileFeedback(f.env, 1, A.owner),
  ]);
  assert.equal(f.rows("ticket_feedback_invites").length, 1);
  assert.equal(f.rows("ticket_feedback_events").length, 1);
  assert.deepEqual(
    f.rows("ticket_notification_candidates").map((x) => x.recipient_id),
    [1],
  );
  assert.equal((await reconcileFeedback(f.env, 1, A.owner)).existing, 1);
});
test("CT47 concurrent same response returns same receipt; divergent second response conflicts; closure remains closed", async (t) => {
  const f = await fixture(t),
    i = await issued(f);
  const [a, b] = await Promise.all([
    respondFeedback(f.env, 1, A.owner, i.id, value),
    respondFeedback(f.env, 1, A.owner, i.id, value),
  ]);
  assert.equal(a.receipt, b.receipt);
  assert.equal(f.rows("ticket_feedback_responses").length, 1);
  await assert.rejects(
    respondFeedback(f.env, 1, A.owner, i.id, { ...value, effort: 0 }),
    { status: 409 },
  );
  assert.equal(f.row(1).status, "closed");
  assert.equal(f.rows("ticket_feedback_events").length, 2);
});
test("consent required; decline is explicit, unique, nonpositive and without comment", async (t) => {
  const f = await fixture(t),
    i = await issued(f);
  await assert.rejects(
    respondFeedback(f.env, 1, A.owner, i.id, { ...value, consent: false }),
  );
  await respondFeedback(f.env, 1, A.owner, i.id, { declined: true });
  const r = f.rows("ticket_feedback_responses")[0];
  assert.equal(r.comment, "");
  assert.equal(r.consent, 0);
  const g = aggregateFeedback(
    (await feedbackMetricSource(f.env, 1, A.owner)).rows,
    win(),
  ).groups[0];
  assert.equal(g.responses, 0);
  assert.equal(g.declined, 1);
  assert.equal(g.nonresponse, 1);
});
test("exact recipient required even for other managers, tenant hidden and revoked membership denied", async (t) => {
  const f = await fixture(t),
    i = await issued(f);
  await assert.rejects(respondFeedback(f.env, 1, A.peer, i.id, value), {
    status: 404,
  });
  assert.equal((await listFeedback(f.env, 1, A.peer)).items.length, 0);
  f.env.MAONO_TICKET_FEEDBACK_ORGANIZATION_IDS = "1,2";
  await assert.rejects(respondFeedback(f.env, 2, A.otherOwner, i.id, value), {
    status: 404,
  });
  f.sqlite.exec(
    "DELETE FROM organization_users WHERE user_id=1 AND organization_id=1",
  );
  await assert.rejects(respondFeedback(f.env, 1, A.owner, i.id, value), {
    status: 404,
  });
});
test("atomic response rollback on ACL revocation between authorization and batch", async (t) => {
  const f = await fixture(t),
    i = await issued(f);
  f.beforeNextBatch(() =>
    f.sqlite.exec(
      "UPDATE organization_tickets SET visibility='private' WHERE id=1",
    ),
  );
  await assert.rejects(respondFeedback(f.env, 1, A.owner, i.id, value));
  assert.equal(f.rows("ticket_feedback_responses").length, 0);
  assert.equal(f.rows("ticket_feedback_events").length, 1);
});
test("optional grant revocation during response batch is fenced", async (t) => {
  const f = await fixture(t),
    i = await issued(f);
  f.beforeNextBatch(() =>
    f.sqlite.exec(
      "INSERT INTO role_permissions(role,permission,scope_type,active) VALUES('owner','ticket.view','organization',0)",
    ),
  );
  await assert.rejects(respondFeedback(f.env, 1, A.owner, i.id, value), {
    status: 409,
  });
  assert.equal(f.rows("ticket_feedback_responses").length, 0);
});
test("failure after response insert rolls back response and receipt; retry succeeds once", async (t) => {
  const f = await fixture(t),
    i = await issued(f);
  f.failNextBatchAt(5);
  await assert.rejects(respondFeedback(f.env, 1, A.owner, i.id, value));
  assert.equal(f.rows("ticket_feedback_responses").length, 0);
  await respondFeedback(f.env, 1, A.owner, i.id, value);
  assert.equal(f.rows("ticket_feedback_events").length, 2);
});
test("GET is read only; comments never enter list, public event, outbox or aggregate facts", async (t) => {
  const f = await fixture(t),
    i = await issued(f);
  await respondFeedback(f.env, 1, A.owner, i.id, value);
  const before = f.snapshot();
  const list = await listFeedback(f.env, 1, A.owner);
  assert.deepEqual(f.snapshot(), before);
  assert.ok(!JSON.stringify(list).includes("PRIVATE"));
  for (const table of [
    "ticket_events",
    "ticket_command_outbox",
    "ticket_feedback_events",
  ])
    assert.ok(!JSON.stringify(f.rows(table)).includes("PRIVATE"));
  assert.ok(
    !JSON.stringify(await feedbackMetricSource(f.env, 1, A.owner)).includes(
      "PRIVATE",
    ),
  );
  assert.equal(await feedbackMetricSource(f.env, 1, A.viewer), null);
});
test("expiry is exclusive; response cannot bypass it; DB guards immutable and cross-scope data", async (t) => {
  const f = await fixture(t);
  seed(f);
  f.sqlite.exec(
    "INSERT INTO ticket_feedback_invites VALUES('expired',1,1,1,1,1,'2020-01-01T00:00:00.000Z','2020-01-02T00:00:00.000Z','2020-01-01T00:00:00.000Z')",
  );
  await assert.rejects(respondFeedback(f.env, 1, A.owner, "expired", value), {
    code: "TICKET_FEEDBACK_EXPIRED",
  });
  assert.throws(
    () =>
      f.sqlite.exec(
        "INSERT INTO ticket_feedback_invites VALUES('foreign',2,1,1,1,1,'2020-01-01','2020-01-02','2020-01-01')",
      ),
    /FOREIGN/,
  );
  assert.throws(
    () => f.sqlite.exec("DELETE FROM ticket_feedback_invites"),
    /IMMUTABLE/,
  );
});
test("delivery rechecks ACL and recipient; suppression retains denominator", async (t) => {
  const f = await fixture(t);
  await issued(f);
  f.sqlite.exec(
    "UPDATE organization_tickets SET visibility='private' WHERE id=1",
  );
  const r = await consumeTicketNotifications(f.env);
  assert.equal(r.suppressed, 1);
  assert.equal(f.rows("ticket_notifications").length, 0);
  assert.equal(f.rows("ticket_feedback_invites").length, 1);
});
test("delivery ACL change inside batch cannot deliver; later authorized retry delivers once", async (t) => {
  const f = await fixture(t);
  await issued(f);
  f.beforeNextBatch(() =>
    f.sqlite.exec(
      "UPDATE organization_tickets SET visibility='private' WHERE id=1",
    ),
  );
  const r = await consumeTicketNotifications(f.env);
  assert.equal(r.retried, 1);
  assert.equal(f.rows("ticket_notifications").length, 0);
  f.sqlite.exec(
    "UPDATE organization_tickets SET visibility='organization';UPDATE ticket_command_outbox SET notification_next_at=NULL",
  );
  await consumeTicketNotifications(f.env);
  assert.equal(f.rows("ticket_notifications").length, 1);
  await consumeTicketNotifications(f.env);
  assert.equal(f.rows("ticket_notifications").length, 1);
});
test("CC11 sixth family raw projection, replay, source drift, ACL and no comment persistence", async (t) => {
  const f = await fixture(t),
    i = await issued(f);
  let w = {
    from: win().from,
    to: new Date().toISOString(),
    asOf: new Date().toISOString(),
  };
  await respondFeedback(f.env, 1, A.owner, i.id, value);
  w = { ...w, to: new Date().toISOString(), asOf: new Date().toISOString() };
  let r = await replayMetrics(f.env, 1, A.owner, w);
  assert.equal(r.feedback.groups[0].immatureResponses, 1);
  assert.equal(r.feedback.groups[0].rate, null);
  assert.equal(r.aggregation.matched, 1);
  assert.equal((await replayMetrics(f.env, 1, A.owner, w)).replay.changed, 0);
  assert.ok(
    !JSON.stringify(f.rows("ticket_metric_rollups")).includes("PRIVATE"),
  );
  f.sqlite.exec(
    "UPDATE organization_tickets SET visibility='private' WHERE id=1",
  );
  r = await readMetrics(f.env, 1, A.owner, w);
  assert.equal(r.feedback.groups.length, 0);
});
test("CT48: 10 mature/4 responses =40%; 3 immature/2 replies kept separate; failure never shrinks denominator", () => {
  const base = {
    ticket_id: 1,
    closed_at: "2026-02-01T00:00:00.000Z",
    issued_at: "2026-02-01T00:00:00.000Z",
    eligible_until: "2026-02-02T00:00:00.000Z",
    instrument_version: 1,
    definition_json: JSON.stringify(definition),
    outcome: "Sim",
    effort: 0,
  };
  const rows = Array.from({ length: 13 }, (_, i) => ({
    ...base,
    eligible_until: i < 10 ? base.eligible_until : "2026-03-01T00:00:00.000Z",
    responded_at:
      i < 4 || i === 10 || i === 11 ? "2026-02-01T12:00:00.000Z" : null,
    delivery_status: i === 9 ? "failed" : "delivered",
  }));
  const g = aggregateFeedback(rows, {
    from: "2026-02-01T00:00:00.000Z",
    to: "2026-02-03T00:00:00.000Z",
    asOf: "2026-02-03T00:00:00.000Z",
  }).groups[0];
  assert.deepEqual(
    [
      g.mature,
      g.responses,
      g.rate,
      g.nonresponse,
      g.immature,
      g.immatureResponses,
      g.deliveryFailed,
    ],
    [10, 4, 0.4, 6, 3, 2, 1],
  );
});
test("CT48: no eligible cohort is empty; instrument versions remain independent; asOf excludes future replies", () => {
  const w = win();
  assert.equal(aggregateFeedback([], w).groups.length, 0);
  const rows = [1, 2].map((version) => ({
    instrument_version: version,
    definition_json: JSON.stringify(definition),
    closed_at: "2026-02-01T00:00:00.000Z",
    issued_at: "2026-02-01T00:00:00.000Z",
    eligible_until: "2026-02-02T00:00:00.000Z",
    responded_at: "2028-01-01T00:00:00.000Z",
  }));
  const g = aggregateFeedback(rows, w).groups;
  assert.equal(g.length, 2);
  assert.equal(g[0].responses, 0);
  assert.equal(g[1].responses, 0);
});
test("OFF and missing schema leave CC03 closure working; explicit reopen makes a separate cycle and invitation", async (t) => {
  const f = await fixture(t);
  const req = (etag) =>
    new Request("https://local.test", {
      headers: etag
        ? { "If-Match": etag }
        : { "Idempotency-Key": crypto.randomUUID() },
    });
  const created = await executeTicketCreate(
    f.env,
    1,
    A.owner,
    {
      subject: "Voluntary",
      description: "Fixture",
      category: "map",
      priority: "normal",
      assignedTo: 2,
      demandNature: "question_request",
      expectedResult: "Question answered",
      context: "Test",
      impact: "team",
      urgency: "soon",
      priorityReason: "",
      triageAnswers: {},
      triageFormVersion: 1,
    },
    req(),
  );
  f.env.MAONO_TICKET_FEEDBACK_ENABLED = "false";
  const closure = {
    outcomeCode: "answered",
    summary: "Question answered",
    evidence: "Reply sent",
    communication: "Requester informed",
    pendingChangeAcknowledged: true,
  };
  const closed = await executeTicketTransition(
    f.env,
    1,
    created.ticket.id,
    A.owner,
    { status: "closed", closure },
    req(created.etag),
  );
  assert.equal(closed.ticket.status, "closed");
  assert.equal(f.rows("ticket_feedback_invites").length, 0);
  f.env.MAONO_TICKET_FEEDBACK_ENABLED = "true";
  await reconcileFeedback(f.env, 1, A.owner);
  const i = (await listFeedback(f.env, 1, A.owner)).items[0];
  const reopened = await executeTicketReopen(
    f.env,
    1,
    created.ticket.id,
    A.owner,
    { reason: "Issue returned", nextAction: "Investigate" },
    req(closed.etag),
  );
  await respondFeedback(f.env, 1, A.owner, i.id, value);
  const second = await executeTicketTransition(
    f.env,
    1,
    created.ticket.id,
    A.owner,
    { status: "closed", closure },
    req(reopened.etag),
  );
  assert.equal(second.ticket.status, "closed");
  await reconcileFeedback(f.env, 1, A.owner);
  assert.deepEqual(
    f.rows("ticket_feedback_invites").map((i) => i.cycle_number),
    [1, 2],
  );
});
test("missing schema and preview fail closed; OFF reads empty without schema", async (t) => {
  const f = await fixture(t, { schema: false });
  await assert.rejects(feedbackReady(f.env, 1), { status: 503 });
  f.env.MAONO_TICKET_FEEDBACK_ENABLED = "false";
  assert.equal((await listFeedback(f.env, 1, A.owner)).enabled, false);
  f.env.MAONO_TICKET_FEEDBACK_ENABLED = "true";
  f.env.MAONO_RUNTIME_ENV = "preview";
  await assert.rejects(feedbackReady(f.env, 1), {
    code: "TICKET_FEEDBACK_RUNTIME_DENIED",
  });
});
test("HTTP: authenticated read no-store, missing session denied, cross-origin write and oversized body rejected", async (t) => {
  const f = await fixture(t),
    i = await issued(f);
  const call = (route, headers = {}, body, method = "GET") =>
    route({
      env: f.env,
      params: { id: "1", inviteId: i.id },
      request: new Request(
        "https://local.test/api/organizations/1/ticket-feedback",
        { method, headers, body: body === undefined ? undefined : body },
      ),
    });
  assert.notEqual((await call(collection)).status, 200);
  let r = await call(collection, { Cookie: f.sessionCookie() });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  r = await call(
    respondRoute,
    {
      Cookie: f.sessionCookie(),
      "Content-Type": "application/json",
      Origin: "https://evil.test",
    },
    JSON.stringify(value),
    "POST",
  );
  assert.equal(r.status, 403);
  r = await call(
    respondRoute,
    { Cookie: f.sessionCookie(), "Content-Type": "application/json" },
    JSON.stringify({ ...value, comment: "x".repeat(17000) }),
    "POST",
  );
  assert.equal(r.status, 413);
});

test("withdrawal is immutable, scoped and removes response from all currently computed cohorts without allowing a second response", async (t) => {
  const f = await fixture(t),
    i = await issued(f);
  await respondFeedback(f.env, 1, A.owner, i.id, value);
  await assert.rejects(withdrawFeedback(f.env, 1, A.peer, i.id), {
    status: 404,
  });
  const a = await withdrawFeedback(f.env, 1, A.owner, i.id);
  assert.equal(
    (await withdrawFeedback(f.env, 1, A.owner, i.id)).receipt,
    a.receipt,
  );
  const source = await feedbackMetricSource(f.env, 1, A.owner);
  assert.equal(source.rows[0].outcome, null);
  assert.equal(aggregateFeedback(source.rows, win()).groups[0].responses, 0);
  assert.equal(aggregateFeedback(source.rows, win()).groups[0].withdrawn, 1);
  assert.equal(
    (await listFeedback(f.env, 1, A.owner)).items[0].state,
    "withdrawn",
  );
  await assert.rejects(
    respondFeedback(f.env, 1, A.owner, i.id, { ...value, outcome: "Sim" }),
    { status: 409 },
  );
  assert.equal(f.rows("ticket_feedback_responses").length, 1);
  assert.equal(f.rows("ticket_feedback_events").length, 3);
});
test("fresh schema and upgrade expose identical feedback objects and valid foreign keys", async (t) => {
  const f = await fixture(t);
  const { DatabaseSync } = await import("node:sqlite");
  const fresh = new DatabaseSync(":memory:");
  try {
    fresh.exec(read("schema.sql"));
    const objects = (db) =>
      db
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE name LIKE 'ticket_feedback_%' ORDER BY name",
        )
        .all();
    assert.deepEqual(objects(f.sqlite), objects(fresh));
    assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      f.sqlite.prepare("PRAGMA quick_check").get().quick_check,
      "ok",
    );
  } finally {
    fresh.close();
  }
});
test("reconciler pagination progresses across existing cycles; late closure appears on a fresh scan", async (t) => {
  const f = await fixture(t);
  for (let n = 1; n <= 27; n++) seed(f, n);
  let r = await reconcileFeedback(f.env, 1, A.owner);
  assert.equal(r.issued, 25);
  assert.ok(r.nextCursor);
  r = await reconcileFeedback(f.env, 1, A.owner, { after: r.nextCursor });
  assert.equal(r.issued, 2);
  assert.equal(r.nextCursor, null);
  assert.equal(f.rows("ticket_feedback_invites").length, 27);
});

test("reconciler applies manager ACL before scanning, counts or issuing private cycles", async (t) => {
  const f = await fixture(t);
  seed(f);
  f.sqlite.exec("UPDATE organization_tickets SET visibility='private'");
  const r = await reconcileFeedback(f.env, 1, A.owner);
  assert.deepEqual(r, {
    issued: 0,
    existing: 0,
    excluded: 0,
    scanned: 0,
    nextCursor: null,
  });
  assert.equal(f.rows("ticket_feedback_invites").length, 0);
});

test("migration preflight rejects incomplete ledger, source drift and partially created feedback schema", async (t) => {
  const f = await fixture(t, { schema: false });
  const { CC15_SCHEMA_QUERY, evaluateCC15Schema } = await import(
    "../scripts/migrations/cc15-schema-preflight.mjs"
  );
  const names = [
    "0010_ticket_center.sql",
    "0025_ticket_triage_classification.sql",
    "0026_ticket_command_lifecycle.sql",
    "0027_ticket_selective_access.sql",
    "0028_ticket_conversations.sql",
    "0030_ticket_notifications.sql",
    "0031_ticket_change_reconciliation.sql",
    "0033_ticket_sla_policies.sql",
    "0034_ticket_metric_rollups.sql",
    "0035_ticket_report_exports.sql",
    "0036_ticket_incidents_problems.sql",
    "0037_ticket_knowledge.sql",
  ];
  const objects = f.sqlite.prepare(CC15_SCHEMA_QUERY).all(),
    ledger = names.map((name) => ({ name }));
  assert.equal(evaluateCC15Schema(objects, ledger).compatible, true);
  assert.equal(
    evaluateCC15Schema(objects, ledger.slice(0, -1)).compatible,
    false,
  );
  assert.equal(
    evaluateCC15Schema(
      objects.filter((o) => o.name !== "ticket_cycles"),
      ledger,
    ).compatible,
    false,
  );
  f.sqlite.exec(read("migrations/0038_ticket_feedback.sql"));
  assert.equal(
    evaluateCC15Schema(f.sqlite.prepare(CC15_SCHEMA_QUERY).all(), ledger)
      .compatible,
    false,
  );
});
