import { requireSession } from '../../../_lib/auth.js';
import { jsonResponse, errorResponse, methodNotAllowed } from '../../../_lib/http.js';
import { auditOrganizationSearch, readAuditOrganizations } from '../../../_lib/admin-operation-audit-reader.js';

export function createAuditOrganizationsHandler(sessionReader = requireSession) {
  return async ({ request, env }) => {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    try {
      const user = await sessionReader(env, request);
      if (String(user?.role || '').trim().toLowerCase() !== 'super_admin') return errorResponse('Acesso restrito ao Super Admin.', 403, 'AUTH_PERMISSION_DENIED');
      const search = auditOrganizationSearch(request.url);
      const data = await readAuditOrganizations(env, search);
      return jsonResponse({ ok: true, ...data }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, X-Maono-Audit' } });
    } catch (error) {
      const status = Number(error?.status);
      if (status === 400) return errorResponse('Filtro de organização inválido.', 400, 'VALIDATION_ERROR');
      if (status === 401) return errorResponse('Sessão inválida ou expirada.', 401, 'AUTH_SESSION_EXPIRED');
      if (status === 403) return errorResponse('Acesso restrito.', 403, 'AUTH_PERMISSION_DENIED');
      return errorResponse('Consulta de organizações indisponível.', 503, 'INFRASTRUCTURE_UNEXPECTED_ERROR');
    }
  };
}
export const onRequest = createAuditOrganizationsHandler();
