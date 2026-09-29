import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTicketCommandDb } from "./helpers/ticket-command-db.mjs";
import {
  CC12_SCHEMA_QUERY,
  evaluateCC12Schema,
} from "../scripts/migrations/cc12-schema-preflight.mjs";
const read = (n) =>
  readFileSync(new URL("../migrations/" + n, import.meta.url), "utf8");
test("0035 preflight requires prerequisite ledger/schema and rejects partial/previous apply", async (t) => {
  const f = await createTicketCommandDb(t),
    names = [
      "0010_ticket_center.sql",
      "0025_ticket_triage_classification.sql",
      "0026_ticket_command_lifecycle.sql",
      "0027_ticket_selective_access.sql",
      "0028_ticket_conversations.sql",
      "0033_ticket_sla_policies.sql",
      "0034_ticket_metric_rollups.sql",
    ];
  for (const n of names.slice(3)) f.sqlite.exec(read(n));
  const objects = f.sqlite.prepare(CC12_SCHEMA_QUERY).all(),
    ledger = names.map((name) => ({ name }));
  assert.equal(evaluateCC12Schema(objects, ledger).compatible, true);
  assert.equal(
    evaluateCC12Schema(objects, ledger.slice(0, -1)).compatible,
    false,
  );
  assert.equal(
    evaluateCC12Schema(
      objects.filter((o) => o.name !== "ticket_access_group_members"),
      ledger,
    ).compatible,
    false,
  );
  f.sqlite.exec(read("0035_ticket_report_exports.sql"));
  assert.equal(
    evaluateCC12Schema(f.sqlite.prepare(CC12_SCHEMA_QUERY).all(), ledger)
      .compatible,
    false,
  );
  assert.throws(
    () => f.sqlite.exec(read("0035_ticket_report_exports.sql")),
    /already exists/,
  );
});
