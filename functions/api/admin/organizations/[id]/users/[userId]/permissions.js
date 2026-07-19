import { normalizeRole, requireSession } from "../../../../../../_lib/auth.js";
import { permissionCatalog } from "../../../../../../_lib/access-delegation.js";
import { ACCESS_DELEGATION_PERMISSION, getPermissionMetadata } from "../../../../../../_lib/permission-catalog.js";
import { recordAuditLog } from "../../../../../../_lib/permissions.js";
import { getRouteParam, grantOrganizationPermission, handleApiError, jsonResponse, methodNotAllowed, parsePositiveInteger, readJsonBody, revokeOrganizationPermission } from "../../../../../../_lib/organizations.js";

async function context(env, request, params) {
  const actor = await requireSession(env, request);
  if (normalizeRole(actor.role) !== "super_admin") { const error = new Error("Somente Super Admin pode administrar acessos no Painel Admin."); error.status = 403; error.code = "SUPER_ADMIN_REQUIRED"; throw error; }
  return { actor, organizationId: parsePositiveInteger(getRouteParam(params, "id"), "organizationId"), userId: parsePositiveInteger(getRouteParam(params, "userId"), "userId") };
}

function organizationPermission(value) {
  const permission = String(value || "");
  const metadata = getPermissionMetadata(permission);
  if (!metadata || permission === ACCESS_DELEGATION_PERMISSION || metadata.group === "Plataforma") {
    const error = new Error("Acesso fora do catálogo organizacional administrável.");
    error.status = 400;
    error.code = "ORGANIZATION_PERMISSION_NOT_ASSIGNABLE";
    throw error;
  }
  return permission;
}

export async function onRequestGet({ env, request, params }) {
  try {
    const value = await context(env, request, params);
    const membership = await env.DB.prepare(`SELECT u.id, u.name, u.email, u.role, u.active, ou.access_level FROM users u INNER JOIN organization_users ou ON ou.user_id = u.id WHERE ou.organization_id = ? AND u.id = ? LIMIT 1`).bind(value.organizationId, value.userId).first();
    if (!membership) { const error = new Error("Usuário não encontrado na organização."); error.status = 404; error.code = "USER_NOT_FOUND"; throw error; }
    const result = await env.DB.prepare(`SELECT permission FROM user_permissions WHERE user_id = ? AND organization_id = ? AND active = 1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) ORDER BY permission`).bind(value.userId, value.organizationId).all();
    return jsonResponse({ ok: true, user: { ...membership, accessLevel: membership.access_level }, permissions: (result.results || []).map((item) => item.permission), catalog: permissionCatalog() });
  } catch (error) { return handleApiError(error); }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const value = await context(env, request, params); const body = await readJsonBody(request); const permission = organizationPermission(body?.permission);
    const grant = await grantOrganizationPermission(env, value.organizationId, value.userId, permission, value.actor, body || {});
    await recordAuditLog(env, { actorUserId: value.actor.id, organizationId: value.organizationId, action: "admin.permission.grant", resourceType: "user", resourceId: value.userId, result: "success", metadata: { permission }, request });
    return jsonResponse({ ok: true, grant }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}

export async function onRequestDelete({ env, request, params }) {
  try {
    const value = await context(env, request, params); const body = await readJsonBody(request); const permission = organizationPermission(body?.permission);
    const revoke = await revokeOrganizationPermission(env, value.organizationId, value.userId, permission, value.actor);
    await recordAuditLog(env, { actorUserId: value.actor.id, organizationId: value.organizationId, action: "admin.permission.revoke", resourceType: "user", resourceId: value.userId, result: "success", metadata: { permission }, request });
    return jsonResponse({ ok: true, revoke });
  } catch (error) { return handleApiError(error); }
}

export async function onRequest(contextValue) {
  if (contextValue.request.method === "GET") return onRequestGet(contextValue);
  if (contextValue.request.method === "POST") return onRequestPost(contextValue);
  if (contextValue.request.method === "DELETE") return onRequestDelete(contextValue);
  return methodNotAllowed(contextValue.request.method, ["GET", "POST", "DELETE"]);
}
