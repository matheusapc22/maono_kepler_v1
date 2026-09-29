import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createTicketCommandDb,
  COMMAND_ACTORS as A,
} from "./helpers/ticket-command-db.mjs";
import {
  commandCase,
  readCase,
  listCases,
  casesReady,
  communicateCase,
} from "../functions/_lib/ticket-cases.js";
import {
  createTicketExport,
  processExportStep,
  readTicketExport,
  downloadTicketExport,
} from "../functions/_lib/ticket-exports.js";
import { onRequest } from "../functions/api/organizations/[id]/ticket-cases.js";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const key = () => crypto.randomUUID();
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
  ])
    f.sqlite.exec(read("migrations/" + n));
  Object.assign(f.env, {
    MAONO_RUNTIME_ENV: "local",
    MAONO_TICKET_CASES_ENABLED: "true",
    MAONO_TICKET_CASE_ORGANIZATION_IDS: "1",
    MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: "true",
    MAONO_TICKET_CONVERSATIONS_ENABLED: "true",
  });
  f.sqlite.exec(
    "INSERT INTO organization_tickets(id,organization_id,subject,description,status,created_by,visibility) VALUES(1,1,'A','test','open',1,'organization'),(2,1,'Secret','test','open',2,'private'),(3,2,'Other org','test','open',4,'organization')",
  );
  f.sqlite.exec(
    "INSERT INTO ticket_acl_entries(organization_id,ticket_id,principal_type,principal_id,action,effect,created_by,created_at) VALUES(1,2,'user','2','ticket.view','allow',2,'2026-01-01')",
  );
  return f;
}
const create = (f, extra = {}, actor = A.owner) =>
  commandCase(f.env, 1, actor, null, {
    action: "create",
    kind: "incident",
    title: "Service",
    idempotencyKey: key(),
    ...extra,
  });
async function change(f, caseId, action, extra = {}, actor = A.owner) {
  const d = await readCase(f.env, 1, actor, caseId);
  return commandCase(f.env, 1, actor, caseId, {
    action,
    version: d.record.version,
    idempotencyKey: key(),
    ...extra,
  });
}
test("CT43: mitigation/restoration without cause never closes related tickets", async (t) => {
  const f = await fixture(t),
    r = await create(f);
  await change(f, r.id, "link", { target: { type: "ticket", id: 1 } });
  await change(f, r.id, "transition", {
    state: "mitigating",
    data: { mitigation: "Contorno", reason: "Mitigar" },
  });
  await change(f, r.id, "transition", {
    state: "restored",
    data: { restoration: "Serviço verificado", reason: "Restaurado" },
  });
  const d = await readCase(f.env, 1, A.owner, r.id);
  assert.equal(d.record.state, "restored");
  assert.equal(d.record.data.causeStatus, "unknown");
  assert.equal(f.row(1).status, "open");
  assert.equal(f.rows("ticket_command_outbox").length, 0);
  await change(f, r.id, "transition", {
    state: "closed",
    data: { reason: "Coordenado" },
  });
  await change(f, r.id, "transition", {
    state: "open",
    data: { reason: "Recidiva" },
  });
  assert.equal(f.row(1).status, "open");
});
test("CT44: independent private links filter IDs, counts and revision numbers", async (t) => {
  const f = await fixture(t),
    r = await create(f, { kind: "problem", visibility: "organization" });
  await change(f, r.id, "link", { target: { type: "ticket", id: 1 } });
  await change(f, r.id, "link", { target: { type: "ticket", id: 2 } }, A.peer);
  const d = await readCase(f.env, 1, A.owner, r.id);
  assert.equal(d.links.length, 1);
  assert.equal(d.history.filter((e) => e.action === "link").length, 1);
  assert.equal(typeof d.record.version, "string");
  assert.ok(!JSON.stringify(d).includes("Secret"));
  assert.equal(d.links[0].target.id, 1);
  const p = await create(
    f,
    { title: "Private problem", kind: "problem" },
    A.peer,
  );
  assert.equal((await listCases(f.env, 1, A.owner)).items.length, 1);
  await assert.rejects(readCase(f.env, 1, A.owner, p.id), { status: 404 });
  await assert.rejects(listCases(f.env, 1, A.owner, { after: p.id }), {
    status: 404,
  });
});
test("cross-tenant ticket and case links denied by service and SQL", async (t) => {
  const f = await fixture(t),
    r = await create(f);
  await assert.rejects(
    change(f, r.id, "link", { target: { type: "ticket", id: 3 } }),
    (e) => [403, 404].includes(e.status),
  );
  assert.throws(
    () =>
      f.sqlite
        .prepare(
          "INSERT INTO ticket_case_links(id,organization_id,case_id,ticket_id,relation,created_by,created_at) VALUES('bad',1,?,3,'related',1,'now')",
        )
        .run(r.id),
    /CC13_TENANT/,
  );
  await assert.rejects(
    change(f, r.id, "link", { target: { type: "case", id: r.id } }),
    { code: "TICKET_CASE_SELF_LINK" },
  );
});
test("idempotency, divergent replay and stale entity version", async (t) => {
  const f = await fixture(t),
    body = {
      action: "create",
      kind: "incident",
      title: "Once",
      idempotencyKey: key(),
    };
  const r = await commandCase(f.env, 1, A.owner, null, body);
  assert.equal(
    (await commandCase(f.env, 1, A.owner, null, body)).replayed,
    true,
  );
  await assert.rejects(
    commandCase(f.env, 1, A.owner, null, { ...body, title: "Other" }),
    { status: 409 },
  );
  const d = await readCase(f.env, 1, A.owner, r.id);
  await change(f, r.id, "update", { data: { impact: "Impact" } });
  await assert.rejects(
    commandCase(f.env, 1, A.owner, r.id, {
      action: "update",
      version: d.record.version,
      idempotencyKey: key(),
      data: { impact: "lost" },
    }),
    { status: 409 },
  );
  assert.equal(f.rows("ticket_cases").length, 1);
});
test("CAS/generation fence rolls back membership, events and receipt on concurrent revocation", async (t) => {
  const f = await fixture(t),
    r = await create(f, { visibility: "organization" }),
    d = await readCase(f.env, 1, A.peer, r.id);
  f.beforeNextBatch((sqlite) =>
    sqlite
      .prepare("UPDATE ticket_cases SET visibility='private' WHERE id=?")
      .run(r.id),
  );
  await assert.rejects(
    commandCase(f.env, 1, A.peer, r.id, {
      action: "audience",
      visibility: "organization",
      members: [3],
      version: d.record.version,
      idempotencyKey: key(),
    }),
  );
  assert.equal(f.rows("ticket_case_members").length, 0);
  assert.equal(f.rows("ticket_case_events").length, 1);
  assert.equal(f.rows("ticket_case_commands").length, 1);
});
test("failure inside command batch rolls back record/event/receipt", async (t) => {
  const f = await fixture(t);
  f.failNextBatchAt(3);
  await assert.rejects(create(f));
  assert.equal(f.rows("ticket_cases").length, 0);
  assert.equal(f.rows("ticket_case_events").length, 0);
  assert.equal(f.rows("ticket_case_commands").length, 0);
});
test("cause evidence required, post-mortem revisions preserve history", async (t) => {
  const f = await fixture(t),
    r = await create(f, { kind: "problem" });
  await assert.rejects(
    change(f, r.id, "update", {
      data: { causeStatus: "confirmed", cause: "Root" },
    }),
    { code: "TICKET_CASE_EVIDENCE_REQUIRED" },
  );
  await change(f, r.id, "update", {
    data: {
      causeStatus: "hypothesis",
      cause: "Hypothesis",
      postMortem: "Initial decision",
    },
  });
  await change(f, r.id, "update", {
    data: {
      causeStatus: "confirmed",
      cause: "Root",
      causeEvidence: "Reviewed evidence",
      postMortem: "Final decision",
    },
  });
  const d = await readCase(f.env, 1, A.owner, r.id);
  assert.equal(d.history.length, 3);
  assert.ok(JSON.stringify(d.history).includes("Initial decision"));
  assert.throws(
    () => f.sqlite.exec("DELETE FROM ticket_case_events"),
    /CC13_IMMUTABLE/,
  );
  assert.throws(
    () => f.sqlite.exec("UPDATE ticket_case_events SET action='rewrite'"),
    /CC13_IMMUTABLE/,
  );
});
test("deduplication requires human decision, preserves both records", async (t) => {
  const f = await fixture(t),
    a = await create(f),
    b = await create(f);
  await assert.rejects(
    change(f, a.id, "link", {
      target: { type: "case", id: b.id },
      relation: "duplicate_confirmed",
    }),
    { code: "TICKET_CASE_REVIEW_REQUIRED" },
  );
  await change(f, a.id, "link", {
    target: { type: "case", id: b.id },
    relation: "duplicate_candidate",
  });
  await change(f, a.id, "review_duplicate", {
    target: { type: "case", id: b.id },
    relation: "duplicate_confirmed",
    data: { reason: "Reviewed reports" },
  });
  assert.equal(f.rows("ticket_cases").length, 2);
  assert.equal(
    (await readCase(f.env, 1, A.owner, a.id)).links[0].relation,
    "duplicate_confirmed",
  );
});
test("read and write require current actor and explicit audience, no role bypass", async (t) => {
  const f = await fixture(t),
    r = await create(f);
  await assert.rejects(readCase(f.env, 1, A.peer, r.id), { status: 404 });
  await change(f, r.id, "audience", { visibility: "private", members: [2] });
  assert.equal((await readCase(f.env, 1, A.peer, r.id)).record.id, r.id);
  await change(f, r.id, "audience", { visibility: "private", members: [] });
  await assert.rejects(readCase(f.env, 1, A.peer, r.id), { status: 404 });
  f.sqlite.exec("UPDATE users SET active=0 WHERE id=1");
  await assert.rejects(readCase(f.env, 1, A.owner, r.id), { status: 404 });
});
test("human-reviewed communication reuses CC05 event/outbox atomically and never copies case data", async (t) => {
  const f = await fixture(t),
    r = await create(f, { title: "PRIVATE HEADER" });
  await change(f, r.id, "link", { target: { type: "ticket", id: 1 } });
  const d = await readCase(f.env, 1, A.owner, r.id);
  const request = new Request("https://local.test", {
      headers: { "Idempotency-Key": key() },
    }),
    body = {
      ticketId: 1,
      version: d.record.version,
      kind: "response",
      body: "Reviewed update",
    };
  const result = await communicateCase(f.env, 1, A.owner, r.id, body, request);
  assert.equal(result.message.body, "Reviewed update");
  assert.equal(f.rows("ticket_command_outbox").length, 1);
  assert.ok(
    !JSON.stringify(f.rows("ticket_messages")).includes("PRIVATE HEADER"),
  );
  assert.equal(
    (await communicateCase(f.env, 1, A.owner, r.id, body, request)).replayed,
    true,
  );
  assert.equal(f.rows("ticket_command_outbox").length, 1);
});
test("communication denies revocation between authorization and write", async (t) => {
  const f = await fixture(t),
    r = await create(f);
  await change(f, r.id, "link", { target: { type: "ticket", id: 1 } });
  const d = await readCase(f.env, 1, A.owner, r.id);
  f.beforeNextBatch((s) =>
    s.exec(
      "UPDATE organization_tickets SET visibility='private',created_by=2 WHERE id=1",
    ),
  );
  await assert.rejects(
    communicateCase(
      f.env,
      1,
      A.owner,
      r.id,
      {
        ticketId: 1,
        version: d.record.version,
        kind: "response",
        body: "Reviewed",
      },
      new Request("https://local.test", {
        headers: { "Idempotency-Key": key() },
      }),
    ),
  );
  assert.equal(f.rows("ticket_messages").length, 0);
  assert.equal(f.rows("ticket_command_outbox").length, 0);
});
test("HTTP authenticates, enforces same origin/bounded body, and OFF/preview are safe", async (t) => {
  const f = await fixture(t),
    url = "https://local.test/api/organizations/1/ticket-cases";
  const call = (request) =>
    onRequest({ env: f.env, params: { id: "1" }, request });
  assert.equal((await call(new Request(url))).status, 401);
  const cookie = f.sessionCookie();
  assert.equal(
    (
      await call(
        new Request(url, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "https://evil.test",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        new Request(url, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: "x".repeat(24001),
        }),
      )
    ).status,
    413,
  );
  f.env.MAONO_TICKET_CASES_ENABLED = "false";
  assert.deepEqual(await listCases(f.env, 1, A.owner), {
    enabled: false,
    items: [],
    nextCursor: null,
  });
  f.env.MAONO_TICKET_CASES_ENABLED = "true";
  f.env.MAONO_RUNTIME_ENV = "preview";
  await assert.rejects(casesReady(f.env, 1), { status: 503 });
});
test("migration upgrades and fresh schema have valid foreign keys", async (t) => {
  const f = await fixture(t);
  assert.equal(f.sqlite.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  const fresh = new DatabaseSync(":memory:");
  t.after(() => fresh.close());
  fresh.exec(read("schema.sql"));
  assert.ok(
    fresh
      .prepare("SELECT name FROM sqlite_master WHERE name='ticket_cases'")
      .get(),
  );
});
test("authorized list paginates completely with no hidden records", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 24; i++) await create(f, { title: "Case " + i });
  await create(f, { title: "Secret" }, A.peer);
  const a = await listCases(f.env, 1, A.owner);
  const b = await listCases(f.env, 1, A.owner, { after: a.nextCursor });
  assert.equal(a.items.length + b.items.length, 24);
  assert.equal(b.nextCursor, null);
});
async function exportFixture(t) {
  const f = await fixture(t);
  f.sqlite.exec("UPDATE users SET role='editor' WHERE id=1");
  for (const p of [
    "ticket.manage",
    "export.create",
    "export.view",
    "export.download",
  ])
    f.sqlite
      .prepare(
        "INSERT INTO user_permissions(user_id,permission,organization_id,active) VALUES(?,?,1,1)",
      )
      .run(1, p);
  Object.assign(f.env, {
    MAONO_TICKET_EXPORTS_ENABLED: "true",
    MAONO_TICKET_EXPORT_ORGANIZATION_IDS: "1",
    MAONO_TICKET_EXPORT_TTL_SECONDS: "3600",
    MAONO_TICKET_EXPORT_MAX_ROWS: "1000",
    MAONO_TICKET_EXPORT_MAX_BYTES: "10485760",
    MAONO_TICKET_EXPORT_MAX_JOBS_PER_ORG: "10",
    MAONO_TICKET_EXPORT_MAX_ATTEMPTS: "3",
    MAONO_TICKET_EXPORT_CSV_PROFILE: "text-v1",
  });
  const files = new Map();
  f.storage = {
    async put(p, b) {
      files.set(p.id, b);
    },
    async get(p) {
      return new Response(files.get(p.id));
    },
    async remove(p) {
      files.delete(p.id);
    },
  };
  return f;
}
const exportBody = () => ({
  idempotencyKey: key(),
  report: "causes",
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-09-01T00:00:00.000Z",
  asOf: new Date().toISOString(),
});
async function drain(f) {
  for (let i = 0; i < 20; i++) {
    await processExportStep(f.env, 1, { storage: f.storage });
    const j = f.rows("ticket_export_jobs")[0];
    if (["ready", "failed", "revoked"].includes(j.state)) return j;
  }
  throw Error("not done");
}
test("CT41 expanded: distinct cases, explicit unknown, private exclusion and safe CSV", async (t) => {
  const f = await exportFixture(t),
    a = await create(f, { title: "=formula" }),
    b = await create(f, { kind: "problem" });
  await change(f, a.id, "link", { target: { type: "ticket", id: 1 } });
  await change(f, b.id, "link", { target: { type: "ticket", id: 1 } });
  const hidden = await create(f, { title: "Hidden" }, A.peer);
  await change(
    f,
    hidden.id,
    "link",
    { target: { type: "ticket", id: 1 } },
    A.peer,
  );
  const { job } = await createTicketExport(f.env, 1, A.owner, exportBody());
  const done = await drain(f);
  assert.equal(done.state, "ready", done.error_code);
  const { manifest } = await readTicketExport(f.env, 1, A.owner, job.id);
  assert.equal(manifest.totals.tickets, 1);
  assert.equal(manifest.causes.records, 2);
  assert.equal(manifest.causes.unknownCauses, 2);
  const csv = await (
    await downloadTicketExport(f.env, 1, A.owner, job.id, {
      storage: f.storage,
    })
  ).text();
  assert.ok(csv.includes("cases_json"));
  assert.ok(!csv.includes("Hidden"));
  assert.ok(csv.includes("text:["));
  await change(f, b.id, "unlink", { target: { type: "ticket", id: 1 } });
  await assert.rejects(
    downloadTicketExport(f.env, 1, A.owner, job.id, { storage: f.storage }),
    { status: 404 },
  );
});
test("CT42 expanded: case source mutation fences snapshot capture", async (t) => {
  const f = await exportFixture(t),
    r = await create(f);
  await change(f, r.id, "link", { target: { type: "ticket", id: 1 } });
  await createTicketExport(f.env, 1, A.owner, exportBody());
  await change(f, r.id, "update", { data: { impact: "Changed" } });
  const done = await drain(f);
  assert.equal(done.state, "failed");
  assert.equal(done.error_code, "SOURCE_CHANGED");
});

test("change links reauthorize the CR/project independently; grant removal hides relation and event", async (t) => {
  const f = await fixture(t),
    r = await create(f, { visibility: "organization" });
  f.sqlite
    .exec(`INSERT INTO projects(id,organization_id,name,slug,dropbox_root_path)VALUES(1,1,'Mapa','mapa','/mapa');
  INSERT INTO user_projects(project_id,user_id,access_level)VALUES(1,1,'owner'),(1,2,'viewer');
  INSERT INTO project_change_requests(id,organization_id,project_id,requested_by_user_id,ticket_id,base_revision,status,reason,idempotency_key,submission_hash)VALUES('cr-linked',1,1,2,1,1,'submitted','Proposta','unique','hash');`);
  const cr = f.sqlite
    .prepare(
      "SELECT id FROM change_records WHERE change_request_id='cr-linked'",
    )
    .get();
  await change(f, r.id, "link", {
    target: { type: "change", id: cr.id },
    relation: "implements",
  });
  assert.equal((await readCase(f.env, 1, A.peer, r.id)).links.length, 1);
  f.sqlite.exec("DELETE FROM user_projects WHERE user_id=2");
  const d = await readCase(f.env, 1, A.peer, r.id);
  assert.equal(d.links.length, 0);
  assert.ok(!JSON.stringify(d).includes(cr.id));
  assert.equal(
    f.sqlite
      .prepare(
        "SELECT status FROM project_change_requests WHERE id='cr-linked'",
      )
      .get().status,
    "submitted",
  );
});

test("CC13 preflight requires exact prerequisites, rejects partial deployment and digest drift", async (t) => {
  const { evaluateCC13Schema, assertCC13Schema, CC13_SCHEMA_QUERY } =
    await import("../scripts/migrations/cc13-schema-preflight.mjs");
  const f = await createTicketCommandDb(t);
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
  ];
  for (const name of names.slice(3)) f.sqlite.exec(read("migrations/" + name));
  const ledger = names.map((name) => ({ name })),
    objects = f.sqlite.prepare(CC13_SCHEMA_QUERY).all();
  const initial = evaluateCC13Schema(objects, ledger);
  assert.equal(initial.compatible, true);
  assertCC13Schema(initial);
  assert.throws(
    () =>
      assertCC13Schema(
        evaluateCC13Schema(
          objects,
          ledger.filter((x) => !x.name.startsWith("0035")),
        ),
      ),
    { code: "CC13_SCHEMA_PREFLIGHT_BLOCKED" },
  );
  f.sqlite.exec(read("migrations/0036_ticket_incidents_problems.sql"));
  const deployed = evaluateCC13Schema(
    f.sqlite.prepare(CC13_SCHEMA_QUERY).all(),
    ledger,
  );
  assert.equal(deployed.compatible, false);
  assert.notEqual(initial.digest, deployed.digest);
  const fresh = new DatabaseSync(":memory:");
  t.after(() => fresh.close());
  fresh.exec(read("schema.sql"));
  const select =
    "SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'ticket_case_%' OR name LIKE 'ticket_export_epoch_ticket_case%' ORDER BY name";
  assert.deepEqual(f.sqlite.prepare(select).all(), fresh.prepare(select).all());
});
