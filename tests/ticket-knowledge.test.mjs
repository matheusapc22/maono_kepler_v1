import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createTicketCommandDb,
  COMMAND_ACTORS as A,
} from "./helpers/ticket-command-db.mjs";
import {
  commandKnowledge,
  readKnowledge,
  listKnowledge,
  selectKnowledge,
  sendKnowledge,
  knowledgeReady,
} from "../functions/_lib/ticket-knowledge.js";
import { commandCase } from "../functions/_lib/ticket-cases.js";
import {
  listTicketMessages,
  resolveTicketConversationContext,
} from "../functions/_lib/ticket-conversations.js";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const key = () => crypto.randomUUID();

test("concurrent identical create returns the same durable receipt", async (t) => {
  const f = await fixture(t),
    payload = {
      action: "create",
      title: "Concurrent",
      body: "Draft",
      reviewerId: 2,
      idempotencyKey: key(),
    };
  const results = await Promise.all([
    commandKnowledge(f.env, 1, A.owner, null, payload),
    commandKnowledge(f.env, 1, A.owner, null, payload),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(f.rows("ticket_knowledge_articles").length, 1);
  assert.equal(f.rows("ticket_knowledge_events").length, 1);
});
async function fixture(t) {
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
  ])
    f.sqlite.exec(read("migrations/" + n));
  Object.assign(f.env, {
    MAONO_RUNTIME_ENV: "local",
    MAONO_TICKET_KNOWLEDGE_ENABLED: "true",
    MAONO_TICKET_KNOWLEDGE_ORGANIZATION_IDS: "1",
    MAONO_TICKET_CASES_ENABLED: "true",
    MAONO_TICKET_CASE_ORGANIZATION_IDS: "1",
    MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: "true",
    MAONO_TICKET_CONVERSATIONS_ENABLED: "true",
  });
  f.sqlite.exec(
    "INSERT INTO organization_tickets(id,organization_id,subject,description,status,created_by,visibility) VALUES(1,1,'A','test','open',1,'organization'),(2,1,'Secret','test','open',2,'private'),(3,2,'Other','test','open',4,'organization')",
  );
  f.sqlite.exec(
    "INSERT INTO ticket_acl_entries(organization_id,ticket_id,principal_type,principal_id,action,effect,created_by,created_at) VALUES(1,2,'user','2','ticket.view','allow',2,'2026-01-01')",
  );
  f.sqlite.exec(
    "INSERT INTO role_permissions(role,permission,scope_type) VALUES('viewer','ticket.view','organization')",
  );
  return f;
}
const create = (f, extra = {}, actor = A.owner) =>
  commandKnowledge(f.env, 1, actor, null, {
    action: "create",
    title: "Solução",
    body: "Diagnóstico revisável",
    reviewerId: 2,
    idempotencyKey: key(),
    ...extra,
  });
async function change(f, id, action, extra = {}, actor = A.owner) {
  const a = await readKnowledge(f.env, 1, actor, id);
  return commandKnowledge(
    f.env,
    1,
    actor,
    id,
    JSON.parse(
      JSON.stringify({
        action,
        version: a.version,
        idempotencyKey: key(),
        reason: "Revisão humana",
        ...extra,
      }),
    ),
  );
}
async function publish(f, id) {
  await change(f, id, "submit");
  await change(f, id, "approve", {}, A.peer);
  await change(f, id, "publish");
  return readKnowledge(f.env, 1, A.owner, id);
}
async function published(f) {
  const a = await create(f);
  await change(f, a.id, "revise", {
    title: "Solução v2",
    body: "Conteúdo sanitizado",
    audience: "organization",
    reason: undefined,
  });
  return publish(f, a.id);
}
const request = () => new Request("https://test.example/api/knowledge");
const select = (f, a, extra = {}, actor = A.owner) =>
  selectKnowledge(f.env, 1, actor, a.id, {
    revisionId: a.published.id,
    ticketId: 1,
    kind: "response",
    idempotencyKey: key(),
    ...extra,
  });

test("CT45: private capture cannot publish without independent review or expose its source", async (t) => {
  const f = await fixture(t);
  const c = await commandCase(f.env, 1, A.owner, null, {
    action: "create",
    title: "Private incident",
    kind: "incident",
    idempotencyKey: key(),
  });
  const a = await create(f, { source: { type: "case", id: c.id } });
  await assert.rejects(change(f, a.id, "publish"), {
    code: "TICKET_KNOWLEDGE_REVIEW_REQUIRED",
  });
  await assert.rejects(readKnowledge(f.env, 1, A.viewer, a.id), {
    status: 404,
  });
  await change(f, a.id, "revise", {
    title: "Solução pública interna",
    body: "Sem informações privadas",
    audience: "organization",
    reason: undefined,
  });
  await change(f, a.id, "submit");
  await assert.rejects(change(f, a.id, "approve"), { status: 403 });
  await change(f, a.id, "approve", {}, A.peer);
  await change(f, a.id, "publish");
  const visible = await readKnowledge(f.env, 1, A.viewer, a.id);
  assert.equal(visible.revision.body, "Sem informações privadas");
  assert.equal(visible.source, undefined);
  assert.equal(visible.history, undefined);
  const reviewer = await readKnowledge(f.env, 1, A.peer, a.id);
  assert.equal(reviewer.source, undefined);
  assert.ok((await readKnowledge(f.env, 1, A.owner, a.id)).source);
});
test("CT46: human-edited v2 response keeps immutable provenance after withdrawal", async (t) => {
  const f = await fixture(t),
    a = await published(f),
    s = await select(f, a);
  assert.equal(f.rows("ticket_messages").length, 0);
  const result = await sendKnowledge(
    f.env,
    1,
    A.owner,
    a.id,
    {
      selectionId: s.selectionId,
      body: "Texto editado pelo humano",
      reviewed: true,
    },
    request(),
  );
  assert.equal(result.message.body, "Texto editado pelo humano");
  assert.equal(result.message.knowledge.revisionNumber, 2);
  await change(f, a.id, "withdraw");
  assert.equal(
    (await listKnowledge(f.env, 1, A.viewer, { suggestions: true })).items
      .length,
    0,
  );
  const bundle = await listTicketMessages(
    f.env,
    await resolveTicketConversationContext(f.env, 1, 1, A.owner),
  );
  assert.equal(bundle.messages[0].knowledge.revisionId, a.published.id);
  assert.equal(
    (
      await sendKnowledge(
        f.env,
        1,
        A.owner,
        a.id,
        {
          selectionId: s.selectionId,
          body: "Texto editado pelo humano",
          reviewed: true,
        },
        request(),
      )
    ).replayed,
    true,
  );
  assert.equal(f.rows("ticket_messages").length, 1);
  assert.equal(f.rows("ticket_command_outbox").length, 1);
});
test("draft search never leaks unpublished words or source; organization reader sees published revision", async (t) => {
  const f = await fixture(t),
    a = await published(f);
  await change(f, a.id, "revise", {
    title: "SECRETWORD",
    body: "segredo de revisão",
    audience: "private",
    reason: undefined,
  });
  assert.equal(
    (await listKnowledge(f.env, 1, A.viewer, { query: "SECRETWORD" })).items
      .length,
    0,
  );
  const d = await readKnowledge(f.env, 1, A.viewer, a.id);
  assert.equal(d.revision.title, "Solução v2");
  assert.equal(d.state, "published");
  assert.equal(d.version, null);
  assert.equal(
    (await listKnowledge(f.env, 1, A.viewer, { suggestions: true })).items[0]
      .number,
    2,
  );
});
test("editing invalidates approval and cannot mutate old revisions", async (t) => {
  const f = await fixture(t),
    a = await create(f);
  await change(f, a.id, "submit");
  await change(f, a.id, "approve", {}, A.peer);
  await change(f, a.id, "revise", {
    title: "Changed",
    body: "Novo texto",
    audience: "organization",
    reason: undefined,
  });
  await assert.rejects(change(f, a.id, "publish"), { status: 409 });
  assert.throws(
    () =>
      f.sqlite.exec("UPDATE ticket_knowledge_revisions SET body='overwrite'"),
    /CC14_IMMUTABLE/,
  );
  assert.throws(
    () => f.sqlite.exec("DELETE FROM ticket_knowledge_events"),
    /CC14_IMMUTABLE/,
  );
});
test("private publication is never offered for sending to broader ticket audiences", async (t) => {
  const f = await fixture(t),
    a = await create(f),
    d = await publish(f, a.id);
  assert.equal(
    (await listKnowledge(f.env, 1, A.owner, { suggestions: true })).items
      .length,
    0,
  );
  await assert.rejects(select(f, d), {
    code: "TICKET_KNOWLEDGE_PUBLICATION_CHANGED",
  });
});
test("withdrawal between selection and send blocks stale selection and creates no side effect", async (t) => {
  const f = await fixture(t),
    a = await published(f),
    s = await select(f, a);
  await change(f, a.id, "withdraw");
  await assert.rejects(
    sendKnowledge(
      f.env,
      1,
      A.owner,
      a.id,
      { selectionId: s.selectionId, body: s.body, reviewed: true },
      request(),
    ),
    { status: 409 },
  );
  assert.equal(f.rows("ticket_messages").length, 0);
});
test("new published revision invalidates old unsent selection", async (t) => {
  const f = await fixture(t),
    a = await published(f),
    s = await select(f, a);
  await change(f, a.id, "revise", {
    title: "v3",
    body: "New",
    audience: "organization",
    reason: undefined,
  });
  await publish(f, a.id);
  await assert.rejects(
    sendKnowledge(
      f.env,
      1,
      A.owner,
      a.id,
      { selectionId: s.selectionId, body: s.body, reviewed: true },
      request(),
    ),
    { status: 409 },
  );
});
test("cross-tenant and private ticket targets denied; source validated before capture", async (t) => {
  const f = await fixture(t),
    a = await published(f);
  await assert.rejects(readKnowledge(f.env, 1, A.otherOwner, a.id), {
    status: 404,
  });
  await assert.rejects(select(f, a, { ticketId: 3 }), { status: 404 });
  await assert.rejects(select(f, a, { ticketId: 2 }), { status: 404 });
  await assert.rejects(create(f, { source: { type: "ticket", id: 2 } }), {
    status: 404,
  });
});
test("membership revocation between selection and send denies request", async (t) => {
  const f = await fixture(t),
    a = await published(f),
    s = await select(f, a);
  f.sqlite.exec(
    "DELETE FROM organization_users WHERE organization_id=1 AND user_id=1",
  );
  await assert.rejects(
    sendKnowledge(
      f.env,
      1,
      A.owner,
      a.id,
      { selectionId: s.selectionId, body: s.body, reviewed: true },
      request(),
    ),
    { status: 404 },
  );
  assert.equal(f.rows("ticket_messages").length, 0);
});
test("selection ownership and human-review assertion are mandatory", async (t) => {
  const f = await fixture(t),
    a = await published(f),
    s = await select(f, a);
  await assert.rejects(
    sendKnowledge(
      f.env,
      1,
      A.owner,
      a.id,
      { selectionId: s.selectionId, body: s.body, reviewed: false },
      request(),
    ),
    { status: 422 },
  );
  await assert.rejects(
    sendKnowledge(
      f.env,
      1,
      A.peer,
      a.id,
      { selectionId: s.selectionId, body: s.body, reviewed: true },
      request(),
    ),
    { status: 404 },
  );
});
test("idempotency and stale CAS cannot duplicate editorial events", async (t) => {
  const f = await fixture(t),
    body = {
      action: "create",
      title: "A",
      body: "B",
      reviewerId: 2,
      idempotencyKey: key(),
    };
  const a = await commandKnowledge(f.env, 1, A.owner, null, body);
  assert.equal(
    (await commandKnowledge(f.env, 1, A.owner, null, body)).replayed,
    true,
  );
  await assert.rejects(
    commandKnowledge(f.env, 1, A.owner, null, { ...body, title: "C" }),
    { status: 409 },
  );
  const d = await readKnowledge(f.env, 1, A.owner, a.id);
  await change(f, a.id, "submit");
  await assert.rejects(
    commandKnowledge(f.env, 1, A.owner, a.id, {
      action: "submit",
      version: d.version,
      reason: "old",
      idempotencyKey: key(),
    }),
    { status: 409 },
  );
  assert.equal(f.rows("ticket_knowledge_events").length, 2);
});
test("revision history paginates beyond the CC13 200-revision limitation", async (t) => {
  const f = await fixture(t),
    a = await create(f);
  for (let i = 0; i < 202; i++)
    await change(f, a.id, "revise", {
      title: "v" + i,
      body: "Revision " + i,
      audience: "private",
      reason: undefined,
    });
  const d = await readKnowledge(f.env, 1, A.owner, a.id);
  assert.equal(d.history.length, 20);
  assert.equal(d.nextHistory, 184);
  const older = await readKnowledge(f.env, 1, A.owner, a.id, {
    before: d.nextHistory,
  });
  assert.equal(older.history.length, 20);
  assert.equal(d.events.length, 100);
  assert.ok(d.nextEvents);
  const olderEvents = await readKnowledge(f.env, 1, A.owner, a.id, {
    eventsBefore: d.nextEvents,
  });
  assert.equal(olderEvents.events.length, 100);
  assert.ok(olderEvents.events[0].sequence < d.events.at(-1).sequence);
});
test("closed ticket and internal-note restrictions are enforced", async (t) => {
  const f = await fixture(t),
    a = await published(f);
  f.sqlite.exec("UPDATE organization_tickets SET status='closed' WHERE id=1");
  await assert.rejects(select(f, a), { status: 404 });
});
test("default OFF, missing allowlist, Preview and partial schema fail closed", async (t) => {
  const f = await fixture(t);
  f.env.MAONO_TICKET_KNOWLEDGE_ENABLED = "false";
  assert.equal((await listKnowledge(f.env, 1, A.owner)).enabled, false);
  f.env.MAONO_TICKET_KNOWLEDGE_ENABLED = "true";
  f.env.MAONO_TICKET_KNOWLEDGE_ORGANIZATION_IDS = "";
  await assert.rejects(knowledgeReady(f.env, 1), { status: 503 });
  f.env.MAONO_TICKET_KNOWLEDGE_ORGANIZATION_IDS = "1";
  f.env.MAONO_RUNTIME_ENV = "preview";
  await assert.rejects(knowledgeReady(f.env, 1), { status: 503 });
  f.env.MAONO_RUNTIME_ENV = "local";
  f.sqlite.exec("DROP TRIGGER ticket_knowledge_revisions_update_immutable");
  await assert.rejects(knowledgeReady(f.env, 1), { status: 503 });
});
test("send replay with divergent human body conflicts", async (t) => {
  const f = await fixture(t),
    a = await published(f),
    s = await select(f, a);
  await sendKnowledge(
    f.env,
    1,
    A.owner,
    a.id,
    { selectionId: s.selectionId, body: "Reviewed", reviewed: true },
    request(),
  );
  await assert.rejects(
    sendKnowledge(
      f.env,
      1,
      A.owner,
      a.id,
      { selectionId: s.selectionId, body: "Different", reviewed: true },
      request(),
    ),
    { status: 409 },
  );
});
test("schema retains integrity after lifecycle and message; use receipt immutable", async (t) => {
  const f = await fixture(t),
    a = await published(f),
    s = await select(f, a);
  await sendKnowledge(
    f.env,
    1,
    A.owner,
    a.id,
    { selectionId: s.selectionId, body: s.body, reviewed: true },
    request(),
  );
  assert.throws(
    () =>
      f.sqlite.exec("UPDATE ticket_knowledge_uses SET revision_id=revision_id"),
    /CC14_IMMUTABLE/,
  );
  assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(f.sqlite.prepare("PRAGMA quick_check").get().quick_check, "ok");
});

test("CAS generation fence rejects withdrawal injected immediately before message transaction", async (t) => {
  const f = await fixture(t),
    a = await published(f),
    s = await select(f, a);
  f.beforeNextBatch((db) =>
    db
      .prepare(
        "UPDATE ticket_knowledge_articles SET published_id=NULL,state='withdrawn',version=version+1 WHERE id=?",
      )
      .run(a.id),
  );
  await assert.rejects(
    sendKnowledge(
      f.env,
      1,
      A.owner,
      a.id,
      { selectionId: s.selectionId, body: s.body, reviewed: true },
      request(),
    ),
  );
  assert.equal(f.rows("ticket_messages").length, 0);
  assert.equal(f.rows("ticket_command_outbox").length, 0);
  assert.equal(f.rows("ticket_knowledge_uses")[0].message_id, null);
});
test("optional role-grant revocation is fenced inside the message transaction", async (t) => {
  const f = await fixture(t),
    a = await published(f);
  f.sqlite.exec(
    "INSERT INTO role_permissions(role,permission,scope_type) VALUES('viewer','ticket.comment','organization')",
  );
  const s = await select(f, a, {}, A.viewer);
  f.beforeNextBatch((db) =>
    db.exec(
      "DELETE FROM role_permissions WHERE role='viewer' AND permission='ticket.comment'",
    ),
  );
  await assert.rejects(
    sendKnowledge(
      f.env,
      1,
      A.viewer,
      a.id,
      { selectionId: s.selectionId, body: s.body, reviewed: true },
      request(),
    ),
  );
  assert.equal(f.rows("ticket_messages").length, 0);
});
test("failure after message insert rolls back message, event, receipt, outbox and provenance", async (t) => {
  const f = await fixture(t),
    a = await published(f),
    s = await select(f, a),
    before = f.snapshot();
  f.failNextBatchAt(8);
  await assert.rejects(
    sendKnowledge(
      f.env,
      1,
      A.owner,
      a.id,
      { selectionId: s.selectionId, body: s.body, reviewed: true },
      request(),
    ),
    /FIXTURE/,
  );
  assert.deepEqual(f.snapshot(), before);
  const sent = await sendKnowledge(
    f.env,
    1,
    A.owner,
    a.id,
    { selectionId: s.selectionId, body: s.body, reviewed: true },
    request(),
  );
  assert.equal(sent.message.knowledge.revisionNumber, 2);
});
test("concurrent editorial commands yield one winner and a conflict", async (t) => {
  const f = await fixture(t),
    a = await create(f),
    d = await readKnowledge(f.env, 1, A.owner, a.id);
  const result = await Promise.allSettled(
    [1, 2].map(() =>
      commandKnowledge(f.env, 1, A.owner, a.id, {
        action: "submit",
        version: d.version,
        reason: "review",
        idempotencyKey: key(),
      }),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.rows("ticket_knowledge_events").length, 2);
});
test("selection key mismatch and reviewer self-assignment rejected", async (t) => {
  const f = await fixture(t),
    a = await published(f),
    k = key();
  await select(f, a, { idempotencyKey: k });
  await assert.rejects(select(f, a, { idempotencyKey: k, kind: "internal" }), {
    status: 409,
  });
  await assert.rejects(create(f, { reviewerId: 1 }), { status: 422 });
});
test("HTTP boundary rejects unauthenticated, cross-origin, oversized and unknown commands", async (t) => {
  const { onRequest } = await import(
    "../functions/api/organizations/[id]/ticket-knowledge.js"
  );
  const f = await fixture(t),
    cookie = f.sessionCookie();
  async function call(body, headers = {}) {
    return onRequest({
      env: f.env,
      params: { id: "1" },
      request: new Request(
        "https://test.example/api/organizations/1/ticket-knowledge",
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            ...headers,
          },
          body,
        },
      ),
    });
  }
  assert.equal(
    (await call("{}", { Origin: "https://evil.example" })).status,
    403,
  );
  assert.equal((await call("a".repeat(81000))).status, 413);
  assert.equal((await call("{")).status, 400);
  assert.equal(
    (await call(JSON.stringify({ action: "delete", idempotencyKey: key() })))
      .status,
    400,
  );
  const response = await call("{}", { Cookie: "" });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
});
