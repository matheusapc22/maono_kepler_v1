import { requireSession, normalizeRole } from "../../../../_lib/auth.js";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../../../_lib/http.js";
import { recordAuditLog } from "../../../../_lib/permissions.js";

export async function onRequestGet({ env, request, params }) {
  try {
    const actor = await requireSession(env, request);
    if (normalizeRole(actor.role) !== "super_admin") return errorResponse("Somente Super Admin pode gerenciar vínculos organizacionais.", 403, "SUPER_ADMIN_REQUIRED");
    const userId = Number(params.id);
    if (!Number.isInteger(userId) || userId <= 0) return errorResponse("Usuário inválido.", 400, "USER_ID_INVALID");
    const { results } = await env.DB.prepare(`SELECT o.id, o.name, o.slug, o.active, ou.access_level, CASE WHEN ou.user_id IS NULL THEN 0 ELSE 1 END AS assigned FROM organizations o LEFT JOIN organization_users ou ON ou.organization_id = o.id AND ou.user_id = ? ORDER BY o.name`).bind(userId).all();
    return jsonResponse({ ok: true, organizations: (results || []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, active: row.active !== 0, assigned: row.assigned === 1, accessLevel: row.access_level || "viewer" })) });
  } catch (error) { return errorResponse(error.message, error.status || 500, error.code || "ADMIN_USER_ORGANIZATIONS_ERROR"); }
}

export async function onRequest({ request, ...context }) {
  if (request.method === "GET") return onRequestGet({ request, ...context });
  return methodNotAllowed(["GET"]);
}
