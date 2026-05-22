import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/projects.js";

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
  return ["viewer", "editor", "owner"].includes(accessLevel)
    ? accessLevel
    : "viewer";
}

async function listAccess(env) {
  const { results } = await env.DB.prepare(
    `SELECT
      user_projects.id,
      user_projects.access_level,
      user_projects.created_at,
      users.id AS user_id,
      users.email AS user_email,
      users.name AS user_name,
      users.role AS user_role,
      users.active AS user_active,
      projects.id AS project_id,
      projects.name AS project_name,
      projects.slug AS project_slug,
      projects.active AS project_active
    FROM user_projects
    INNER JOIN users ON users.id = user_projects.user_id
    INNER JOIN projects ON projects.id = user_projects.project_id
    ORDER BY projects.name ASC, users.email ASC`
  ).all();

  return results || [];
}

async function listUsersAndProjects(env) {
  const [{ results: users }, { results: projects }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, email, name, role, active
       FROM users
       ORDER BY email ASC`
    ).all(),
    env.DB.prepare(
      `SELECT id, name, slug, active
       FROM projects
       ORDER BY name ASC`
    ).all(),
  ]);

  return {
    users: users || [],
    projects: projects || [],
  };
}

function publicAccess(row) {
  return {
    id: row.id,
    accessLevel: row.access_level,
    createdAt: row.created_at,
    user: {
      id: row.user_id,
      email: row.user_email,
      name: row.user_name,
      role: row.user_role,
      active: Boolean(row.user_active),
    },
    project: {
      id: row.project_id,
      name: row.project_name,
      slug: row.project_slug,
      active: Boolean(row.project_active),
    },
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    if (request.method === "GET") {
      const access = await listAccess(env);
      const lookups = await listUsersAndProjects(env);

      return jsonResponse({
        ok: true,
        access: access.map(publicAccess),
        users: lookups.users.map((item) => ({
          id: item.id,
          email: item.email,
          name: item.name,
          role: item.role,
          active: Boolean(item.active),
        })),
        projects: lookups.projects.map((item) => ({
          id: item.id,
          name: item.name,
          slug: item.slug,
          active: Boolean(item.active),
        })),
      });
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const userId = Number(body?.userId || body?.user_id);
      const projectId = Number(body?.projectId || body?.project_id);
      const accessLevel = normalizeAccessLevel(body?.accessLevel || body?.access_level);

      if (!userId || !projectId) {
        return errorResponse("Informe usuário e projeto para criar o vínculo.", 400, "ACCESS_REQUIRED_FIELDS");
      }

      await env.DB.prepare(
        `INSERT INTO user_projects (user_id, project_id, access_level)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, project_id) DO UPDATE SET
           access_level = excluded.access_level`
      )
        .bind(userId, projectId, accessLevel)
        .run();

      await logAudit(env, {
        userId: user.id,
        projectId,
        action: "admin.access.upsert",
        details: { targetUserId: userId, accessLevel },
      });

      return jsonResponse({ ok: true });
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_ACCESS_ERROR");
  }
}
