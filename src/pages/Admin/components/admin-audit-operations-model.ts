export const auditResultLabels = {
  requested: 'Solicitação registrada', authorized: 'Autorização concedida', denied: 'Acesso negado',
  running: 'Em andamento', succeeded: 'Concluído', failed: 'Falhou', blocked: 'Impedido',
  partial: 'Parcial', unknown: 'Resultado a confirmar', noop: 'Sem alteração',
  legacy_unproven: 'Resultado não comprovado no registro legado',
} as const;
export type AuditResult = keyof typeof auditResultLabels;
export const auditCategoryLabels = {
  organization: 'Organizações', access: 'Usuários e Permissões', project: 'Projetos e Mapas',
  document: 'Arquivos e Documentos', ticket: 'Chamados', administration: 'Sistema', other: 'Não registrada',
} as const;
export type AuditCategory = keyof typeof auditCategoryLabels;
const actionLabels: Record<string, string> = {
  create: 'Criar organização', change: 'Salvar alterações', pause: 'Pausar organização', resume: 'Reativar organização',
  delete: 'Excluir organização', review: 'Revisar solicitação',
  'organization.create': 'Criar organização', 'organization.created': 'Organização criada',
  'organization.change': 'Salvar alterações', 'organization.updated': 'Organização atualizada',
  'organization.update': 'Alterar organização', 'organization.legacy_updated': 'Alterar organização',
  'organization.policy_updated': 'Alterar plano ou responsável', 'organization.configured': 'Configurar organização',
  'organization.review': 'Analisar solicitação', 'organization.request_approved': 'Aprovar solicitação', 'organization.request_rejected': 'Recusar solicitação',
  'organization.pause': 'Pausar organização', 'organization.paused': 'Organização pausada',
  'organization.resume': 'Reativar organização', 'organization.resumed': 'Organização reativada',
  'organization.delete': 'Excluir organização', 'organization.deleted': 'Organização excluída',
  'organization.permanent_delete': 'Excluir permanentemente organização',
  'organization.deletion_requested': 'Solicitar exclusão permanente',
  'organization.storage_recovery': 'Recuperar armazenamento', 'organization.storage_disable': 'Desativar armazenamento',
  'organization.storage_observed': 'Consultar armazenamento',
  'organization.reconcile': 'Consultar e reconciliar operação',
  'organization.storage.repair': 'Verificar armazenamento',
  'ticket.created': 'Criar chamado', 'ticket.attachment.added': 'Adicionar anexo',
  'project.change_request.submitted': 'Enviar proposta de mapa',
  'project.lifecycle.draft_created': 'Criar rascunho de projeto', 'project.lifecycle.reconcile': 'Reconciliar projeto',
  'permission.grant': 'Conceder permissão', 'permission.revoke': 'Revogar permissão',
  'permission.native.deny': 'Bloquear permissão nativa', 'permission.native.restore': 'Restaurar permissão nativa',
};
export function auditActionLabel(action: string) { return actionLabels[action] ?? 'Ação registrada'; }

export type AuditActor = { id: number | null; name: string | null; kind: 'user' | 'system' | 'unrecorded' };
export type AuditOrganization = { id: number | null; name: string | null; slug: string | null };
export type AuditEntry = {
  id: string; createdAt: string | null; actor: AuditActor; organization: AuditOrganization | null;
  route: string | null; origin: string | null; category: AuditCategory; action: string;
  resource: { type: string; id: string | null; label: string | null };
  result: AuditResult; summary: string; legacy: boolean;
};
export type AuditPage = { entries: AuditEntry[]; nextBefore: string | null; capabilities: { operations: true } };
export const auditActionKinds = ['query', 'follow', 'resolve', 'retry', 'resume', 'review'] as const;
export type AuditRecoveryAction = {
  kind: typeof auditActionKinds[number]; enabled: boolean; reason: string | null;
  organizationId: number | null; operationId: string | null; deletionId: string | null;
  expectedVersion: number | null; itemIndex: number | null; confirmationRequired: boolean;
};
type RecoveryItemState = 'pending' | 'running' | 'succeeded' | 'failed' | 'partial';
export type AuditRecoveryResult =
  | { operation: { id: string; done: boolean; items: { state: RecoveryItemState }[] }; deletion?: never }
  | { deletion: { id: string; state: 'pending' | 'storage_deleted' | 'completed'; errorCode: string | null }; operation?: never };
export type AuditExecutor = 'user' | 'worker' | 'system' | 'unrecorded';
export type AuditStage = { id: string; createdAt: string | null; result: AuditResult; summary: string | null };
export type AuditAttempt = {
  id: string; parentId: string | null; itemIndex: number | null; originalActor: AuditActor; requestedBy: AuditActor; executor: AuditExecutor;
  startedAt: string | null; endedAt: string | null; result: AuditResult; stages: AuditStage[];
};
export type AuditDetail = {
  entry: AuditEntry; changes: { field: string; before: string | number | boolean | null; after: string | number | boolean | null }[];
  attempts: AuditAttempt[]; nextHistoryBefore: number | null;
  technical: { operationId: string | null; source: string | null; eventId: string | null; code: string | null;
    originalActor: AuditActor; requestedBy: AuditActor; executor: AuditExecutor; version: number | null };
  actions: AuditRecoveryAction[];
};
export type AuditFilters = { from: string; to: string; result: string; organizationId: string };
export const emptyAuditFilters: AuditFilters = { from: '', to: '', result: '', organizationId: '' };
const unavailable = () => new Error('Resposta de auditoria indisponível.');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 500): string {
  if (typeof value !== 'string' || value.length > limit || [...value].some(character => character.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(character))) throw unavailable();
  return value;
}
function optionalText(value: unknown, limit = 500) { return value == null ? null : text(value, limit); }
function positiveId(value: unknown) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw unavailable();
  return value as number;
}
function nonnegative(value: unknown) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw unavailable();
  return value as number;
}
function time(value: unknown): string | null {
  if (value === null) return null;
  const timestamp = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)) throw unavailable();
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== timestamp.slice(0, 19)) throw unavailable();
  return date.toISOString();
}
function result(value: unknown): AuditResult {
  if (typeof value !== 'string' || !Object.hasOwn(auditResultLabels, value)) throw unavailable();
  return value as AuditResult;
}
function actor(value: unknown): AuditActor {
  const row = object(value);
  if (!['user', 'system', 'unrecorded'].includes(String(row.kind))) throw unavailable();
  return { id: positiveId(row.id), name: optionalText(row.name, 240), kind: row.kind as AuditActor['kind'] };
}
function organization(value: unknown): AuditOrganization | null {
  if (value === null) return null;
  const row = object(value);
  return { id: positiveId(row.id), name: optionalText(row.name, 240), slug: optionalText(row.slug, 240) };
}
function entry(value: unknown): AuditEntry {
  const row = object(value), resource = object(row.resource);
  const id = text(row.id, 80);
  if (!/^(frame|legacy):[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id.split(':')[1])) || typeof row.legacy !== 'boolean') throw unavailable();
  if (typeof row.category !== 'string' || !Object.hasOwn(auditCategoryLabels, row.category)) throw unavailable();
  const state = result(row.result);
  if (id.startsWith('legacy:') !== row.legacy || (row.legacy && !['legacy_unproven', 'authorized', 'denied'].includes(state))) throw unavailable();
  return { id, createdAt: time(row.createdAt), actor: actor(row.actor), organization: organization(row.organization),
    route: optionalText(row.route, 300), origin: optionalText(row.origin, 300), category: row.category as AuditCategory,
    action: text(row.action, 160), resource: { type: text(resource.type, 80), id: optionalText(resource.id, 160), label: optionalText(resource.label, 400) },
    result: state, summary: text(row.summary, 1600), legacy: row.legacy };
}
export function parseAuditPage(value: unknown): AuditPage {
  const data = object(value), capability = object(data.capabilities);
  if (data.ok !== true || capability.operations !== true || !Array.isArray(data.entries) || data.entries.length > 25) throw unavailable();
  const entries = data.entries.map(entry);
  if (new Set(entries.map(row => row.id)).size !== entries.length) throw unavailable();
  const nextBefore = optionalText(data.nextBefore, 2048);
  if (nextBefore !== null && (!nextBefore || entries.length !== 25)) throw unavailable();
  return { entries, nextBefore, capabilities: { operations: true } };
}
function scalar(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return text(value, 3000);
  throw unavailable();
}
function attempt(value: unknown): AuditAttempt {
  const row = object(value);
  if (!Array.isArray(row.stages) || row.stages.length > 100) throw unavailable();
  if (row.itemIndex !== null && (!Number.isSafeInteger(row.itemIndex) || Number(row.itemIndex) < 0)) throw unavailable();
  return { id: text(row.id, 160), parentId: optionalText(row.parentId, 160), itemIndex: row.itemIndex as number | null, originalActor: actor(row.originalActor),
    requestedBy: actor(row.requestedBy), executor: executor(row.executor), startedAt: time(row.startedAt), endedAt: time(row.endedAt),
    result: result(row.result), stages: row.stages.map(value => { const stage = object(value); return { id: text(stage.id, 160), createdAt: time(stage.createdAt), result: result(stage.result), summary: optionalText(stage.summary, 1600) }; }) };
}
function executor(value: unknown): AuditExecutor {
  if (!['user', 'worker', 'system', 'unrecorded'].includes(String(value))) throw unavailable();
  return value as AuditExecutor;
}
export function parseAuditDetail(value: unknown, expectedId: string): AuditDetail {
  const data = object(value), technical = object(data.technical);
  const selected = entry(data.entry);
  if (data.ok !== true || object(data.capabilities).operations !== true || selected.id !== expectedId || !Array.isArray(data.changes) || data.changes.length > 100 || !Array.isArray(data.attempts) || data.attempts.length > 100 || !Array.isArray(data.actions) || data.actions.length > 12) throw unavailable();
  const actions = data.actions.map(value => {
    const action = object(value);
    if (!auditActionKinds.includes(action.kind as AuditRecoveryAction['kind']) || typeof action.enabled !== 'boolean') throw unavailable();
    return { kind: action.kind as AuditRecoveryAction['kind'], enabled: action.enabled, reason: optionalText(action.reason, 1000),
      organizationId: positiveId(action.organizationId), operationId: optionalText(action.operationId, 160), deletionId: optionalText(action.deletionId, 160),
      expectedVersion: nonnegative(action.expectedVersion), itemIndex: nonnegative(action.itemIndex), confirmationRequired: action.confirmationRequired === true };
  });
  return { entry: selected, changes: data.changes.map(value => { const change = object(value); return { field: text(change.field, 160), before: scalar(change.before), after: scalar(change.after) }; }),
    attempts: data.attempts.map(attempt), nextHistoryBefore: positiveId(data.nextHistoryBefore),
    technical: { operationId: optionalText(technical.operationId, 160), source: optionalText(technical.source, 160), eventId: optionalText(technical.eventId, 160), code: optionalText(technical.code, 160),
      originalActor: actor(technical.originalActor), requestedBy: actor(technical.requestedBy), executor: executor(technical.executor), version: nonnegative(technical.version) }, actions };
}
/** An HTTP success without a valid domain observation cannot release another intention. */
export function parseAuditRecoveryResult(value: unknown, action: Pick<AuditRecoveryAction, 'operationId' | 'deletionId'>): AuditRecoveryResult {
  const data = object(value);
  if (data.ok !== true) throw unavailable();
  if (action.deletionId) {
    const deletion = object(data.deletion);
    if (data.operation !== undefined || deletion.id !== action.deletionId || !['pending', 'storage_deleted', 'completed'].includes(String(deletion.state)) || (deletion.errorCode !== null && typeof deletion.errorCode !== 'string')) throw unavailable();
    return { deletion: { id: action.deletionId, state: deletion.state as 'pending' | 'storage_deleted' | 'completed', errorCode: optionalText(deletion.errorCode, 160) } };
  }
  const operation = object(data.operation);
  if (!action.operationId || data.deletion !== undefined || operation.id !== action.operationId || typeof operation.done !== 'boolean' || !Array.isArray(operation.items) || operation.items.length < 1 || operation.items.length > 100) throw unavailable();
  const items = operation.items.map(value => {
    const item = object(value);
    if (!['pending', 'running', 'succeeded', 'failed', 'partial'].includes(String(item.state))) throw unavailable();
    return { state: item.state as RecoveryItemState };
  });
  if (operation.done !== items.every(item => ['succeeded', 'failed', 'partial'].includes(item.state))) throw unavailable();
  return { operation: { id: action.operationId, done: operation.done, items } };
}
export function mergeAuditHistory(current: AuditDetail, older: AuditDetail): AuditDetail {
  if (current.entry.id !== older.entry.id) throw unavailable();
  const attempts = new Map(current.attempts.map(item => [item.id, item]));
  for (const incoming of older.attempts) {
    const existing = attempts.get(incoming.id);
    if (!existing) { attempts.set(incoming.id, incoming); continue; }
    const stages = [...new Map([...incoming.stages, ...existing.stages].map(stage => [stage.id, stage])).values()]
      .sort((left, right) => Number(left.id.split(':')[1]) - Number(right.id.split(':')[1]));
    attempts.set(incoming.id, { ...existing, startedAt: existing.startedAt || incoming.startedAt, endedAt: existing.endedAt || incoming.endedAt,
      result: stages.at(-1)?.result || existing.result, stages });
  }
  return { ...current, attempts: [...attempts.values()], nextHistoryBefore: older.nextHistoryBefore, actions: older.actions };
}
export function auditActorLabel(value: AuditActor) { return value.name || (value.kind === 'system' ? 'Sistema' : 'Não registrado'); }
export function auditDateLabel(value: string | null) {
  if (!value) return 'Não registrado';
  return new Intl.DateTimeFormat('pt-BR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo', timeZoneName: 'shortOffset' }).format(new Date(value));
}

const filterIssueLabels = {
  invalid_date: 'Informe uma data válida.',
  inverted_range: 'A data final deve ser igual ou posterior à inicial.',
  invalid_result: 'Selecione um resultado válido.',
  invalid_organization: 'Informe uma organização válida.',
  invalid_cursor: 'Página inválida. Volte aos registros mais recentes.',
};
type AuditFilterIssue = keyof typeof filterIssueLabels;
class AuditFilterError extends Error {
  readonly issue: AuditFilterIssue;
  constructor(issue: AuditFilterIssue) { super(issue); this.issue = issue; }
}
export function auditFilterErrorLabel(cause: unknown): string {
  return cause instanceof AuditFilterError ? filterIssueLabels[cause.issue] : 'Confira os filtros e tente novamente.';
}

/** Date controls represent Brasília calendar days; APIs receive UTC instants. */
export function auditDayBoundary(value: string, nextDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AuditFilterError('invalid_date');
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AuditFilterError('invalid_date');
  if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
  const day = date.toISOString().slice(0, 10), nominal = Date.parse(`${day}T00:00:00.000Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = nominal;
  for (let index = 0; index < 3; index++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const represented = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000Z`);
    const adjustment = nominal - represented;
    instant += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(instant).toISOString();
}
export function auditFiltersFromParams(params: URLSearchParams): AuditFilters {
  return { from: params.get('audit_from') ?? '', to: params.get('audit_to') ?? '', result: params.get('audit_result') ?? '', organizationId: params.get('audit_org') ?? '' };
}
export function auditQuery(filters: AuditFilters, before: string | null): string {
  const query = new URLSearchParams();
  if (filters.from) query.set('from', auditDayBoundary(filters.from));
  if (filters.to) query.set('to', auditDayBoundary(filters.to, true));
  if (filters.from && filters.to && filters.from > filters.to) throw new AuditFilterError('inverted_range');
  if (filters.result) {
    if (!Object.hasOwn(auditResultLabels, filters.result)) throw new AuditFilterError('invalid_result');
    query.set('result', filters.result);
  }
  if (filters.organizationId) {
    if (!/^[1-9]\d*$/.test(filters.organizationId) || !Number.isSafeInteger(Number(filters.organizationId))) throw new AuditFilterError('invalid_organization');
    query.set('organizationId', filters.organizationId);
  }
  if (before !== null) {
    if (!before || before.length > 2048 || [...before].some(character => character.charCodeAt(0) <= 32)) throw new AuditFilterError('invalid_cursor');
    query.set('before', before);
  }
  return query.toString();
}
