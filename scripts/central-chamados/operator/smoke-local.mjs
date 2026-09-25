#!/usr/bin/env node
// Native binding test. No Cloudflare account, remote database or application flag.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTicketCommandDb } from "../../../tests/helpers/ticket-command-db.mjs";
import { parseOperatorArgs, runOperator } from "./lib.mjs";

process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_LOG = "none";
const evidence = { mode: "local_native_binding", remoteBindings: false, remoteD1Access: false,
  node: process.version, wrangler: "4.140.0", startedAt: new Date().toISOString(), checks: [] };
const cleanup = [];
let proxy;
let directory;
const timeout = setTimeout(() => {
  process.stderr.write(`${JSON.stringify({ ...evidence, ok: false, error: "LOCAL_RUNTIME_TIMEOUT" }, null, 2)}\n`);
  process.exit(1);
}, 45000);
try {
  const installed = JSON.parse(await readFile(new URL("./node_modules/wrangler/package.json", import.meta.url), "utf8"));
  assert.equal(installed.version, evidence.wrangler);
  const fixture = await createTicketCommandDb({ after(fn) { cleanup.push(fn); } }, { marker: false });
  fixture.sqlite.exec(`UPDATE users SET role='super_admin' WHERE id=1;
    CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT);
    INSERT INTO d1_migrations(name,applied_at) VALUES
      ('0025_ticket_triage_classification.sql','2026-09-25 16:00:00'),
      ('0026_ticket_command_lifecycle.sql','2026-09-25 17:10:33');`);
  fixture.createLegacySource();
  fixture.sqlite.exec(`INSERT INTO tickets(id,organization_id,subject,description,created_by,active) VALUES
    (101,1,'Fixture A','Local only',2,1), (102,1,'Fixture B','Local only',2,1),
    (201,2,'Fixture other organization','Local only',4,1);`);
  directory = await mkdtemp(join(tmpdir(), "cc03-native-d1-"));
  const configPath = join(directory, "wrangler.json");
  const identity = { name: "cc03-local-fixture", id: "11111111-1111-4111-8111-111111111111" };
  await writeFile(configPath, JSON.stringify({ name: "cc03-local-fixture", compatibility_date: "2026-09-25",
    d1_databases: [{ binding: "DB", database_name: identity.name, database_id: identity.id, remote: false }] }));
  evidence.phase = "getPlatformProxy";
  const { getPlatformProxy } = await import("wrangler");
  proxy = await getPlatformProxy({ configPath, persist: false, remoteBindings: false, envFiles: [] });
  const DB = proxy.env.DB;
  const probe = await DB.prepare("SELECT 1 AS local_probe").all();
  assert.equal(probe.results[0].local_probe, 1);
  assert.match(probe.meta.served_by, /miniflare|local|workerd/i);
  evidence.servedBy = probe.meta.served_by;
  evidence.phase = "fixture";
  // Each schema object is a complete statement, including multi-statement trigger bodies.
  const objects = fixture.sqlite.prepare(`SELECT type,name,sql FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid`).all();
  for (const item of objects) await DB.prepare(item.sql).run();
  const tables = objects.filter((item) => item.type === "table").map((item) => item.name);
  for (const table of tables) {
    for (const row of fixture.sqlite.prepare(`SELECT * FROM "${table}"`).all()) {
      const columns = Object.keys(row);
      await DB.prepare(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
        .bind(...Object.values(row)).run();
    }
  }
  const snapshots = async () => {
    const result = {};
    for (const table of tables) result[table] = (await DB.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).results;
    return result;
  };
  const countEffects = async () => {
    const result = {};
    for (const table of ["organization_tickets", "ticket_commands", "ticket_events", "audit_logs", "ticket_command_outbox"]) {
      result[table] = (await DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
    }
    return result;
  };
  const inventory = parseOperatorArgs(["--database-name", identity.name, "--database-id", identity.id, "--report", "unused-local-fixture.json"]);
  const options = { ...inventory, mode: "apply", organizationId: 1, operatorUserId: 1, fallbackUserId: 2,
    confirmDatabaseId: identity.id, writersPaused: true, pageSize: 1, maxPages: 1 };
  const run = (settings) => runOperator({ DB }, settings, { identity, runId: "native-local-fixture",
    backup: { bookmark: "LOCAL-FIXTURE-NOT-A-REMOTE-BOOKMARK", capturedAt: new Date().toISOString() } });
  evidence.phase = "scenarios";
  const before = await snapshots();
  const inspected = await run(inventory);
  assert.equal(inspected.exitCode, 0, JSON.stringify(inspected.report.error));
  assert.equal(inspected.report.allOrganizationsReady, false);
  assert.deepEqual(await snapshots(), before);
  evidence.checks.push("inventory leaves all tables unchanged");

  const first = await run(options);
  assert.equal(first.exitCode, 2, JSON.stringify(first.report));
  assert.equal(first.report.migrated, 1);
  const resumed = await run(options);
  assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.report));
  assert.equal(resumed.report.migrated, 1);
  assert.deepEqual(await countEffects(), { organization_tickets: 2, ticket_commands: 2, ticket_events: 2, audit_logs: 2, ticket_command_outbox: 2 });
  evidence.checks.push("bounded native D1 batches import and resume with all mandatory effects");

  const beforeReplay = await snapshots();
  const replay = await run(options);
  assert.equal(replay.report.reconciledReplay, true);
  assert.equal(replay.report.writesPerformed, false);
  assert.deepEqual(await snapshots(), beforeReplay);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM organization_tickets WHERE organization_id=2").first()).n, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM ticket_command_backfills WHERE organization_id=2").first()).n, 0);
  evidence.checks.push("replay is a no-op and organization 2 remains untouched");

  await DB.prepare("INSERT INTO tickets(id,organization_id,subject,created_by,active) VALUES (103,1,'Atomic rollback fixture',2,1)").run();
  await DB.prepare(`CREATE TRIGGER cc03_local_fail_outbox BEFORE INSERT ON ticket_command_outbox
    WHEN (SELECT legacy_ticket_id FROM organization_tickets WHERE id=NEW.ticket_id)=103
    BEGIN SELECT RAISE(ABORT,'LOCAL_OUTBOX_FAILURE'); END`).run();
  const beforeFailure = await countEffects();
  const failed = await run(options);
  assert.equal(failed.exitCode, 1);
  assert.deepEqual(await countEffects(), beforeFailure);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM organization_tickets WHERE legacy_ticket_id=103").first()).n, 0);
  await DB.prepare("DROP TRIGGER cc03_local_fail_outbox").run();
  const recovered = await run(options);
  assert.equal(recovered.exitCode, 0, JSON.stringify(recovered.report));
  assert.equal(recovered.report.migrated, 1);
  evidence.checks.push("native batch rolls back mandatory outbox failure and resumes after correction");
  const final = await run(inventory);
  assert.deepEqual(final.report.pendingOrganizationIds, [2]);
  evidence.checks.push("global inventory still blocks release for the untouched organization");
  evidence.ok = true;
  evidence.phase = "finished";
} catch (error) {
  evidence.ok = false;
  evidence.error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  try { await proxy?.dispose(); } catch (error) { evidence.cleanupError = error.message; process.exitCode = 1; }
  for (const fn of cleanup.reverse()) fn();
  if (directory) await rm(directory, { recursive: true, force: true });
  clearTimeout(timeout);
  evidence.finishedAt = new Date().toISOString();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
