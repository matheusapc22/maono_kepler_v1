import { requireSession } from './auth.js';
import { requirePermission } from './permissions.js';
import { jsonResponse, errorResponse, methodNotAllowed } from './http.js';
import { ManagementError, requireOperationAuditReady } from './operation-audit.js';
import { auditEventId, auditHistoryCursor, readOperationAuditDetail, readOperationAuditRecord } from './admin-operation-audit-reader.js';
import { getAuditRecoveryActions, runAuditRecoveryAction } from './organization-audit-recovery.js';
import { createOrganizationLifecycle, updateOrganizationLifecycle } from './organization-lifecycle.js';
import { resolveOrganizationPolicy, isProjectQuotaReservationEnabled } from './organization-limit-service.js';

const privateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, X-Maono-Audit', 'X-Content-Type-Options': 'nosniff' };
async function superAdmin(env, request, sessionReader) {
  const user = await sessionReader(env, request);
  if (String(user?.role || '').trim().toLowerCase() !== 'super_admin') throw Object.assign(new Error('Acesso restrito ao Super Admin.'), { status: 403 });
  return user;
}
function failure(error) {
  const status = Number(error?.status);
  if (status === 401) return errorResponse('Sessão inválida ou expirada.', 401, 'AUTH_SESSION_EXPIRED', null, { headers: privateHeaders });
  if (status === 403) return errorResponse('Acesso restrito.', 403, 'AUTH_PERMISSION_DENIED', null, { headers: privateHeaders });
  if (error instanceof ManagementError && [400, 404, 409, 412, 413, 415, 422, 423, 503].includes(status)) {
    return errorResponse(error.message, status, error.code, null, { headers: privateHeaders });
  }
  if (status === 400) return errorResponse('Consulta ou ação de auditoria inválida.', 400, 'VALIDATION_ERROR', null, { headers: privateHeaders });
  if (status === 404) return errorResponse('Registro não encontrado.', 404, 'AUDIT_EVENT_NOT_FOUND', null, { headers: privateHeaders });
  return errorResponse('Consulta de auditoria indisponível. Consulte o estado antes de repetir.', 503, 'INFRASTRUCTURE_UNEXPECTED_ERROR', null, { headers: privateHeaders });
}
function eventId(context) {
  const value = context.params?.eventId;
  auditEventId(value);
  return value;
}
export function createAuditDetailHandler(sessionReader = requireSession, recoveryActions = getAuditRecoveryActions) {
  return async context => {
    if (context.request.method !== 'GET') return methodNotAllowed(['GET']);
    try {
      const user = await superAdmin(context.env, context.request, sessionReader);
      const id = eventId(context), before = auditHistoryCursor(context.request.url);
      const detail = await readOperationAuditDetail(context.env, id, user, recoveryActions, before);
      return jsonResponse({ ok: true, ...detail }, { headers: privateHeaders });
    } catch (error) { return failure(error); }
  };
}
async function body(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin || ![null, 'same-origin', 'none'].includes(request.headers.get('Sec-Fetch-Site')) || request.headers.get('X-Maono-Management') !== '1') {
    throw Object.assign(new Error('Acesso restrito.'), { status: 403 });
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ManagementError('Use JSON nesta operação.', 415, 'MANAGEMENT_CONTENT_TYPE');
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('Corpo ausente.'), { status: 400 });
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new ManagementError('Requisição excede o limite.', 413, 'MANAGEMENT_BODY_TOO_LARGE'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
  const fields = new Set(['action', 'expectedVersion', 'confirmation', 'requestKey']);
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).some(key => !fields.has(key)) || !['query', 'follow', 'resolve', 'retry', 'resume', 'review'].includes(result.action) ||
    (result.expectedVersion !== undefined && (!Number.isSafeInteger(result.expectedVersion) || result.expectedVersion < 0)) ||
    (result.confirmation !== undefined && (typeof result.confirmation !== 'string' || result.confirmation.length > 256)) ||
    (result.requestKey !== undefined && (typeof result.requestKey !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(result.requestKey)))) throw Object.assign(new Error('Ação inválida.'), { status: 400 });
  return result;
}
export function createAuditRetryHandler(sessionReader = requireSession, executor = runAuditRecoveryAction, extraDependencies = {}) {
  return async context => {
    const { request, env } = context;
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    try {
      const user = await superAdmin(env, request, sessionReader);
      const id = eventId(context);
      if (new URL(request.url).search) throw Object.assign(new Error('Parâmetros inválidos.'), { status: 400 });
      await requireOperationAuditReady(env);
      const command = await body(request);
      const row = await readOperationAuditRecord(env, id);
      if (row.row_source !== 'frame') throw new ManagementError('Este registro legado não permite repetir ações.', 409, 'AUDIT_LEGACY_NOT_RECOVERABLE');
      const authorize = organizationId => requirePermission(env, request, 'admin.panel.access', organizationId == null ? { scopeType: 'global' } : { scopeType: 'organization', organizationId }, { audit: false, auditOnSuccess: false });
      const dependencies = {
        createLifecycle: createOrganizationLifecycle, updateLifecycle: updateOrganizationLifecycle,
        resolvePolicy: resolveOrganizationPolicy, quotaEnabled: isProjectQuotaReservationEnabled,
        authorizeGlobal: () => authorize(null), authorizeOrganization: id => authorize(id), ...extraDependencies,
      };
      // The event chooses the domain operation. No URL, SQL or payload from the client/log is replayed.
      const result = await executor(env, user, row, command, request, dependencies);
      return jsonResponse({ ok: true, ...result }, { headers: privateHeaders });
    } catch (error) { return failure(error); }
  };
}
