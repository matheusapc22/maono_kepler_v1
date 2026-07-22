import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { hashPassword, normalizeEmail } from "../../../_lib/auth.js";
import { requirePermission } from "../../../_lib/permissions.js";
import { logAudit } from "../../../_lib/projects.js";

const ALLOWED_ROLES = new Set(["admin", "client", "viewer", "editor"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeRole(value) {
  const role = normalizeText(value || "client").toLowerCase();

  return ALLOWED_ROLES.has(role) ? role : null;
}

async function requireGlobalAdminPanelAccess(env, request, action) {
  return requirePermission(
    env,
    request,
    "admin.panel.access",
    {
      scopeType: "global",
    },
    {
      resourceType: "platform",
      resourceId: "admin.users",
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

function publicAdminUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: Boolean(row.active),
    projectCount: row.project_count || 0,
    organizations: Array.isArray(row.organizations) ? row.organizations : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listAdminUsers(env) {
  const [usersResult, membershipsResult] = await Promise.all([
    env.DB.prepare(
      `SELECT
        users.id,
        users.email,
        users.name,
        users.role,
        users.active,
        users.created_at,
        users.updated_at,
        COUNT(DISTINCT user_projects.id) AS project_count
      FROM users
      LEFT JOIN user_projects ON user_projects.user_id = users.id
      GROUP BY users.id
      ORDER BY users.active DESC, users.email ASC`,
    ).all(),
    env.DB.prepare(
      `SELECT
        organization_users.user_id,
        organizations.id AS organization_id,
        organizations.name AS organization_name,
        organizations.slug AS organization_slug,
        organizations.active AS organization_active,
        organization_users.access_level
      FROM organization_users
      INNER JOIN organizations
        ON organizations.id = organization_users.organization_id
      ORDER BY organizations.name ASC`,
    ).all(),
  ]);

  const organizationsByUser = new Map();

  for (const membership of membershipsResult.results || []) {
    const userOrganizations = organizationsByUser.get(membership.user_id) || [];
    userOrganizations.push({
      id: membership.organization_id,
      name: membership.organization_name,
      slug: membership.organization_slug,
      active: Boolean(membership.organization_active),
      accessLevel: membership.access_level,
    });
    organizationsByUser.set(membership.user_id, userOrganizations);
  }

  return (usersResult.results || []).map((user) => ({
    ...user,
    organizations: organizationsByUser.get(user.id) || [],
  }));
}

function validateRoleCreationPermission(actingUser, role) {
  if (role === "admin" && actingUser?.role !== "super_admin") {
    return {
      error: errorResponse(
        "Apenas Super Admin pode criar usuários administradores.",
        403,
        "ADMIN_ROLE_CREATION_RESTRICTED",
      ),
    };
  }

  return { ok: true };
}

async function createUser(env, body, actingUser) {
  const email = normalizeEmail(body?.email);
  const name = normalizeText(body?.name);
  const role = normalizeRole(body?.role);
  const active = body?.active === false ? 0 : 1;
  const password = String(body?.password || "");

  if (!role) {
    return {
      error: errorResponse(
        "Informe um papel válido: client, viewer, editor ou admin. Super Admin não pode ser criado por este endpoint.",
        400,
        "USER_ROLE_INVALID",
      ),
    };
  }

  const rolePermission = validateRoleCreationPermission(actingUser, role);

  if (rolePermission.error) {
    return rolePermission;
  }

  if (!email || !email.includes("@")) {
    return {
      error: errorResponse(
        "Informe um e-mail válido.",
        400,
        "USER_EMAIL_REQUIRED",
      ),
    };
  }

  if (!password || password.length < 8) {
    return {
      error: errorResponse(
        "Informe uma senha inicial com pelo menos 8 caracteres.",
        400,
        "USER_PASSWORD_REQUIRED",
      ),
    };
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await env.DB.prepare(
      `INSERT INTO users (
        email,
        name,
        role,
        password_hash,
        active
      )
      VALUES (?, ?, ?, ?, ?)
      RETURNING
        id,
        email,
        name,
        role,
        active,
        created_at,
        updated_at`,
    )
      .bind(email, name || null, role, passwordHash, active)
      .first();

    return { user };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return {
        error: errorResponse(
          "Já existe um usuário com este e-mail.",
          409,
          "USER_EMAIL_EXISTS",
        ),
      };
    }

    throw error;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (request.method !== "GET" && request.method !== "POST") {
      return methodNotAllowed(["GET", "POST"]);
    }

    if (request.method === "GET") {
      await requireGlobalAdminPanelAccess(
        env,
        request,
        "admin.users.view",
      );

      const users = await listAdminUsers(env);

      return jsonResponse({
        ok: true,
        scope: "global",
        users: users.map(publicAdminUser),
      });
    }

    if (request.method === "POST") {
      const { user } = await requireGlobalAdminPanelAccess(
        env,
        request,
        "admin.users.create",
      );

      const body = await readJsonBody(request);
      const { user: createdUser, error } = await createUser(
        env,
        body,
        user,
      );

      if (error) {
        return error;
      }

      await logAudit(env, {
        userId: user.id,
        action: "admin.users.create",
        details: {
          targetUserId: createdUser.id,
          email: createdUser.email,
          role: createdUser.role,
          active: Boolean(createdUser.active),
        },
      });

      return jsonResponse(
        {
          ok: true,
          user: publicAdminUser({
            ...createdUser,
            project_count: 0,
            organizations: [],
          }),
        },
        { status: 201 },
      );
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_USERS_ERROR",
    );
  }
}
