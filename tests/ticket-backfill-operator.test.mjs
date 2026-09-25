import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createTicketCommandDb } from "./helpers/ticket-command-db.mjs";
import { parseOperatorArgs, readOnlyD1, runOperator, loadOperatorSchema } from "../scripts/central-chamados/operator/lib.mjs";
import { main, verifyRemoteBinding, runPinnedWranglerJson } from "../scripts/central-chamados/operator/backfill-d1.mjs";

const databaseId = "5bc4dc32-f3bd-4c92-bbd1-cbda63e467db";
const identity = { id: databaseId, name: "maono_maps" };
const baseArgs = (report = "report.json") => ["--database-name", identity.name, "--database-id", identity.id, "--report", report];
const backup = () => ({ bookmark: "00000001-00000002-00000003", capturedAt: new Date().toISOString() });
const inventory = (extras = {}) => ({ ...parseOperatorArgs(baseArgs()), ...extras });
const apply = (extras = {}) => ({ ...inventory(), mode: "apply", organizationId: 1, operatorUserId: 1, fallbackUserId: 2,
  confirmDatabaseId: databaseId, writersPaused: true, ...extras });
async function fixture(t, { differentVersionDefault = false } = {}) {
  const db = await createTicketCommandDb(t, { marker: false, commandsSchema: !differentVersionDefault });
  if (differentVersionDefault) {
    const migration = await readFile(new URL("../migrations/0026_ticket_command_lifecycle.sql", import.meta.url), "utf8");
    db.sqlite.exec(migration.replace("ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK", "ADD COLUMN version INTEGER NOT NULL DEFAULT 10 CHECK"));
  }
  db.sqlite.exec(`UPDATE users SET role='super_admin' WHERE id=1;
    UPDATE organizations SET active=0 WHERE id=2;
    CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT);
    INSERT INTO d1_migrations(name,applied_at) VALUES('0025_ticket_triage_classification.sql','2026-09-25 16:00:00'),('0026_ticket_command_lifecycle.sql','2026-09-25 17:10:33');`);
  db.createLegacySource();
  db.add = (id, org = 1) => db.sqlite.prepare(`INSERT INTO tickets(id,organization_id,subject,description,created_by,active) VALUES(?,?,'Conteúdo sensível ausente do relatório','SEGREDO-DO-TICKET',999,1)`).run(id, org);
  return db;
}
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "cc03-operator-test-"));
  t.after(() => rm(path, { force: true, recursive: true }));
  return path;
}
async function execute(db, options = inventory(), extras = {}) {
  return runOperator(db.env, options, { identity, backup: backup(), runId: "local-test-run", ...extras });
}

test("strict CLI defaults to inventory and refuses implicit/malformed application", () => {
  assert.equal(parseOperatorArgs(baseArgs()).mode, "inventory");
  for (const args of [[], [...baseArgs(), "--mode", "apply"], [...baseArgs(), "--writers-paused"], [...baseArgs(), "--page-size", "101"], [...baseArgs(), "--report", "duplicate"], [...baseArgs(), "--unknown"]]) assert.throws(() => parseOperatorArgs(args));
  assert.equal(parseOperatorArgs(["--help"]).help, true);
});

test("read-only wrapper rejects run/batch and SQL writes through first/all before reaching D1", async () => {
  let queries = 0;
  const db = readOnlyD1({ prepare() { queries += 1; return { bind() { return this; }, all() { return { results: [] }; }, first() { return null; } }; } });
  for (const sql of ["UPDATE users SET active=0", "WITH x AS (SELECT 1) DELETE FROM tickets", "SELECT 1; DELETE FROM tickets", "PRAGMA foreign_keys=OFF", "ATTACH DATABASE 'x' AS other"]) assert.throws(() => db.prepare(sql), { code: "OPERATOR_READ_ONLY" });
  assert.equal(queries, 0);
  assert.throws(() => db.prepare("SELECT 1").run(), { code: "OPERATOR_READ_ONLY" });
  assert.throws(() => db.batch([]), { code: "OPERATOR_READ_ONLY" });
  await db.prepare("PRAGMA table_info(tickets)").all();
});

test("inventory covers active organizations, leaves every table unchanged and narrows fallback candidates", async (t) => {
  const db = await fixture(t); db.add(1); db.add(2, 2);
  const before = db.snapshot();
  const result = await execute(db);
  assert.equal(result.exitCode, 0); assert.equal(result.report.mode, "inventory");
  assert.deepEqual(result.report.organizations.map((row) => row.id), [1]);
  assert.equal(result.report.organizations[0].pendingCount, 1);
  assert.deepEqual(result.report.operatorCandidates.map((row) => row.id), [1]);
  assert.equal(result.report.fallbackCandidates, undefined);
  assert.deepEqual(db.snapshot(), before);
  const scoped = await execute(db, inventory({ organizationId: 1 }));
  assert.deepEqual(scoped.report.fallbackCandidates.map((row) => row.id), [1, 2, 3]);
  assert(!JSON.stringify(scoped.report).includes("SEGREDO-DO-TICKET"));
  assert.deepEqual(db.snapshot(), before);
  const inactive = await execute(db, inventory({ organizationId: 2 }));
  assert.equal(inactive.report.organizations[0].active, 0);
});

for (const [name, corrupt] of [
  ["ledger", (db) => db.sqlite.exec("DELETE FROM d1_migrations WHERE name LIKE '0026%'")],
  ["trigger", (db) => db.sqlite.exec("DROP TRIGGER ticket_events_no_delete")],
  ["index", (db) => db.sqlite.exec("DROP INDEX idx_ticket_wait_open")],
  ["source contract", (db) => db.sqlite.exec("DROP TABLE tickets; CREATE TABLE tickets(id INTEGER PRIMARY KEY)")],
]) test(`preflight blocks apply when ${name} is incomplete without creating a marker`, async (t) => {
  const db = await fixture(t); corrupt(db);
  const before = db.snapshot();
  const result = await execute(db, apply());
  assert.equal(result.exitCode, 1); assert.equal(result.report.error.code, "OPERATOR_PREFLIGHT_FAILED");
  assert.deepEqual(db.snapshot(), before);
});

for (const [name, change, options] of [
  ["owner is not a super admin", (db) => db.sqlite.exec("UPDATE users SET role='owner' WHERE id=1"), {}],
  ["inactive operator", (db) => db.sqlite.exec("UPDATE users SET active=0 WHERE id=1"), {}],
  ["inactive fallback", (db) => db.sqlite.exec("UPDATE users SET active=0 WHERE id=2"), {}],
  ["fallback from another organization", () => {}, { fallbackUserId: 4 }],
  ["inactive organization", () => {}, { organizationId: 2, fallbackUserId: 4 }],
]) test(`apply rejects ${name} before any mutation`, async (t) => {
  const db = await fixture(t); db.add(1); change(db);
  const before = db.snapshot();
  assert.equal((await execute(db, apply(options))).exitCode, 1);
  assert.deepEqual(db.snapshot(), before);
});

test("apply uses one run ID across bounded pages, exits 2 while incomplete, resumes and replays ready without writes", async (t) => {
  const db = await fixture(t); db.add(1); db.add(2); db.add(3, 2);
  const first = await execute(db, apply({ pageSize: 1, maxPages: 1 }));
  assert.equal(first.exitCode, 2); assert.equal(first.report.migrated, 1);
  assert.equal(first.report.final.pendingCount, 1);
  const second = await execute(db, apply({ pageSize: 1, maxPages: 3 }));
  assert.equal(second.exitCode, 0); assert.equal(second.report.migrated, 1);
  assert.equal(db.rows("organization_tickets").every((row) => row.organization_id === 1 && row.created_by === 2), true);
  assert.equal(db.rows("ticket_events").every((row) => JSON.parse(row.metadata).runId === "local-test-run"), true);
  const before = db.snapshot();
  const replay = await execute(db, apply());
  assert.equal(replay.report.reconciledReplay, true); assert.equal(replay.report.writesPerformed, false);
  assert.deepEqual(db.snapshot(), before);
});

test("a zero-pending inconsistent marker is reconciled instead of falsely treated as a no-op", async (t) => {
  const db = await fixture(t); await execute(db, apply());
  db.sqlite.exec("UPDATE ticket_command_backfills SET pending_count=1,source_count=99 WHERE organization_id=1");
  const result = await execute(db, apply());
  assert.equal(result.exitCode, 0); assert.equal(result.report.reconciledReplay, undefined);
  assert.equal(result.report.final.marker.pendingCount, 0); assert.equal(result.report.final.marker.sourceCount, 0);
});

test("page failure preserves earlier durable totals without ticket text or raw SQL", async (t) => {
  const db = await fixture(t); db.add(1); db.add(2);
  db.sqlite.exec("CREATE TRIGGER fail_second BEFORE INSERT ON ticket_command_outbox WHEN NEW.ticket_id=2 BEGIN SELECT RAISE(ABORT,'SECRET-API-TOKEN'); END");
  const result = await execute(db, apply({ pageSize: 1, maxPages: 2 }));
  assert.equal(result.exitCode, 1); assert.equal(result.report.pages.length, 2);
  assert.equal(result.report.migrated, 1); assert.equal(db.rows("organization_tickets").length, 1);
  assert.equal(result.report.pages[1].pendingCount, 1);
  assert.equal(result.report.migratedCountMeaning, "confirmed_minimum_on_failure");
  assert(!JSON.stringify(result.report).includes("SECRET-API-TOKEN"));
});

test("a lost response after a committed batch reports uncertainty and durable counts, then reruns safely", async (t) => {
  const db = await fixture(t); db.add(1);
  const batch = db.env.DB.batch;
  let lost = false;
  db.env.DB.batch = async (...args) => { const result = await batch(...args); if (!lost) { lost = true; throw new Error("lost response"); } return result; };
  const result = await execute(db, apply());
  assert.equal(result.exitCode, 1); assert.equal(result.report.migrated, 0);
  assert.equal(result.report.commitOutcomeUnknown, true);
  assert.equal(result.report.pages[0].canonicalCount, 1);
  const replay = await execute(db, apply());
  assert.equal(replay.exitCode, 0); assert.equal(db.rows("organization_tickets").length, 1);
  assert.equal(db.rows("ticket_command_outbox").length, 1);
});

test("report persistence failure before apply blocks all database writes", async (t) => {
  const db = await fixture(t); db.add(1);
  const before = db.snapshot();
  const result = await execute(db, apply(), { onProgress: async () => { throw new Error("disk full"); } });
  assert.equal(result.exitCode, 1); assert.deepEqual(db.snapshot(), before);
});

async function wrapperSetup(t, { local = false } = {}) {
  const db = await fixture(t); db.add(1);
  const folder = await directory(t); const reportPath = join(folder, "new-report.json");
  let disposed = 0; let configPath; const calls = []; let output = "";
  const DB = { ...db.env.DB, prepare(sql) {
    const statement = db.env.DB.prepare(sql);
    if (!sql.includes("operator_probe")) return statement;
    return { ...statement, async all() { const result = await statement.all(); return { ...result, meta: { served_by: local ? "miniflare.db" : "v3-prod" } }; } };
  } };
  return { db, folder, reportPath, calls, get disposed() { return disposed; }, get configPath() { return configPath; }, get output() { return output; },
    injections: { signals: new EventEmitter(), output(text) { output += text; },
      async wranglerJson(args, path) { calls.push(args); configPath = path; return args.includes("time-travel") ? { bookmark: backup().bookmark } : { uuid: identity.id, name: identity.name }; },
      async getPlatformProxy(options) {
        assert.equal(options.persist, false); assert.equal(options.remoteBindings, true); assert.deepEqual(options.envFiles, []);
        configPath = options.configPath;
        const config = JSON.parse(await readFile(configPath, "utf8"));
        assert.deepEqual(config.d1_databases, [{ binding: "DB", database_name: identity.name, database_id: identity.id, remote: true }]);
        assert.equal(config.env, undefined);
        return { env: { DB }, async dispose() { disposed += 1; } };
      } },
  };
}

test("CLI inventory verifies identity, uses isolated remote binding, saves report and cleans up", async (t) => {
  const setup = await wrapperSetup(t); const before = setup.db.snapshot();
  assert.equal(await main(baseArgs(setup.reportPath), setup.injections), 0);
  assert.deepEqual(setup.db.snapshot(), before); assert.equal(setup.disposed, 1);
  assert.equal(setup.calls.length, 1); await assert.rejects(stat(setup.configPath));
  const report = JSON.parse(await readFile(setup.reportPath, "utf8"));
  assert.equal(report.database.verified, true); assert.equal(report.binding.remote, true);
  assert.equal(report.exitCode, 0); assert.equal((await stat(setup.reportPath)).mode & 0o777, 0o600);
});

test("CLI apply captures the current bookmark before DML and never invokes migrations or sequential execute", async (t) => {
  const setup = await wrapperSetup(t);
  const args = [...baseArgs(setup.reportPath), "--mode", "apply", "--organization-id", "1", "--operator-user-id", "1", "--fallback-user-id", "2", "--confirm-database-id", databaseId, "--writers-paused"];
  assert.equal(await main(args, setup.injections), 0);
  assert.deepEqual(setup.calls, [["d1", "info", "maono_maps"], ["d1", "time-travel", "info", "maono_maps"]]);
  assert.equal(setup.db.rows("organization_tickets").length, 1);
  const report = JSON.parse(await readFile(setup.reportPath, "utf8"));
  assert.equal(report.backup.bookmark, backup().bookmark);
  assert.equal(report.attestations.verifiedAutomatically, false);
  assert.equal(setup.disposed, 1);
});

test("local fallback metadata is rejected and proxy is disposed without creating markers", async (t) => {
  const setup = await wrapperSetup(t, { local: true }); const before = setup.db.snapshot();
  assert.equal(await main(baseArgs(setup.reportPath), setup.injections), 1);
  assert.equal(JSON.parse(setup.output).error.code, "OPERATOR_REMOTE_BINDING_UNVERIFIED");
  assert.equal(setup.disposed, 1); assert.deepEqual(setup.db.snapshot(), before);
});

test("unavailable or existing report aborts before authentication and preserves existing content", async (t) => {
  const setup = await wrapperSetup(t);
  await writeFile(setup.reportPath, "original");
  assert.equal(await main(baseArgs(setup.reportPath), setup.injections), 1);
  assert.equal(await readFile(setup.reportPath, "utf8"), "original");
  assert.equal(setup.calls.length, 0);
  assert.equal(await main(baseArgs(join(setup.folder, "absent", "report.json")), setup.injections), 1);
  assert.equal(setup.calls.length, 0);
});

test("wrong control-plane identity fails before proxy creation and without leaking command stderr", async (t) => {
  const setup = await wrapperSetup(t);
  setup.injections.wranglerJson = async () => ({ name: "another-database", uuid: identity.id, secret: "SECRET" });
  assert.equal(await main(baseArgs(setup.reportPath), setup.injections), 1);
  assert.equal(setup.disposed, 0);
  assert.equal(JSON.parse(setup.output).error.code, "OPERATOR_IDENTITY_MISMATCH");
  assert(!setup.output.includes("SECRET"));
});

test("inventory completion never implies release readiness and uses the same reconciled marker predicate", async (t) => {
  const db = await fixture(t);
  const initial = await execute(db);
  assert.equal(initial.report.complete, true);
  assert.equal(initial.report.allOrganizationsReady, false);
  assert.deepEqual(initial.report.pendingOrganizationIds, [1]);
  assert.equal(initial.report.releaseAuthorized, false);
  await execute(db, apply());
  const ready = await execute(db);
  assert.equal(ready.report.allOrganizationsReady, true);
  assert.deepEqual(ready.report.pendingOrganizationIds, []);
  db.sqlite.exec("UPDATE ticket_command_backfills SET pending_count=1 WHERE organization_id=1");
  assert.equal((await execute(db)).report.allOrganizationsReady, false);
});

test("report failure after a committed page preserves that page and prevents further pages", async (t) => {
  const db = await fixture(t); db.add(1); db.add(2);
  let progress = 0;
  const result = await execute(db, apply({ pageSize: 1, maxPages: 2 }), { onProgress: async () => { progress += 1; if (progress === 2) throw new Error("disk became unavailable"); } });
  assert.equal(result.exitCode, 1); assert.equal(result.report.pages.length, 1);
  assert.equal(result.report.migrated, 1);
  assert.equal(result.report.pages[0].pendingCount, 1);
  assert.equal(db.rows("organization_tickets").length, 1);
});

test("a source row arriving before final inspection cannot produce complete=true", async (t) => {
  const db = await fixture(t); db.add(1);
  const prepare = db.env.DB.prepare;
  let countReads = 0;
  db.env.DB.prepare = (sql) => {
    const statement = prepare(sql);
    if (!sql.includes("WITH eligible")) return statement;
    const first = statement.first;
    statement.first = async () => { countReads += 1; if (countReads === 3) db.add(2); return first(); };
    return statement;
  };
  const result = await execute(db, apply());
  assert.equal(result.exitCode, 2); assert.equal(result.report.complete, false);
  assert.equal(result.report.final.pendingCount, 1);
});

test("mismatched injected identity is not reported as verified", async (t) => {
  const db = await fixture(t);
  const result = await execute(db, inventory(), { identity: { ...identity, name: "wrong" } });
  assert.equal(result.exitCode, 1); assert.equal(result.report.database.verified, false);
});


test("preflight rejects a real SQLite expansion with DEFAULT 10 instead of DEFAULT 1", async (t) => {
  const db = await fixture(t, { differentVersionDefault: true });
  const version = db.sqlite.prepare("PRAGMA table_info(organization_tickets)").all().find((column) => column.name === "version");
  assert.equal(version.dflt_value, "10");
  const before = db.snapshot();
  const result = await execute(db, apply());
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.error.code, "OPERATOR_PREFLIGHT_FAILED");
  assert(result.report.preflight.missingSchema.includes("column-definition:organization_tickets.version"));
  assert.deepEqual(db.snapshot(), before);
});


const pinnedPackage = async () => ({ version: "4.140.0" });
const wrapperConfigPath = join(tmpdir(), "operator path with spaces", "wrangler.json");

for (const [name, command, response] of [
  ["database identity", ["d1", "info", "maono_maps"], { uuid: databaseId, name: "maono_maps" }],
  ["current bookmark", ["d1", "time-travel", "info", "maono_maps"], { bookmark: "00000001-00000002-00000003" }],
]) test(`pinned Wrangler ${name} preserves JSON output and invokes Node without a shell`, async () => {
  const inheritedLog = process.env.WRANGLER_LOG;
  let executed = 0;
  const actual = await runPinnedWranglerJson(command, wrapperConfigPath, {
    readPackage: pinnedPackage,
    async execCommand(binary, args, options) {
      executed += 1;
      assert.equal(binary, process.execPath);
      assert.match(args[0].replaceAll("\\", "/"), /operator\/node_modules\/wrangler\/bin\/wrangler\.js$/);
      assert.deepEqual(args.slice(1), [...command, "--config", wrapperConfigPath, "--json"]);
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.equal(options.env.WRANGLER_LOG, "log", "Wrangler uses logger.log to emit --json; none would suppress stdout");
      assert.equal(options.env.WRANGLER_WRITE_LOGS, "false");
      assert.equal(options.env.WRANGLER_SEND_METRICS, "false");
      assert.equal(options.env.CI, "true");
      assert(options.timeout > 0);
      return { stdout: `  ${JSON.stringify(response)}\n`, stderr: "PRIVATE-DIAGNOSTIC" };
    },
  });
  assert.equal(executed, 1);
  assert.deepEqual(actual, response);
  assert(!JSON.stringify(actual).includes("PRIVATE-DIAGNOSTIC"));
  assert.equal(process.env.WRANGLER_LOG, inheritedLog, "subprocess settings must not change the parent logger");
});

function assertSafeWranglerFailure(error, expectedCode, secrets = []) {
  assert.equal(error.code, expectedCode);
  assert.equal(error.operatorSafe, true);
  const exposed = [String(error), error.stack || "", JSON.stringify(error)].join("\n");
  for (const secret of secrets) assert(!exposed.includes(secret), `Diagnostic leaked ${secret}`);
  return true;
}

test("pinned Wrangler command failures redact stdout, stderr, command text and tokens", async () => {
  const secrets = ["PRIVATE-STDOUT", "PRIVATE-STDERR", "PRIVATE-API-TOKEN", "PRIVATE-COMMAND"];
  await assert.rejects(runPinnedWranglerJson(["d1", "info", "maono_maps"], wrapperConfigPath, {
    readPackage: pinnedPackage,
    async execCommand() {
      throw Object.assign(new Error("PRIVATE-COMMAND failed with PRIVATE-API-TOKEN"), {
        code: 1, stdout: "PRIVATE-STDOUT", stderr: "PRIVATE-STDERR", cmd: "PRIVATE-COMMAND",
      });
    },
  }), (error) => assertSafeWranglerFailure(error, "OPERATOR_WRANGLER_COMMAND_FAILED", secrets));
});

test("successful Wrangler invocation with empty stdout has a distinct safe diagnostic", async () => {
  for (const stdout of ["", " \r\n\t "]) {
    await assert.rejects(runPinnedWranglerJson(["d1", "info", "maono_maps"], wrapperConfigPath, {
      readPackage: pinnedPackage,
      execCommand: async () => ({ stdout, stderr: "PRIVATE-STDERR" }),
    }), (error) => assertSafeWranglerFailure(error, "OPERATOR_WRANGLER_EMPTY_OUTPUT", ["PRIVATE-STDERR"]));
  }
});

test("Wrangler malformed JSON and non-object shapes fail without echoing output", async () => {
  for (const stdout of ["PRIVATE-MALFORMED-OUTPUT", '{"token":"PRIVATE-JSON-TOKEN",}', "[]", "null", "123", '"PRIVATE-STRING"', "true"]) {
    await assert.rejects(runPinnedWranglerJson(["d1", "info", "maono_maps"], wrapperConfigPath, {
      readPackage: pinnedPackage,
      execCommand: async () => ({ stdout, stderr: "PRIVATE-STDERR" }),
    }), (error) => assertSafeWranglerFailure(error, "OPERATOR_WRANGLER_INVALID_JSON", ["PRIVATE-MALFORMED-OUTPUT", "PRIVATE-JSON-TOKEN", "PRIVATE-STRING", "PRIVATE-STDERR"]));
  }
});

test("missing or unreadable pinned installation aborts before executing Wrangler", async () => {
  let executed = false;
  await assert.rejects(runPinnedWranglerJson(["d1", "info", "maono_maps"], wrapperConfigPath, {
    readPackage: async () => { throw new Error("PRIVATE-INSTALLATION-PATH"); },
    execCommand: async () => { executed = true; return { stdout: "{}" }; },
  }), (error) => assertSafeWranglerFailure(error, "OPERATOR_WRANGLER_INSTALLATION", ["PRIVATE-INSTALLATION-PATH"]));
  assert.equal(executed, false);
});

test("an unpinned Wrangler version aborts before authentication or execution", async () => {
  let executed = false;
  await assert.rejects(runPinnedWranglerJson(["d1", "info", "maono_maps"], wrapperConfigPath, {
    readPackage: async () => ({ version: "4.139.0" }),
    execCommand: async () => { executed = true; return { stdout: "{}" }; },
  }), (error) => assertSafeWranglerFailure(error, "OPERATOR_WRANGLER_VERSION"));
  assert.equal(executed, false);
});
