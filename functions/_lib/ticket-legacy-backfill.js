import { normalizeLegacyTicketRow } from "./ticket-center.js";
import { getDb, getTableColumns, tableExists } from "./organizations.js";

const MAX_PAGE_SIZE = 100;

function backfillError(message, code = "TICKET_BACKFILL_INVALID", status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function positiveId(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw backfillError(`${label} deve ser um inteiro positivo.`);
  }
  return parsed;
}

async function sourceContract(env) {
  if (!(await tableExists(env, "tickets"))) return { exists: false, activeSql: "" };
  const columns = await getTableColumns(env, "tickets");
  if (!columns.has("id") || !columns.has("organization_id")) {
    throw backfillError("Tabela legada sem id/organization_id; reconciliação bloqueada.", "TICKET_BACKFILL_SOURCE_INCOMPATIBLE", 503);
  }
  return {
    exists: true,
    activeSql: columns.has("active") ? "AND (legacy.active = 1 OR legacy.active IS NULL)" : "",
  };
}

function countQuery(source) {
  if (!source.exists) {
    return `SELECT 0 AS source_count, 0 AS canonical_count, 0 AS pending_count,
      0 AS excluded_source_count,
      (SELECT COUNT(*) FROM organization_tickets WHERE organization_id = ?1) AS canonical_total`;
  }
  return `WITH eligible AS (
    SELECT legacy.id FROM tickets legacy WHERE legacy.organization_id = ?1 ${source.activeSql}
  ), counts AS (
    SELECT COUNT(*) AS source_count,
      COALESCE(SUM(CASE WHEN EXISTS (
        SELECT 1 FROM organization_tickets canonical
        WHERE canonical.organization_id = ?1 AND canonical.legacy_ticket_id = eligible.id
      ) THEN 1 ELSE 0 END), 0) AS canonical_count FROM eligible
  ) SELECT source_count, canonical_count, source_count - canonical_count AS pending_count,
    (SELECT COUNT(*) FROM tickets WHERE organization_id = ?1) - source_count AS excluded_source_count,
    (SELECT COUNT(*) FROM organization_tickets WHERE organization_id = ?1) AS canonical_total FROM counts`;
}

function publicCounts(row) {
  return {
    sourceCount: Number(row.source_count), canonicalCount: Number(row.canonical_count),
    pendingCount: Number(row.pending_count), excludedSourceCount: Number(row.excluded_source_count),
    canonicalTotal: Number(row.canonical_total),
  };
}

/** Read-only inventory. CanonicalCount counts eligible legacy identities, not all tickets. */
export async function inspectTicketLegacyBackfill(env, organizationId) {
  const orgId = positiveId(organizationId, "organizationId");
  const source = await sourceContract(env);
  const row = await getDb(env).prepare(countQuery(source)).bind(orgId).first();
  const marker = await tableExists(env, "ticket_command_backfills")
    ? await getDb(env).prepare("SELECT * FROM ticket_command_backfills WHERE organization_id = ?").bind(orgId).first()
    : null;
  return { organizationId: orgId, sourceExists: source.exists, ...publicCounts(row), marker };
}

async function assertBackfillSchema(env) {
  const tables = {
    organization_tickets: ["legacy_ticket_id", "demand_nature", "triage_source", "version", "current_cycle_number"],
    ticket_events: ["command_id", "entity_version"],
    ticket_commands: ["id", "organization_id", "actor_user_id", "operation", "request_hash", "result_json", "response_status"],
    ticket_command_outbox: ["command_id", "organization_id", "ticket_id", "event_id", "event_type", "payload"],
    ticket_command_backfills: ["schema_version", "status", "pending_count", "skipped_count", "last_run_id"],
    audit_logs: ["user_id", "action", "details", "created_at"],
  };
  for (const [table, names] of Object.entries(tables)) {
    if (!(await tableExists(env, table))) {
      throw backfillError(`Schema de backfill incompleto: ${table}.`, "TICKET_BACKFILL_SCHEMA_OUTDATED", 503);
    }
    const columns = await getTableColumns(env, table);
    if (names.some((name) => !columns.has(name))) {
      throw backfillError(`Schema de backfill incompleto: ${table}.`, "TICKET_BACKFILL_SCHEMA_OUTDATED", 503);
    }
  }
}

function timestampIsKnown(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(new Date(value).getTime());
}

function provenance(row, ticket) {
  const rawCreator = Number(row.created_by) > 0 ? Number(row.created_by) : Number(row.user_id) || null;
  const rawAssignee = Number(row.assigned_to) || null;
  return {
    sourceTable: "tickets", sourceId: ticket.legacyId,
    originalCreatorId: rawCreator, creatorSubstituted: rawCreator !== ticket.createdBy,
    canonicalCreatorId: ticket.createdBy,
    originalAssignedToId: rawAssignee, assignmentDiscarded: Boolean(rawAssignee && !ticket.assignedTo),
    createdAtInferred: !timestampIsKnown(row.created_at),
    updatedAtInferred: !timestampIsKnown(row.updated_at || row.created_at),
    legacyStatus: String(row.status ?? "").slice(0, 160), canonicalStatus: ticket.status,
    legacyCategory: String(row.category ?? "").slice(0, 160), canonicalCategory: ticket.category,
    historicalCyclesKnown: false, firstResponseKnown: false,
  };
}

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The marker's counts and ready decision are evaluated together in the database.
// A new source row racing after this statement is caught by the read-only cutover guard.
async function writeMarker(env, source, { organizationId, runId, lastLegacyId, failed = false, running = false, skippedCount = 0 }) {
  const now = new Date().toISOString();
  await getDb(env).prepare(`WITH counts AS (${countQuery(source)})
    INSERT INTO ticket_command_backfills (
      organization_id, status, schema_version, source_count, canonical_count, pending_count,
      skipped_count, last_legacy_id, completed_at, updated_at, last_run_id
    ) SELECT ?1, CASE WHEN ?2 = 1 THEN 'failed' WHEN ?3 = 1 THEN 'running'
      WHEN pending_count = 0 AND ?4 = 0 THEN 'ready' ELSE 'pending' END,
      1, source_count, canonical_count, pending_count, ?4, ?5,
      CASE WHEN ?2 = 0 AND ?3 = 0 AND pending_count = 0 AND ?4 = 0 THEN ?6 ELSE NULL END,
      ?6, ?7 FROM counts WHERE 1
    ON CONFLICT(organization_id) DO UPDATE SET status=excluded.status,
      schema_version=excluded.schema_version, source_count=excluded.source_count,
      canonical_count=excluded.canonical_count, pending_count=excluded.pending_count,
      skipped_count=excluded.skipped_count, last_legacy_id=excluded.last_legacy_id,
      completed_at=excluded.completed_at, updated_at=excluded.updated_at, last_run_id=excluded.last_run_id`)
    .bind(organizationId, Number(failed), Number(running), skippedCount, lastLegacyId, now, runId).run();
}

async function importTicket(env, ticket, row, { operatorUserId, runId }) {
  const db = getDb(env);
  const commandId = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata = { ...provenance(row, ticket), runId, importedAt: now, operatorUserId };
  const metadataJson = JSON.stringify(metadata);
  const requestHash = await digest({ ticket, sourceId: ticket.legacyId });
  const imported = `SELECT id FROM organization_tickets WHERE organization_id = ? AND legacy_ticket_id = ?`;
  const results = await db.batch([
    db.prepare(`INSERT INTO organization_tickets (
      organization_id, legacy_ticket_id, code, subject, description, status, priority, category,
      assigned_to, due_at, closed_at, created_by, active, created_at, updated_at,
      demand_nature, triage_source, version, current_cycle_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, 'legacy', 1, 0)
    ON CONFLICT(organization_id, legacy_ticket_id) DO NOTHING`)
      .bind(ticket.organizationId, ticket.legacyId, ticket.code, ticket.subject, ticket.description,
        ticket.status, ticket.priority, ticket.category, ticket.assignedTo, ticket.dueAt,
        ticket.closedAt, ticket.createdBy, ticket.createdAt, ticket.updatedAt),
    db.prepare(`INSERT INTO ticket_commands (
      id, organization_id, actor_user_id, operation, request_hash, result_json, response_status, created_at
    ) SELECT ?, ?, ?, 'legacy.import', ?, json_object('ticketId', (${imported}), 'legacyId', ?), 201, ?
      WHERE changes() = 1`)
      .bind(commandId, ticket.organizationId, operatorUserId, requestHash, ticket.organizationId, ticket.legacyId, ticket.legacyId, now),
    db.prepare(`INSERT INTO ticket_events (
      organization_id, ticket_id, event_type, actor_user_id, metadata, created_at, command_id, entity_version
    ) SELECT ?, (${imported}), 'ticket.legacy.imported', ?, ?, ?, ?, 1
      WHERE EXISTS (SELECT 1 FROM ticket_commands WHERE id = ?)`)
      .bind(ticket.organizationId, ticket.organizationId, ticket.legacyId, operatorUserId, metadataJson, now, commandId, commandId),
    db.prepare(`INSERT INTO audit_logs (user_id, action, details, created_at)
      SELECT ?, 'ticket.legacy.imported', json_object('organizationId', ?, 'resourceType', 'ticket',
        'resourceId', (${imported}), 'commandId', ?, 'result', 'success', 'metadata', json(?)), ?
      WHERE EXISTS (SELECT 1 FROM ticket_commands WHERE id = ?)`)
      .bind(operatorUserId, ticket.organizationId, ticket.organizationId, ticket.legacyId, commandId, metadataJson, now, commandId),
    db.prepare(`INSERT INTO ticket_command_outbox (
      id, command_id, organization_id, ticket_id, event_id, event_type, payload, status, created_at
    ) SELECT ?, ?, organization_id, ticket_id, id, event_type, metadata, 'pending', ?
      FROM ticket_events WHERE command_id = ? AND event_type = 'ticket.legacy.imported'`)
      .bind(crypto.randomUUID(), commandId, now, commandId),
  ]);
  return Number(results[0]?.meta?.changes || 0);
}

/** Explicit operator job. One page, no remote execution and no implicit migration. */
export async function runTicketLegacyBackfillPage(env, options) {
  const organizationId = positiveId(options?.organizationId, "organizationId");
  const operatorUserId = positiveId(options?.operatorUserId, "operatorUserId");
  const fallbackUserId = positiveId(options?.fallbackUserId ?? operatorUserId, "fallbackUserId");
  const pageSize = Number(options?.pageSize ?? 50);
  const afterLegacyId = Number(options?.afterLegacyId ?? 0);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE ||
      !Number.isSafeInteger(afterLegacyId) || afterLegacyId < 0) {
    throw backfillError("pageSize deve estar entre 1 e 100; afterLegacyId deve ser um inteiro não negativo.");
  }
  const runId = String(options?.runId || crypto.randomUUID());
  if (runId.length > 100) throw backfillError("runId excede 100 caracteres.");
  const source = await sourceContract(env);
  await assertBackfillSchema(env);
  const db = getDb(env);
  const users = await db.prepare("SELECT id FROM users WHERE id IN (?, ?)").bind(operatorUserId, fallbackUserId).all();
  const validUserIds = new Set((users.results || []).map((row) => String(row.id)));
  if (!validUserIds.has(String(operatorUserId)) || !validUserIds.has(String(fallbackUserId))) {
    throw backfillError("Operador e autor substituto precisam existir em users.");
  }
  const organization = await db.prepare("SELECT id FROM organizations WHERE id = ?").bind(organizationId).first();
  if (!organization) throw backfillError("Organização não encontrada.");
  let lastLegacyId = afterLegacyId;
  let migrated = 0;
  let duplicates = 0;
  const markerOptions = () => ({ organizationId, runId, lastLegacyId });
  await writeMarker(env, source, { ...markerOptions(), running: true });
  try {
    const rows = source.exists ? (await db.prepare(`SELECT legacy.* FROM tickets legacy
      WHERE legacy.organization_id = ? AND legacy.id > ? ${source.activeSql}
      AND NOT EXISTS (SELECT 1 FROM organization_tickets canonical
        WHERE canonical.organization_id = ? AND canonical.legacy_ticket_id = legacy.id)
      ORDER BY legacy.id ASC LIMIT ?`).bind(organizationId, afterLegacyId, organizationId, pageSize).all()).results || [] : [];
    // Bound user lookups to this page; importing a page must not load every user.
    const candidateIds = [...new Set(rows.flatMap((row) => [row.created_by, row.user_id, row.assigned_to])
      .map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
    for (let start = 0; start < candidateIds.length; start += 80) {
      const chunk = candidateIds.slice(start, start + 80);
      const result = await db.prepare(`SELECT id FROM users WHERE id IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all();
      for (const user of result.results || []) validUserIds.add(String(user.id));
    }
    for (const row of rows) {
      const ticket = normalizeLegacyTicketRow(row, { organizationId, fallbackUserId, validUserIds });
      if (!ticket || !Number.isSafeInteger(ticket.legacyId)) {
        throw backfillError(`Chamado legado inválido: ${String(row.id).slice(0, 100)}.`, "TICKET_BACKFILL_INVALID_ROW");
      }
      const changes = await importTicket(env, ticket, row, { operatorUserId, runId });
      migrated += changes;
      duplicates += changes === 0 ? 1 : 0;
      lastLegacyId = ticket.legacyId;
    }
    await writeMarker(env, source, markerOptions());
    const report = await inspectTicketLegacyBackfill(env, organizationId);
    return { ...report, runId, migrated, duplicates, skipped: 0, scanned: rows.length, lastLegacyId,
      complete: report.marker?.status === "ready" && report.pendingCount === 0 };
  } catch (error) {
    // Earlier row transactions remain durable. Replay selects only still-pending identities.
    try {
      await writeMarker(env, source, { ...markerOptions(), failed: true, skippedCount: 1 });
      error.backfillReport = { ...(await inspectTicketLegacyBackfill(env, organizationId)), runId, migrated, duplicates, skipped: 1, lastLegacyId, complete: false };
    } catch (reportError) {
      error.backfillReportError = reportError.message;
    }
    throw error;
  }
}

function emptyMarkerIsReady(report) {
  const marker = report?.marker;
  return report?.sourceCount === 0 && report.canonicalCount === 0 && report.pendingCount === 0 &&
    marker?.status === "ready" && marker.schema_version === 1 && marker.source_count === 0 &&
    marker.canonical_count === 0 && marker.pending_count === 0 && marker.skipped_count === 0 &&
    Boolean(String(marker.completed_at || "").trim());
}

async function assertEmptyReconciliationActors(db, organizationId, operatorUserId) {
  const operator = await db.prepare("SELECT id FROM users WHERE id = ? AND active = 1 AND role = 'super_admin'").bind(operatorUserId).first();
  if (!operator) throw backfillError("O operador deve ser um super admin ativo.", "TICKET_BACKFILL_OPERATOR_FORBIDDEN", 403);
  const organization = await db.prepare("SELECT id FROM organizations WHERE id = ? AND active = 1").bind(organizationId).first();
  if (!organization) throw backfillError("A reconciliação exige uma organização ativa.", "TICKET_BACKFILL_ORGANIZATION_INACTIVE", 409);
}

/**
 * Reconcile only an empty eligible legacy source. No fallback author, import,
 * event, command or cycle is fabricated. One conditional marker statement
 * rechecks the source and operational actors at the instant of its write.
 */
export async function reconcileEmptyTicketLegacyBackfill(env, options) {
  let organizationId = null;
  let runId = null;
  let inspection = null;
  let source = null;
  let writeAttempted = false;
  let writeConfirmed = false;
  let writesPerformed = false;
  let outcomeUnknown = false;
  const report = () => ({
    organizationId, sourceExists: null, sourceCount: null, canonicalCount: null,
    pendingCount: null, excludedSourceCount: null, canonicalTotal: null, marker: null,
    ...inspection, runId, migrated: 0, scanned: 0, duplicates: 0, skipped: 0,
    complete: false, writesPerformed, writeAttempted, outcomeUnknown,
    reconciledReplay: false,
  });
  try {
    organizationId = positiveId(options?.organizationId, "organizationId");
    const operatorUserId = positiveId(options?.operatorUserId, "operatorUserId");
    const suppliedRunId = String(options?.runId || crypto.randomUUID());
    if (suppliedRunId.length > 100 || !suppliedRunId.trim()) throw backfillError("runId deve conter entre 1 e 100 caracteres.");
    runId = suppliedRunId;
    source = await sourceContract(env);
    await assertBackfillSchema(env);
    const db = getDb(env);
    await assertEmptyReconciliationActors(db, organizationId, operatorUserId);
    inspection = await inspectTicketLegacyBackfill(env, organizationId);
    if (inspection.sourceExists !== source.exists) throw backfillError("A estrutura da fonte mudou durante a conferência. Refaça o inventário.", "TICKET_BACKFILL_EMPTY_SOURCE_CHANGED", 409);
    // A fully imported nonempty source is still outside this operation's scope.
    if (inspection.sourceCount !== 0) throw backfillError("A reconciliação sem importação exige zero chamados legados elegíveis.", "TICKET_BACKFILL_EMPTY_SOURCE_REQUIRED", 409);
    const timestamp = new Date().toISOString();
    const statement = db.prepare(`WITH empty_counts AS (${countQuery(source)})
      INSERT INTO ticket_command_backfills (
        organization_id,status,schema_version,source_count,canonical_count,pending_count,
        skipped_count,last_legacy_id,completed_at,updated_at,last_run_id
      ) SELECT ?1,'ready',1,0,0,0,0,NULL,?2,?2,?3 FROM empty_counts
      WHERE source_count = 0
        ${source.exists ? "" : "AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tickets')"}
        AND EXISTS (SELECT 1 FROM organizations WHERE id = ?1 AND active = 1)
        AND EXISTS (SELECT 1 FROM users WHERE id = ?4 AND active = 1 AND role = 'super_admin')
      ON CONFLICT(organization_id) DO UPDATE SET status=excluded.status,
        schema_version=excluded.schema_version,source_count=0,canonical_count=0,pending_count=0,
        skipped_count=0,last_legacy_id=NULL,completed_at=excluded.completed_at,
        updated_at=excluded.updated_at,last_run_id=excluded.last_run_id
      WHERE NOT (
        ticket_command_backfills.status = 'ready' AND ticket_command_backfills.schema_version = 1
        AND ticket_command_backfills.source_count = 0 AND ticket_command_backfills.canonical_count = 0
        AND ticket_command_backfills.pending_count = 0 AND ticket_command_backfills.skipped_count = 0
        AND ticket_command_backfills.completed_at IS NOT NULL
        AND length(trim(ticket_command_backfills.completed_at)) > 0
      )`).bind(organizationId, timestamp, runId, operatorUserId);
    writeAttempted = true;
    const result = await statement.run();
    if (result?.success === false || ![0, 1].includes(result?.meta?.changes)) {
      throw backfillError("Não foi possível confirmar o resultado da reconciliação. Refaça o inventário.", "TICKET_BACKFILL_EMPTY_RESULT_UNCONFIRMED", 503);
    }
    writeConfirmed = true;
    writesPerformed = result.meta.changes === 1;
    // Re-read the source contract too: an absent table may have appeared, or an
    // eligible row may have arrived after the atomic marker decision.
    inspection = await inspectTicketLegacyBackfill(env, organizationId);
    await assertEmptyReconciliationActors(db, organizationId, operatorUserId);
    if (inspection.sourceExists !== source.exists || inspection.sourceCount !== 0) {
      throw backfillError("A fonte legada mudou durante a reconciliação. O marcador não libera o cutover; refaça o inventário.", "TICKET_BACKFILL_EMPTY_SOURCE_CHANGED", 409);
    }
    if (!emptyMarkerIsReady(inspection)) throw backfillError("O marcador não foi reconciliado. Refaça o inventário antes de continuar.", "TICKET_BACKFILL_EMPTY_SOURCE_CHANGED", 409);
    return { ...report(), complete: true, reconciledReplay: !writesPerformed };
  } catch (error) {
    outcomeUnknown = writeAttempted && !writeConfirmed;
    if (organizationId !== null && source !== null) {
      try { inspection = await inspectTicketLegacyBackfill(env, organizationId); }
      catch { error.backfillReportError = "TICKET_BACKFILL_EMPTY_INSPECTION_UNAVAILABLE"; }
    }
    error.backfillReport = report();
    throw error;
  }
}
