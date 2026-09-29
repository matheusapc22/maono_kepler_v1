import { metricWindow } from "./ticket-metrics-domain.js";

export const EXPORT_VERSION = 1;
export const SOURCE_TABLES = Object.freeze([
  "organization_tickets",
  "ticket_cycles",
  "ticket_events",
  "ticket_wait_intervals",
  "ticket_messages",
  "ticket_message_revisions",
  "ticket_commands",
  "ticket_sla_assignments",
  "ticket_sla_policies",
  "ticket_metric_definitions",
  "ticket_acl_entries",
  "ticket_ticket_access_policies",
  "ticket_access_policies",
  "ticket_access_policy_entries",
  "ticket_access_groups",
  "ticket_access_group_members",
  "organization_users",
  "organizations",
  "users",
  "user_permission_denials",
]);
export const TERMINAL = new Set([
  "ready",
  "failed",
  "cancelled",
  "expired",
  "revoked",
]);
export const CSV_HEADERS = [
  "ticket_id",
  "code",
  "subject",
  "domain",
  "nature",
  "current_status",
  "current_assignee",
  "source_version",
  "definition_version",
  "policy_versions",
  "first_response_ms",
  "first_response_useful_ms",
  "age_ms",
  "cycle_age_ms",
  "wait_ms",
  "open_at_as_of",
  "waiting_at_as_of",
  "wip_at_as_of",
  "resolution_cycles_json",
  "wait_reasons_json",
  "reopening_json",
  "quality_json",
  "watermark",
  "source_sha256",
  "cycles_json",
  "wait_intervals_json",
];

export function exportError(
  code,
  status = 400,
  message = "Exportação indisponível. Atualize a consulta ou solicite um novo relatório.",
) {
  return Object.assign(new Error(message), {
    code: `TICKET_EXPORT_${code}`,
    status,
  });
}
export const enabled = (value) => String(value).toLowerCase() === "true";
export const exportsEnabled = (env, org) =>
  enabled(env.MAONO_TICKET_EXPORTS_ENABLED) &&
  String(env.MAONO_TICKET_EXPORT_ORGANIZATION_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .includes(String(org));
export function exportConfig(env) {
  const integer = (name, min, max) => {
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw exportError("CONFIG_REQUIRED", 503);
    return value;
  };
  // Mandatory operational settings; bounds are engineering ceilings, not approved production defaults.
  const config = {
    ttl: integer("MAONO_TICKET_EXPORT_TTL_SECONDS", 60, 604800),
    maxRows: integer("MAONO_TICKET_EXPORT_MAX_ROWS", 250, 50000),
    maxBytes: integer("MAONO_TICKET_EXPORT_MAX_BYTES", 1024, 100 * 1024 * 1024),
    maxJobs: integer("MAONO_TICKET_EXPORT_MAX_JOBS_PER_ORG", 1, 50),
    attempts: integer("MAONO_TICKET_EXPORT_MAX_ATTEMPTS", 1, 10),
  };
  if (env.MAONO_TICKET_EXPORT_CSV_PROFILE !== "text-v1")
    throw exportError("CSV_PROFILE_REQUIRED", 503);
  return config;
}
export function normalizeExportInput(body, { cases = false } = {}) {
  if (
    !body ||
    typeof body.idempotencyKey !== "string" ||
    !/^[\w-]{16,100}$/.test(body.idempotencyKey)
  )
    throw exportError("INVALID_REQUEST");
  const allowed = new Set([
    "idempotencyKey",
    "from",
    "to",
    "asOf",
    "report",
    "domain",
    "nature",
    "definitionVersion",
  ]);
  if (Object.keys(body).some((k) => !allowed.has(k)))
    throw exportError("INVALID_FILTER");
  const report = body.report || "all";
  if (["causes", "incidents"].includes(report) && !cases)
    throw exportError(
      "CC13_REQUIRED",
      409,
      "Relatórios de incidentes e causas aguardam a CC-13.",
    );
  if (
    !["all", "backlog", "cycles", "sla", "causes", "incidents"].includes(report)
  )
    throw exportError("INVALID_REPORT");
  const domain = body.domain || null,
    nature = body.nature || null;
  if (
    domain &&
    !["map", "database", "permission", "export", "support", "other"].includes(
      domain,
    )
  )
    throw exportError("INVALID_FILTER");
  if (
    nature &&
    ![
      "question_request",
      "incident",
      "defect",
      "improvement_change",
      "recurring_problem",
      "unknown",
    ].includes(nature)
  )
    throw exportError("INVALID_FILTER");
  if (
    body.definitionVersion != null &&
    (!Number.isSafeInteger(body.definitionVersion) ||
      body.definitionVersion < 0)
  )
    throw exportError("INVALID_DEFINITION");
  return {
    ...metricWindow(body),
    report,
    domain,
    nature,
    definitionVersion: body.definitionVersion ?? null,
  };
}
export async function sha256(input) {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new TextEncoder().encode(
          typeof input === "string" ? input : JSON.stringify(input),
        );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
// text-v1 deliberately prefixes EVERY string with a printable fixed label. This avoids
// relying on apostrophes/tabs that spreadsheet programs can strip on save/reopen.
// The reversible representation is declared in the manifest; numbers remain numbers.
export function csvCell(value) {
  const raw =
    value == null
      ? ""
      : typeof value === "number"
        ? String(Number.isFinite(value) ? value : "")
        : typeof value === "boolean"
          ? value
            ? "1"
            : "0"
          : `text:${typeof value === "string" ? value : JSON.stringify(value)}`;
  return '"' + raw.replaceAll('"', '""') + '"';
}
export const csvLine = (values) => values.map(csvCell).join(",") + "\r\n";
export function ticketCsvRow(ticket, fact, definition, policyVersions, hash) {
  const values = [
    ticket.id,
    ticket.code,
    ticket.subject,
    ticket.category,
    fact.nature,
    ticket.status,
    ticket.assigned_to,
    ticket.version,
    definition.version,
    policyVersions,
    fact.response,
    fact.responseUseful,
    fact.age,
    fact.cycleAge,
    fact.wait,
    fact.open,
    fact.waiting,
    fact.wip,
    fact.resolution,
    fact.waitByReason,
    fact.reopening,
    fact.quality,
    fact.watermark,
    hash,
    fact.cycles,
    fact.waitIntervals,
  ];
  if (fact.cases) values.push(fact.cases);
  return csvLine(values);
}
