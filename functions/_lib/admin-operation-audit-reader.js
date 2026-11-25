import { requireOperationAuditReady, safeAuditChanges } from './operation-audit.js';

export const AUDIT_RESULTS = new Set(['requested', 'authorized', 'denied', 'running', 'succeeded', 'failed', 'blocked', 'partial', 'unknown', 'noop', 'legacy_unproven']);
const PAGE_SIZE = 25;
const HISTORY_SIZE = 100;
const ACTIONS = new Map([
  ['organization.create', 'Criar organização'], ['organization.created', 'Criar organização'],
  ['organization.update', 'Alterar organização'], ['organization.updated', 'Alterar organização'],
  ['organization.legacy_updated', 'Alterar organização'], ['organization.policy_updated', 'Alterar plano ou responsável'],
  ['organization.configured', 'Configurar organização'], ['organization.pause', 'Pausar organização'],
  ['organization.paused', 'Pausar organização'], ['organization.resume', 'Reativar organização'],
  ['organization.resumed', 'Reativar organização'], ['organization.review', 'Analisar solicitação'],
  ['organization.request_approved', 'Aprovar solicitação'], ['organization.request_rejected', 'Recusar solicitação'],
  ['organization.permanent_delete', 'Excluir organização'], ['organization.reconcile', 'Consultar resultado'],
  ['organization.deletion_requested', 'Solicitar exclusão'], ['organization.storage_recovery', 'Verificar armazenamento'],
  ['organization.storage_disable', 'Desativar armazenamento'], ['organization.storage_observed', 'Observar armazenamento'],
  ['ticket.created', 'Criar chamado'], ['ticket.attachment.added', 'Adicionar anexo'],
  ['project.change_request.submitted', 'Enviar proposta'], ['project.lifecycle.draft_created', 'Criar rascunho de projeto'],
  ['project.lifecycle.reconcile', 'Consultar projeto'], ['permission.grant', 'Conceder permissão'],
  ['permission.revoke', 'Revogar permissão'], ['permission.native.deny', 'Bloquear permissão'],
  ['permission.native.restore', 'Restaurar permissão'],
]);
const SUMMARIES = {
  requested: 'Solicitação registrada; execução ainda não confirmada.', authorized: 'Permissão autorizada; execução ainda não confirmada.',
  denied: 'A permissão para esta ação foi negada.', running: 'Execução iniciada; consulte o estado atual antes de repetir.',
  succeeded: 'Conclusão confirmada nesta etapa.', failed: 'Esta tentativa falhou.', blocked: 'A ação encontrou um impedimento.',
  partial: 'Parte da operação foi confirmada; há etapas pendentes.', unknown: 'Resultado ainda não confirmado. Consulte antes de repetir.',
  noop: 'Verificação concluída sem nova alteração.', legacy_unproven: 'Resultado não comprovado no registro legado.',
};
const clean = (value, max = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null;
const positiveId = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
function json(value) {
  if (typeof value !== 'string' || value.length > 65536) return {};
  try { return object(JSON.parse(value)); } catch { return {}; }
}
export function auditTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/.test(value)) return null;
  const date = new Date(value.replace(' ', 'T').replace(/Z?$/, 'Z'));
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.replace(' ', 'T').slice(0, 19) ? date.toISOString() : null;
}
function route(value) {
  return typeof value === 'string' && /^\/(?:admin|projects|projetos)(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(value) ? value.slice(0, 200) : null;
}
function origin(value) {
  return typeof value === 'string' && /^(?:api:(?:GET|POST|PUT|PATCH|DELETE):\/api\/[A-Za-z0-9_\/-]+|d1:[a-z_]+|(?:worker|system|domain):[a-zA-Z0-9_-]+)$/.test(value) ? value.slice(0, 300) : null;
}
function category(action) {
  if (action.startsWith('organization.')) return 'organization';
  if (action.startsWith('permission.')) return 'access';
  if (action.startsWith('project.')) return 'project';
  if (action.startsWith('ticket.')) return 'ticket';
  if (action.startsWith('document.')) return 'document';
  return 'other';
}
export function publicAuditEntry(row) {
  const legacy = row.row_source === 'legacy';
  const details = legacy ? json(row.details) : {};
  const action = ACTIONS.has(row.action) ? row.action : 'other';
  const authorization = legacy && details.auditVersion === 2 && details.phase === 'authorization' && ['authorized', 'denied'].includes(details.result);
  const result = legacy ? (authorization ? details.result : 'legacy_unproven') : row.outcome === 'no_change' ? 'noop' : AUDIT_RESULTS.has(row.outcome) ? row.outcome : 'unknown';
  const actorId = positiveId(legacy ? row.user_id : row.actor_id);
  const orgId = positiveId(legacy ? details.organizationId : row.organization_id);
  const resourceType = legacy ? details.resourceType : row.resource_type;
  const resourceId = legacy ? details.resourceId : row.resource_id;
  return {
    id: `${legacy ? 'legacy' : 'frame'}:${row.id}`, createdAt: auditTime(legacy ? row.created_at : row.occurred_at),
    actor: { id: actorId, name: legacy ? null : clean(row.actor_name), kind: actorId !== null ? 'user' : ['worker', 'system'].includes(row.executor_kind) ? 'system' : 'unrecorded' },
    organization: orgId !== null || (!legacy && row.organization_name) ? { id: orgId, name: legacy ? null : clean(row.organization_name), slug: legacy ? null : clean(row.organization_slug, 200) } : null,
    route: legacy ? null : route(row.ui_route), origin: legacy ? null : origin(row.technical_origin),
    category: category(action), action,
    resource: { type: ['organization', 'project', 'document', 'ticket', 'user', 'platform'].includes(resourceType) ? resourceType : 'other',
      id: typeof resourceId === 'number' && positiveId(resourceId) ? String(resourceId) : typeof resourceId === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(resourceId) ? resourceId : null,
      label: legacy ? null : clean(row.resource_label) },
    result, summary: SUMMARIES[result], legacy,
  };
}

function invalidQuery() { throw Object.assign(new Error('Consulta de auditoria inválida.'), { status: 400, code: 'VALIDATION_ERROR' }); }
export function auditEventId(value) {
  const match = /^(frame|legacy):([1-9]\d*)$/.exec(value || '');
  if (!match || !Number.isSafeInteger(Number(match[2]))) invalidQuery();
  return { source: match[1], id: Number(match[2]) };
}
function filterFingerprint(query) { return JSON.stringify([query.from, query.to, query.result, query.organizationId]); }
function cursor(value, query) {
  try {
    if (typeof value !== 'string' || value.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value)) invalidQuery();
    const parsed = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    if (!Array.isArray(parsed) || parsed.length !== 5 || parsed[0] !== 1 || typeof parsed[1] !== 'string' || (parsed[1] !== '' && auditTime(parsed[1]) !== parsed[1]) || !['frame', 'legacy'].includes(parsed[2]) || !positiveId(parsed[3]) || parsed[4] !== filterFingerprint(query)) invalidQuery();
    return { time: parsed[1], source: parsed[2], id: parsed[3] };
  } catch { invalidQuery(); }
}
function encodeCursor(row, query) {
  return btoa(JSON.stringify([1, row.sort_time, row.row_source, row.id, filterFingerprint(query)])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function operationAuditQuery(url) {
  const params = new URL(url).searchParams;
  const allowed = new Set(['before', 'from', 'to', 'result', 'organizationId']);
  if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)) invalidQuery();
  const query = { from: params.get('from'), to: params.get('to'), result: params.get('result'), organizationId: null, before: null };
  for (const key of ['from', 'to']) if (query[key] !== null && (auditTime(query[key]) !== query[key])) invalidQuery();
  if (query.from !== null && query.to !== null && query.from >= query.to) invalidQuery();
  if (query.result !== null && !AUDIT_RESULTS.has(query.result)) invalidQuery();
  if (params.has('organizationId')) {
    const id = params.get('organizationId');
    if (!/^[1-9]\d*$/.test(id || '') || !Number.isSafeInteger(Number(id))) invalidQuery();
    query.organizationId = Number(id);
  }
  if (params.has('before')) query.before = cursor(params.get('before'), query);
  return query;
}

const LEGACY_ORG = "CASE WHEN json_valid(details) THEN CASE WHEN json_type(details,'$.organizationId')='integer' THEN json_extract(details,'$.organizationId') END END";
const LEGACY_RESULT = "CASE WHEN json_valid(details) THEN CASE WHEN json_extract(details,'$.auditVersion')=2 AND json_extract(details,'$.phase')='authorization' AND json_extract(details,'$.result') IN ('authorized','denied') THEN json_extract(details,'$.result') ELSE 'legacy_unproven' END ELSE 'legacy_unproven' END";
function queryPart(query, source) {
  const clauses = [], args = [];
  const time = `COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',${source === 'frame' ? 'occurred_at' : 'created_at'}),'')`;
  for (const [field, operator] of [['from', '>='], ['to', '<']]) if (query[field] !== null) { clauses.push(`${time} ${operator} ?`); args.push(query[field]); }
  if (query.organizationId !== null) { clauses.push(`${source === 'frame' ? 'organization_id' : LEGACY_ORG} = ?`); args.push(query.organizationId); }
  if (query.result !== null) {
    clauses.push(`${source === 'frame' ? "CASE WHEN outcome='no_change' THEN 'noop' ELSE outcome END" : LEGACY_RESULT} = ?`); args.push(query.result);
  }
  if (query.before !== null) {
    clauses.push(`(${time} < ? OR (${time} = ? AND ('${source}' < ? OR ('${source}' = ? AND id < ?))))`);
    args.push(query.before.time, query.before.time, query.before.source, query.before.source, query.before.id);
  }
  return { sql: `SELECT id, '${source}' AS row_source, ${time} AS sort_time FROM ${source === 'frame' ? 'audit_operation_frames' : 'audit_logs'}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`, args };
}
async function rows(db, sql, args = []) {
  const data = await db.prepare(sql).bind(...args).all();
  if (!Array.isArray(data?.results)) throw new Error('AUDIT_UNAVAILABLE');
  return data.results;
}
export async function readOperationAuditPage(env, query) {
  await requireOperationAuditReady(env);
  const frames = queryPart(query, 'frame'), legacy = queryPart(query, 'legacy');
  const keys = await rows(env.DB, `SELECT * FROM (${frames.sql} UNION ALL ${legacy.sql}) ORDER BY sort_time DESC, row_source DESC, id DESC LIMIT ${PAGE_SIZE + 1}`, [...frames.args, ...legacy.args]);
  if (keys.length > PAGE_SIZE + 1 || keys.some(key => !positiveId(key.id) || !['frame', 'legacy'].includes(key.row_source))) throw new Error('AUDIT_UNAVAILABLE');
  const visible = keys.slice(0, PAGE_SIZE);
  const grouped = await Promise.all(['frame', 'legacy'].map(async source => {
    const ids = visible.filter(row => row.row_source === source).map(row => row.id);
    return ids.length ? rows(env.DB, `SELECT *, '${source}' AS row_source FROM ${source === 'frame' ? 'audit_operation_frames' : 'audit_logs'} WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : [];
  }));
  const records = new Map(grouped.flat().map(row => [`${row.row_source}:${row.id}`, row]));
  const entries = visible.map(key => {
    const row = records.get(`${key.row_source}:${key.id}`);
    // A concurrent deleted legacy row is an unavailable page, not invented history.
    if (!row) throw new Error('AUDIT_UNAVAILABLE');
    return publicAuditEntry(row);
  });
  return { entries, nextBefore: keys.length > PAGE_SIZE ? encodeCursor(visible.at(-1), query) : null, capabilities: { operations: true } };
}

export async function readOperationAuditRecord(env, eventId) {
  const { source, id } = auditEventId(eventId);
  const row = await env.DB.prepare(`SELECT *, '${source}' AS row_source FROM ${source === 'frame' ? 'audit_operation_frames' : 'audit_logs'} WHERE id=?`).bind(id).first();
  if (!row) throw Object.assign(new Error('Registro não encontrado.'), { status: 404, code: 'AUDIT_EVENT_NOT_FOUND' });
  return row;
}
export function auditOrganizationSearch(url) {
  const params = new URL(url).searchParams;
  if ([...params.keys()].some(key => key !== 'search') || params.getAll('search').length > 1) invalidQuery();
  const search = params.get('search') || '';
  if (search.length > 120 || /[\u0000-\u001f\u007f]/.test(search)) invalidQuery();
  return search.trim();
}
export async function readAuditOrganizations(env, search) {
  await requireOperationAuditReady(env);
  const number = /^[1-9]\d*$/.test(search) && Number.isSafeInteger(Number(search)) ? Number(search) : null;
  const like = `%${search.replace(/[\\%_]/g, value => `\\${value}`)}%`;
  const result = await rows(env.DB, `WITH candidates AS (
    SELECT organization_id AS id, MAX(id) AS recent FROM audit_operation_frames
    WHERE organization_id > 0 AND (?='' OR organization_id=? OR organization_name LIKE ? ESCAPE '\\' OR organization_slug LIKE ? ESCAPE '\\') GROUP BY organization_id
    UNION ALL
    SELECT ${LEGACY_ORG} AS id, 0 AS recent FROM audit_logs
    WHERE ${LEGACY_ORG} > 0 AND (?='' OR ${LEGACY_ORG}=?) GROUP BY ${LEGACY_ORG}
  ), identities AS (SELECT id, MAX(recent) AS recent FROM candidates GROUP BY id)
  SELECT identities.id,
    (SELECT organization_name FROM audit_operation_frames WHERE organization_id=identities.id AND organization_name IS NOT NULL ORDER BY id DESC LIMIT 1) AS name,
    (SELECT organization_slug FROM audit_operation_frames WHERE organization_id=identities.id AND organization_slug IS NOT NULL ORDER BY id DESC LIMIT 1) AS slug
  FROM identities ORDER BY recent DESC,id DESC LIMIT 26`, [search, number, like, like, search, number]);
  return { organizations: result.slice(0, 25).map(row => ({ id: positiveId(row.id), name: clean(row.name), slug: clean(row.slug, 200) })), hasMore: result.length > 25, capabilities: { operations: true } };
}
const FIELD_LABELS = { name: 'Nome', description: 'Descrição', active: 'Ativa', plan: 'Plano', projectLimit: 'Limite de projetos', ownerId: 'Responsável principal', storageStatus: 'Armazenamento', decision: 'Decisão' };
function changes(row) {
  if (row.row_source === 'legacy') return [];
  const before = safeAuditChanges(row.before_json) || {}, after = safeAuditChanges(row.after_json) || {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => before[key] !== after[key]).map(key => ({ field: FIELD_LABELS[key], before: before[key] ?? null, after: after[key] ?? null }));
}
function actor(id, name, executor = null) {
  return { id: positiveId(id), name: clean(name), kind: positiveId(id) ? 'user' : ['worker', 'system'].includes(executor) ? 'system' : 'unrecorded' };
}
function history(rows) {
  const attempts = new Map();
  for (const row of rows.slice().reverse()) {
    if (!row.attempt_id || row.event_type === 'recovery_requested') continue;
    let attempt = attempts.get(row.attempt_id);
    if (!attempt) {
      attempt = { id: clean(row.attempt_id, 100), parentId: clean(row.parent_attempt_id, 100), itemIndex: Number.isSafeInteger(row.item_index) ? row.item_index : null,
        originalActor: actor(row.original_actor_id, row.original_actor_name), requestedBy: actor(row.actor_id, row.actor_name),
        executor: ['worker', 'system', 'user'].includes(row.executor_kind) ? row.executor_kind : 'unrecorded',
        startedAt: null, endedAt: null, result: 'unknown', stages: [] };
      attempts.set(row.attempt_id, attempt);
    }
    const entry = publicAuditEntry({ ...row, row_source: 'frame' });
    if (row.event_type === 'attempt_started') attempt.startedAt = entry.createdAt;
    if (['attempt_finished', 'completed', 'attempt_completed', 'interrupted'].includes(row.event_type)) attempt.endedAt = entry.createdAt;
    attempt.result = entry.result;
    attempt.stages.push({ id: entry.id, createdAt: entry.createdAt, result: entry.result, summary: entry.summary });
  }
  return [...attempts.values()].reverse();
}
export function auditHistoryCursor(url) {
  const params = new URL(url).searchParams;
  if ([...params.keys()].some(key => key !== 'historyBefore') || params.getAll('historyBefore').length > 1) invalidQuery();
  if (!params.has('historyBefore')) return null;
  const value = params.get('historyBefore');
  if (!/^[1-9]\d*$/.test(value || '') || !Number.isSafeInteger(Number(value))) invalidQuery();
  return Number(value);
}
export async function readOperationAuditDetail(env, eventId, actorUser, recoveryActions, before = null) {
  await requireOperationAuditReady(env);
  const row = await readOperationAuditRecord(env, eventId);
  const legacy = row.row_source === 'legacy';
  const related = !legacy && row.operation_id ? await rows(env.DB,
    `SELECT * FROM audit_operation_frames WHERE operation_id=?${before === null ? '' : ' AND id < ?'} ORDER BY id DESC LIMIT ${HISTORY_SIZE + 1}`,
    before === null ? [row.operation_id] : [row.operation_id, before]) : [];
  const visible = related.slice(0, HISTORY_SIZE);
  return {
    entry: publicAuditEntry(row), changes: changes(row), attempts: history(visible),
    nextHistoryBefore: related.length > HISTORY_SIZE ? visible.at(-1).id : null,
    technical: { operationId: legacy ? null : clean(row.operation_id, 80), source: legacy ? 'audit_logs' : clean(row.source, 80),
      eventId: String(row.id), code: !legacy && /^[A-Z][A-Z0-9_]{0,100}$/.test(row.code || '') ? row.code : null,
      originalActor: legacy ? actor(null, null) : actor(row.original_actor_id, row.original_actor_name),
      requestedBy: actor(legacy ? row.user_id : row.actor_id, legacy ? null : row.actor_name),
      executor: legacy ? 'unrecorded' : ['worker', 'system', 'user'].includes(row.executor_kind) ? row.executor_kind : 'unrecorded',
      version: !legacy && Number.isSafeInteger(row.version) ? row.version : null,
    },
    actions: legacy || !recoveryActions ? [] : await recoveryActions(env, actorUser, row), capabilities: { operations: true },
  };
}
