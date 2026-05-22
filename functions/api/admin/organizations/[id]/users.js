import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../../_lib/http.js";
import { requireSession } from "../../../../_lib/auth.js";
import { logAudit } from "../../../../_lib/projects.js";

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
  return await env.DB.prepare(
    `SELECT id, name, slug, dropbox_root_path, active
     FROM organizations
     WHERE id = ?
     LIMIT 1`
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
    ORDER BY users.email ASC`
  )
    .bind(organizationId)
    .all();

  return results || [];
}

async function upsertOrganizationUser(env, organizationId, body) {
  const userId = Number(body?.userId || body?.user_id);
  const accessLevel = normalizeAccessLevel(body?.accessLevel || body?.access_level);

  if (!userId) {
    return { error: errorResponse("Informe o usuário que receberá acesso à organização.", 400, "ORGANIZATION_USER_REQUIRED") };
  }

  const targetUser = await env.DB.prepare(
    `SELECT id, email, active FROM users WHERE id = ? LIMIT 1`
  )
    .bind(userId)
    .first();

  if (!targetUser) {
    return { error: errorResponse("Usuário não encontrado.", 404, "USER_NOT_FOUND") };
  }

  if (!targetUser.active) {
    return { error: errorResponse("Usuário inativo não pode receber acesso à organização.", 400, "USER_INACTIVE") };
  }

  const organizationUser = await env.DB.prepare(
    `INSERT INTO organization_users (organization_id, user_id, access_level)
     VALUES (?, ?, ?)
     ON CONFLICT(organization_id, user_id) DO UPDATE SET
       access_level = excluded.access_level
     RETURNING id, organization_id, user_id, access_level, created_at`
  )
    .bind(organizationId, userId, accessLevel)
    .first();

  return { organizationUser };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    const organizationId = Number(params.id);
    if (!organizationId) {
      return errorResponse("ID da organização inválido.", 400, "ORGANIZATION_ID_INVALID");
    }

    const organization = await getOrganization(env, organizationId);
    if (!organization) {
      return errorResponse("Organização não encontrada.", 404, "ORGANIZATION_NOT_FOUND");
    }

    if (request.method === "GET") {
      const organizationUsers = await listOrganizationUsers(env, organizationId);
      return jsonResponse({
        ok: true,
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          dropboxRootPath: organization.dropbox_root_path,
          active: Boolean(organization.active),
        },
        users: organizationUsers.map(publicOrganizationUser),
      });
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const { organizationUser, error } = await upsertOrganizationUser(env, organizationId, body);
      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        action: "admin.organization_users.upsert",
        details: {
          organizationId,
          organizationUserId: organizationUser.id,
          targetUserId: organizationUser.user_id,
          accessLevel: organizationUser.access_level,
        },
      });

      const organizationUsers = await listOrganizationUsers(env, organizationId);
      const hydrated = organizationUsers.find((item) => item.id === organizationUser.id) || organizationUser;

      return jsonResponse({ ok: true, organizationUser: publicOrganizationUser(hydrated) }, { status: 201 });
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_ORGANIZATION_USERS_ERROR");
  }
}
