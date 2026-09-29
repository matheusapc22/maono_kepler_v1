// CC15 native D1 binding, local only. No production credentials or remote bindings.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTicketCommandDb,
  COMMAND_ACTORS,
} from "../../../tests/helpers/ticket-command-db.mjs";
import {
  publishFeedbackInstrument,
  reconcileFeedback,
  listFeedback,
  respondFeedback,
  withdrawFeedback,
  feedbackMetricSource,
} from "../../../functions/_lib/ticket-feedback.js";
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
    "0038_ticket_feedback.sql",
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
  directory = await mkdtemp(join(tmpdir(), "cc15-native-"));
  const configPath = join(directory, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "cc15-local-fixture",
      compatibility_date: "2026-09-29",
      d1_databases: [
        {
          binding: "DB",
          database_name: "cc15-local-fixture",
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
    MAONO_TICKET_FEEDBACK_ENABLED: "true",
    MAONO_TICKET_FEEDBACK_ORGANIZATION_IDS: "1",
    MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: "true",
    MAONO_TICKET_CONVERSATIONS_ENABLED: "true",
  };
  const owner = COMMAND_ACTORS.owner;
  const definition = {
    resultQuestion: "Result?",
    effortQuestion: "Effort?",
    consentText: "Local fixture only",
    windowHours: 24,
    outcomes: ["Yes", "No"],
    effortLabels: ["Low", "High"],
    effortDirection: "ascending",
    individualAudience: "requester",
    aggregateAudience: "ticket.manage",
    eligibleActor: "requester",
    approved: true,
  };
  await publishFeedbackInstrument(env, 1, owner, {
    definition,
    expectedVersion: 0,
    requestKey: crypto.randomUUID(),
  });
  const at = new Date().toISOString();
  await DB.prepare(
    "UPDATE organization_tickets SET status='closed' WHERE id=1",
  ).run();
  await DB.prepare(
    "INSERT INTO ticket_cycles(organization_id,ticket_id,cycle_number,origin,opened_at,closed_at) VALUES(1,1,1,'created',?,?)",
  )
    .bind(at, at)
    .run();
  assert.equal((await reconcileFeedback(env, 1, owner)).issued, 1);
  assert.equal((await reconcileFeedback(env, 1, owner)).existing, 1);
  const i = (await listFeedback(env, 1, owner)).items[0];
  const answer = {
    outcome: "No",
    effort: 1,
    comment: "Private local only",
    consent: true,
  };
  const a = await respondFeedback(env, 1, owner, i.id, answer);
  assert.equal(
    (await respondFeedback(env, 1, owner, i.id, answer)).receipt,
    a.receipt,
  );
  await assert.rejects(
    DB.batch([
      DB.prepare("INSERT INTO ticket_feedback_guard VALUES(0)"),
      DB.prepare("INSERT INTO audit_logs(action) VALUES('SHOULD_NOT_COMMIT')"),
    ]),
  );
  assert.equal(
    await DB.prepare(
      "SELECT 1 FROM audit_logs WHERE action='SHOULD_NOT_COMMIT'",
    ).first(),
    null,
  );
  await withdrawFeedback(env, 1, owner, i.id);
  assert.equal((await listFeedback(env, 1, owner)).items[0].state, "withdrawn");
  assert.equal(
    (await feedbackMetricSource(env, 1, owner)).rows[0].outcome,
    null,
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
    "CC15 native D1: instrument, invite, response, replay, withdrawal, atomic rollback and integrity PASS",
  );
} finally {
  await proxy?.dispose();
  for (const fn of cleanup) fn();
  if (directory) await rm(directory, { recursive: true, force: true });
}
