// CC14 native D1 binding, local only. No production credentials or remote bindings.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTicketCommandDb,
  COMMAND_ACTORS,
} from "../../../tests/helpers/ticket-command-db.mjs";
import {
  commandKnowledge,
  readKnowledge,
  selectKnowledge,
  sendKnowledge,
} from "../../../functions/_lib/ticket-knowledge.js";
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
    "0037_ticket_knowledge.sql",
  ])
    f.sqlite.exec(
      await readFile(
        new URL("../../../migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  f.sqlite.exec(
    "INSERT INTO organization_tickets(id,organization_id,subject,description,status,created_by,visibility) VALUES(1,1,'Local only','fixture','open',1,'organization')",
  );
  directory = await mkdtemp(join(tmpdir(), "cc14-native-"));
  const configPath = join(directory, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "cc14-local-fixture",
      compatibility_date: "2026-09-29",
      d1_databases: [
        {
          binding: "DB",
          database_name: "cc14-local-fixture",
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
    MAONO_TICKET_KNOWLEDGE_ENABLED: "true",
    MAONO_TICKET_KNOWLEDGE_ORGANIZATION_IDS: "1",
    MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: "true",
    MAONO_TICKET_CONVERSATIONS_ENABLED: "true",
  };
  const owner = COMMAND_ACTORS.owner,
    peer = COMMAND_ACTORS.peer,
    key = () => crypto.randomUUID();
  const created = await commandKnowledge(env, 1, owner, null, {
    action: "create",
    title: "Native D1",
    body: "Sanitized",
    reviewerId: 2,
    idempotencyKey: key(),
  });
  async function command(action, extra = {}, actor = owner) {
    const d = await readKnowledge(env, 1, actor, created.id);
    return commandKnowledge(env, 1, actor, created.id, {
      action,
      version: d.version,
      idempotencyKey: key(),
      ...extra,
    });
  }
  await command("revise", {
    title: "Native v2",
    body: "Reviewed text",
    audience: "organization",
  });
  await command("submit", { reason: "Review" });
  await command("approve", { reason: "Independent review" }, peer);
  await command("publish", { reason: "Publish" });
  const article = await readKnowledge(env, 1, owner, created.id);
  const selection = await selectKnowledge(env, 1, owner, created.id, {
    revisionId: article.published.id,
    ticketId: 1,
    kind: "response",
    idempotencyKey: key(),
  });
  const payload = {
    selectionId: selection.selectionId,
    body: "Human revised response",
    reviewed: true,
  };
  const sent = await sendKnowledge(
    env,
    1,
    owner,
    created.id,
    payload,
    new Request("https://local.example"),
  );
  assert.equal(sent.message.knowledge.revisionNumber, 2);
  assert.equal(
    (
      await sendKnowledge(
        env,
        1,
        owner,
        created.id,
        payload,
        new Request("https://local.example"),
      )
    ).replayed,
    true,
  );
  await command("withdraw", { reason: "Retire" });
  await assert.rejects(
    selectKnowledge(env, 1, owner, created.id, {
      revisionId: article.published.id,
      ticketId: 1,
      kind: "response",
      idempotencyKey: key(),
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
      DB.prepare("INSERT INTO ticket_knowledge_guard VALUES(0)"),
      DB.prepare("UPDATE ticket_knowledge_articles SET state='draft'"),
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
  assert.deepEqual(
    (await DB.prepare("PRAGMA foreign_key_check").all()).results,
    [],
  );
  assert.equal(
    (await DB.prepare("PRAGMA quick_check").first()).quick_check,
    "ok",
  );
  console.log(
    "CC14 native D1: editorial lifecycle, atomic provenance, replay, withdrawal, rollback and integrity PASS",
  );
} finally {
  await proxy?.dispose();
  for (const fn of cleanup) fn();
  if (directory) await rm(directory, { recursive: true, force: true });
}
