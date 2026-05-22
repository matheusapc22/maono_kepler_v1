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
    projectCount: row.project_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listAdminUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT
      users.id,
      users.email,
      users.name,
      users.role,
      users.active,
      users.created_at,
      users.updated_at,
      COUNT(user_projects.id) AS project_count
    FROM users
    LEFT JOIN user_projects ON user_projects.user_id = users.id
    GROUP BY users.id
    ORDER BY users.active DESC, users.email ASC`
  ).all();

  return results || [];
}

async function createUser(env, body) {
  const email = normalizeEmail(body?.email);
  const name = normalizeText(body?.name);
  const role = normalizeRole(body?.role);
  const active = body?.active === false ? 0 : 1;
  const password = String(body?.password || "");

  if (!email || !email.includes("@")) {
    return { error: errorResponse("Informe um e-mail válido.", 400, "USER_EMAIL_REQUIRED") };
  }

  if (!password || password.length < 8) {
    return { error: errorResponse("Informe uma senha inicial com pelo menos 8 caracteres.", 400, "USER_PASSWORD_REQUIRED") };
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await env.DB.prepare(
      `INSERT INTO users (email, name, role, password_hash, active)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id, email, name, role, active, created_at, updated_at`
    )
      .bind(email, name || null, role, passwordHash, active)
      .first();

    return { user };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return { error: errorResponse("Já existe um usuário com este e-mail.", 409, "USER_EMAIL_EXISTS") };
    }
    throw error;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    if (request.method === "GET") {
      const users = await listAdminUsers(env);
      return jsonResponse({
        ok: true,
        users: users.map(publicAdminUser),
      });
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const { user: createdUser, error } = await createUser(env, body);

      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        action: "admin.users.create",
        details: { targetUserId: createdUser.id, email: createdUser.email, role: createdUser.role },
      });

      return jsonResponse(
        {
          ok: true,
          user: publicAdminUser({ ...createdUser, project_count: 0 }),
        },
        { status: 201 }
      );
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_USERS_ERROR");
  }
}
