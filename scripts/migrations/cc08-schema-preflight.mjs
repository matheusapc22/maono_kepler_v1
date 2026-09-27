import { createHash } from "node:crypto";
import {
  PRODUCTION_DATABASE_NAME,
  runWranglerJson,
  rowsFromD1Json,
  gateError,
} from "./production-migration-lib.mjs";
export const CC08_MIGRATION = "0031_ticket_change_reconciliation.sql";
export function evaluateCC08Schema(objects, ledger) {
  const names = new Set(objects.map((r) => r.name)),
    applied = new Set(ledger.map((r) => r.name));
  const required = [
    "0020_project_change_requests.sql",
    "0026_ticket_command_lifecycle.sql",
    "0027_ticket_selective_access.sql",
    "0028_ticket_conversations.sql",
    "0030_ticket_notifications.sql",
  ];
  const missingLedger = required.filter((n) => !applied.has(n));
  const base =
    objects.find((r) => r.name === "project_change_requests")?.sql || "";
  const requiredObjects = [
    "project_change_requests",
    "project_change_operations",
    "trg_project_change_requests_immutable_content",
    "trg_project_change_operations_no_update",
    "trg_project_change_operations_no_direct_delete",
  ];
  const missingObjects = requiredObjects.filter((n) => !names.has(n));
  const conflicting = objects
    .filter(
      (r) =>
        r.name === "cc08_schema" ||
        /trg_change_request_lifecycle|trg_ticket_change_request_status_guard/.test(
          r.name,
        ) ||
        r.name === "project_change_request_apply_artifacts",
    )
    .map((r) => r.name);
  const baseColumns = [
    "organization_id",
    "project_id",
    "requested_by_user_id",
    "ticket_id",
    "base_revision",
    "submission_hash",
  ];
  const missingColumns = baseColumns.filter(
    (n) => !new RegExp(`\\b${n}\\b`, "i").test(base),
  );
  const hasLegacyExpansion = /\blifecycle_version\b|\bapplied_revision\b/i.test(
    base,
  );
  return {
    compatible:
      !missingLedger.length &&
      !missingObjects.length &&
      !missingColumns.length &&
      !conflicting.length &&
      !hasLegacyExpansion,
    missingLedger,
    missingObjects,
    missingColumns,
    conflicting,
    hasLegacyExpansion,
    digest: createHash("sha256").update(JSON.stringify(objects)).digest("hex"),
    objects,
  };
}
export async function readCC08Schema(configPath, ledger) {
  const json = await runWranglerJson(
    [
      "d1",
      "execute",
      PRODUCTION_DATABASE_NAME,
      "--remote",
      "--command",
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name LIKE '%change_request%' OR name='cc08_schema' ORDER BY type,name;",
    ],
    configPath,
  );
  return evaluateCC08Schema(rowsFromD1Json(json), ledger);
}
export function assertCC08Schema(report) {
  if (!report.compatible)
    throw gateError(
      "CC08_SCHEMA_PREFLIGHT_BLOCKED",
      "Schema CR/ledger não compatível; revisar relatório read-only antes de qualquer autorização.",
      {
        missingLedger: report.missingLedger,
        missingObjects: report.missingObjects,
        conflicting: report.conflicting,
      },
    );
}
