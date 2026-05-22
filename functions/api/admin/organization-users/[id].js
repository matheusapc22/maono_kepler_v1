import { errorResponse, jsonResponse, methodNotAllowed, readJsonBody } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/projects.js";

const ALLOWED_ACCESS_LEVELS = new Set(["viewer", "editor", "owner"]);

function requireAdmin(user) {
  if (user?.role !== "admin") {
    const error = new Error("Apenas administradores podem acessar este recurso.");
    error.status = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
}

function normalizeAccessLevel(value) {
  const accessLevel = String(value || "viewer").trim().toLowerCase();
  return ALLOWED_ACCESS_LEVELS.has(accessLevel) ? accessLevel : "viewer";
}

async function getOrganizationUser(env, organizationUserId) {
  return await env.DB.prepare(
    `SELECT
      organization_users.id,
      organization_users.organization_id,
      organization_users.user_id,
      organization_users.access_level,
      organization_users.created_at,
      users.email,
      organizations.slug AS organization_slug
    FROM organization_users
    INNER JOIN users ON users.id = organization_users.user_id
    INNER JOIN organizations ON organizations.id = organization_users.organization_id
    WHERE organization_users.id = ?
    LIMIT 1`
  )
    .bind(organizationUserId)
    .first();
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    const organizationUserId = Number(params.id);
    if (!organizationUserId) {
      return errorResponse("ID do vínculo inválido.", 400, "ORGANIZATION_USER_ID_INVALID");
    }

    const organizationUser = await getOrganizationUser(env, organizationUserId);
    if (!organizationUser) {
      return errorResponse("Vínculo de organização não encontrado.", 404, "ORGANIZATION_USER_NOT_FOUND");
    }

    if (request.method === "PATCH" || request.method === "PUT") {
      const body = await readJsonBody(request);
      const accessLevel = normalizeAccessLevel(body?.accessLevel || body?.access_level);

      await env.DB.prepare(
        `UPDATE organization_users SET access_level = ? WHERE id = ?`
      )
        .bind(accessLevel, organizationUserId)
        .run();

      await logAudit(env, {
        userId: user.id,
        action: "admin.organization_users.update",
        details: {
          organizationUserId,
          organizationId: organizationUser.organization_id,
          targetUserId: organizationUser.user_id,
          accessLevel,
        },
      });

      return jsonResponse({ ok: true });
    }

    if (request.method === "DELETE") {
      await env.DB.prepare(`DELETE FROM organization_users WHERE id = ?`)
        .bind(organizationUserId)
        .run();

      await logAudit(env, {
        userId: user.id,
        action: "admin.organization_users.delete",
        details: {
          organizationUserId,
          organizationId: organizationUser.organization_id,
          targetUserId: organizationUser.user_id,
        },
      });

      return jsonResponse({ ok: true });
    }

    return methodNotAllowed(["PATCH", "PUT", "DELETE"]);
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_ORGANIZATION_USER_ERROR");
  }
}
