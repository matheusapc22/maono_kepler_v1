import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { hashPassword, normalizeEmail, requireSession } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/projects.js";

const ALLOWED_ROLES = new Set(["admin", "client", "viewer", "editor"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeRole(value) {
  const role = normalizeText(value || "client").toLowerCase();
  return ALLOWED_ROLES.has(role) ? role : "client";
}

function requireAdmin(user) {
  if (user?.role !== "admin") {
    const error = new Error("Apenas administradores podem acessar este recurso.");
    error.status = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
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
  return await env.DB.prepare(
    `SELECT id, email, name, role, active, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`
  )
    .bind(userId)
    .first();
}

async function updateUser(env, targetUserId, body, currentAdmin) {
  const current = await getUserById(env, targetUserId);

  if (!current) {
    return { error: errorResponse("Usuário não encontrado.", 404, "USER_NOT_FOUND") };
  }

  const email = normalizeEmail(body?.email ?? current.email);
  const name = normalizeText(body?.name ?? current.name);
  const role = normalizeRole(body?.role ?? current.role);
  const active = body?.active === false ? 0 : body?.active === true ? 1 : Number(current.active || 0);
  const password = body?.password ? String(body.password) : "";

  if (!email || !email.includes("@")) {
    return { error: errorResponse("Informe um e-mail válido.", 400, "USER_EMAIL_REQUIRED") };
  }

  if (password && password.length < 8) {
    return { error: errorResponse("A nova senha precisa ter pelo menos 8 caracteres.", 400, "USER_PASSWORD_INVALID") };
  }

  if (targetUserId === currentAdmin.id && active === 0) {
    return { error: errorResponse("Você não pode desativar o próprio usuário administrador em uso.", 400, "SELF_DISABLE_BLOCKED") };
  }

  if (targetUserId === currentAdmin.id && role !== "admin") {
    return { error: errorResponse("Você não pode remover sua própria permissão de administrador.", 400, "SELF_ROLE_CHANGE_BLOCKED") };
  }

  try {
    let updated = null;

    if (password) {
      const passwordHash = await hashPassword(password);
      updated = await env.DB.prepare(
        `UPDATE users
         SET email = ?, name = ?, role = ?, active = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
         RETURNING id, email, name, role, active, created_at, updated_at`
      )
        .bind(email, name || null, role, active, passwordHash, targetUserId)
        .first();
    } else {
      updated = await env.DB.prepare(
        `UPDATE users
         SET email = ?, name = ?, role = ?, active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
         RETURNING id, email, name, role, active, created_at, updated_at`
      )
        .bind(email, name || null, role, active, targetUserId)
        .first();
    }

    return { user: updated };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return { error: errorResponse("Já existe outro usuário com este e-mail.", 409, "USER_EMAIL_EXISTS") };
    }
    throw error;
  }
}

async function deleteUser(env, targetUserId, currentAdmin) {
  const current = await getUserById(env, targetUserId);

  if (!current) {
    return { error: errorResponse("Usuário não encontrado.", 404, "USER_NOT_FOUND") };
  }

  if (targetUserId === currentAdmin.id) {
    return { error: errorResponse("Você não pode excluir o próprio usuário administrador em uso.", 400, "SELF_DELETE_BLOCKED") };
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(targetUserId),
    env.DB.prepare(`DELETE FROM user_projects WHERE user_id = ?`).bind(targetUserId),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(targetUserId),
  ]);

  return { user: current };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    const targetUserId = Number(params.id);

    if (!targetUserId) {
      return errorResponse("ID do usuário inválido.", 400, "USER_ID_INVALID");
    }

    if (request.method === "GET") {
      const targetUser = await getUserById(env, targetUserId);

      if (!targetUser) {
        return errorResponse("Usuário não encontrado.", 404, "USER_NOT_FOUND");
      }

      return jsonResponse({ ok: true, user: publicAdminUser(targetUser) });
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      const body = await readJsonBody(request);
      const { user: updatedUser, error } = await updateUser(env, targetUserId, body, user);

      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        action: "admin.users.update",
        details: { targetUserId, email: updatedUser.email, role: updatedUser.role, active: Boolean(updatedUser.active), passwordChanged: Boolean(body?.password) },
      });

      return jsonResponse({ ok: true, user: publicAdminUser(updatedUser) });
    }

    if (request.method === "DELETE") {
      const { user: deletedUser, error } = await deleteUser(env, targetUserId, user);

      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        action: "admin.users.delete",
        details: { targetUserId, email: deletedUser.email },
      });

      return jsonResponse({ ok: true });
    }

    return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]);
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_USER_ERROR");
  }
}
