import { getDb, tableExists } from "./organizations.js";

export const LIFECYCLE_TRANSITIONS = Object.freeze({
  submitted: ["under_review", "rejected", "superseded"],
  under_review: ["approved", "rejected", "conflict"],
  approved: ["applying", "conflict"],
  applying: ["applied", "conflict"],
  rejected: [], conflict: [], applied: [], superseded: [],
});
export function ticketStatusForRequest(status) {
  return ({ submitted: "new", under_review: "in_review", approved: "in_review", applying: "in_progress",
    applied: "closed", rejected: "closed", conflict: "closed", superseded: "closed" })[status] || null;
}
function lifecycleError(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status });
}
export async function isChangeRequestLifecycleSchemaReady(env) {
  if (!(await tableExists(env, "project_change_request_events"))) return false;
  const db = getDb(env);
  const columns = await db.prepare("PRAGMA table_info(project_change_requests)").all();
  const names = new Set((columns.results || []).map(column => column.name));
  if (!["lifecycle_version", "decision", "feedback", "decided_by_user_id", "decided_at",
    "transition_actor_user_id", "applied_revision"].every(name => names.has(name))) return false;
  const triggers = await db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'trg_change_request_lifecycle_guard', 'trg_change_request_lifecycle_sync',
    'trg_change_request_lifecycle_created', 'trg_ticket_change_request_status_guard')`).first();
  return Number(triggers?.count) === 4;
}
export async function ensureChangeRequestLifecycleSchema(env) {
  if (!(await isChangeRequestLifecycleSchemaReady(env))) throw lifecycleError(
    "A migration 0021_change_request_lifecycle.sql precisa ser aplicada antes de alterar o lifecycle.",
    "CHANGE_REQUEST_LIFECYCLE_SCHEMA_OUTDATED", 503,
  );
}
export function publicRequestLifecycle(row) {
  return {
    lifecycleVersion: Number(row.lifecycle_version || 0),
    decision: row.decision || null,
    feedback: row.feedback || null,
    decidedByUserId: row.decided_by_user_id ? Number(row.decided_by_user_id) : null,
    decidedAt: row.decided_at || null,
    appliedRevision: row.applied_revision == null ? null : Number(row.applied_revision),
  };
}
export async function transitionRequestLifecycle(db, row, fromStatuses, nextStatus, { actor, feedback = null, appliedRevision = null } = {}) {
  const expected = Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses];
  if (row.status === nextStatus) {
    if (nextStatus === "rejected" && row.feedback !== String(feedback || "").trim()) throw lifecycleError(
      "A rejeição já foi registrada com outro feedback.", "CHANGE_REQUEST_DECISION_CONFLICT",
    );
    return null; // Idempotent: never emits a second transition/event.
  }
  if (!expected.includes(row.status)) return null;
  if (!LIFECYCLE_TRANSITIONS[row.status]?.includes(nextStatus)) throw lifecycleError(
    "Transição de solicitação inválida.", "CHANGE_REQUEST_INVALID_TRANSITION",
  );
  const comment = feedback == null ? null : String(feedback).trim();
  if (nextStatus === "rejected" && !comment) throw lifecycleError(
    "Informe o motivo da rejeição.", "CHANGE_REQUEST_REJECTION_REASON_REQUIRED", 400,
  );
  if (comment && comment.length > 2000) throw lifecycleError(
    "O feedback deve ter no máximo 2000 caracteres.", "CHANGE_REQUEST_FEEDBACK_TOO_LONG", 400,
  );
  const decision = nextStatus === "approved" ? "approved" : nextStatus === "rejected" ? "rejected" : row.decision;
  const newDecision = decision && !row.decision;
  // One D1 statement: triggers synchronize Ticket + durable journal atomically.
  return db.prepare(`UPDATE project_change_requests SET status = ?, lifecycle_version = lifecycle_version + 1,
    decision = ?, feedback = ?, decided_by_user_id = ?, decided_at = ?, transition_actor_user_id = ?,
    applied_revision = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND project_id = ? AND organization_id = ? AND status = ? AND lifecycle_version = ? RETURNING *`)
    .bind(nextStatus, decision || null, newDecision ? comment : row.feedback || null,
      newDecision ? actor?.id ?? null : row.decided_by_user_id ?? null,
      newDecision ? new Date().toISOString() : row.decided_at || null,
      actor?.id ?? null, nextStatus === "applied" ? appliedRevision : row.applied_revision ?? null,
      row.id, row.project_id, row.organization_id, row.status, row.lifecycle_version).first();
}
export async function getCanonicalTicketRequest(env, organizationId, ticketId) {
  if (!(await tableExists(env, "project_change_requests"))) return null;
  return getDb(env).prepare("SELECT * FROM project_change_requests WHERE organization_id = ? AND ticket_id = ? LIMIT 1")
    .bind(organizationId, ticketId).first();
}
