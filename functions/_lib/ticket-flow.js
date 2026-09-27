import { getDb, getTableColumns, tableExists } from "./organizations.js";
const failure = (message, status, code) => Object.assign(new Error(message), { status, code, publicMessage: message });
export const isTicketFlowEnabled = (env, organizationId) => {
  const organizations = String(env?.MAONO_TICKET_FLOW_ORGANIZATION_IDS || '').split(',').map(value => value.trim());
  return String(env?.MAONO_TICKET_FLOW_ENABLED).toLowerCase() === 'true' &&
    (organizations.includes('*') || organizations.includes(String(organizationId)));
};
export async function assertTicketFlowReady(env, organizationId) {
  if (!isTicketFlowEnabled(env, organizationId)) throw failure("Gestão de fluxo indisponível.", 503, "TICKET_FLOW_DISABLED");
  if (String(env.MAONO_TICKET_COMMANDS_ENABLED).toLowerCase() !== "true" ||
      !(await getTableColumns(env, "organization_tickets")).has("queue_entered_at") ||
      !(await tableExists(env, "ticket_query_snapshots")) || !(await tableExists(env, "ticket_query_snapshot_items")) ||
      !(await tableExists(env, "ticket_queue_policies"))) {
    throw failure("Gestão de fluxo aguarda preparação do ambiente.", 503, "TICKET_FLOW_NOT_READY");
  }
  const objects = await getDb(env).prepare("SELECT name FROM sqlite_master WHERE name IN ('ticket_flow_queue_entry','ticket_flow_initial_entry','idx_ticket_flow_queue','idx_ticket_snapshot_expiry','idx_ticket_snapshot_owner')").all();
  if (objects.results.length !== 5) throw failure('Gestão de fluxo aguarda validação do schema.',503,'TICKET_FLOW_NOT_READY');
}
// Membership and ordering are fixed for 15 minutes, not ticket content/authorization.
// Re-check ACL on EVERY read. Revoked/deleted records leave ordinal holes; never fill
// those holes with new records, which would duplicate or skip later pages.
export async function ticketQuerySnapshot(env, organizationId, user, options, where, order) {
  await assertTicketFlowReady(env, organizationId);
  if (!user?.id) throw failure("Autenticação necessária.", 401, "UNAUTHENTICATED");
  const db = getDb(env);
  const { page, snapshot, limit, ...query } = options;
  const queryKey = JSON.stringify(query);
  const timestamp = new Date().toISOString();
  if (snapshot) {
    const row = await db.prepare(`SELECT * FROM ticket_query_snapshots WHERE id = ? AND organization_id = ? AND user_id = ? AND query_key = ? AND expires_at > ?`)
      .bind(snapshot, organizationId, user.id, queryKey, timestamp).first();
    if (!row) throw failure("Esta consulta expirou ou mudou. Atualize a lista para iniciar outra consulta.", 409, "TICKET_QUERY_EXPIRED");
    return row;
  }
  const active = await db.prepare('SELECT COUNT(*) AS total FROM ticket_query_snapshots WHERE organization_id = ? AND user_id = ? AND expires_at > ?').bind(organizationId,user.id,timestamp).first();
  if (Number(active?.total) >= 100) throw failure('Limite temporário de consultas atingido. Aguarde a expiração das consultas anteriores.',429,'TICKET_QUERY_RATE_LIMIT');
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM ticket_query_snapshots WHERE expires_at <= ?").bind(timestamp),
    db.prepare(`INSERT INTO ticket_query_snapshots(id,organization_id,user_id,query_key,created_at,expires_at) VALUES(?,?,?,?,?,?)`)
      .bind(id, organizationId, user.id, queryKey, timestamp, expiresAt),
    db.prepare(`INSERT INTO ticket_query_snapshot_items(snapshot_id,ordinal,ticket_id)
      SELECT ?, ROW_NUMBER() OVER(ORDER BY ${order}, t.id DESC), t.id FROM organization_tickets t WHERE ${where.sql}`)
      .bind(id, ...where.values),
  ]);
  return { id, created_at: timestamp, expires_at: expiresAt };
}
export async function readQueuePolicies(env, organizationId) {
  await assertTicketFlowReady(env, organizationId);
  const result = await getDb(env).prepare("SELECT queue,wip_limit AS wipLimit,version FROM ticket_queue_policies WHERE organization_id = ?").bind(organizationId).all();
  return ['in_progress','in_review'].map(queue => result.results.find(row => row.queue === queue) || { queue, wipLimit: null, version: 0 });
}
export async function saveQueuePolicy(env, organizationId, user, payload) {
  await assertTicketFlowReady(env, organizationId);
  const { queue, wipLimit, version } = payload || {};
  if (!['in_progress','in_review'].includes(queue) || !Number.isInteger(version) || version < 0 ||
      !(wipLimit === null || Number.isInteger(wipLimit) && wipLimit >= 1 && wipLimit <= 10000)) {
    throw failure("Informe fila, versão e limite entre 1 e 10000 (ou sem limite).", 400, "TICKET_WIP_INVALID");
  }
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (reason.length < 10 || reason.length > 1000) throw failure("Justifique a configuração com 10 a 1000 caracteres.", 400, "TICKET_WIP_REASON_REQUIRED");
  const db = getDb(env), id = crypto.randomUUID(), timestamp = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO ticket_queue_policies(organization_id,queue,wip_limit,version,updated_by,updated_at,change_id)
      SELECT ?,?,?,1,?,?,? WHERE ? = 0
      ON CONFLICT(organization_id,queue) DO NOTHING`).bind(organizationId,queue,wipLimit,user.id,timestamp,id,version),
    db.prepare(`UPDATE ticket_queue_policies SET wip_limit = ?, version = version + 1, updated_by = ?, updated_at = ?, change_id = ?
      WHERE organization_id = ? AND queue = ? AND version = ? AND ? > 0`).bind(wipLimit,user.id,timestamp,id,organizationId,queue,version,version),
    db.prepare(`INSERT INTO audit_logs(user_id,action,details,created_at) SELECT ?, 'ticket.queue_policy.updated',
      json_object('organizationId',organization_id,'queue',queue,'wipLimit',wip_limit,'version',version,'reason',?),?
      FROM ticket_queue_policies WHERE organization_id = ? AND queue = ? AND change_id = ?`).bind(user.id,reason,timestamp,organizationId,queue,id),
  ]);
  const changed = await db.prepare("SELECT change_id FROM ticket_queue_policies WHERE organization_id = ? AND queue = ?").bind(organizationId,queue).first();
  if (changed?.change_id !== id) throw failure("A configuração mudou. Atualize antes de salvar.", 412, "TICKET_WIP_VERSION_CONFLICT");
  return readQueuePolicies(env, organizationId);
}
// Applied in the SAME UPDATE as the ticket CAS; two concurrent entrants cannot
// both take the last slot. Count all tickets, never send hidden counts to clients.
export async function ticketWipGuard(env, organizationId, current, updates, payload) {
  if (!isTicketFlowEnabled(env, organizationId)) {
    if (updates.status && updates.status !== current.status && ['in_progress','in_review'].includes(updates.status) && await tableExists(env, 'ticket_queue_policies')) {
      const policy = await getDb(env).prepare('SELECT 1 FROM ticket_queue_policies WHERE organization_id = ? AND queue = ? AND wip_limit IS NOT NULL').bind(organizationId,updates.status).first();
      if (policy) throw failure('A fila tem WIP configurado e a gestão de fluxo está indisponível.',503,'TICKET_FLOW_DISABLED');
    }
    return { sql: '', values: [], metadata: {} };
  }
  await assertTicketFlowReady(env, organizationId);
  const target = updates.status;
  if (!target || target === current.status || !['in_progress','in_review'].includes(target)) return { sql: '', values: [], metadata: {} };
  const reason = payload.wipExceptionReason;
  if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 1000)) {
    throw failure("Justifique a exceção de WIP com 10 a 1000 caracteres.", 400, "TICKET_WIP_REASON_REQUIRED");
  }
  if (reason) return { sql: '', values: [], metadata: { wipException: { queue: target, reason: reason.trim() } } };
  return {
    sql: `AND NOT EXISTS(SELECT 1 FROM ticket_queue_policies p WHERE p.organization_id = ? AND p.queue = ? AND p.wip_limit IS NOT NULL
      AND (SELECT COUNT(*) FROM organization_tickets w WHERE w.organization_id = p.organization_id AND w.active = 1 AND w.status = p.queue) >= p.wip_limit)`,
    values: [organizationId, target], metadata: {},
  };
}
