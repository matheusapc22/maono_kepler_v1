import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createTicketCommandDb,
  COMMAND_ACTORS,
} from "./helpers/ticket-command-db.mjs";
import {
  createTicketExport,
  listTicketExports,
  readTicketExport,
  cancelTicketExport,
  retryTicketExport,
  processExportStep,
  downloadTicketExport,
  cleanupTicketExports,
  exportReady,
} from "../functions/_lib/ticket-exports.js";
import {
  csvCell,
  normalizeExportInput,
  sha256,
  SOURCE_TABLES,
} from "../functions/_lib/ticket-export-domain.js";
import { onRequest } from "../functions/api/organizations/[id]/tickets/exports.js";
import { consumeTicketExports } from "../workers/ticket-exports.js";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const actor = COMMAND_ACTORS.owner;
const window = {
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-02-01T00:00:00.000Z",
  asOf: "2026-02-01T00:00:00.000Z",
};
const input = (extra = {}) => ({
  ...window,
  idempotencyKey: crypto.randomUUID(),
  ...extra,
});
async function fixture(t) {
  const f = await createTicketCommandDb(t);
  for (const name of [
    "0027_ticket_selective_access.sql",
    "0028_ticket_conversations.sql",
    "0033_ticket_sla_policies.sql",
    "0034_ticket_metric_rollups.sql",
    "0035_ticket_report_exports.sql",
  ])
    f.sqlite.exec(read("migrations/" + name));
  // Canonical owner role does not currently include export capabilities. Exercise
  // explicitly scoped grants on ordinary editors; do not add implicit role access.
  f.sqlite.exec("UPDATE users SET role='editor' WHERE id IN (1,2)");
  for (const id of [1, 2])
    for (const p of ["export.create", "export.view", "export.download"])
      f.sqlite
        .prepare(
          "INSERT INTO user_permissions(user_id,permission,organization_id,active) VALUES(?,?,1,1)",
        )
        .run(id, p);
  Object.assign(f.env, {
    MAONO_RUNTIME_ENV: "local",
    MAONO_TICKET_EXPORTS_ENABLED: "true",
    MAONO_TICKET_EXPORT_ORGANIZATION_IDS: "1",
    MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: "true",
    MAONO_TICKET_EXPORT_TTL_SECONDS: "3600",
    MAONO_TICKET_EXPORT_MAX_ROWS: "1000",
    MAONO_TICKET_EXPORT_MAX_BYTES: String(10 * 1024 * 1024),
    MAONO_TICKET_EXPORT_MAX_JOBS_PER_ORG: "10",
    MAONO_TICKET_EXPORT_MAX_ATTEMPTS: "3",
    MAONO_TICKET_EXPORT_CSV_PROFILE: "text-v1",
  });
  f.files = new Map();
  f.storage = {
    async put(p, bytes) {
      const old = f.files.get(p.id);
      if (old) assert.deepEqual(old, bytes);
      f.files.set(p.id, bytes);
    },
    async get(p) {
      return new Response(f.files.get(p.id));
    },
    async remove(p) {
      f.files.delete(p.id);
    },
  };
  return f;
}
function seed(
  f,
  id = 1,
  org = 1,
  visibility = "organization",
  subject = "Chamado",
) {
  f.sqlite
    .prepare(
      "INSERT INTO organization_tickets(id,organization_id,subject,description,status,created_by,created_at,updated_at,current_cycle_number,visibility) VALUES(?,?,?,'test','open',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1,?)",
    )
    .run(id, org, subject, visibility);
  f.sqlite
    .prepare(
      "INSERT INTO ticket_cycles(organization_id,ticket_id,cycle_number,origin,opened_at,opened_by) VALUES(?,?,1,'created','2026-01-01T00:00:00.000Z',1)",
    )
    .run(org, id);
}
async function drain(f, id) {
  for (let n = 0; n < 1000; n++) {
    const job = f.sqlite
      .prepare("SELECT * FROM ticket_export_jobs WHERE id=?")
      .get(id);
    if (
      ["ready", "failed", "revoked", "cancelled", "expired"].includes(job.state)
    )
      return job;
    await processExportStep(f.env, 1, { storage: f.storage });
  }
  throw new Error("not completed");
}

test("CT41: 250 rows complete, exact percentiles, private manifest, UTF8 CSV and verified stream", async (t) => {
  const f = await fixture(t);
  for (let i = 1; i <= 250; i++)
    seed(f, i, 1, "organization", i === 1 ? '=HYPERLINK("evil")' : "ação " + i);
  seed(f, 251, 1, "private");
  seed(f, 252, 2);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  assert.equal(job.expectedRows, 250);
  const done = await drain(f, job.id);
  assert.equal(done.state, "ready", done.error_code);
  const result = await readTicketExport(f.env, 1, actor, job.id);
  assert.equal(result.manifest.totals.tickets, 250);
  assert.equal(result.manifest.totals.backlog, 250);
  assert.equal(result.manifest.distributions.age.p95, 31 * 86400000);
  assert.equal(result.manifest.definition.reopen_hours, null);
  assert.equal(result.manifest.causes.available, false);
  assert.ok(!JSON.stringify(result).includes("dropbox"));
  const response = await downloadTicketExport(f.env, 1, actor, job.id, {
    storage: f.storage,
  });
  const csv = await response.text();
  assert.equal(csv.split("\r\n").length, 252);
  assert.match(csv, /text:=HYPERLINK/);
  assert.match(csv, /ação 250/);
  assert.ok(!csv.includes('"251",'));
  assert.equal(
    Number(response.headers.get("Content-Length")),
    Buffer.byteLength(csv),
  );
});
test("source mutation between pages fails entire snapshot; no ready partial", async (t) => {
  const f = await fixture(t);
  for (let i = 1; i <= 7; i++) seed(f, i);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  await processExportStep(f.env, 1, { storage: f.storage });
  f.sqlite.exec("UPDATE organization_tickets SET subject='changed' WHERE id=7");
  const done = await drain(f, job.id);
  assert.equal(done.state, "failed");
  assert.equal(done.error_code, "SOURCE_CHANGED");
  await assert.rejects(downloadTicketExport(f.env, 1, actor, job.id), {
    status: 409,
  });
});
test("mutation during capture persistence cannot commit any mixed rows (generation fence)", async (t) => {
  const f = await fixture(t);
  seed(f);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  const batch = f.env.DB.batch.bind(f.env.DB);
  f.env.DB.batch = async (statements) => {
    if (
      statements.some((s) =>
        s.__description().sql.includes("INSERT INTO ticket_export_items"),
      )
    )
      f.sqlite.exec(
        "UPDATE ticket_cycles SET opened_at='2026-01-02' WHERE ticket_id=1",
      );
    return batch(statements);
  };
  const done = await drain(f, job.id);
  assert.equal(done.state, "failed");
  assert.equal(f.rows("ticket_export_items").length, 0);
});
test("CT42: revoke after ready, actor/organization isolation and capability denial", async (t) => {
  const f = await fixture(t);
  seed(f);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  await drain(f, job.id);
  await assert.rejects(
    readTicketExport(f.env, 1, COMMAND_ACTORS.peer, job.id),
    { status: 404 },
  );
  assert.equal(
    (await listTicketExports(f.env, 1, COMMAND_ACTORS.peer)).jobs.length,
    0,
  );
  f.sqlite.exec(
    "UPDATE organization_tickets SET visibility='private' WHERE id=1",
  );
  await assert.rejects(downloadTicketExport(f.env, 1, actor, job.id), {
    status: 404,
  });
  assert.equal((await listTicketExports(f.env, 1, actor)).jobs.length, 0);
  f.sqlite.exec(
    "UPDATE organization_tickets SET visibility='organization' WHERE id=1;INSERT INTO user_permission_denials(user_id,organization_id,permission) VALUES(1,1,'export.download')",
  );
  await assert.rejects(downloadTicketExport(f.env, 1, actor, job.id), {
    status: 404,
  });
});
test("idempotence, race, conflicting payload, no cross-actor replay; quota at boundary", async (t) => {
  const f = await fixture(t);
  seed(f);
  const b = input();
  const [a, c] = await Promise.all([
    createTicketExport(f.env, 1, actor, b),
    createTicketExport(f.env, 1, actor, b),
  ]);
  assert.equal(a.job.id, c.job.id);
  assert.equal(f.rows("ticket_export_jobs").length, 1);
  await assert.rejects(
    createTicketExport(f.env, 1, actor, { ...b, report: "backlog" }),
    { status: 409 },
  );
  const other = await createTicketExport(f.env, 1, COMMAND_ACTORS.peer, b);
  assert.notEqual(a.job.id, other.job.id);
  f.env.MAONO_TICKET_EXPORT_MAX_JOBS_PER_ORG = "2";
  await assert.rejects(createTicketExport(f.env, 1, actor, input()), {
    status: 409,
  });
});
test("cancel during storage put prevents publication; cleanup retries failed removal", async (t) => {
  const f = await fixture(t);
  seed(f);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  await processExportStep(f.env, 1, { storage: f.storage });
  const put = f.storage.put;
  f.storage.put = async (p, b) => {
    await put(p, b);
    await cancelTicketExport(f.env, 1, actor, job.id);
  };
  await processExportStep(f.env, 1, { storage: f.storage });
  assert.equal(
    f.sqlite
      .prepare("SELECT state FROM ticket_export_jobs WHERE id=?")
      .get(job.id).state,
    "cancelled",
  );
  assert.equal(f.rows("ticket_export_parts")[0].state, "pending");
  f.sqlite.exec("UPDATE ticket_export_parts SET last_attempt_at='2020-01-01'");
  await cleanupTicketExports(f.env, 1, {
    storage: {
      ...f.storage,
      async remove() {
        throw new Error("temporary");
      },
    },
  });
  assert.equal(f.rows("ticket_export_parts").length, 1);
  await cleanupTicketExports(f.env, 1, { storage: f.storage });
  assert.equal(f.files.size, 0);
  assert.equal(f.rows("ticket_export_parts").length, 0);
});
test("lost lease during storage cannot publish, next worker reconciles immutable bytes", async (t) => {
  const f = await fixture(t);
  seed(f);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  await processExportStep(f.env, 1, { storage: f.storage });
  const put = f.storage.put;
  let lost = false;
  f.storage.put = async (p, b) => {
    await put(p, b);
    if (!lost) {
      lost = true;
      f.sqlite.exec(
        "UPDATE ticket_export_jobs SET token='other',lease_until='2020-01-01'",
      );
    }
  };
  await processExportStep(f.env, 1, { storage: f.storage });
  assert.equal(f.rows("ticket_export_parts")[0].state, "pending");
  assert.equal((await drain(f, job.id)).state, "ready");
  assert.equal(f.files.size, 1);
});
test("retry after ambiguous upload uses durable same partition, Retry-After and attempt ceiling", async (t) => {
  const f = await fixture(t);
  seed(f);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  await processExportStep(f.env, 1, { storage: f.storage });
  let tries = 0;
  const put = f.storage.put;
  f.storage.put = async (p, b) => {
    await put(p, b);
    if (++tries === 1)
      throw Object.assign(new Error("provider secret"), {
        details: { retryAfterMs: 45000 },
      });
  };
  await processExportStep(f.env, 1, { storage: f.storage });
  let row = f.rows("ticket_export_jobs")[0];
  assert.equal(row.state, "running");
  assert.ok(Date.parse(row.next_at) > Date.now() + 40000);
  f.sqlite.exec("UPDATE ticket_export_jobs SET next_at=NULL");
  assert.equal((await drain(f, job.id)).state, "ready");
  assert.equal(f.files.size, 1);
});
test("download integrity and permission revalidation between partitions; no bytes after revocation", async (t) => {
  const f = await fixture(t);
  for (let i = 1; i <= 6; i++) seed(f, i);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  await drain(f, job.id);
  const res = await downloadTicketExport(f.env, 1, actor, job.id, {
    storage: f.storage,
  });
  const reader = res.body.getReader();
  assert.ok((await reader.read()).value.length > 0);
  f.sqlite.exec(
    "UPDATE organization_tickets SET visibility='private' WHERE id=6",
  );
  await assert.rejects(reader.read());
  f.sqlite.exec(
    "UPDATE organization_tickets SET visibility='organization' WHERE id=6",
  );
  const corrupt = await downloadTicketExport(f.env, 1, actor, job.id, {
    storage: {
      ...f.storage,
      async get() {
        return new Response("corrupt");
      },
    },
  });
  await assert.rejects(corrupt.text());
});
test("expired job, missing trigger, disabled feature, oversized scope and CC13 fail closed", async (t) => {
  const f = await fixture(t);
  seed(f);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  f.sqlite.exec("UPDATE ticket_export_jobs SET expires_at='2020-01-01'");
  await assert.rejects(readTicketExport(f.env, 1, actor, job.id), {
    status: 410,
  });
  assert.throws(() => normalizeExportInput(input({ report: "causes" })), {
    code: "TICKET_EXPORT_CC13_REQUIRED",
  });
  f.env.MAONO_TICKET_EXPORTS_ENABLED = "false";
  assert.equal((await listTicketExports(f.env, 1, actor)).enabled, false);
  f.env.MAONO_TICKET_EXPORTS_ENABLED = "true";
  delete f.env.MAONO_TICKET_EXPORT_TTL_SECONDS;
  await assert.rejects(exportReady(f.env, 1), {
    code: "TICKET_EXPORT_CONFIG_REQUIRED",
  });
  f.env.MAONO_TICKET_EXPORT_TTL_SECONDS = "3600";
  f.sqlite.exec("DROP TRIGGER ticket_export_epoch_users_update");
  await assert.rejects(exportReady(f.env, 1), {
    code: "TICKET_EXPORT_SCHEMA_REQUIRED",
  });
});
test("HTTP auth, permissions, origin, bounded body, generic safe errors and no-store", async (t) => {
  const f = await fixture(t);
  seed(f);
  const url = "https://local.test/api/organizations/1/tickets/exports";
  const req = (userId, body, origin = "https://local.test") =>
    onRequest({
      env: f.env,
      params: { id: "1" },
      request: new Request(url, {
        method: body ? "POST" : "GET",
        headers: {
          cookie: userId ? f.sessionCookie(userId) : "",
          origin,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    });
  assert.equal((await req()).status, 401);
  assert.equal((await req(3, input())).status, 403);
  assert.equal((await req(1, input(), "https://evil.test")).status, 403);
  assert.equal((await req(1, { huge: "x".repeat(5000) })).status, 413);
  const r = await req(1, input());
  assert.equal(r.status, 202, await r.clone().text());
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
});
test("CSV text profile roundtrips dangerous strings as literal text including delimiters/newlines", () => {
  for (const v of [
    "=SUM(1,1)",
    "+cmd",
    "-1",
    "@evil",
    "\t=1",
    "\r\n=1",
    "＝1",
    'a";=1',
    "ação",
  ]) {
    const cell = csvCell(v);
    assert.ok(cell.startsWith('"text:'));
    assert.equal(cell.slice(1, -1).replaceAll('""', '"').slice(5), v);
  }
  assert.equal(csvCell(42), '"42"');
  assert.equal(csvCell(null), '""');
});
test("fresh schema and immutable upgrade; all mutation sources have insert/update/delete epochs", async (t) => {
  const f = await fixture(t),
    fresh = new DatabaseSync(":memory:");
  t.after(() => fresh.close());
  fresh.exec(read("schema.sql"));
  for (const db of [fresh, f.sqlite]) {
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    for (const source of SOURCE_TABLES)
      for (const op of ["insert", "update", "delete"])
        assert.ok(
          db
            .prepare("SELECT name FROM sqlite_master WHERE name=?")
            .get(`ticket_export_epoch_${source}_${op}`),
        );
  }
  seed(f);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  await drain(f, job.id);
  assert.throws(
    () => f.sqlite.exec("UPDATE ticket_export_items SET fact_json='{}'"),
    /IMMUTABLE/,
  );
  assert.throws(
    () => f.sqlite.exec("UPDATE ticket_export_parts SET csv='bad'"),
    /IMMUTABLE/,
  );
  const sha = await sha256(read("migrations/0035_ticket_report_exports.sql"));
  assert.match(sha, /^[a-f0-9]{64}$/);
});
test("worker starts OFF and refuses preview execution", async () => {
  assert.deepEqual(await consumeTicketExports({}), { enabled: false });
  await assert.rejects(
    consumeTicketExports({
      MAONO_TICKET_EXPORT_WORKER_ENABLED: "true",
      MAONO_RUNTIME_ENV: "preview",
    }),
    { code: "TICKET_EXPORT_RUNTIME_DENIED" },
  );
});

test("row and byte ceilings fail explicitly, no partial publication; empty cohort exports header", async (t) => {
  const f = await fixture(t);
  f.env.MAONO_TICKET_EXPORT_MAX_ROWS = "250";
  for (let i = 1; i <= 251; i++) seed(f, i);
  await assert.rejects(createTicketExport(f.env, 1, actor, input()), {
    code: "TICKET_EXPORT_ROW_LIMIT",
  });
  assert.equal(f.rows("ticket_export_jobs").length, 0);
  const { job: empty } = await createTicketExport(
    f.env,
    1,
    actor,
    input({ domain: "database" }),
  );
  assert.equal((await drain(f, empty.id)).state, "ready");
  assert.equal(
    (await readTicketExport(f.env, 1, actor, empty.id)).manifest.totals.tickets,
    0,
  );
  f.env.MAONO_TICKET_EXPORT_MAX_ROWS = "1000";
  f.env.MAONO_TICKET_EXPORT_MAX_BYTES = "1024";
  const { job } = await createTicketExport(f.env, 1, actor, input());
  const done = await drain(f, job.id);
  assert.equal(done.state, "failed");
  assert.equal(done.error_code, "BYTE_LIMIT");
});
test("source events beyond ceiling fail, terminal retry creates new snapshot, failed cleanup preserves authorization", async (t) => {
  const f = await fixture(t);
  seed(f);
  for (let i = 0; i < 501; i++)
    f.sqlite.exec(
      "INSERT INTO ticket_events(organization_id,ticket_id,event_type,actor_user_id,metadata) VALUES(1,1,'test',1,'{}')",
    );
  const { job } = await createTicketExport(f.env, 1, actor, input());
  assert.equal((await drain(f, job.id)).error_code, "SOURCE_LIMIT");
  const retry = await retryTicketExport(
    f.env,
    1,
    actor,
    job.id,
    crypto.randomUUID(),
  );
  assert.notEqual(retry.job.id, job.id);
  assert.equal((await drain(f, retry.job.id)).error_code, "SOURCE_LIMIT");
  const narrowed = await createTicketExport(
    f.env,
    1,
    actor,
    input({ domain: "database" }),
  );
  assert.equal((await drain(f, narrowed.job.id)).state, "ready");
});
test("concurrent workers capture exactly once and terminal lease exhaustion is observable", async (t) => {
  const f = await fixture(t);
  for (let i = 1; i <= 8; i++) seed(f, i);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  await Promise.all([
    processExportStep(f.env, 1, { storage: f.storage }),
    processExportStep(f.env, 1, { storage: f.storage }),
  ]);
  assert.equal(f.rows("ticket_export_items").length, 5);
  assert.equal((await drain(f, job.id)).state, "ready");
  const { job: next } = await createTicketExport(f.env, 1, actor, input());
  f.sqlite
    .prepare(
      "UPDATE ticket_export_jobs SET attempts=3,token='dead',lease_until='2020-01-01' WHERE id=?",
    )
    .run(next.id);
  assert.equal((await drain(f, next.id)).error_code, "ATTEMPTS_EXHAUSTED");
});
test("exact nearest-rank aggregate across multiple partitions and current domain/nature filters", async (t) => {
  const f = await fixture(t);
  for (let i = 1; i <= 7; i++) {
    seed(f, i);
    f.sqlite
      .prepare("UPDATE ticket_cycles SET closed_at=? WHERE ticket_id=?")
      .run(`2026-01-0${i + 1}T00:00:00.000Z`, i);
  }
  seed(f, 8);
  f.sqlite.exec(
    "UPDATE organization_tickets SET category='database' WHERE id=8",
  );
  const { job } = await createTicketExport(
    f.env,
    1,
    actor,
    input({ report: "cycles", domain: "support", nature: "unknown" }),
  );
  await drain(f, job.id);
  const { manifest } = await readTicketExport(f.env, 1, actor, job.id);
  assert.equal(manifest.totals.tickets, 7);
  assert.equal(manifest.distributions.resolution_raw.p50, 4 * 86400000);
  assert.equal(manifest.distributions.resolution_raw.p95, 7 * 86400000);
});
test("metadata tombstone re-deletes file completed after initial cleanup", async (t) => {
  const f = await fixture(t);
  seed(f);
  const { job } = await createTicketExport(f.env, 1, actor, input());
  await drain(f, job.id);
  const part = f.rows("ticket_export_parts")[0],
    bytes = f.files.get(part.id);
  await cancelTicketExport(f.env, 1, actor, job.id);
  f.sqlite.exec("UPDATE ticket_export_parts SET last_attempt_at='2020-01-01'");
  await cleanupTicketExports(f.env, 1, { storage: f.storage });
  assert.equal(f.files.size, 0);
  assert.equal(f.rows("ticket_export_gc").length, 1);
  f.files.set(part.id, bytes);
  f.sqlite.exec("UPDATE ticket_export_gc SET next_at='2020-01-01'");
  await cleanupTicketExports(f.env, 1, { storage: f.storage });
  assert.equal(f.files.size, 0);
});

test("history uses bounded keyset pages without repeating jobs", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 7; i++)
    await createTicketExport(f.env, 1, actor, input());
  const a = await listTicketExports(f.env, 1, actor);
  assert.equal(a.jobs.length, 5);
  assert.ok(a.nextCursor);
  const b = await listTicketExports(f.env, 1, actor, a.nextCursor);
  assert.equal(b.jobs.length, 2);
  assert.equal(b.nextCursor, null);
  assert.equal(new Set([...a.jobs, ...b.jobs].map((j) => j.id)).size, 7);
});
