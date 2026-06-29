import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { requirePermission } from "../../../_lib/permissions.js";
import { logAudit } from "../../../_lib/projects.js";

const ALLOWED_ACCESS_LEVELS = new Set(["viewer", "editor", "owner"]);

function normalizePositiveInteger(value) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeAccessLevel(value) {
  const accessLevel = String(value || "").trim().toLowerCase();

  return ALLOWED_ACCESS_LEVELS.has(accessLevel) ? accessLevel : null;
}

async function requireAdminPanelAccessForOrganizationUser(
  env,
  request,
  user,
  organizationUser,
  action,
) {
  const organizationId = normalizePositiveInteger(
    organizationUser.organization_id,
  );

  return requirePermission(
    env,
    request,
    "admin.panel.access",
    {
      organizationId,
      scopeType: "organization",
    },
    {
      user,
      resourceType: "organization_user",
      resourceId: organizationUser.id,
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

async function getOrganizationUser(env, organizationUserId) {
  return env.DB.prepare(
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
    LIMIT 1`,
  )
    .bind(organizationUserId)
    .first();
}

async function countOrganizationOwners(env, organizationId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM organization_users
     WHERE organization_id = ?
       AND access_level = 'owner'`,
  )
    .bind(organizationId)
    .first();

  return Number(row?.total || 0);
}

async function assertDoesNotRemoveLastOwner(
  env,
  organizationUser,
  nextAccessLevel = null,
) {
  const currentAccessLevel = normalizeAccessLevel(
    organizationUser.access_level,
  );

  if (currentAccessLevel !== "owner") {
    return;
  }

  if (nextAccessLevel === "owner") {
    return;
  }

  const organizationId = normalizePositiveInteger(
    organizationUser.organization_id,
  );

  const ownersCount = await countOrganizationOwners(env, organizationId);

  if (ownersCount <= 1) {
    const error = new Error(
      "A organização precisa manter pelo menos um owner ativo.",
    );
    error.status = 409;
    error.code = "LAST_OWNER_REQUIRED";
    throw error;
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    if (
      request.method !== "PATCH" &&
      request.method !== "PUT" &&
      request.method !== "DELETE"
    ) {
      return methodNotAllowed(["PATCH", "PUT", "DELETE"]);
    }

    const sessionUser = await requireSession(env, request);
    const organizationUserId = normalizePositiveInteger(params.id);

    if (!organizationUserId) {
      return errorResponse(
        "ID do vínculo inválido.",
        400,
        "ORGANIZATION_USER_ID_INVALID",
      );
    }

    const organizationUser = await getOrganizationUser(
      env,
      organizationUserId,
    );

    if (!organizationUser) {
      return errorResponse(
        "Vínculo de organização não encontrado.",
        404,
        "ORGANIZATION_USER_NOT_FOUND",
      );
    }

    if (request.method === "PATCH" || request.method === "PUT") {
      const { user } = await requireAdminPanelAccessForOrganizationUser(
        env,
        request,
        sessionUser,
        organizationUser,
        "admin.organization_users.update",
      );

      const body = await readJsonBody(request);
      const accessLevel = normalizeAccessLevel(
        body?.accessLevel || body?.access_level,
      );

      if (!accessLevel) {
        return errorResponse(
          "Informe um nível de acesso válido: viewer, editor ou owner.",
          400,
          "ORGANIZATION_USER_ACCESS_LEVEL_INVALID",
        );
      }

      await assertDoesNotRemoveLastOwner(
        env,
        organizationUser,
        accessLevel,
      );

      await env.DB.prepare(
        `UPDATE organization_users
         SET access_level = ?
         WHERE id = ?`,
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
          previousAccessLevel: organizationUser.access_level,
          accessLevel,
        },
      });

      return jsonResponse({ ok: true });
    }

    if (request.method === "DELETE") {
      const { user } = await requireAdminPanelAccessForOrganizationUser(
        env,
        request,
        sessionUser,
        organizationUser,
        "admin.organization_users.delete",
      );

      await assertDoesNotRemoveLastOwner(env, organizationUser, null);

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
          previousAccessLevel: organizationUser.access_level,
        },
      });

      return jsonResponse({ ok: true });
    }

    return methodNotAllowed(["PATCH", "PUT", "DELETE"]);
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_ORGANIZATION_USER_ERROR",
    );
  }
}