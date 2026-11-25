import { requireSession } from '../../../../_lib/auth.js';
import { jsonResponse, errorResponse, methodNotAllowed } from '../../../../_lib/http.js';
import { requireOperationAuditReady } from '../../../../_lib/operation-audit.js';

export function createAuditOperationLinkHandler(sessionReader = requireSession) {
  return async ({ request, env, params }) => {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    try {
      const user = await sessionReader(env, request);
      if (String(user?.role || '').trim().toLowerCase() !== 'super_admin') return errorResponse('Acesso restrito ao Super Admin.', 403, 'AUTH_PERMISSION_DENIED');
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(params?.operationId || '') || new URL(request.url).search) return errorResponse('Operação inválida.', 400, 'VALIDATION_ERROR');
      await requireOperationAuditReady(env);
      const row = await env.DB.prepare('SELECT id FROM audit_operation_frames WHERE operation_id=? ORDER BY id DESC LIMIT 1').bind(params.operationId).first();
      // Old operations acquire an observation through an explicit domain consult.
      // A read does not fabricate a historical event or mutate their old result.
      if (!row) return errorResponse('O relatório ainda não foi registrado. Consulte o resultado da operação.', 404, 'AUDIT_EVENT_NOT_FOUND');
      return jsonResponse({ ok: true, eventId: `frame:${row.id}`, capabilities: { operations: true } }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, X-Maono-Audit' } });
    } catch (error) {
      const status = Number(error?.status);
      if (status === 401) return errorResponse('Sessão inválida ou expirada.', 401, 'AUTH_SESSION_EXPIRED');
      if (status === 403) return errorResponse('Acesso restrito.', 403, 'AUTH_PERMISSION_DENIED');
      return errorResponse('Consulta de auditoria indisponível.', 503, 'INFRASTRUCTURE_UNEXPECTED_ERROR');
    }
  };
}
export const onRequest = createAuditOperationLinkHandler();
