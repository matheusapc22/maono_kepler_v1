import { createHash } from "node:crypto";
import { SOURCE_TABLES } from "../../functions/_lib/ticket-export-domain.js";
import {
  PRODUCTION_DATABASE_NAME,
  runWranglerJson,
  rowsFromD1Json,
  gateError,
} from "./production-migration-lib.mjs";
export const CC12_MIGRATION = "0035_ticket_report_exports.sql";
export const CC12_SCHEMA_QUERY = `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN (${SOURCE_TABLES.map((t) => `'${t}'`).join(",")}) OR name LIKE 'ticket_export_%' ORDER BY type,name;`;
export function evaluateCC12Schema(objects, ledger) {
  const applied = new Set(ledger.map((x) => x.name));
  const missingLedger = [
    "0010_ticket_center.sql",
    "0025_ticket_triage_classification.sql",
    "0026_ticket_command_lifecycle.sql",
    "0027_ticket_selective_access.sql",
    "0028_ticket_conversations.sql",
    "0033_ticket_sla_policies.sql",
    "0034_ticket_metric_rollups.sql",
  ].filter((n) => !applied.has(n));
  const missingTables = SOURCE_TABLES.filter(
    (t) => !objects.some((o) => o.type === "table" && o.name === t),
  );
  const required = {
    organization_tickets: [
      "id",
      "organization_id",
      "version",
      "visibility",
      "category",
      "demand_nature",
    ],
    ticket_events: [
      "corrects_event_id",
      "message_id",
      "audience",
      "command_id",
      "entity_version",
    ],
    ticket_cycles: ["cycle_number", "origin", "opened_at", "closed_at"],
    ticket_metric_definitions: ["version", "reopen_hours"],
  };
  const missingColumns = Object.entries(required).flatMap(([t, columns]) =>
    columns
      .filter(
        (c) =>
          !new RegExp(`\\b${c}\\b`).test(
            objects.find((o) => o.name === t)?.sql || "",
          ),
      )
      .map((c) => `${t}.${c}`),
  );
  const conflicting = objects
    .filter((o) => o.name.startsWith("ticket_export_"))
    .map((o) => o.name);
  return {
    compatible:
      !missingLedger.length &&
      !missingTables.length &&
      !missingColumns.length &&
      !conflicting.length,
    missingLedger,
    missingTables,
    missingColumns,
    conflicting,
    objects,
    digest: createHash("sha256").update(JSON.stringify(objects)).digest("hex"),
  };
}
export async function readCC12Schema(configPath, ledger) {
  return evaluateCC12Schema(
    rowsFromD1Json(
      await runWranglerJson(
        [
          "d1",
          "execute",
          PRODUCTION_DATABASE_NAME,
          "--remote",
          "--command",
          CC12_SCHEMA_QUERY,
        ],
        configPath,
      ),
    ),
    ledger,
  );
}
export function assertCC12Schema(report) {
  if (!report.compatible)
    throw gateError(
      "CC12_SCHEMA_PREFLIGHT_BLOCKED",
      "Schema/ledger incompatível com 0035; revisar audit antes de autorizar.",
      {
        missingLedger: report.missingLedger,
        missingTables: report.missingTables,
        missingColumns: report.missingColumns,
        conflicting: report.conflicting,
      },
    );
}
