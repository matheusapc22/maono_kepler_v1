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

function normalizePositiveInteger(value) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeRole(value) {
  const role = normalizeText(value).toLowerCase();

  return ALLOWED_ROLES.has(role) ? role : null;
}

function hasOwnProperty(object, property) {
  return Object.prototype.hasOwnProperty.call(object || {}, property);
}

function isSuperAdmin(user) {
  return user?.role === "super_admin";
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getUserById(env, userId) {
  return env.DB.prepare(
    `SELECT
      id,
      email,
      name,
      role,
      active,
      created_at,
      updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(userId)
    .first();
}

function resolveNextRole(body, currentUser) {
  if (!hasOwnProperty(body, "role")) {
    return {
      role: currentUser.role,
      changed: false,
    };
  }

  const role = normalizeRole(body?.role);

  if (!role) {
    return {
      error: errorResponse(
        "Informe um papel válido: client, viewer, editor ou admin. Super Admin não pode ser atribuído por este endpoint.",
        400,
        "USER_ROLE_INVALID",
      ),
    };
  }

  return {
    role,
    changed: role !== currentUser.role,
  };
}

function assertCanUpdateUser(actingUser, targetUser, nextRole, nextActive) {
  const actingIsSuperAdmin = isSuperAdmin(actingUser);
  const isSelf = Number(actingUser?.id) === Number(targetUser?.id);
  const targetIsAdmin = targetUser?.role === "admin";
  const targetIsSuperAdmin = targetUser?.role === "super_admin";

  if (isSelf && nextActive === 0) {
    return {
      error: errorResponse(
        "Você não pode desativar o próprio usuário administrador em uso.",
        400,
        "SELF_DISABLE_BLOCKED",
      ),
    };
  }

  if (isSelf && nextRole !== targetUser.role) {
    return {
      error: errorResponse(
        "Você não pode alterar o próprio papel de acesso em uso.",
        400,
        "SELF_ROLE_CHANGE_BLOCKED",
      ),
    };
  }

  if (targetIsSuperAdmin && !actingIsSuperAdmin) {
    return {
      error: errorResponse(
        "Apenas Super Admin pode alterar dados de outro Super Admin.",
        403,
        "SUPER_ADMIN_UPDATE_RESTRICTED",
      ),
    };
  }

  if (targetIsSuperAdmin && nextRole !== targetUser.role) {
    return {
      error: errorResponse(
        "O papel Super Admin não pode ser alterado por este endpoint.",
        403,
        "SUPER_ADMIN_ROLE_CHANGE_RESTRICTED",
      ),
    };
  }

  if (targetIsAdmin && !isSelf && !actingIsSuperAdmin) {
    return {
      error: errorResponse(
        "Apenas Super Admin pode alterar outro usuário administrador.",
        403,
        "ADMIN_USER_UPDATE_RESTRICTED",
      ),
    };
  }

  if (nextRole === "admin" && targetUser.role !== "admin" && !actingIsSuperAdmin) {
    return {
      error: errorResponse(
        "Apenas Super Admin pode promover usuários para administrador.",
        403,
        "ADMIN_ROLE_ASSIGNMENT_RESTRICTED",
      ),
    };
  }

  return { ok: true };
}

function assertCanDeleteUser(actingUser, targetUser) {
  const actingIsSuperAdmin = isSuperAdmin(actingUser);
  const isSelf = Number(actingUser?.id) === Number(targetUser?.id);

  if (isSelf) {
    return {
      error: errorResponse(
        "Você não pode excluir o próprio usuário administrador em uso.",
        400,
        "SELF_DELETE_BLOCKED",
      ),
    };
  }

  if (targetUser?.role === "super_admin") {
    return {
      error: errorResponse(
        "Super Admin não pode ser excluído por este endpoint.",
        403,
        "SUPER_ADMIN_DELETE_RESTRICTED",
      ),
    };
  }

  if (targetUser?.role === "admin" && !actingIsSuperAdmin) {
    return {
      error: errorResponse(
        "Apenas Super Admin pode excluir outro usuário administrador.",
        403,
        "ADMIN_USER_DELETE_RESTRICTED",
      ),
    };
  }

  return { ok: true };
}

async function updateUser(env, targetUserId, body, actingUser) {
  const current = await getUserById(env, targetUserId);

  if (!current) {
    return {
      error: errorResponse(
        "Usuário não encontrado.",
        404,
        "USER_NOT_FOUND",
      ),
    };
  }

  const email = normalizeEmail(body?.email ?? current.email);
  const name = normalizeText(body?.name ?? current.name);
  const resolvedRole = resolveNextRole(body, current);

  if (resolvedRole.error) {
    return resolvedRole;
  }

  const role = resolvedRole.role;
  const active =
    body?.active === false
      ? 0
      : body?.active === true
        ? 1
        : Number(current.active || 0);
  const password = body?.password ? String(body.password) : "";
  const passwordChanged = Boolean(password);

  if (!email || !email.includes("@")) {
    return {
      error: errorResponse(
        "Informe um e-mail válido.",
        400,
        "USER_EMAIL_REQUIRED",
      ),
    };
  }

  if (password && password.length < 8) {
    return {
      error: errorResponse(
        "A nova senha precisa ter pelo menos 8 caracteres.",
        400,
        "USER_PASSWORD_INVALID",
      ),
    };
  }

  const policy = assertCanUpdateUser(actingUser, current, role, active);

  if (policy.error) {
    return policy;
  }

  try {
    let updated = null;

    if (passwordChanged) {
      const passwordHash = await hashPassword(password);

      updated = await env.DB.prepare(
        `UPDATE users
         SET
          email = ?,
          name = ?,
          role = ?,
          active = ?,
          password_hash = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
         RETURNING
          id,
          email,
          name,
          role,
          active,
          created_at,
          updated_at`,
      )
        .bind(email, name || null, role, active, passwordHash, targetUserId)
        .first();
    } else {
      updated = await env.DB.prepare(
        `UPDATE users
         SET
          email = ?,
          name = ?,
          role = ?,
          active = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
         RETURNING
          id,
          email,
          name,
          role,
          active,
          created_at,
          updated_at`,
      )
        .bind(email, name || null, role, active, targetUserId)
        .first();
    }

    return {
      user: updated,
      previousUser: current,
      passwordChanged,
    };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return {
        error: errorResponse(
          "Já existe outro usuário com este e-mail.",
          409,
          "USER_EMAIL_EXISTS",
        ),
      };
    }

    throw error;
  }
}

async function deleteUser(env, targetUserId, actingUser) {
  const current = await getUserById(env, targetUserId);

  if (!current) {
    return {
      error: errorResponse(
        "Usuário não encontrado.",
        404,
        "USER_NOT_FOUND",
      ),
    };
  }

  const policy = assertCanDeleteUser(actingUser, current);

  if (policy.error) {
    return policy;
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(
      targetUserId,
    ),
    env.DB.prepare(`DELETE FROM user_projects WHERE user_id = ?`).bind(
      targetUserId,
    ),
    env.DB.prepare(`DELETE FROM organization_users WHERE user_id = ?`).bind(
      targetUserId,
    ),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(targetUserId),
  ]);

  return { user: current };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    if (
      request.method !== "GET" &&
      request.method !== "PUT" &&
      request.method !== "PATCH" &&
      request.method !== "DELETE"
    ) {
      return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]);
    }

    const targetUserId = normalizePositiveInteger(params.id);

    if (!targetUserId) {
      return errorResponse(
        "ID do usuário inválido.",
        400,
        "USER_ID_INVALID",
      );
    }

    if (request.method === "GET") {
      await requireGlobalAdminPanelAccess(env, request, "admin.users.view");

      const targetUser = await getUserById(env, targetUserId);

      if (!targetUser) {
        return errorResponse(
          "Usuário não encontrado.",
          404,
          "USER_NOT_FOUND",
        );
      }

      return jsonResponse({
        ok: true,
        user: publicAdminUser(targetUser),
      });
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      const { user } = await requireGlobalAdminPanelAccess(
        env,
        request,
        "admin.users.update",
      );

      const body = await readJsonBody(request);
      const {
        user: updatedUser,
        previousUser,
        passwordChanged,
        error,
      } = await updateUser(env, targetUserId, body || {}, user);

      if (error) {
        return error;
      }

      await logAudit(env, {
        userId: user.id,
        action: "admin.users.update",
        details: {
          targetUserId,
          email: updatedUser.email,
          previousRole: previousUser.role,
          role: updatedUser.role,
          previousActive: Boolean(previousUser.active),
          active: Boolean(updatedUser.active),
          passwordChanged,
        },
      });

      return jsonResponse({
        ok: true,
        user: publicAdminUser(updatedUser),
      });
    }

    if (request.method === "DELETE") {
      const { user } = await requireGlobalAdminPanelAccess(
        env,
        request,
        "admin.users.delete",
      );

      const { user: deletedUser, error } = await deleteUser(
        env,
        targetUserId,
        user,
      );

      if (error) {
        return error;
      }

      await logAudit(env, {
        userId: user.id,
        action: "admin.users.delete",
        details: {
          targetUserId,
          email: deletedUser.email,
          role: deletedUser.role,
          active: Boolean(deletedUser.active),
        },
      });

      return jsonResponse({ ok: true });
    }

    return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]);
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_USER_ERROR",
    );
  }
}