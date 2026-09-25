import { getDb, getTableColumns, tableExists } from "./organizations.js";
import {
  assertTicketTriageWriteReady, isTicketTriageEnabled, normalizeTicketTriage,
  hasTicketTriagePayload, TICKET_TRIAGE_COLUMNS,
} from "./ticket-triage.js";
import { getTicketOrThrow, validateTicketCreatePayload, validateTicketPatchPayload } from "./ticket-center.js";

export const TICKET_COMMAND_TRANSITIONS = Object.freeze({
  new: ["open", "closed"], open: ["in_progress", "closed"],
  in_progress: ["open", "in_review", "closed"], in_review: ["in_progress", "closed"], closed: [],
});
export const TICKET_CLOSURE_OUTCOMES = Object.freeze([
  "resolved", "answered", "fulfilled", "rejected", "duplicate", "withdrawn", "no_action",
]);
const COMMAND_COLUMNS = ["version", "last_command_id", "current_cycle_number", "current_cycle_json", "active_wait_json", "closure_json", "next_action", "tombstoned_at"];
const COMMAND_TABLE_COLUMNS = {
  ticket_commands: ["id", "organization_id", "actor_user_id", "operation", "idempotency_key", "request_hash", "result_json", "response_status", "created_at"],
  ticket_cycles: ["organization_id", "ticket_id", "cycle_number", "origin", "opened_at", "opened_by", "closed_at", "closure_json"],
  ticket_wait_intervals: ["id", "organization_id", "ticket_id", "cycle_number", "reason", "responsible_id", "started_at", "ended_at", "expected_at", "next_action", "end_reason", "ended_by"],
  ticket_command_backfills: ["organization_id", "status", "schema_version", "source_count", "canonical_count", "pending_count", "skipped_count", "last_legacy_id", "completed_at", "updated_at", "last_run_id"],
  ticket_command_outbox: ["id", "command_id", "organization_id", "ticket_id", "event_id", "event_type", "payload", "status", "created_at"],
  audit_logs: ["user_id", "project_id", "action", "details", "created_at"],
};
const REQUIRED_TRIGGERS = ["ticket_core_version_legacy_update", "ticket_version_monotonic", "ticket_lifecycle_requires_command", "ticket_events_no_update", "ticket_events_no_delete", "ticket_event_correction_scope", "ticket_audit_no_update", "ticket_audit_no_delete"];
const REQUIRED_INDEXES = ["idx_ticket_id_org", "idx_ticket_events_command", "idx_ticket_wait_open", "idx_ticket_command_outbox_pending"];
const STATE_FIELDS = Object.freeze({
  id: "id", organizationId: "organization_id", code: "code", subject: "subject", description: "description",
  status: "status", priority: "priority", category: "category", assignedToId: "assigned_to",
  dueAt: "due_at", closedAt: "closed_at", createdById: "created_by", createdAt: "created_at", updatedAt: "updated_at",
  demandNature: "demand_nature", expectedResult: "expected_result", context: "context", impact: "impact", urgency: "urgency",
  priorityReason: "priority_reason", triageFormVersion: "triage_form_version", triageSource: "triage_source",
  triagedAt: "triaged_at", triagedBy: "triaged_by", version: "version", nextAction: "next_action", active: "active", tombstonedAt: "tombstoned_at",
});
const JSON_STATE_FIELDS = { triageAnswers: "triage_answers", cycle: "current_cycle_json", wait: "active_wait_json", closure: "closure_json" };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
function commandError(message, status = 400, code = "TICKET_COMMAND_INVALID") {
  return Object.assign(new Error(message), { status, code, publicMessage: message });
}
function string(value, name, { required = false, max = 2000 } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw commandError(`Preencha ${name}${required ? " (obrigatório)" : ""} com até ${max} caracteres.`);
  }
  return value.trim();
}
function object(value) {
  if (!record(value)) throw commandError("O comando deve ser um objeto.");
  return value;
}
function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
async function hash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function isTicketCommandsEnabled(env) {
  return String(env?.MAONO_TICKET_COMMANDS_ENABLED || "").trim().toLowerCase() === "true";
}

export async function getTicketCommandCapability(env, organizationId) {
  if (!isTicketCommandsEnabled(env) || !isTicketTriageEnabled(env)) return false;
  try {
    const columns = await getTableColumns(env, "organization_tickets");
    if (![...TICKET_TRIAGE_COLUMNS, ...COMMAND_COLUMNS].every((column) => columns.has(column))) return false;
    const eventColumns = await getTableColumns(env, "ticket_events");
    if (!["command_id", "entity_version", "corrects_event_id"].every((column) => eventColumns.has(column))) return false;
    for (const [table, expected] of Object.entries(COMMAND_TABLE_COLUMNS)) {
      if (!(await tableExists(env, table))) return false;
      const actual = await getTableColumns(env, table);
      if (!expected.every((column) => actual.has(column))) return false;
    }
    const schemaObjects = await getDb(env).prepare("SELECT type, name FROM sqlite_master WHERE type IN ('trigger','index')").all();
    const present = new Set((schemaObjects?.results || []).map((row) => `${row.type}:${row.name}`));
    if (!REQUIRED_TRIGGERS.every((name) => present.has(`trigger:${name}`)) ||
        !REQUIRED_INDEXES.every((name) => present.has(`index:${name}`))) return false;
    const marker = await getDb(env).prepare(`SELECT * FROM ticket_command_backfills
      WHERE organization_id = ? AND status = 'ready' AND schema_version = 1
        AND pending_count = 0 AND skipped_count = 0 AND completed_at IS NOT NULL`).bind(organizationId).first();
    if (!marker) return false;
    if (await tableExists(env, "tickets")) {
      const legacy = await getTableColumns(env, "tickets");
      if (!legacy.has("id") || !legacy.has("organization_id")) return false;
      const pending = await getDb(env).prepare(`SELECT 1 AS pending FROM tickets legacy
        WHERE legacy.organization_id = ? ${legacy.has("active") ? "AND (legacy.active = 1 OR legacy.active IS NULL)" : ""}
        AND NOT EXISTS (SELECT 1 FROM organization_tickets t WHERE t.organization_id = ? AND t.legacy_ticket_id = legacy.id)
        LIMIT 1`).bind(organizationId, organizationId).first();
      if (pending) return false;
    }
    return true;
  } catch (error) {
    if (error?.code === "TABLE_NOT_FOUND") return false;
    throw error;
  }
}
export async function assertTicketCommandReady(env, organizationId) {
  if (!isTicketCommandsEnabled(env)) throw commandError("Este fluxo de atendimento ainda não está habilitado. Recarregue a Central.", 503, "TICKET_COMMANDS_DISABLED");
  if (!(await getTicketCommandCapability(env, organizationId))) {
    throw commandError("O fluxo de atendimento está temporariamente indisponível. Contate a equipe responsável.", 503, "TICKET_COMMANDS_NOT_READY");
  }
}
export function canonicalTicketState(row) {
  const state = Object.fromEntries(Object.entries(STATE_FIELDS).map(([key, column]) => [key, row[column] ?? null]));
  for (const [key, column] of Object.entries(JSON_STATE_FIELDS)) state[key] = parseJson(row[column], key === "triageAnswers" ? {} : null);
  state.needsTriage = !row.demand_nature || row.triage_source !== "human";
  return state;
}
export async function ticketStateEtag(row) {
  return `"ticket-state-${await hash(canonicalTicketState(row))}"`;
}
async function stateEtag(state) { return `"ticket-state-${await hash(state)}"`; }
export async function readTicketCommandState(env, organizationId, ticketId) {
  await assertTicketCommandReady(env, organizationId);
  const row = await getTicketOrThrow(env, organizationId, ticketId);
  return { state: canonicalTicketState(row), etag: await ticketStateEtag(row) };
}
export async function ticketLifecycleProjection(row) {
  return {
    version: Number(row.version), etag: await ticketStateEtag(row),
    cycle: parseJson(row.current_cycle_json), nextAction: row.next_action || "",
    wait: parseJson(row.active_wait_json), closure: parseJson(row.closure_json),
  };
}
async function pendingChange(env, organizationId, ticketId) {
  if (!(await tableExists(env, "project_change_requests"))) return false;
  const found = await getDb(env).prepare(`SELECT 1 AS pending FROM project_change_requests
    WHERE organization_id = ? AND ticket_id = ?
      AND status NOT IN ('applied','rejected','superseded') LIMIT 1`).bind(organizationId, ticketId).first();
  return Boolean(found);
}
export async function readTicketLifecycleDetails(env, organizationId, ticketId) {
  if (!(await getTicketCommandCapability(env, organizationId))) return { lifecycleEnabled: false };
  await getTicketOrThrow(env, organizationId, ticketId);
  const rows = await getDb(env).prepare(`SELECT cycle_number, origin, opened_at, closed_at, closure_json
    FROM ticket_cycles WHERE organization_id = ? AND ticket_id = ? ORDER BY cycle_number DESC`).bind(organizationId, ticketId).all();
  return {
    lifecycleEnabled: true,
    hasPendingChange: await pendingChange(env, organizationId, ticketId),
    closureHistory: (rows?.results || []).filter((row) => row.closure_json).map((row) => ({
      cycleNumber: row.cycle_number, origin: row.origin, openedAt: row.opened_at,
      ...parseJson(row.closure_json, {}),
    })),
  };
}
async function requireIfMatch(request, row) {
  const expected = request?.headers?.get("If-Match");
  if (!expected) throw commandError("Recarregue o chamado antes de salvar: falta a versão esperada.", 428, "TICKET_IF_MATCH_REQUIRED");
  if (expected.trim() !== await ticketStateEtag(row)) {
    throw commandError("Este chamado mudou. Recarregue e compare suas alterações antes de salvar.", 412, "TICKET_VERSION_CONFLICT");
  }
}
async function assignee(env, organizationId, id, required = false) {
  if (id == null && !required) return null;
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw commandError("Escolha uma pessoa responsável válida.", 400, "INVALID_ASSIGNEE");
  const row = await getDb(env).prepare(`SELECT u.id FROM users u INNER JOIN organization_users ou ON ou.user_id = u.id
    WHERE ou.organization_id = ? AND u.id = ? AND u.active = 1 LIMIT 1`).bind(organizationId, Number(id)).first();
  if (!row) throw commandError("A pessoa responsável não pertence à organização.", 400, "ASSIGNEE_NOT_IN_ORGANIZATION");
  return Number(id);
}
function stateSql(alias = "t") {
  const pairs = Object.entries(STATE_FIELDS).map(([key, column]) => `'${key}', ${alias}.${column}`);
  for (const [key, column] of Object.entries(JSON_STATE_FIELDS)) pairs.push(`'${key}', json(${alias}.${column})`);
  pairs.push(`'needsTriage', json(CASE WHEN ${alias}.demand_nature IS NULL OR ${alias}.triage_source <> 'human' THEN 'true' ELSE 'false' END)`);
  return `json_object(${pairs.join(", ")})`;
}
function resultSql(alias = "t") {
  return `json_object('state', ${stateSql(alias)}, 'display', json_object(
    'attachmentsCount', (SELECT COUNT(*) FROM ticket_attachments a WHERE a.organization_id = ${alias}.organization_id AND a.ticket_id = ${alias}.id AND a.status = 'ACTIVE' AND a.deleted_at IS NULL),
    'creatorName', (SELECT name FROM users WHERE id = ${alias}.created_by),
    'creatorEmail', (SELECT email FROM users WHERE id = ${alias}.created_by),
    'assigneeName', (SELECT name FROM users WHERE id = ${alias}.assigned_to),
    'assigneeEmail', (SELECT email FROM users WHERE id = ${alias}.assigned_to)))`;
}
async function commandResult(command, replayed = false) {
  const result = parseJson(command.result_json);
  if (!result?.state) throw commandError("Não foi possível confirmar o resultado persistido.", 503, "TICKET_COMMAND_RESULT_UNAVAILABLE");
  const { state, display = {} } = result;
  const etag = await stateEtag(state);
  const ticket = {
    ...state, etag,
    createdBy: state.createdById == null ? null : { id: state.createdById, name: display.creatorName || null, email: display.creatorEmail || null },
    assignedTo: state.assignedToId == null ? null : { id: state.assignedToId, name: display.assigneeName || null, email: display.assigneeEmail || null },
    attachmentsCount: Number(display.attachmentsCount || 0),
  };
  return { ticket, state, etag, replayed, status: Number(command.response_status) };
}
async function loadCommand(env, id) { return getDb(env).prepare("SELECT * FROM ticket_commands WHERE id = ?").bind(id).first(); }
function sideEffects(db, { commandId, organizationId, ticketId, userId, operation, metadata, timestamp, correctsEventId = null }) {
  const where = "t.organization_id = ? AND t.id = ? AND t.last_command_id = ?";
  const scope = [organizationId, ticketId, commandId];
  return [
    db.prepare(`INSERT INTO ticket_events
      (organization_id,ticket_id,event_type,actor_user_id,metadata,created_at,command_id,entity_version,corrects_event_id)
      SELECT t.organization_id,t.id,?,?,?, ?,?,t.version,? FROM organization_tickets t WHERE ${where}`)
      .bind(operation, userId, JSON.stringify(metadata), timestamp, commandId, correctsEventId, ...scope),
    db.prepare(`INSERT INTO audit_logs(user_id,project_id,action,details,created_at)
      SELECT ?,NULL,?,json_object('organizationId',t.organization_id,'resourceType','ticket','resourceId',t.id,'commandId',?,'result','success'),?
      FROM organization_tickets t WHERE ${where}`).bind(userId, operation, commandId, timestamp, ...scope),
    db.prepare(`INSERT INTO ticket_command_outbox(id,command_id,organization_id,ticket_id,event_id,event_type,payload,status,created_at)
      SELECT ?,?,t.organization_id,t.id,e.id,e.event_type,json_object('eventId',e.id,'ticketId',t.id,'version',t.version),'pending',?
      FROM organization_tickets t JOIN ticket_events e ON e.command_id = ? AND e.ticket_id = t.id
      WHERE ${where}`).bind(uuid(), commandId, timestamp, commandId, ...scope),
  ];
}
function lifecycleForMutation(current, operation, timestamp, userId) {
  if (operation === "ticket.reopened") {
    const cycle = { number: Number(current.current_cycle_number || 0) + 1, origin: "reopened", openedAt: timestamp, openedBy: userId };
    return { cycle, isNew: true };
  }
  const existing = parseJson(current.current_cycle_json);
  if (existing) return { cycle: existing, isNew: false };
  if (current.status === "closed") return { cycle: null, isNew: false };
  return { cycle: { number: Math.max(1, Number(current.current_cycle_number || 0) + 1), origin: "observed_baseline", openedAt: timestamp, openedBy: userId }, isNew: true };
}
async function mutate(env, organizationId, ticketId, user, payload, request, build) {
  await assertTicketCommandReady(env, organizationId);
  object(payload);
  const current = await getTicketOrThrow(env, organizationId, ticketId);
  await requireIfMatch(request, current);
  const timestamp = now();
  const commandId = uuid();
  const change = await build(current, timestamp, commandId);
  const operation = change.operation;
  const lifecycle = lifecycleForMutation(current, operation, timestamp, user.id);
  const updates = { ...change.updates, updated_at: timestamp, version: Number(current.version) + 1, last_command_id: commandId };
  if (lifecycle.isNew) {
    updates.current_cycle_number = lifecycle.cycle.number;
    updates.current_cycle_json = JSON.stringify(lifecycle.cycle);
  }
  if (change.waitStart) {
    change.waitStart.cycleNumber = lifecycle.cycle?.number;
    updates.active_wait_json = JSON.stringify(change.waitStart);
  }
  const after = { ...current, ...updates };
  const db = getDb(env);
  const entries = Object.entries(updates);
  const statements = [db.prepare(`UPDATE organization_tickets SET ${entries.map(([column]) => `${column} = ?`).join(", ")}
    WHERE organization_id = ? AND id = ? AND active = 1 AND version = ?
    ${change.guardPendingChange ? "AND NOT EXISTS(SELECT 1 FROM project_change_requests cr WHERE cr.organization_id = organization_tickets.organization_id AND cr.ticket_id = organization_tickets.id AND cr.status NOT IN ('applied','rejected','superseded'))" : ""}`)
    .bind(...entries.map(([, value]) => value), organizationId, ticketId, current.version)];
  const scope = [organizationId, ticketId, commandId];
  const where = "t.organization_id = ? AND t.id = ? AND t.last_command_id = ?";
  if (lifecycle.isNew) {
    statements.push(db.prepare(`INSERT INTO ticket_cycles(organization_id,ticket_id,cycle_number,origin,opened_at,opened_by)
      SELECT t.organization_id,t.id,?,?,?,? FROM organization_tickets t WHERE ${where}`)
      .bind(lifecycle.cycle.number, lifecycle.cycle.origin, timestamp, user.id, ...scope));
  }
  if (change.close) {
    statements.push(db.prepare(`UPDATE ticket_cycles SET closed_at = ?, closure_json = ?
      WHERE ticket_id = ? AND organization_id = ? AND cycle_number = ?
        AND EXISTS(SELECT 1 FROM organization_tickets t WHERE ${where})`)
      .bind(timestamp, updates.closure_json, ticketId, organizationId, lifecycle.cycle?.number || 0, ...scope));
  }
  if (change.waitStart) {
    const wait = change.waitStart;
    statements.push(db.prepare(`INSERT INTO ticket_wait_intervals(id,organization_id,ticket_id,cycle_number,reason,responsible_id,started_at,expected_at,next_action)
      SELECT ?,t.organization_id,t.id,?,?,?,?,?,? FROM organization_tickets t WHERE ${where}`)
      .bind(wait.id, lifecycle.cycle.number, wait.reason, wait.responsibleId, timestamp, wait.expectedAt, wait.nextAction, ...scope));
  }
  if (change.waitEnd || change.close) {
    statements.push(db.prepare(`UPDATE ticket_wait_intervals SET ended_at = ?, end_reason = ?, ended_by = ?
      WHERE ticket_id = ? AND organization_id = ? AND ended_at IS NULL
        AND EXISTS(SELECT 1 FROM organization_tickets t WHERE ${where})`)
      .bind(timestamp, change.close ? "Atendimento concluído" : change.waitEnd, user.id, ticketId, organizationId, ...scope));
  }
  statements.push(db.prepare(`INSERT INTO ticket_commands(id,organization_id,actor_user_id,operation,idempotency_key,request_hash,result_json,response_status,created_at)
    SELECT ?,t.organization_id,?,?,NULL,?,${resultSql()},200,? FROM organization_tickets t WHERE ${where}`)
    .bind(commandId, user.id, operation, await hash(payload), timestamp, ...scope));
  statements.push(...sideEffects(db, {
    commandId, organizationId, ticketId, userId: user.id, operation, timestamp,
    metadata: { before: canonicalTicketState(current), after: canonicalTicketState(after), ...change.metadata },
    correctsEventId: change.correctsEventId,
  }));
  await db.batch(statements);
  const persisted = await loadCommand(env, commandId);
  if (!persisted) {
    if (change.guardPendingChange) {
      const latest = await getTicketOrThrow(env, organizationId, ticketId);
      if (Number(latest.version) === Number(current.version) && await pendingChange(env, organizationId, ticketId)) {
        throw commandError("Há uma alteração relacionada pendente. Confirme que concluir o atendimento não cancela nem aprova essa alteração.", 409, "TICKET_PENDING_CHANGE_ACK_REQUIRED");
      }
    }
    throw commandError("Este chamado mudou enquanto a alteração era processada. Recarregue antes de salvar.", 412, "TICKET_VERSION_CONFLICT");
  }
  return commandResult(persisted);
}

export async function executeTicketCreate(env, organizationId, user, payload, request) {
  await assertTicketCommandReady(env, organizationId);
  object(payload);
  const key = request?.headers?.get("Idempotency-Key")?.trim();
  if (!key) throw commandError("Recarregue o formulário antes de criar o chamado.", 400, "TICKET_IDEMPOTENCY_KEY_REQUIRED");
  if (key.length > 200) throw commandError("A identificação desta tentativa é inválida.", 400, "TICKET_IDEMPOTENCY_KEY_INVALID");
  const db = getDb(env);
  const fingerprint = await hash(payload);
  const existing = () => db.prepare(`SELECT * FROM ticket_commands WHERE organization_id = ? AND actor_user_id = ? AND operation = 'ticket.created' AND idempotency_key = ?`).bind(organizationId, user.id, key).first();
  const replay = async (row) => {
    if (row.request_hash !== fingerprint) throw commandError("Esta tentativa de abertura já foi usada com outro conteúdo. Inicie uma nova abertura.", 409, "TICKET_IDEMPOTENCY_KEY_REUSED");
    return commandResult(row, true);
  };
  const prior = await existing();
  if (prior) return replay(prior);
  const triageEnabled = await assertTicketTriageWriteReady(env, payload);
  const data = validateTicketCreatePayload(payload);
  await assignee(env, organizationId, data.assignedTo);
  const timestamp = now();
  const triage = triageEnabled ? normalizeTicketTriage(payload, { creating: true, priority: data.priority, actorId: user.id, now: timestamp }) : { updates: {} };
  const recent = await db.prepare(`SELECT COUNT(*) AS total FROM organization_tickets WHERE organization_id = ? AND created_by = ? AND created_at >= ?`)
    .bind(organizationId, user.id, new Date(Date.now() - 600000).toISOString()).first();
  if (Number(recent?.total || 0) >= 10) throw commandError("Muitas solicitações em pouco tempo. Aguarde alguns minutos.", 429, "TICKET_RATE_LIMITED");
  const commandId = uuid();
  const cycle = { number: 1, origin: "created", openedAt: timestamp, openedBy: user.id };
  const values = {
    organization_id: organizationId, code: `PENDING-${commandId}`, subject: data.subject, description: data.description,
    status: "new", priority: data.priority, category: data.category, assigned_to: data.assignedTo, due_at: data.dueAt,
    created_by: user.id, active: 1, created_at: timestamp, updated_at: timestamp, ...triage.updates,
    version: 1, last_command_id: commandId, current_cycle_number: 1, current_cycle_json: JSON.stringify(cycle),
    next_action: string(payload.nextAction, "a próxima ação", { max: 1000 }),
  };
  const entries = Object.entries(values);
  const statements = [
    db.prepare(`INSERT INTO ticket_commands(id,organization_id,actor_user_id,operation,idempotency_key,request_hash,result_json,response_status,created_at)
      VALUES (?,?,?,'ticket.created',?,?,'{}',201,?)`).bind(commandId, organizationId, user.id, key, fingerprint, timestamp),
    db.prepare(`INSERT INTO organization_tickets(${entries.map(([column]) => column).join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`).bind(...entries.map(([, value]) => value)),
    // The canonical code is assigned inside the transaction. Its version bump
    // is explicit and never visible as a partial creation to another request.
    db.prepare(`UPDATE organization_tickets SET code = 'TKT-' || printf('%06d',id), version = version + 1 WHERE organization_id = ? AND last_command_id = ?`).bind(organizationId, commandId),
    db.prepare(`INSERT INTO ticket_cycles(organization_id,ticket_id,cycle_number,origin,opened_at,opened_by)
      SELECT organization_id,id,1,'created',?,? FROM organization_tickets WHERE organization_id = ? AND last_command_id = ?`).bind(timestamp, user.id, organizationId, commandId),
    db.prepare(`UPDATE ticket_commands SET result_json = (SELECT ${resultSql()} FROM organization_tickets t WHERE t.organization_id = ? AND t.last_command_id = ?) WHERE id = ?`).bind(organizationId, commandId, commandId),
    db.prepare(`INSERT INTO ticket_events(organization_id,ticket_id,event_type,actor_user_id,metadata,created_at,command_id,entity_version)
      SELECT organization_id,id,'ticket.created',?,json_object('after',${stateSql("organization_tickets")}),?,?,version
      FROM organization_tickets WHERE organization_id = ? AND last_command_id = ?`).bind(user.id, timestamp, commandId, organizationId, commandId),
    db.prepare(`INSERT INTO audit_logs(user_id,project_id,action,details,created_at)
      SELECT ?,NULL,'ticket.created',json_object('organizationId',organization_id,'resourceType','ticket','resourceId',id,'commandId',?,'result','success'),?
      FROM organization_tickets WHERE organization_id = ? AND last_command_id = ?`).bind(user.id, commandId, timestamp, organizationId, commandId),
    db.prepare(`INSERT INTO ticket_command_outbox(id,command_id,organization_id,ticket_id,event_id,event_type,payload,status,created_at)
      SELECT ?,?,t.organization_id,t.id,e.id,e.event_type,json_object('eventId',e.id,'ticketId',t.id,'version',t.version),'pending',?
      FROM organization_tickets t JOIN ticket_events e ON e.command_id = ? AND e.ticket_id = t.id
      WHERE t.organization_id = ? AND t.last_command_id = ?`).bind(uuid(), commandId, timestamp, commandId, organizationId, commandId),
  ];
  try { await db.batch(statements); }
  catch (error) {
    const winner = await existing();
    if (winner) return replay(winner);
    throw error;
  }
  return commandResult(await loadCommand(env, commandId));
}

export async function executeTicketUpdate(env, organizationId, ticketId, user, payload, request) {
  return mutate(env, organizationId, ticketId, user, payload, request, async (current, timestamp) => {
    if (own(payload, "status") && payload.status !== current.status) {
      throw commandError("Use a ação de atendimento correspondente para alterar o estado.", 409, "TICKET_TRANSITION_REQUIRED");
    }
    const triageEnabled = await assertTicketTriageWriteReady(env, payload);
    const hasBaseFields = ["subject", "description", "status", "priority", "category", "dueAt", "assignedTo"].some((key) => own(payload, key));
    const patch = (hasBaseFields || hasTicketTriagePayload(payload) || !own(payload, "nextAction"))
      ? validateTicketPatchPayload(payload, { allowTriageOnly: triageEnabled }) : {};
    if (own(patch, "assignedTo")) await assignee(env, organizationId, patch.assignedTo);
    const triage = triageEnabled ? normalizeTicketTriage(payload, {
      current, priority: patch.priority || current.priority, category: patch.category || current.category, actorId: user.id, now: timestamp,
    }) : { updates: {} };
    const updates = { ...triage.updates };
    const mapping = { subject: "subject", description: "description", priority: "priority", category: "category", assignedTo: "assigned_to", dueAt: "due_at" };
    for (const [key, column] of Object.entries(mapping)) if (own(patch, key)) updates[column] = patch[key];
    if (own(payload, "nextAction")) updates.next_action = string(payload.nextAction, "a próxima ação", { required: true, max: 1000 });
    if (!Object.keys(updates).length) throw commandError("Nenhuma alteração válida informada.", 400, "EMPTY_PATCH");
    return { operation: "ticket.updated", updates, metadata: { fields: Object.keys(updates), reason: payload.priorityReason || null } };
  });
}
export async function executeTicketTransition(env, organizationId, ticketId, user, payload, request) {
  return mutate(env, organizationId, ticketId, user, payload, request, async (current, timestamp) => {
    const status = payload.status;
    if (!TICKET_COMMAND_TRANSITIONS[current.status]?.includes(status)) throw commandError("Esta transição de atendimento não é permitida.", 409, "TICKET_TRANSITION_INVALID");
    const updates = { status };
    const metadata = {};
    if (status === "closed") {
      const input = object(payload.closure);
      if (!TICKET_CLOSURE_OUTCOMES.includes(input.outcomeCode)) throw commandError("Escolha um resultado de conclusão válido.");
      const hasPending = await pendingChange(env, organizationId, ticketId);
      if (hasPending && input.pendingChangeAcknowledged !== true) throw commandError("Há uma alteração relacionada pendente. Confirme que concluir o atendimento não cancela nem aprova essa alteração.", 409, "TICKET_PENDING_CHANGE_ACK_REQUIRED");
      const closure = {
        outcomeCode: input.outcomeCode,
        summary: string(input.summary, "o resultado", { required: true }),
        evidence: string(input.evidence, "a evidência", { required: true }),
        communication: string(input.communication, "a comunicação ao solicitante", { required: true }),
        closedAt: timestamp, closedBy: user.id,
        pendingChangeAcknowledged: input.pendingChangeAcknowledged === true,
      };
      updates.closed_at = timestamp;
      updates.closure_json = JSON.stringify(closure);
      updates.active_wait_json = null;
      updates.next_action = "";
      return { operation: "ticket.closed", updates, close: true,
        guardPendingChange: input.pendingChangeAcknowledged !== true && await tableExists(env, "project_change_requests"),
        metadata: { closure, hadPendingChange: hasPending } };
    }
    updates.next_action = string(payload.nextAction, "a próxima ação", { required: true, max: 1000 });
    await assignee(env, organizationId, current.assigned_to, true);
    if (current.status === "new" && status === "open") {
      if (isTicketTriageEnabled(env) && (!current.demand_nature || current.triage_source !== "human")) throw commandError("Classifique a demanda antes de concluir a triagem.", 409, "TICKET_TRIAGE_REQUIRED");
    }
    if (status === "in_review") metadata.evidence = string(payload.evidence, "a evidência para revisão", { required: true });
    if ((current.status === "in_progress" && status === "open") || (current.status === "in_review" && status === "in_progress")) metadata.reason = string(payload.reason, "o motivo", { required: true, max: 1000 });
    return { operation: "ticket.status.changed", updates, metadata: { from: current.status, to: status, ...metadata } };
  });
}
export async function executeTicketReopen(env, organizationId, ticketId, user, payload, request) {
  return mutate(env, organizationId, ticketId, user, payload, request, async (current) => {
    if (current.status !== "closed") throw commandError("Somente um chamado concluído pode ser reaberto.", 409, "TICKET_REOPEN_INVALID");
    const reason = string(payload.reason, "o motivo da reabertura", { required: true, max: 1000 });
    return { operation: "ticket.reopened", updates: {
      status: "open", closed_at: null, closure_json: null, active_wait_json: null,
      next_action: string(payload.nextAction, "a próxima ação", { required: true, max: 1000 }),
    }, metadata: { reason, previousClosure: parseJson(current.closure_json) } };
  });
}
export async function executeTicketWait(env, organizationId, ticketId, user, payload, request) {
  return mutate(env, organizationId, ticketId, user, payload, request, async (current, timestamp) => {
    if (current.status === "closed") throw commandError("Um chamado concluído não pode entrar em espera.", 409, "TICKET_WAIT_INVALID");
    if (payload.action === "start") {
      if (current.active_wait_json) throw commandError("Este chamado já possui uma espera ativa.", 409, "TICKET_WAIT_ACTIVE");
      const expectedAt = payload.expectedAt ? new Date(payload.expectedAt) : null;
      if (expectedAt && Number.isNaN(expectedAt.getTime())) throw commandError("A data da próxima ação é inválida.");
      const wait = {
        id: uuid(), reason: string(payload.reason, "o motivo da espera", { required: true, max: 1000 }),
        responsibleId: await assignee(env, organizationId, payload.responsibleId, true),
        startedAt: timestamp, expectedAt: expectedAt?.toISOString() || null,
        nextAction: string(payload.nextAction, "a próxima ação", { required: true, max: 1000 }),
      };
      return { operation: "ticket.wait.started", updates: { next_action: wait.nextAction }, waitStart: wait, metadata: { wait, slaPaused: false } };
    }
    if (payload.action === "end") {
      if (!current.active_wait_json) throw commandError("Não há uma espera ativa para encerrar.", 409, "TICKET_WAIT_NOT_ACTIVE");
      const reason = string(payload.reason, "o motivo da retomada", { max: 1000 }) || "Atendimento retomado";
      return { operation: "ticket.wait.ended", updates: {
        active_wait_json: null, next_action: string(payload.nextAction, "a próxima ação", { required: true, max: 1000 }),
      }, waitEnd: reason, metadata: { reason, wait: parseJson(current.active_wait_json) } };
    }
    throw commandError("Escolha iniciar ou encerrar a espera.");
  });
}
export async function executeTicketEventCorrection(env, organizationId, ticketId, user, payload, request) {
  return mutate(env, organizationId, ticketId, user, payload, request, async () => {
    const eventId = Number(payload.eventId);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) throw commandError("Referência de evento inválida.");
    const event = await getDb(env).prepare("SELECT id FROM ticket_events WHERE organization_id = ? AND ticket_id = ? AND id = ?").bind(organizationId, ticketId, eventId).first();
    if (!event) throw commandError("Evento não encontrado neste chamado.", 404, "TICKET_EVENT_NOT_FOUND");
    return { operation: "ticket.event.corrected", updates: {}, correctsEventId: eventId, metadata: {
      eventId, reason: string(payload.reason, "o motivo da correção", { required: true }),
      correction: string(payload.correction, "a correção", { required: true }),
    } };
  });
}
