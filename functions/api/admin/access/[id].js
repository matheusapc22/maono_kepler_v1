import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { requirePermission } from "../../../_lib/permissions.js";
import { logAudit } from "../../../_lib/projects.js";

function normalizePositiveInteger(value) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

async function getAccessById(env, accessId) {
  return env.DB.prepare(
    `SELECT
      user_projects.id,
      user_projects.user_id,
      user_projects.project_id,
      user_projects.access_level,
      projects.organization_id
     FROM user_projects
     INNER JOIN projects ON projects.id = user_projects.project_id
     WHERE user_projects.id = ?
     LIMIT 1`,
  )
    .bind(accessId)
    .first();
}

async function requireAdminPanelAccessForAccessDelete(
  env,
  request,
  user,
  access,
) {
  const organizationId = normalizePositiveInteger(access.organization_id);
  const projectId = normalizePositiveInteger(access.project_id);

  const permissionContext = organizationId
    ? {
        organizationId,
        projectId,
        scopeType: "organization",
      }
    : {
        projectId,
        scopeType: "global",
      };

  return requirePermission(
    env,
    request,
    "admin.panel.access",
    permissionContext,
    {
      user,
      resourceType: organizationId ? "organization" : "project",
      resourceId: organizationId || projectId || access.id,
      auditAction: "admin.access.delete",
      auditOnSuccess: false,
    },
  );
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    if (request.method !== "DELETE") {
      return methodNotAllowed(["DELETE"]);
    }

    const sessionUser = await requireSession(env, request);
    const accessId = normalizePositiveInteger(params.id);

    if (!accessId) {
      return errorResponse(
        "ID do acesso inválido.",
        400,
        "ACCESS_ID_INVALID",
      );
    }

    const access = await getAccessById(env, accessId);

    if (!access) {
      return errorResponse(
        "Vínculo de acesso não encontrado.",
        404,
        "ACCESS_NOT_FOUND",
      );
    }

    const { user } = await requireAdminPanelAccessForAccessDelete(
      env,
      request,
      sessionUser,
      access,
    );

    await env.DB.prepare(`DELETE FROM user_projects WHERE id = ?`)
      .bind(accessId)
      .run();

    await logAudit(env, {
      userId: user.id,
      projectId: access.project_id,
      action: "admin.access.delete",
      details: {
        accessId,
        targetUserId: access.user_id,
        accessLevel: access.access_level,
        organizationId: access.organization_id || null,
      },
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_ACCESS_DELETE_ERROR",
    );
  }
}