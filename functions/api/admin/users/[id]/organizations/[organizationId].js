import { requireSession, normalizeRole } from "../../../../../_lib/auth.js";
import { errorResponse, jsonResponse, methodNotAllowed, readJsonBody } from "../../../../../_lib/http.js";
import { recordAuditLog } from "../../../../../_lib/permissions.js";
import { disableDelegationsIfIneligible } from "../../../../../_lib/access-delegation.js";

const LEVELS = new Set(["viewer", "editor", "owner"]);
function id(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
async function requireSuperAdmin(env, request) { const actor = await requireSession(env, request); if (normalizeRole(actor.role) !== "super_admin") { const error = new Error("Somente Super Admin pode gerenciar vínculos organizacionais."); error.status = 403; error.code = "SUPER_ADMIN_REQUIRED"; throw error; } return actor; }

export async function onRequestPut({ env, request, params }) {
  try {
    const actor = await requireSuperAdmin(env, request); const userId = id(params.id); const organizationId = id(params.organizationId); const body = await readJsonBody(request); const accessLevel = String(body?.accessLevel || "viewer").toLowerCase();
    if (!userId || !organizationId || !LEVELS.has(accessLevel)) return errorResponse("Vínculo organizacional inválido.", 400, "ORGANIZATION_MEMBERSHIP_INVALID");
    const user = await env.DB.prepare("SELECT id, active FROM users WHERE id = ?").bind(userId).first(); const organization = await env.DB.prepare("SELECT id, active FROM organizations WHERE id = ?").bind(organizationId).first();
    if (!user || !organization) return errorResponse("Usuário ou organização não encontrado.", 404, "MEMBERSHIP_TARGET_NOT_FOUND");
    const existing = await env.DB.prepare("SELECT id FROM organization_users WHERE user_id = ? AND organization_id = ?").bind(userId, organizationId).first();
    if (existing) await env.DB.prepare("UPDATE organization_users SET access_level = ? WHERE id = ?").bind(accessLevel, existing.id).run();
    else await env.DB.prepare("INSERT INTO organization_users (organization_id, user_id, access_level, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)").bind(organizationId, userId, accessLevel).run();
    await disableDelegationsIfIneligible(env, userId);
    await recordAuditLog(env, { actorUserId: actor.id, organizationId, action: existing ? "admin.user_organization.update" : "admin.user_organization.assign", resourceType: "user", resourceId: userId, result: "success", metadata: { accessLevel }, request });
    return jsonResponse({ ok: true, assigned: true, accessLevel });
  } catch (error) { return errorResponse(error.message, error.status || 500, error.code || "ADMIN_USER_ORGANIZATION_UPDATE_ERROR"); }
}

export async function onRequestDelete({ env, request, params }) {
  try {
    const actor = await requireSuperAdmin(env, request); const userId = id(params.id); const organizationId = id(params.organizationId); if (!userId || !organizationId) return errorResponse("Vínculo inválido.", 400, "ORGANIZATION_MEMBERSHIP_INVALID");
    const membership = await env.DB.prepare("SELECT id, access_level FROM organization_users WHERE user_id = ? AND organization_id = ?").bind(userId, organizationId).first(); if (!membership) return errorResponse("Vínculo não encontrado.", 404, "MEMBERSHIP_NOT_FOUND");
    if (String(membership.access_level).toLowerCase() === "owner") { const owners = await env.DB.prepare("SELECT COUNT(*) AS total FROM organization_users WHERE organization_id = ? AND LOWER(access_level) = 'owner'").bind(organizationId).first(); if (Number(owners?.total || 0) <= 1) return errorResponse("Não é possível remover o último responsável.", 409, "LAST_OWNER_REMOVAL_BLOCKED"); }
    await env.DB.batch([env.DB.prepare("DELETE FROM user_permissions WHERE user_id = ? AND organization_id = ?").bind(userId, organizationId), env.DB.prepare("DELETE FROM organization_users WHERE user_id = ? AND organization_id = ?").bind(userId, organizationId)]);
    await env.DB.prepare("UPDATE organization_access_delegations SET enabled = 0, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ? AND delegate_user_id = ?").bind(organizationId, userId).run();
    await recordAuditLog(env, { actorUserId: actor.id, organizationId, action: "admin.user_organization.remove", resourceType: "user", resourceId: userId, result: "success", request }); return jsonResponse({ ok: true, removed: true });
  } catch (error) { return errorResponse(error.message, error.status || 500, error.code || "ADMIN_USER_ORGANIZATION_DELETE_ERROR"); }
}

export async function onRequest(context) { if (context.request.method === "PUT") return onRequestPut(context); if (context.request.method === "DELETE") return onRequestDelete(context); return methodNotAllowed(["PUT", "DELETE"]); }
