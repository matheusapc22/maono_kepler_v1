import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../../_lib/http.js";
import { requirePermission } from "../../../../_lib/permissions.js";
import { logAudit } from "../../../../_lib/projects.js";

const ALLOWED_ACCESS_LEVELS = new Set(["viewer", "editor", "owner"]);

function normalizePositiveInteger(value) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeAccessLevel(value) {
  const accessLevel = String(value || "").trim().toLowerCase();

  return ALLOWED_ACCESS_LEVELS.has(accessLevel) ? accessLevel : null;
}

async function requireOrganizationAdminPanelAccess(
  env,
  request,
  organizationId,
  action,
  options = {},
) {
  return requirePermission(
    env,
    request,
    "admin.panel.access",
    {
      organizationId,
      scopeType: "organization",
    },
    {
      user: options.user,
      resourceType: "organization",
      resourceId: organizationId,
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

async function requireGlobalAdminPanelAccess(
  env,
  request,
  action,
  options = {},
) {
  return requirePermission(
    env,
    request,
    "admin.panel.access",
    {
      scopeType: "global",
    },
    {
      user: options.user,
      resourceType: "platform",
      resourceId: "admin.organization_users",
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

function publicOrganizationUser(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    accessLevel: row.access_level,
    createdAt: row.created_at,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      active: Boolean(row.user_active),
    },
  };
}

async function getOrganization(env, organizationId) {
  return env.DB.prepare(
    `SELECT
      id,
      name,
      slug,
      active
     FROM organizations
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(organizationId)
    .first();
}

async function listOrganizationUsers(env, organizationId) {
  const { results } = await env.DB.prepare(
    `SELECT
      organization_users.id,
      organization_users.organization_id,
      organization_users.user_id,
      organization_users.access_level,
      organization_users.created_at,
      users.email,
      users.name,
      users.role,
      users.active AS user_active
    FROM organization_users
    INNER JOIN users ON users.id = organization_users.user_id
    WHERE organization_users.organization_id = ?
    ORDER BY users.email ASC`,
  )
    .bind(organizationId)
    .all();

  return results || [];
}

async function getExistingOrganizationUser(env, organizationId, userId) {
  return env.DB.prepare(
    `SELECT
      id,
      organization_id,
      user_id,
      access_level,
      created_at
     FROM organization_users
     WHERE organization_id = ?
       AND user_id = ?
     LIMIT 1`,
  )
    .bind(organizationId, userId)
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
  organizationId,
  currentOrganizationUser,
  nextAccessLevel,
) {
  if (!currentOrganizationUser) {
    return;
  }

  const currentAccessLevel = normalizeAccessLevel(
    currentOrganizationUser.access_level,
  );

  if (currentAccessLevel !== "owner" || nextAccessLevel === "owner") {
    return;
  }

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

async function assertCanAssignAccessLevel(
  env,
  request,
  user,
  accessLevel,
) {
  if (accessLevel !== "owner") {
    return;
  }

  /**
   * Atribuir owner é operação sensível.
   * Admin apenas organizacional pode gerenciar a organização, mas não deve
   * promover alguém a owner sem permissão global de painel admin.
   * Super Admin continua autorizado pela policy central.
   */
  await requireGlobalAdminPanelAccess(
    env,
    request,
    "admin.organization_users.assign_owner",
    { user },
  );
}

async function upsertOrganizationUser(env, organizationId, body) {
  const userId = normalizePositiveInteger(body?.userId || body?.user_id);
  const accessLevel = normalizeAccessLevel(
    body?.accessLevel || body?.access_level,
  );

  if (!userId) {
    return {
      error: errorResponse(
        "Informe o usuário que receberá acesso à organização.",
        400,
        "ORGANIZATION_USER_REQUIRED",
      ),
    };
  }

  if (!accessLevel) {
    return {
      error: errorResponse(
        "Informe um nível de acesso válido: viewer, editor ou owner.",
        400,
        "ORGANIZATION_USER_ACCESS_LEVEL_INVALID",
      ),
    };
  }

  const targetUser = await env.DB.prepare(
    `SELECT
      id,
      email,
      active
     FROM users
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(userId)
    .first();

  if (!targetUser) {
    return {
      error: errorResponse(
        "Usuário não encontrado.",
        404,
        "USER_NOT_FOUND",
      ),
    };
  }

  if (!targetUser.active) {
    return {
      error: errorResponse(
        "Usuário inativo não pode receber acesso à organização.",
        400,
        "USER_INACTIVE",
      ),
    };
  }

  const currentOrganizationUser = await getExistingOrganizationUser(
    env,
    organizationId,
    userId,
  );

  await assertDoesNotRemoveLastOwner(
    env,
    organizationId,
    currentOrganizationUser,
    accessLevel,
  );

  const organizationUser = await env.DB.prepare(
    `INSERT INTO organization_users (
      organization_id,
      user_id,
      access_level
    )
    VALUES (?, ?, ?)
    ON CONFLICT(organization_id, user_id) DO UPDATE SET
      access_level = excluded.access_level
    RETURNING
      id,
      organization_id,
      user_id,
      access_level,
      created_at`,
  )
    .bind(organizationId, userId, accessLevel)
    .first();

  return {
    organizationUser,
    previousAccessLevel: currentOrganizationUser?.access_level || null,
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    if (request.method !== "GET" && request.method !== "POST") {
      return methodNotAllowed(["GET", "POST"]);
    }

    const organizationId = normalizePositiveInteger(params.id);

    if (!organizationId) {
      return errorResponse(
        "ID da organização inválido.",
        400,
        "ORGANIZATION_ID_INVALID",
      );
    }

    const { user } = await requireOrganizationAdminPanelAccess(
      env,
      request,
      organizationId,
      request.method === "POST"
        ? "admin.organization_users.upsert"
        : "admin.organization_users.view",
    );

    const organization = await getOrganization(env, organizationId);

    if (!organization) {
      return errorResponse(
        "Organização não encontrada.",
        404,
        "ORGANIZATION_NOT_FOUND",
      );
    }

    if (!organization.active) {
      return errorResponse(
        "Organização inativa.",
        403,
        "ORGANIZATION_INACTIVE",
      );
    }

    if (request.method === "GET") {
      const organizationUsers = await listOrganizationUsers(
        env,
        organizationId,
      );

      return jsonResponse({
        ok: true,
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          active: Boolean(organization.active),
        },
        users: organizationUsers.map(publicOrganizationUser),
      });
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const requestedAccessLevel = normalizeAccessLevel(
        body?.accessLevel || body?.access_level,
      );

      await assertCanAssignAccessLevel(
        env,
        request,
        user,
        requestedAccessLevel,
      );

      const { organizationUser, previousAccessLevel, error } =
        await upsertOrganizationUser(env, organizationId, body);

      if (error) {
        return error;
      }

      await logAudit(env, {
        userId: user.id,
        action: "admin.organization_users.upsert",
        details: {
          organizationId,
          organizationUserId: organizationUser.id,
          targetUserId: organizationUser.user_id,
          previousAccessLevel,
          accessLevel: organizationUser.access_level,
        },
      });

      const organizationUsers = await listOrganizationUsers(
        env,
        organizationId,
      );
      const hydrated =
        organizationUsers.find((item) => item.id === organizationUser.id) ||
        organizationUser;

      return jsonResponse(
        {
          ok: true,
          organizationUser: publicOrganizationUser(hydrated),
        },
        { status: 201 },
      );
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_ORGANIZATION_USERS_ERROR",
    );
  }
}