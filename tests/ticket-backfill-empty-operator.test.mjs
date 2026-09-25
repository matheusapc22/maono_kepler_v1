import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { createTicketCommandDb } from "./helpers/ticket-command-db.mjs";
import { parseOperatorArgs, runOperator } from "../scripts/central-chamados/operator/lib.mjs";
import { main } from "../scripts/central-chamados/operator/backfill-d1.mjs";

const identity = { name: "maono_maps", id: "5bc4dc32-f3bd-4c92-bbd1-cbda63e467db" };
const args = (path = "unused.json") => ["--database-name", identity.name, "--database-id", identity.id, "--report", path,
  "--mode", "reconcile-empty", "--organization-id", "1", "--operator-user-id", "1", "--confirm-database-id", identity.id, "--writers-paused"];
const options = () => parseOperatorArgs(args());
const backup = { bookmark: "LOCAL-TEST-BOOKMARK-ONLY", capturedAt: "2026-09-25T18:30:00Z" };
async function fixture(t) {
  const db = await createTicketCommandDb(t, { marker: false });
  db.sqlite.exec(`UPDATE users SET role='super_admin' WHERE id=1;
    DELETE FROM organization_users;
    CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT);
    INSERT INTO d1_migrations(name,applied_at) VALUES
      ('0025_ticket_triage_classification.sql','2026-09-25 16:11:52'),
      ('0026_ticket_command_lifecycle.sql','2026-09-25 17:10:33');
    INSERT INTO organization_tickets(organization_id,subject,description,created_by) VALUES
      (1,'Existing canonical A','Preserve',2),(1,'Existing canonical B','Preserve',2);`);
  db.createLegacySource();
  return db;
}
const run = (db, config = options(), deps = {}) => runOperator(db.env, config, { identity, backup, runId: "empty-operator-local", ...deps });

test("empty mode requires explicit mutation gates and rejects a fallback identity", () => {
  assert.equal(options().fallbackUserId, null);
  assert.throws(() => parseOperatorArgs([...args(), "--fallback-user-id", "1"]), { code: "OPERATOR_MODE_INVALID" });
  assert.throws(() => parseOperatorArgs(args().filter((x) => x !== "--writers-paused")), { code: "OPERATOR_WRITER_PAUSE_REQUIRED" });
  const missingActor = args(); missingActor.splice(missingActor.indexOf("--operator-user-id"), 2);
  assert.throws(() => parseOperatorArgs(missingActor));
  const wrongTarget = args(); wrongTarget[wrongTarget.indexOf("--confirm-database-id") + 1] = "other";
  assert.throws(() => parseOperatorArgs(wrongTarget), { code: "OPERATOR_CONFIRMATION_REQUIRED" });
});

test("empty organization without members gains only a marker and replay changes nothing", async (t) => {
  const db = await fixture(t); const before = db.snapshot();
  const first = await run(db);
  assert.equal(first.exitCode, 0, JSON.stringify(first.report));
  assert.equal(first.report.mode, "reconcile-empty"); assert.equal(first.report.fallbackUserId, null);
  assert.equal(first.report.migrated, 0); assert.equal(first.report.writesPerformed, true);
  assert.equal(first.report.final.canonicalTotal, 2); assert.equal(first.report.final.sourceCount, 0);
  assert.equal(first.report.final.marker.status, "ready"); assert.equal(first.report.releaseAuthorized, false);
  const after = db.snapshot();
  for (const table of Object.keys(before)) if (table !== "ticket_command_backfills") assert.deepEqual(after[table], before[table], table);
  assert.equal(after.organization_users.length, 0);
  const replay = await run(db);
  assert.equal(replay.exitCode, 0); assert.equal(replay.report.reconciledReplay, true);
  assert.equal(replay.report.writesPerformed, false); assert.deepEqual(db.snapshot(), after);
});

test("ordinary apply still requires a fallback member even when the source is empty", async (t) => {
  const db = await fixture(t); const before = db.snapshot();
  const result = await run(db, { ...options(), mode: "apply", fallbackUserId: 1 });
  assert.equal(result.exitCode, 1); assert.equal(result.report.error.code, "OPERATOR_FALLBACK_INVALID");
  assert.deepEqual(db.snapshot(), before);
});

for (const adopted of [false, true]) test(`empty mode rejects nonempty source (already imported: ${adopted}) without effects`, async (t) => {
  const db = await fixture(t);
  db.sqlite.exec("INSERT INTO tickets(id,organization_id,subject,created_by,active) VALUES(7,1,'PRIVATE-TICKET-TEXT',2,1)");
  if (adopted) db.sqlite.exec("UPDATE organization_tickets SET legacy_ticket_id=7 WHERE id=1");
  const before = db.snapshot(); const result = await run(db);
  assert.equal(result.exitCode, 1); assert.equal(result.report.error.code, "TICKET_BACKFILL_EMPTY_SOURCE_REQUIRED");
  assert.equal(result.report.writesPerformed, false); assert.equal(result.report.commitOutcomeUnknown, false);
  assert.equal(result.report.durableEffects, "none"); assert.deepEqual(db.snapshot(), before);
  assert(!JSON.stringify(result.report).includes("PRIVATE-TICKET-TEXT"));
});

for (const [name, change, deps, code] of [
  ["non-super-admin", (db) => db.sqlite.exec("UPDATE users SET role='owner' WHERE id=1"), {}, "OPERATOR_ACTOR_INVALID"],
  ["inactive organization", (db) => db.sqlite.exec("UPDATE organizations SET active=0 WHERE id=1"), {}, "OPERATOR_ORGANIZATION_INACTIVE"],
  ["missing bookmark", () => {}, { backup: null }, "OPERATOR_BACKUP_REQUIRED"],
]) test(`empty mode preserves ${name} gate`, async (t) => {
  const db = await fixture(t); change(db); const before = db.snapshot();
  const result = await run(db, options(), deps);
  assert.equal(result.exitCode, 1); assert.equal(result.report.error.code, code);
  assert.equal(result.report.durableEffects, "none"); assert.deepEqual(db.snapshot(), before);
});

test("a source appearing after the helper result blocks final completion without claiming rollback", async (t) => {
  const db = await fixture(t); let progress = 0;
  const result = await run(db, options(), { onProgress: async () => {
    if (++progress === 2) db.sqlite.exec("INSERT INTO tickets(id,organization_id,subject,created_by,active) VALUES(7,1,'Late source',2,1)");
  } });
  assert.equal(result.exitCode, 1); assert.equal(result.report.error.code, "OPERATOR_EMPTY_RECONCILIATION_STALE");
  assert.equal(result.report.complete, false); assert.equal(result.report.writesPerformed, true);
  assert.equal(result.report.commitOutcomeUnknown, false); assert.equal(result.report.durableEffects, "reconciliation_marker_written");
  assert.equal(db.rows("organization_tickets").length, 2); assert.equal(db.rows("ticket_events").length, 0);
});

test("report persistence failure after the marker preserves a known durable result", async (t) => {
  const db = await fixture(t); let progress = 0;
  const result = await run(db, options(), { onProgress: async () => { if (++progress === 2) throw new Error("disk failed"); } });
  assert.equal(result.exitCode, 1); assert.equal(result.report.writesPerformed, true);
  assert.equal(result.report.commitOutcomeUnknown, false); assert.equal(result.report.durableEffects, "reconciliation_marker_written");
  assert.equal(db.rows("ticket_command_backfills")[0].status, "ready");
});

test("CLI empty mode verifies identity and captures a bookmark before writing, without fallback or migrations", async (t) => {
  const db = await fixture(t); const folder = await mkdtemp(join(tmpdir(), "cc03-empty-cli-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const reportPath = join(folder, "new.json"); const calls = []; let disposed = false;
  const DB = { ...db.env.DB, prepare(sql) {
    const statement = db.env.DB.prepare(sql);
    return !sql.includes("operator_probe") ? statement : { ...statement, async all() {
      return { ...await statement.all(), meta: { served_by: "v3-prod" } };
    } };
  } };
  const code = await main(args(reportPath), { output() {}, signals: new EventEmitter(),
    async wranglerJson(call) { calls.push(call); assert.equal(db.rows("ticket_command_backfills").length, 0);
      return call.includes("time-travel") ? { bookmark: backup.bookmark } : { name: identity.name, uuid: identity.id }; },
    async getPlatformProxy(config) { assert.equal(config.remoteBindings, true); return { env: { DB }, async dispose() { disposed = true; } }; },
  });
  assert.equal(code, 0); assert.equal(disposed, true);
  assert.deepEqual(calls, [["d1", "info", identity.name], ["d1", "time-travel", "info", identity.name]]);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.mode, "reconcile-empty"); assert.equal(report.fallbackUserId, null);
  assert.equal(report.backup.bookmark, backup.bookmark); assert.equal(report.final.canonicalTotal, 2);
});
