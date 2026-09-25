import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { inspectTicketLegacyBackfill, runTicketLegacyBackfillPage, reconcileEmptyTicketLegacyBackfill } from "../functions/_lib/ticket-legacy-backfill.js";

function fixture(t, { source = true, path = ":memory:" } = {}) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  sqlite.exec(`INSERT INTO users (id,email,name,role,password_hash) VALUES
    (1,'operator@cc03.test','Operador','owner','fixture'),
    (2,'author@cc03.test','Autor','viewer','fixture');
    INSERT INTO organizations (id,name,slug,dropbox_root_path) VALUES (1,'A','a','/org-a'),(2,'B','b','/org-b');
    INSERT INTO organization_users (organization_id,user_id,access_level) VALUES (1,1,'owner'),(1,2,'viewer');`);
  if (source) sqlite.exec(`CREATE TABLE tickets (
    id INTEGER PRIMARY KEY, organization_id INTEGER, subject TEXT, description TEXT, status TEXT,
    priority TEXT, category TEXT, created_by INTEGER, assigned_to INTEGER, active INTEGER,
    created_at TEXT, updated_at TEXT, due_at TEXT, closed_at TEXT
  )`);
  t.after(() => sqlite.close());
  const statements = [];
  let beforeBatch;
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { statements.push(sql); const row = sqlite.prepare(sql).get(...values); return row ? { ...row } : null; },
        async all() { statements.push(sql); return { success: true, results: sqlite.prepare(sql).all(...values).map((row) => ({ ...row })) }; },
        async run() {
          statements.push(sql);
          const statement = sqlite.prepare(sql);
          const results = statement.columns().length ? statement.all(...values).map((row) => ({ ...row })) : [];
          if (!statement.columns().length) statement.run(...values);
          return { success: true, results, meta: { ...sqlite.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get() } };
        },
      };
    },
    async batch(batch) {
      const hook = beforeBatch;
      beforeBatch = null;
      hook?.(sqlite);
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of batch) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return {
    env: { DB }, sqlite, statements,
    beforeNextBatch(hook) { beforeBatch = hook; },
    add(id, values = {}) {
      const row = { id, organization_id: 1, subject: `Legado ${id}`, description: "Descrição original",
        status: "pending", priority: "normal", category: "support", created_by: 2, assigned_to: null,
        active: 1, created_at: "2026-01-01T12:00:00.000Z", updated_at: "2026-01-02T12:00:00.000Z",
        due_at: null, closed_at: null, ...values };
      sqlite.prepare(`INSERT INTO tickets (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    },
    counts() {
      return Object.fromEntries(["organization_tickets", "ticket_commands", "ticket_events", "audit_logs", "ticket_command_outbox"].map((table) => [table, sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
    },
  };
}

const options = { organizationId: 1, operatorUserId: 1, pageSize: 2 };

test("CT-49: bounded pages reconcile only eligible source identities and preserve organization scope", async (t) => {
  const db = fixture(t);
  for (let id = 1; id <= 5; id += 1) db.add(id);
  db.add(6, { active: 0 });
  db.add(7, { organization_id: 2 });
  const first = await runTicketLegacyBackfillPage(db.env, options);
  assert.deepEqual([first.migrated, first.sourceCount, first.canonicalCount, first.pendingCount, first.excludedSourceCount], [2, 5, 2, 3, 1]);
  assert.equal(first.marker.status, "pending");
  assert.equal(first.marker.completed_at, null);
  const second = await runTicketLegacyBackfillPage(db.env, { ...options, afterLegacyId: first.lastLegacyId });
  assert.equal(second.migrated, 2);
  const final = await runTicketLegacyBackfillPage(db.env, { ...options, afterLegacyId: second.lastLegacyId });
  assert.equal(final.complete, true);
  assert.equal(final.marker.status, "ready");
  assert.equal(final.marker.schema_version, 1);
  assert.equal(final.pendingCount, 0);
  assert.ok(final.marker.completed_at);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM organization_tickets WHERE organization_id=2").get().n, 0);
  assert.deepEqual(db.counts(), { organization_tickets: 5, ticket_commands: 5, ticket_events: 5, audit_logs: 5, ticket_command_outbox: 5 });
});

test("CT-49: replay after completion is idempotent and counts actual INSERT changes", async (t) => {
  const db = fixture(t);
  db.add(1);
  const first = await runTicketLegacyBackfillPage(db.env, options);
  const before = db.counts();
  const replay = await runTicketLegacyBackfillPage(db.env, options);
  assert.equal(first.migrated, 1);
  assert.equal(replay.migrated, 0);
  assert.equal(replay.scanned, 0);
  assert.equal(replay.complete, true);
  assert.deepEqual(db.counts(), before);
});

test("CT-49: partial failure keeps earlier commits, rolls back failed ticket/event/audit/outbox, and resumes without duplicates", async (t) => {
  const db = fixture(t);
  db.add(1); db.add(2); db.add(3);
  db.sqlite.exec(`CREATE TRIGGER fail_second_outbox BEFORE INSERT ON ticket_command_outbox
    WHEN NEW.ticket_id = 2 BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END;`);
  await assert.rejects(runTicketLegacyBackfillPage(db.env, { ...options, pageSize: 3 }), (error) => {
    assert.match(error.message, /injected outbox failure/);
    assert.equal(error.backfillReport.migrated, 1);
    assert.equal(error.backfillReport.pendingCount, 2);
    assert.equal(error.backfillReport.marker.status, "failed");
    assert.equal(error.backfillReport.marker.completed_at, null);
    return true;
  });
  assert.deepEqual(db.counts(), { organization_tickets: 1, ticket_commands: 1, ticket_events: 1, audit_logs: 1, ticket_command_outbox: 1 });
  db.sqlite.exec("DROP TRIGGER fail_second_outbox");
  const retry = await runTicketLegacyBackfillPage(db.env, { ...options, pageSize: 3 });
  assert.equal(retry.migrated, 2);
  assert.equal(retry.complete, true);
  assert.equal(retry.marker.skipped_count, 0);
  assert.deepEqual(db.counts(), { organization_tickets: 3, ticket_commands: 3, ticket_events: 3, audit_logs: 3, ticket_command_outbox: 3 });
});

test("mandatory audit failure rolls back the import and leaves marker failed", async (t) => {
  const db = fixture(t);
  db.add(1);
  db.sqlite.exec("CREATE TRIGGER fail_import_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit failed'); END;");
  await assert.rejects(runTicketLegacyBackfillPage(db.env, options), /audit failed/);
  assert.deepEqual(db.counts(), { organization_tickets: 0, ticket_commands: 0, ticket_events: 0, audit_logs: 0, ticket_command_outbox: 0 });
  assert.equal((await inspectTicketLegacyBackfill(db.env, 1)).marker.status, "failed");
});

test("provenance records substituted author and inferred timestamps without inventing triage, response or historic cycles", async (t) => {
  const db = fixture(t);
  db.add(1, { created_by: 999, assigned_to: 999, created_at: "invalid", updated_at: null, category: "unknown", status: "resolved", closed_at: "2026-01-10T12:00:00Z" });
  await runTicketLegacyBackfillPage(db.env, options);
  const ticket = db.sqlite.prepare("SELECT * FROM organization_tickets").get();
  assert.equal(ticket.created_by, 1);
  assert.equal(ticket.assigned_to, null);
  assert.equal(ticket.status, "closed");
  assert.equal(ticket.closed_at, "2026-01-10T12:00:00.000Z");
  assert.equal(ticket.category, "support");
  assert.equal(ticket.demand_nature, null);
  assert.equal(ticket.triage_source, "legacy");
  assert.equal(ticket.version, 1);
  assert.equal(ticket.current_cycle_number, 0);
  const event = db.sqlite.prepare("SELECT * FROM ticket_events").get();
  const metadata = JSON.parse(event.metadata);
  assert.equal(event.event_type, "ticket.legacy.imported");
  assert.equal(event.actor_user_id, 1);
  assert.equal(metadata.originalCreatorId, 999);
  assert.equal(metadata.creatorSubstituted, true);
  assert.equal(metadata.assignmentDiscarded, true);
  assert.equal(metadata.createdAtInferred, true);
  assert.equal(metadata.historicalCyclesKnown, false);
  assert.equal(metadata.firstResponseKnown, false);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM ticket_cycles").get().n, 0);
});

test("real legacy author, assignment and timestamps remain intact", async (t) => {
  const db = fixture(t);
  db.add(1, { assigned_to: 2 });
  await runTicketLegacyBackfillPage(db.env, options);
  const ticket = db.sqlite.prepare("SELECT * FROM organization_tickets").get();
  const metadata = JSON.parse(db.sqlite.prepare("SELECT metadata FROM ticket_events").get().metadata);
  assert.equal(ticket.created_by, 2);
  assert.equal(ticket.assigned_to, 2);
  assert.equal(ticket.created_at, "2026-01-01T12:00:00.000Z");
  assert.equal(metadata.creatorSubstituted, false);
  assert.equal(metadata.createdAtInferred, false);
});

test("concurrent earlier import produces zero new events and migrated=0", async (t) => {
  const db = fixture(t);
  db.add(1);
  db.beforeNextBatch((sqlite) => sqlite.exec(`INSERT INTO organization_tickets (
    organization_id,legacy_ticket_id,code,subject,description,created_by
  ) VALUES (1,1,'TKT-L1-000001','Existente','Já importado',2)`));
  const result = await runTicketLegacyBackfillPage(db.env, options);
  assert.equal(result.migrated, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(db.counts(), { organization_tickets: 1, ticket_commands: 0, ticket_events: 0, audit_logs: 0, ticket_command_outbox: 0 });
});

test("inventory is read-only and exposes source additions after a ready marker", async (t) => {
  const db = fixture(t);
  db.add(1);
  await runTicketLegacyBackfillPage(db.env, options);
  db.add(2);
  db.statements.length = 0;
  const report = await inspectTicketLegacyBackfill(db.env, 1);
  assert.equal(report.pendingCount, 1);
  assert.equal(report.marker.status, "ready");
  assert.ok(db.statements.every((sql) => !/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)));
});

test("absent legacy table requires an explicit zero-source reconciliation", async (t) => {
  const db = fixture(t, { source: false });
  const before = await inspectTicketLegacyBackfill(db.env, 1);
  assert.equal(before.marker, null);
  const after = await runTicketLegacyBackfillPage(db.env, options);
  assert.equal(after.complete, true);
  assert.equal(after.sourceExists, false);
  assert.equal(after.sourceCount, 0);
  assert.equal(after.canonicalCount, 0);
  assert.equal(after.migrated, 0);
});

test("incompatible source schema and missing 0026 fail without claiming readiness", async (t) => {
  const db = fixture(t, { source: false });
  db.sqlite.exec("CREATE TABLE tickets(id INTEGER PRIMARY KEY)");
  await assert.rejects(runTicketLegacyBackfillPage(db.env, options), { code: "TICKET_BACKFILL_SOURCE_INCOMPATIBLE" });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM ticket_command_backfills").get().n, 0);
  db.sqlite.exec("DROP TABLE tickets; DROP TABLE ticket_command_backfills;");
  await assert.rejects(runTicketLegacyBackfillPage(db.env, options), { code: "TICKET_BACKFILL_SCHEMA_OUTDATED" });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM organization_tickets").get().n, 0);
});

test("invalid operator and invalid pagination are rejected before writes", async (t) => {
  const db = fixture(t);
  for (const override of [{ operatorUserId: 999 }, { fallbackUserId: 999 }, { pageSize: 101 }, { afterLegacyId: -1 }]) {
    await assert.rejects(runTicketLegacyBackfillPage(db.env, { ...options, ...override }), { code: "TICKET_BACKFILL_INVALID" });
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM ticket_command_backfills").get().n, 0);
});

test("CLI defaults to read-only, accepts only explicit local execution and rejects --remote", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "cc03-backfill-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "copy.sqlite");
  const db = fixture(t, { path });
  db.add(1);
  const cli = new URL("../scripts/central-chamados/backfill-ticket-legacy.mjs", import.meta.url).pathname;
  const args = [cli, "--sqlite", path, "--organization", "1", "--database-identity", "fixture-local"];
  const before = readFileSync(path);
  const dryRun = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.equal(JSON.parse(dryRun.stdout).mode, "read-only");
  assert.deepEqual(readFileSync(path), before);
  const remote = spawnSync(process.execPath, [...args, "--remote"], { encoding: "utf8" });
  assert.equal(remote.status, 1);
  assert.match(JSON.parse(remote.stdout).error, /Opção inválida/);
  const applied = spawnSync(process.execPath, [...args, "--operator", "1", "--apply"], { encoding: "utf8" });
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  assert.equal(JSON.parse(applied.stdout).complete, true);
  assert.equal(JSON.parse(applied.stdout).migrated, 1);
});


function emptyReconcileFixture(t, extra = {}) {
  const db = fixture(t, extra);
  db.sqlite.exec("UPDATE users SET role='super_admin' WHERE id=1; DELETE FROM organization_users WHERE organization_id=2");
  return db;
}
const emptyOptions = { organizationId: 2, operatorUserId: 1, runId: "empty-reconcile-test" };
function markerRow(db, organizationId = 2) {
  const row = db.sqlite.prepare("SELECT * FROM ticket_command_backfills WHERE organization_id=?").get(organizationId);
  return row ? { ...row } : null;
}
function interceptEmptyMarker(db, callback) {
  const prepare = db.env.DB.prepare;
  db.env.DB.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.includes("WITH empty_counts AS")) {
      const run = statement.run;
      statement.run = () => callback(run);
    }
    return statement;
  };
}

for (const source of [true, false]) test(`empty reconciliation with source table ${source ? "present" : "absent"} writes only its marker without fallback or membership`, async (t) => {
  const db = emptyReconcileFixture(t, { source });
  const before = db.counts();
  const result = await reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions);
  assert.equal(result.complete, true); assert.equal(result.writesPerformed, true);
  assert.equal(result.writeAttempted, true); assert.equal(result.outcomeUnknown, false);
  assert.equal(result.sourceExists, source); assert.equal(result.migrated, 0); assert.equal(result.scanned, 0);
  assert.equal(result.marker.status, "ready"); assert.equal(result.marker.last_run_id, emptyOptions.runId);
  assert.equal(result.reconciledReplay, false);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM organization_users WHERE organization_id=2").get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM ticket_cycles").get().n, 0);
  assert.deepEqual(db.counts(), before);
  assert.equal(markerRow(db, 1), null);
});

test("empty ready replay has zero changes and preserves the existing marker timestamps/run ID", async (t) => {
  const db = emptyReconcileFixture(t);
  await reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions);
  const before = markerRow(db); const domain = db.counts(); let changes;
  interceptEmptyMarker(db, async (run) => { const result = await run(); changes = result.meta.changes; return result; });
  const replay = await reconcileEmptyTicketLegacyBackfill(db.env, { ...emptyOptions, runId: "second-operation" });
  assert.equal(changes, 0); assert.equal(replay.writesPerformed, false); assert.equal(replay.reconciledReplay, true);
  assert.equal(replay.complete, true); assert.deepEqual(markerRow(db), before); assert.deepEqual(db.counts(), domain);
});

test("empty reconciliation refuses a nonempty source even when every legacy ticket is already canonical", async (t) => {
  const db = emptyReconcileFixture(t);
  db.add(1, { organization_id: 2 });
  await runTicketLegacyBackfillPage(db.env, { ...options, organizationId: 2 });
  const before = markerRow(db); const domain = db.counts();
  await assert.rejects(reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions), (error) => {
    assert.equal(error.code, "TICKET_BACKFILL_EMPTY_SOURCE_REQUIRED");
    assert.equal(error.backfillReport.sourceCount, 1); assert.equal(error.backfillReport.pendingCount, 0);
    assert.equal(error.backfillReport.writeAttempted, false); assert.equal(error.backfillReport.writesPerformed, false);
    assert.equal(error.backfillReport.outcomeUnknown, false); return true;
  });
  assert.deepEqual(markerRow(db), before); assert.deepEqual(db.counts(), domain);
});

test("empty reconciliation counts only eligible rows in its organization", async (t) => {
  const db = emptyReconcileFixture(t);
  db.add(1, { organization_id: 1 }); db.add(2, { organization_id: 2, active: 0 });
  const result = await reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions);
  assert.equal(result.complete, true); assert.equal(result.sourceCount, 0); assert.equal(result.excludedSourceCount, 1);
  assert.equal(db.counts().organization_tickets, 0);
});

for (const [name, mutate, expected] of [
  ["operator is not super admin", "UPDATE users SET role='owner' WHERE id=1", "TICKET_BACKFILL_OPERATOR_FORBIDDEN"],
  ["operator inactive", "UPDATE users SET active=0 WHERE id=1", "TICKET_BACKFILL_OPERATOR_FORBIDDEN"],
  ["organization inactive", "UPDATE organizations SET active=0 WHERE id=2", "TICKET_BACKFILL_ORGANIZATION_INACTIVE"],
]) test(`empty reconciliation rejects ${name} before its marker statement`, async (t) => {
  const db = emptyReconcileFixture(t); db.sqlite.exec(mutate);
  await assert.rejects(reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions), (error) => {
    assert.equal(error.code, expected); assert.equal(error.backfillReport.writeAttempted, false);
    assert.equal(error.backfillReport.writesPerformed, false); return true;
  });
  assert.equal(markerRow(db), null);
});

for (const active of [1, null]) test(`an eligible source row active=${active} arriving before the SQL guard leaves the marker unchanged`, async (t) => {
  const db = emptyReconcileFixture(t);
  await reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions);
  const before = markerRow(db); const domain = db.counts();
  interceptEmptyMarker(db, async (run) => { db.add(1, { organization_id: 2, active }); return run(); });
  await assert.rejects(reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions), (error) => {
    assert.equal(error.code, "TICKET_BACKFILL_EMPTY_SOURCE_CHANGED");
    assert.equal(error.backfillReport.writeAttempted, true); assert.equal(error.backfillReport.writesPerformed, false);
    assert.equal(error.backfillReport.outcomeUnknown, false); assert.equal(error.backfillReport.sourceCount, 1); return true;
  });
  assert.deepEqual(markerRow(db), before); assert.deepEqual(db.counts(), domain);
});

for (const populated of [false, true]) test(`a previously absent source table appearing before the SQL guard is rejected (${populated ? "with rows" : "empty"})`, async (t) => {
  const db = emptyReconcileFixture(t, { source: false });
  interceptEmptyMarker(db, async (run) => {
    db.sqlite.exec("CREATE TABLE tickets(id INTEGER PRIMARY KEY,organization_id INTEGER,active INTEGER)");
    if (populated) db.sqlite.exec("INSERT INTO tickets VALUES(1,2,1)");
    return run();
  });
  await assert.rejects(reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions), (error) => {
    assert.equal(error.code, "TICKET_BACKFILL_EMPTY_SOURCE_CHANGED"); assert.equal(error.backfillReport.writesPerformed, false);
    assert.equal(error.backfillReport.outcomeUnknown, false); assert.equal(error.backfillReport.sourceExists, true); return true;
  });
  assert.equal(markerRow(db), null); assert.equal(db.counts().organization_tickets, 0);
});

test("a source row arriving after a successful marker write reports its durable effect without claiming rollback", async (t) => {
  const db = emptyReconcileFixture(t);
  interceptEmptyMarker(db, async (run) => { const result = await run(); db.add(1, { organization_id: 2 }); return result; });
  await assert.rejects(reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions), (error) => {
    assert.equal(error.code, "TICKET_BACKFILL_EMPTY_SOURCE_CHANGED"); assert.equal(error.backfillReport.complete, false);
    assert.equal(error.backfillReport.writesPerformed, true); assert.equal(error.backfillReport.outcomeUnknown, false);
    assert.equal(error.backfillReport.sourceCount, 1); return true;
  });
  assert.equal(markerRow(db).status, "ready"); assert.equal(db.counts().organization_tickets, 0);
});

for (const [mutate, expected] of [
  ["UPDATE users SET role='owner' WHERE id=1", "TICKET_BACKFILL_OPERATOR_FORBIDDEN"],
  ["UPDATE organizations SET active=0 WHERE id=2", "TICKET_BACKFILL_ORGANIZATION_INACTIVE"],
]) test(`the marker SQL rechecks an operational revocation: ${expected}`, async (t) => {
  const db = emptyReconcileFixture(t);
  interceptEmptyMarker(db, async (run) => { db.sqlite.exec(mutate); return run(); });
  await assert.rejects(reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions), (error) => {
    assert.equal(error.code, expected); assert.equal(error.backfillReport.writeAttempted, true);
    assert.equal(error.backfillReport.writesPerformed, false); assert.equal(error.backfillReport.outcomeUnknown, false); return true;
  });
  assert.equal(markerRow(db), null);
});

test("an inconsistent zero-source marker is repaired without touching canonical records", async (t) => {
  const db = emptyReconcileFixture(t);
  db.sqlite.exec(`INSERT INTO ticket_command_backfills(organization_id,status,source_count,canonical_count,pending_count,skipped_count)
    VALUES(2,'failed',3,2,1,1)`);
  const domain = db.counts();
  const result = await reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions);
  assert.equal(result.complete, true); assert.equal(result.writesPerformed, true);
  assert.equal(result.marker.skipped_count, 0); assert.equal(result.marker.source_count, 0);
  assert.equal(result.marker.canonical_count, 0); assert.equal(result.marker.pending_count, 0);
  assert.deepEqual(db.counts(), domain);
});

test("another reconciler finishing before SQL produces a no-op instead of replacing its ready marker", async (t) => {
  const db = emptyReconcileFixture(t);
  let existing;
  interceptEmptyMarker(db, async (run) => {
    db.sqlite.exec(`INSERT INTO ticket_command_backfills(organization_id,status,completed_at,last_run_id)
      VALUES(2,'ready','2026-09-25T18:00:00.000Z','other-reconciler')`);
    existing = markerRow(db); return run();
  });
  const result = await reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions);
  assert.equal(result.complete, true); assert.equal(result.writesPerformed, false); assert.equal(result.reconciledReplay, true);
  assert.deepEqual(markerRow(db), existing);
});

test("a lost marker response exposes uncertain outcome and a fresh inspection without retrying writes", async (t) => {
  const db = emptyReconcileFixture(t); let executions = 0;
  interceptEmptyMarker(db, async (run) => { executions += 1; await run(); throw new Error("lost connection after commit"); });
  await assert.rejects(reconcileEmptyTicketLegacyBackfill(db.env, emptyOptions), (error) => {
    assert.equal(error.backfillReport.writeAttempted, true); assert.equal(error.backfillReport.writesPerformed, false);
    assert.equal(error.backfillReport.outcomeUnknown, true); assert.equal(error.backfillReport.complete, false);
    assert.equal(error.backfillReport.marker.status, "ready"); return true;
  });
  assert.equal(executions, 1); assert.equal(db.counts().organization_tickets, 0);
});

test("empty reconciliation attaches an explicit no-write report even to validation errors", async (t) => {
  const db = emptyReconcileFixture(t);
  for (const overrides of [{ organizationId: -1 }, { operatorUserId: 0 }, { runId: "x".repeat(101) }]) {
    await assert.rejects(reconcileEmptyTicketLegacyBackfill(db.env, { ...emptyOptions, ...overrides }), (error) => {
      assert.equal(error.backfillReport.writeAttempted, false); assert.equal(error.backfillReport.writesPerformed, false);
      assert.equal(error.backfillReport.outcomeUnknown, false); assert.equal(error.backfillReport.complete, false); return true;
    });
  }
  assert.equal(markerRow(db), null);
});
