import { createHash } from "node:crypto";
const SOURCE_TABLES = [
  "organization_tickets",
  "ticket_command_outbox",
  "ticket_cycles",
  "ticket_commands",
  "ticket_events",
  "ticket_notification_candidates",
  "ticket_export_generation",
  "users",
  "organization_users",
];
import {
  PRODUCTION_DATABASE_NAME,
  runWranglerJson,
  rowsFromD1Json,
  gateError,
} from "./production-migration-lib.mjs";
export const CC15_MIGRATION = "0038_ticket_feedback.sql";
export const CC15_SCHEMA_QUERY = `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN (${SOURCE_TABLES.map((t) => `'${t}'`).join(",")}) OR name LIKE 'ticket_feedback_%' OR name LIKE 'idx_ticket_feedback_%' ORDER BY type,name;`;
export function evaluateCC15Schema(objects, ledger) {
  const applied = new Set(ledger.map((x) => x.name));
  const missingLedger = [
    "0010_ticket_center.sql",
    "0037_ticket_knowledge.sql",
    "0036_ticket_incidents_problems.sql",
    "0025_ticket_triage_classification.sql",
    "0026_ticket_command_lifecycle.sql",
    "0027_ticket_selective_access.sql",
    "0028_ticket_conversations.sql",
    "0033_ticket_sla_policies.sql",
    "0034_ticket_metric_rollups.sql",
    "0035_ticket_report_exports.sql",
    "0031_ticket_change_reconciliation.sql",
    "0030_ticket_notifications.sql",
  ].filter((n) => !applied.has(n));
  const missingTables = SOURCE_TABLES.filter(
    (t) => !objects.some((o) => o.type === "table" && o.name === t),
  );
  const required = {
    organization_tickets: ["id", "organization_id", "version", "visibility"],
    ticket_cycles: [
      "ticket_id",
      "organization_id",
      "cycle_number",
      "closed_at",
    ],
    ticket_notification_candidates: ["outbox_id", "recipient_id", "state"],
    ticket_command_outbox: ["event_id", "notification_token"],
    ticket_export_generation: ["id", "version"],
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
    .filter(
      (o) =>
        o.name.startsWith("ticket_feedback_") ||
        o.name.startsWith("idx_ticket_feedback_"),
    )
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
export async function readCC15Schema(configPath, ledger) {
  return evaluateCC15Schema(
    rowsFromD1Json(
      await runWranglerJson(
        [
          "d1",
          "execute",
          PRODUCTION_DATABASE_NAME,
          "--remote",
          "--command",
          CC15_SCHEMA_QUERY,
        ],
        configPath,
      ),
    ),
    ledger,
  );
}
export function assertCC15Schema(report) {
  if (!report.compatible)
    throw gateError(
      "CC15_SCHEMA_PREFLIGHT_BLOCKED",
      "Schema/ledger incompatível com 0038; revisar audit antes de autorizar.",
      {
        missingLedger: report.missingLedger,
        missingTables: report.missingTables,
        missingColumns: report.missingColumns,
        conflicting: report.conflicting,
      },
    );
}
