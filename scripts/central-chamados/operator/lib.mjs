import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inspectTicketLegacyBackfill, runTicketLegacyBackfillPage, reconcileEmptyTicketLegacyBackfill } from "../../../functions/_lib/ticket-legacy-backfill.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIGRATIONS = ["0025_ticket_triage_classification.sql", "0026_ticket_command_lifecycle.sql"];
const VALUE_OPTIONS = new Set(["database-name", "database-id", "account-id", "mode", "organization-id", "operator-user-id", "fallback-user-id", "confirm-database-id", "page-size", "max-pages", "report"]);
const BOOLEAN_OPTIONS = new Set(["writers-paused", "help"]);

export function operatorError(code, message) {
  return Object.assign(new Error(message), { code, operatorSafe: true });
}
function integer(value, label, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw operatorError("OPERATOR_ARGUMENT_INVALID", `${label} deve ser um inteiro entre 1 e ${max}.`);
  return number;
}
export function parseOperatorArgs(args) {
  const raw = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) throw operatorError("OPERATOR_ARGUMENT_INVALID", "Use apenas opções nomeadas com --.");
    const name = argument.slice(2);
    if (Object.hasOwn(raw, name) || (!VALUE_OPTIONS.has(name) && !BOOLEAN_OPTIONS.has(name))) throw operatorError("OPERATOR_ARGUMENT_INVALID", "Opção desconhecida ou repetida.");
    if (BOOLEAN_OPTIONS.has(name)) raw[name] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw operatorError("OPERATOR_ARGUMENT_INVALID", `Valor ausente para --${name}.`);
      raw[name] = value;
    }
  }
  if (raw.help) return { help: true };
  const options = {
    databaseName: raw["database-name"], databaseId: raw["database-id"], accountId: raw["account-id"] || null,
    mode: raw.mode || "inventory", organizationId: raw["organization-id"] === undefined ? null : integer(raw["organization-id"], "organization-id"),
    operatorUserId: raw["operator-user-id"] === undefined ? null : integer(raw["operator-user-id"], "operator-user-id"),
    fallbackUserId: raw["fallback-user-id"] === undefined ? null : integer(raw["fallback-user-id"], "fallback-user-id"),
    confirmDatabaseId: raw["confirm-database-id"] || null, writersPaused: raw["writers-paused"] === true,
    pageSize: integer(raw["page-size"], "page-size", 50, 100), maxPages: integer(raw["max-pages"], "max-pages", 1, 10000),
    reportPath: raw.report,
  };
  validateOperatorOptions(options);
  return options;
}
export function validateOperatorOptions(options, timestamp = new Date()) {
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(options.databaseName || "") || !UUID.test(options.databaseId || "")) throw operatorError("OPERATOR_DATABASE_INVALID", "Informe nome e UUID válidos do D1 de destino.");
  if (options.accountId && !/^[a-f0-9]{32}$/i.test(options.accountId)) throw operatorError("OPERATOR_ACCOUNT_INVALID", "account-id deve conter 32 caracteres hexadecimais.");
  if (!["inventory", "apply", "reconcile-empty"].includes(options.mode)) throw operatorError("OPERATOR_MODE_INVALID", "mode deve ser inventory, apply ou reconcile-empty.");
  if (typeof options.reportPath !== "string" || !options.reportPath.trim()) throw operatorError("OPERATOR_REPORT_REQUIRED", "--report é obrigatório e deve ser um arquivo novo numa pasta existente.");
  integer(options.pageSize, "page-size", 50, 100); integer(options.maxPages, "max-pages", 1, 10000);
  if (options.organizationId !== null && options.organizationId !== undefined) integer(options.organizationId, "organization-id");
  if (options.mode !== "inventory") {
    integer(options.organizationId, "organization-id"); integer(options.operatorUserId, "operator-user-id");
    if (options.mode === "apply") integer(options.fallbackUserId, "fallback-user-id");
    else if (options.fallbackUserId !== null && options.fallbackUserId !== undefined) throw operatorError("OPERATOR_MODE_INVALID", "reconcile-empty não importa chamados e não aceita autor substituto.");
    if (options.confirmDatabaseId !== options.databaseId) throw operatorError("OPERATOR_CONFIRMATION_REQUIRED", "--confirm-database-id deve repetir exatamente o UUID de destino.");
    if (!options.writersPaused) throw operatorError("OPERATOR_WRITER_PAUSE_REQUIRED", "Ateste a suspensão dos escritores legados com --writers-paused.");

  } else if (options.writersPaused || options.confirmDatabaseId || options.operatorUserId || options.fallbackUserId) {
    throw operatorError("OPERATOR_MODE_INVALID", "As confirmações e identidades de escrita exigem --mode apply ou reconcile-empty; o inventário não as utiliza.");
  }
  return options;
}

// Defense in depth for this fixed inventory query surface, not a generic SQL sandbox.
// Mutation methods always reject, and first/all cannot smuggle a write statement.
export function readOnlyD1(db) {
  const deny = () => { throw operatorError("OPERATOR_READ_ONLY", "O inventário não permite operações de escrita."); };
  function inspect(sql) {
    if (typeof sql !== "string") deny();
    const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/'(?:''|[^'])*'/g, "''").trim();
    if (/;/.test(stripped.replace(/;\s*$/, ""))) deny();
    if (/^PRAGMA\b/i.test(stripped)) {
      if (!/^PRAGMA\s+(?:table_info|index_list|index_info|foreign_key_list)\s*\(\s*["`]?\w+["`]?\s*\)\s*;?$/i.test(stripped)) deny();
    } else if (!/^(SELECT|WITH)\b/i.test(stripped) || /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|ANALYZE|PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(stripped)) deny();
  }
  return {
    prepare(sql) {
      inspect(sql);
      const wrap = (statement) => ({
        bind(...args) { return wrap(statement.bind(...args)); },
        first(...args) { return statement.first(...args); },
        all(...args) { return statement.all(...args); },
        run: deny, raw: deny,
      });
      return wrap(db.prepare(sql));
    }, batch: deny, exec: deny, dump: deny, withSession: deny,
  };
}
function normalizedSql(sql) {
  return String(sql || "").replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, "").replace(/["`\[\]]/g, "").replace(/\s+/g, "").replace(/;$/, "").toLowerCase();
}
export async function loadOperatorSchema() {
  const sources = await Promise.all(MIGRATIONS.map((name) => readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8")));
  const expectations = { migrations: [...MIGRATIONS], alterations: [], objects: [] };
  for (const source of sources) {
    const clean = source.replace(/--[^\n]*/g, " ");
    for (const match of clean.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s+([\s\S]*?);/gi)) {
      expectations.alterations.push({ table: match[1], column: match[2], definition: `${match[2]} ${match[3]}` });
    }
    for (const match of clean.matchAll(/CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)[\s\S]*?;/gi)) expectations.objects.push({ type: match[1].toLowerCase(), name: match[2], sql: match[0] });
    for (const match of clean.matchAll(/CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)[\s\S]*?\bEND\s*;/gi)) expectations.objects.push({ type: "trigger", name: match[1], sql: match[0] });
  }
  return expectations;
}

export async function verifyOperatorSchema(env, expectations) {
  const rows = (await env.DB.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger')").all()).results || [];
  const objects = new Map(rows.map((row) => [`${row.type}:${row.name}`, row]));
  const missing = [];
  for (const item of expectations.objects) {
    const actual = objects.get(`${item.type}:${item.name}`);
    if (!actual || normalizedSql(actual.sql) !== normalizedSql(item.sql)) missing.push(`${item.type}:${item.name}`);
  }
  for (const item of expectations.alterations) {
    const table = objects.get(`table:${item.table}`);
    const definition = normalizedSql(item.definition);
    const tableSql = normalizedSql(table?.sql);
    // Require column boundaries: DEFAULT 10 must not satisfy DEFAULT 1, and a
    // longer column name must not satisfy a shorter suffix. This compares only
    // the fixed expansion definitions, rather than parsing arbitrary SQL.
    const exactColumn = ["(", ","].some((before) => [",", ")"].some((after) => tableSql.includes(`${before}${definition}${after}`)));
    if (!table || !exactColumn) missing.push(`column-definition:${item.table}.${item.column}`);
  }
  // Prerequisites that remain in 0010 rather than the expansion SQL.
  const required = { organization_tickets: ["id", "organization_id", "legacy_ticket_id", "code", "created_by", "active"], ticket_events: ["id", "organization_id", "ticket_id", "event_type", "actor_user_id", "metadata", "created_at"], audit_logs: ["user_id", "action", "details", "created_at"], users: ["id", "name", "role", "active"], organizations: ["id", "name", "active"], organization_users: ["organization_id", "user_id"] };
  for (const [table, columns] of Object.entries(required)) {
    if (!objects.has(`table:${table}`)) { missing.push(`table:${table}`); continue; }
    const actual = (await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results || [];
    if (!columns.every((name) => actual.some((column) => column.name === name))) missing.push(`columns:${table}`);
  }
  const ticketIndexes = objects.has("table:organization_tickets") ? (await env.DB.prepare("PRAGMA index_list(organization_tickets)").all()).results || [] : [];
  let legacyUnique = false;
  for (const index of ticketIndexes.filter((item) => item.unique && !item.partial)) {
    if (!/^\w+$/.test(index.name)) continue;
    const columns = (await env.DB.prepare(`PRAGMA index_info(${index.name})`).all()).results || [];
    if (columns.map((column) => column.name).join(",") === "organization_id,legacy_ticket_id") legacyUnique = true;
  }
  if (!legacyUnique) missing.push("unique:organization_tickets.organization_id,legacy_ticket_id");
  let ledger = [];
  if (objects.has("table:d1_migrations")) {
    const columns = (await env.DB.prepare("PRAGMA table_info(d1_migrations)").all()).results || [];
    if (columns.some((column) => column.name === "name")) {
      ledger = (await env.DB.prepare(`SELECT name${columns.some((column) => column.name === "applied_at") ? ",applied_at" : ""} FROM d1_migrations WHERE name IN (?, ?)`)
        .bind(...expectations.migrations).all()).results || [];
    }
  }
  const missingLedger = expectations.migrations.filter((name) => !ledger.some((row) => row.name === name));
  const source = objects.get("table:tickets");
  const sourceColumns = source ? (await env.DB.prepare("PRAGMA table_info(tickets)").all()).results || [] : [];
  const sourceCompatible = !source || ["id", "organization_id"].every((name) => sourceColumns.some((column) => column.name === name));
  return { valid: missing.length === 0 && missingLedger.length === 0 && sourceCompatible, missingSchema: missing, missingLedger,
    ledger: ledger.map((row) => ({ name: row.name, appliedAt: row.applied_at || null })), source: { exists: Boolean(source), compatible: sourceCompatible } };
}
function safeInspection(row) {
  return { organizationId: row.organizationId, sourceExists: row.sourceExists,
    sourceCount: row.sourceCount, canonicalCount: row.canonicalCount, pendingCount: row.pendingCount,
    excludedSourceCount: row.excludedSourceCount, canonicalTotal: row.canonicalTotal,
    marker: row.marker ? { status: row.marker.status, schemaVersion: row.marker.schema_version, sourceCount: row.marker.source_count,
      canonicalCount: row.marker.canonical_count, pendingCount: row.marker.pending_count, skippedCount: row.marker.skipped_count,
      lastLegacyId: row.marker.last_legacy_id, completedAt: row.marker.completed_at, updatedAt: row.marker.updated_at, runId: row.marker.last_run_id } : null };
}
export function isReconciledInventory(row) {
  const marker = row?.marker;
  return row?.pendingCount === 0 && marker?.status === "ready" && marker.schemaVersion === 1 &&
    marker.pendingCount === 0 && marker.skippedCount === 0 && Boolean(marker.completedAt) &&
    marker.sourceCount === row.sourceCount && marker.canonicalCount === row.canonicalCount;
}
function safePage(page) {
  return { ...safeInspection(page), runId: page.runId, migrated: page.migrated, duplicates: page.duplicates,
    skipped: page.skipped, scanned: page.scanned ?? null, lastLegacyId: page.lastLegacyId, complete: page.complete === true,
    ...(typeof page.writesPerformed === "boolean" ? { writesPerformed: page.writesPerformed } : {}),
    ...(typeof page.outcomeUnknown === "boolean" ? { outcomeUnknown: page.outcomeUnknown } : {}) };
}
function safeError(error) {
  const emptyErrors = {
    TICKET_BACKFILL_EMPTY_SOURCE_REQUIRED: "A organização possui fonte legada elegível. reconcile-empty não pode importar ou ignorar esses chamados.",
    TICKET_BACKFILL_EMPTY_SOURCE_CHANGED: "A fonte mudou durante a reconciliação. Mantenha as flags desligadas e repita o inventário.",
    TICKET_BACKFILL_EMPTY_RESULT_UNCONFIRMED: "O resultado da escrita do marcador não foi confirmado. Repita o inventário antes de qualquer nova operação.",
    TICKET_BACKFILL_OPERATOR_FORBIDDEN: "A reconciliação exige um operador super admin ativo.",
    TICKET_BACKFILL_ORGANIZATION_INACTIVE: "A reconciliação exige uma organização ativa.",
  };
  if (Object.hasOwn(emptyErrors, error?.code)) return { code: error.code, message: emptyErrors[error.code] };
  return error?.operatorSafe ? { code: error.code, message: error.message }
    : { code: "OPERATOR_REMOTE_OPERATION_FAILED", message: "A operação remota falhou. Revise os contadores e as pendências antes de repetir; detalhes internos não são incluídos no relatório." };
}
export function initialOperatorReport(options, identity = null, runId = randomUUID(), timestamp = new Date()) {
  return { reportVersion: 1, runId, generatedAt: timestamp.toISOString(), mode: options.mode,
    database: { requestedName: options.databaseName, requestedId: options.databaseId, verified: Boolean(identity && identity.name === options.databaseName && identity.id === options.databaseId), name: identity?.name || null, id: identity?.id || null },
    organizationId: options.organizationId, operatorUserId: options.operatorUserId, fallbackUserId: options.fallbackUserId,
    attestations: options.mode !== "inventory" ? { writersPaused: options.writersPaused, verifiedAutomatically: false } : null,
    releaseAuthorized: false, complete: false, ok: false, pages: [], organizations: [] };
}
export async function runOperator(env, options, { identity, expectations, runId = randomUUID(), timestamp = new Date(), backup = null, onProgress = async () => {}, signal = null } = {}) {
  const report = initialOperatorReport(options, identity, runId, timestamp);
  const readonly = { ...env, DB: readOnlyD1(env.DB) };
  let writeStarted = false;
  try {
    validateOperatorOptions(options, timestamp);
    if (signal?.aborted) throw operatorError("OPERATOR_INTERRUPTED", "Operação interrompida entre páginas; revise os efeitos duráveis.");
    if (!identity || identity.id !== options.databaseId || identity.name !== options.databaseName) throw operatorError("OPERATOR_IDENTITY_MISMATCH", "A identidade retornada pelo D1 não corresponde ao nome e UUID solicitados.");
    report.preflight = await verifyOperatorSchema(readonly, expectations || await loadOperatorSchema());
    if (!report.preflight.valid) throw operatorError("OPERATOR_PREFLIGHT_FAILED", "Schema, ledger ou contrato da fonte incompatível. Não houve aplicação; revise o relatório.");
    const organizations = (await readonly.DB.prepare(options.organizationId
      ? "SELECT id,name,active FROM organizations WHERE id = ?" : "SELECT id,name,active FROM organizations WHERE active = 1 ORDER BY id")
      .bind(...(options.organizationId ? [options.organizationId] : [])).all()).results || [];
    if (options.organizationId && organizations.length !== 1) throw operatorError("OPERATOR_ORGANIZATION_NOT_FOUND", "A organização explícita não foi encontrada.");
    for (const organization of organizations) report.organizations.push({ id: organization.id, name: organization.name, active: organization.active,
      ...safeInspection(await inspectTicketLegacyBackfill(readonly, organization.id)) });
    if (options.mode === "inventory") {
      report.operatorCandidates = (await readonly.DB.prepare("SELECT id,name FROM users WHERE role = 'super_admin' AND active = 1 ORDER BY id").all()).results || [];
      if (options.organizationId) report.fallbackCandidates = (await readonly.DB.prepare(`SELECT u.id,u.name FROM users u INNER JOIN organization_users ou ON ou.user_id = u.id
        WHERE ou.organization_id = ? AND u.active = 1 ORDER BY u.id`).bind(options.organizationId).all()).results || [];
      report.allOrganizationsReady = report.organizations.every(isReconciledInventory);
      report.pendingOrganizationIds = report.organizations.filter((row) => !isReconciledInventory(row)).map((row) => row.organizationId);
      report.completionMeaning = "inventory_completed_only_not_release_authorization";
      report.releaseAuthorized = false;
      report.ok = true; report.complete = true; report.writesPerformed = false;
      return { report, exitCode: 0 };
    }
    if (organizations[0]?.active !== 1) throw operatorError("OPERATOR_ORGANIZATION_INACTIVE", "A aplicação exige uma organização ativa.");
    const operator = await readonly.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'super_admin' AND active = 1").bind(options.operatorUserId).first();
    if (!operator) throw operatorError("OPERATOR_ACTOR_INVALID", "O operador deve ser um super admin ativo.");
    if (options.mode === "reconcile-empty") {
      if (!backup || !/^[a-zA-Z0-9._:-]{10,200}$/.test(backup.bookmark || "") || !Number.isFinite(Date.parse(backup.capturedAt))) throw operatorError("OPERATOR_BACKUP_REQUIRED", "A captura automática do bookmark atual é obrigatória antes de reconciliar.");
      report.backup = { bookmark: backup.bookmark, capturedAt: backup.capturedAt, source: "wrangler_d1_time_travel_info" };
      await onProgress(report);
      if (signal?.aborted) throw operatorError("OPERATOR_INTERRUPTED", "Operação interrompida antes da reconciliação.");
      writeStarted = true;
      const result = await reconcileEmptyTicketLegacyBackfill(env, { organizationId: options.organizationId, operatorUserId: options.operatorUserId, runId });
      report.pages.push(safePage(result));
      report.migrated = 0; report.writesPerformed = result.writesPerformed;
      report.reconciledReplay = result.reconciledReplay === true;
      await onProgress(report);
      report.final = safeInspection(await inspectTicketLegacyBackfill(readonly, options.organizationId));
      report.complete = result.complete === true && report.final.sourceCount === 0 && isReconciledInventory(report.final);
      if (!report.complete) throw operatorError("OPERATOR_EMPTY_RECONCILIATION_STALE", "A inspeção final não confirmou fonte vazia e marcador coerente. Repita o inventário antes de continuar.");
      report.ok = true;
      report.nextAction = "Reconciliar as demais organizações e revisar os gates; este operador não habilita flags.";
      return { report, exitCode: 0 };
    }
    const fallback = await readonly.DB.prepare(`SELECT u.id FROM users u INNER JOIN organization_users ou ON ou.user_id = u.id
      WHERE u.id = ? AND u.active = 1 AND ou.organization_id = ?`).bind(options.fallbackUserId, options.organizationId).first();
    if (!fallback) throw operatorError("OPERATOR_FALLBACK_INVALID", "O autor substituto deve ser um usuário ativo e membro da organização.");
    if (!backup || !/^[a-zA-Z0-9._:-]{10,200}$/.test(backup.bookmark || "") || !Number.isFinite(Date.parse(backup.capturedAt))) throw operatorError("OPERATOR_BACKUP_REQUIRED", "A captura automática do bookmark atual é obrigatória antes de aplicar.");
    report.backup = { bookmark: backup.bookmark, capturedAt: backup.capturedAt, source: "wrangler_d1_time_travel_info" };
    const before = report.organizations[0];
    if (isReconciledInventory(before)) {
      report.ok = true; report.complete = true; report.migrated = 0; report.writesPerformed = false; report.reconciledReplay = true;
      return { report, exitCode: 0 };
    }
    let afterLegacyId = 0;
    await onProgress(report);
    for (let index = 0; index < options.maxPages; index += 1) {
      if (signal?.aborted) throw operatorError("OPERATOR_INTERRUPTED", "Operação interrompida entre páginas; revise os efeitos duráveis.");
      writeStarted = true;
      const page = await runTicketLegacyBackfillPage(env, { organizationId: options.organizationId, operatorUserId: options.operatorUserId,
        fallbackUserId: options.fallbackUserId, pageSize: options.pageSize, afterLegacyId, runId });
      report.pages.push(safePage(page));
      await onProgress(report);
      afterLegacyId = page.lastLegacyId;
      if (page.complete || page.scanned === 0) break;
    }
    const last = report.pages.at(-1);
    report.migrated = report.pages.reduce((sum, page) => sum + page.migrated, 0);
    report.writesPerformed = true;
    report.final = safeInspection(await inspectTicketLegacyBackfill(readonly, options.organizationId));
    report.complete = last?.complete === true && isReconciledInventory(report.final);
    report.ok = report.complete;
    report.nextAction = report.complete ? "Revisar o relatório e os gates; este operador não habilita flags." : "Há trabalho pendente. Manter escritores suspensos, revisar o relatório e repetir a operação limitada.";
    return { report, exitCode: report.complete ? 0 : 2 };
  } catch (error) {
    if (error.backfillReport) report.pages.push(safePage(error.backfillReport));
    report.migrated = report.pages.reduce((sum, page) => sum + Number(page.migrated || 0), 0);
    report.migratedCountMeaning = "confirmed_minimum_on_failure";
    report.commitOutcomeUnknown = typeof error.backfillReport?.outcomeUnknown === "boolean" ? error.backfillReport.outcomeUnknown
      : options.mode === "reconcile-empty" && report.pages.length > 0 ? false : !error.operatorSafe && writeStarted;
    report.requiresReconciliation = options.mode !== "inventory";
    report.error = safeError(error); report.ok = false; report.complete = false;
    report.durableEffects = error.backfillReport ? "partial_reported" : report.pages.length ? "earlier_pages_committed" : writeStarted ? "unknown_if_remote_failure" : "none";
    if (options.mode === "reconcile-empty") {
      report.writesPerformed = error.backfillReport?.writesPerformed ?? report.writesPerformed ?? false;
      report.durableEffects = report.commitOutcomeUnknown ? "unknown_if_remote_failure" : report.writesPerformed ? "reconciliation_marker_written" : "none";
    }
    report.nextAction = "Não habilitar flags. Revisar os contadores duráveis; repetir é seguro por identidade legada após corrigir a causa.";
    return { report, exitCode: 1 };
  }
}
