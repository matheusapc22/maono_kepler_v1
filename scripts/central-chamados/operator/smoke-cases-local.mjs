// CC13 native D1 binding, local only. No production credentials or remote bindings.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTicketCommandDb,
  COMMAND_ACTORS,
} from "../../../tests/helpers/ticket-command-db.mjs";
import { commandCase, readCase } from "../../../functions/_lib/ticket-cases.js";
import { getPlatformProxy } from "wrangler";
const cleanup = [];
let proxy, directory;
try {
  const f = await createTicketCommandDb({
    after(fn) {
      cleanup.push(fn);
    },
  });
  for (const name of [
    "0027_ticket_selective_access.sql",
    "0028_ticket_conversations.sql",
    "0030_ticket_notifications.sql",
    "0031_ticket_change_reconciliation.sql",
    "0033_ticket_sla_policies.sql",
    "0034_ticket_metric_rollups.sql",
    "0035_ticket_report_exports.sql",
    "0036_ticket_incidents_problems.sql",
  ])
    f.sqlite.exec(
      await readFile(
        new URL("../../../migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  directory = await mkdtemp(join(tmpdir(), "cc13-native-"));
  const configPath = join(directory, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "cc13-local-fixture",
      compatibility_date: "2026-09-29",
      d1_databases: [
        {
          binding: "DB",
          database_name: "cc13-local-fixture",
          database_id: "11111111-1111-4111-8111-111111111111",
          remote: false,
        },
      ],
    }),
  );
  proxy = await getPlatformProxy({
    configPath,
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  const DB = proxy.env.DB;
  const objects = f.sqlite
    .prepare(
      "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
    )
    .all();
  for (const o of objects.filter((o) => o.type === "table"))
    await DB.prepare(o.sql).run();
  for (const o of objects.filter((o) => o.type === "table"))
    for (const row of f.sqlite.prepare(`SELECT * FROM "${o.name}"`).all()) {
      const columns = Object.keys(row);
      await DB.prepare(
        `INSERT INTO "${o.name}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
      )
        .bind(...Object.values(row))
        .run();
    }
  for (const o of objects.filter((o) => o.type !== "table"))
    await DB.prepare(o.sql).run();
  const env = {
    ...f.env,
    DB,
    MAONO_RUNTIME_ENV: "local",
    MAONO_TICKET_CASES_ENABLED: "true",
    MAONO_TICKET_CASE_ORGANIZATION_IDS: "1",
    MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: "true",
  };
  const actor = COMMAND_ACTORS.owner,
    body = {
      action: "create",
      kind: "incident",
      title: "Native local only",
      idempotencyKey: crypto.randomUUID(),
    };
  const created = await commandCase(env, 1, actor, null, body);
  assert.equal((await commandCase(env, 1, actor, null, body)).replayed, true);
  const before = await readCase(env, 1, actor, created.id);
  await commandCase(env, 1, actor, created.id, {
    action: "transition",
    state: "restored",
    version: before.record.version,
    idempotencyKey: crypto.randomUUID(),
    data: { restoration: "Checked locally", reason: "Native binding test" },
  });
  await assert.rejects(
    commandCase(env, 1, actor, created.id, {
      action: "update",
      version: before.record.version,
      idempotencyKey: crypto.randomUUID(),
    }),
    { status: 409 },
  );
  const g = (
    await DB.prepare(
      "SELECT version FROM ticket_export_generation WHERE id=1",
    ).first()
  ).version;
  await assert.rejects(
    DB.batch([
      DB.prepare("INSERT INTO ticket_case_guard VALUES(0)"),
      DB.prepare("UPDATE ticket_cases SET title='must rollback'"),
    ]),
  );
  assert.equal(
    (
      await DB.prepare(
        "SELECT version FROM ticket_export_generation WHERE id=1",
      ).first()
    ).version,
    g,
  );
  assert.equal(
    (await readCase(env, 1, actor, created.id)).record.title,
    body.title,
  );
  assert.equal(
    (await DB.prepare("SELECT COUNT(*) n FROM ticket_case_events").first()).n,
    2,
  );
  assert.deepEqual(
    (await DB.prepare("PRAGMA foreign_key_check").all()).results,
    [],
  );
  assert.equal(
    (await DB.prepare("PRAGMA quick_check").first()).quick_check,
    "ok",
  );
  process.stdout.write(
    JSON.stringify({
      ok: true,
      mode: "local_native_D1",
      remoteBindings: false,
      checks: [
        "migration objects",
        "idempotent create",
        "CAS transition",
        "batch rollback",
        "generation triggers",
        "quick_check",
        "foreign_key_check",
      ],
    }) + "\n",
  );
} finally {
  await proxy?.dispose();
  for (const fn of cleanup) fn();
  if (directory) await rm(directory, { recursive: true, force: true });
}
