import { requireSession } from '../../../_lib/auth.js';
import { jsonResponse, errorResponse, methodNotAllowed } from '../../../_lib/http.js';
import { auditCursor, readAdminAuditPage } from '../../../_lib/admin-audit-reader.js';

export function createAdminAuditHandler(sessionReader = requireSession) {
  return async function handle({ request, env }) {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    try {
      const user = await sessionReader(env, request);
      if (String(user?.role || '').trim().toLowerCase() !== 'super_admin') {
        return errorResponse('Acesso restrito ao Super Admin.', 403, 'AUTH_PERMISSION_DENIED');
      }
      let before;
      try { before = auditCursor(request.url); }
      catch { return errorResponse('Página de auditoria inválida.', 400, 'VALIDATION_ERROR'); }
      const page = await readAdminAuditPage(env.DB, before);
      return jsonResponse({ ok: true, ...page }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
    } catch (error) {
      const status = Number(error?.status);
      if (status === 401) return errorResponse('Sessão inválida ou expirada.', 401, 'AUTH_SESSION_EXPIRED');
      if (status === 403) return errorResponse('Acesso restrito.', 403, 'AUTH_PERMISSION_DENIED');
      // A missing schema/binding is unavailable, never an empty event list.
      return errorResponse('Consulta de auditoria indisponível.', 503, 'INFRASTRUCTURE_UNEXPECTED_ERROR');
    }
  };
}

export const onRequest = createAdminAuditHandler();
