import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { requirePermission } from "../../../_lib/permissions.js";
import { logAudit } from "../../../_lib/projects.js";

function normalizeAccessLevel(value) {
  const accessLevel = String(value || "viewer").trim().toLowerCase();

  return ["viewer", "editor", "owner"].includes(accessLevel)
    ? accessLevel
    : "viewer";
}

function normalizePositiveInteger(value) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function getRequestedOrganizationId(request) {
  const url = new URL(request.url);
  const rawValue =
    url.searchParams.get("organizationId") ||
    url.searchParams.get("organization_id");

  if (!rawValue) {
    return null;
  }

  return normalizePositiveInteger(rawValue);
}

async function requireAdminPanelAccess(
  env,
  request,
  {
    user,
    organizationId = null,
    projectId = null,
    action = "admin.access.view",
    resourceType,
    resourceId,
  } = {},
) {
  const scopedOrganizationId = normalizePositiveInteger(organizationId);
  const scopedProjectId = normalizePositiveInteger(projectId);

  const permissionContext = scopedOrganizationId
    ? {
        organizationId: scopedOrganizationId,
        projectId: scopedProjectId || undefined,
        scopeType: "organization",
      }
    : {
        projectId: scopedProjectId || undefined,
        scopeType: "global",
      };

  return requirePermission(
    env,
    request,
    "admin.panel.access",
    permissionContext,
    {
      user,
      resourceType:
        resourceType || (scopedOrganizationId ? "organization" : "platform"),
      resourceId:
        resourceId ||
        scopedOrganizationId ||
        scopedProjectId ||
        "admin.access",
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

async function getProjectForAccess(env, projectId) {
  return env.DB.prepare(
    `SELECT
      id,
      name,
      slug,
      organization_id,
      active
     FROM projects
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(projectId)
    .first();
}

async function listAccess(env, { organizationId = null } = {}) {
  const scopedOrganizationId = normalizePositiveInteger(organizationId);

  const sql = scopedOrganizationId
    ? `SELECT
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
        projects.organization_id AS project_organization_id,
        projects.active AS project_active
      FROM user_projects
      INNER JOIN users ON users.id = user_projects.user_id
      INNER JOIN projects ON projects.id = user_projects.project_id
      WHERE projects.organization_id = ?
      ORDER BY projects.name ASC, users.email ASC`
    : `SELECT
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
        projects.organization_id AS project_organization_id,
        projects.active AS project_active
      FROM user_projects
      INNER JOIN users ON users.id = user_projects.user_id
      INNER JOIN projects ON projects.id = user_projects.project_id
      ORDER BY projects.name ASC, users.email ASC`;

  const statement = env.DB.prepare(sql);
  const result = scopedOrganizationId
    ? await statement.bind(scopedOrganizationId).all()
    : await statement.all();

  return result.results || [];
}

async function listUsersAndProjects(env, { organizationId = null } = {}) {
  const scopedOrganizationId = normalizePositiveInteger(organizationId);

  if (scopedOrganizationId) {
    const [{ results: users }, { results: projects }] = await Promise.all([
      env.DB.prepare(
        `SELECT DISTINCT
          users.id,
          users.email,
          users.name,
          users.role,
          users.active
         FROM users
         INNER JOIN organization_users
          ON organization_users.user_id = users.id
         WHERE organization_users.organization_id = ?
         ORDER BY users.email ASC`,
      )
        .bind(scopedOrganizationId)
        .all(),
      env.DB.prepare(
        `SELECT
          id,
          name,
          slug,
          organization_id,
          active
         FROM projects
         WHERE organization_id = ?
         ORDER BY name ASC`,
      )
        .bind(scopedOrganizationId)
        .all(),
    ]);

    return {
      users: users || [],
      projects: projects || [],
    };
  }

  const [{ results: users }, { results: projects }] = await Promise.all([
    env.DB.prepare(
      `SELECT
        id,
        email,
        name,
        role,
        active
       FROM users
       ORDER BY email ASC`,
    ).all(),
    env.DB.prepare(
      `SELECT
        id,
        name,
        slug,
        organization_id,
        active
       FROM projects
       ORDER BY name ASC`,
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
      organizationId: row.project_organization_id || null,
      active: Boolean(row.project_active),
    },
  };
}

function publicLookupUser(item) {
  return {
    id: item.id,
    email: item.email,
    name: item.name,
    role: item.role,
    active: Boolean(item.active),
  };
}

function publicLookupProject(item) {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    organizationId: item.organization_id || null,
    active: Boolean(item.active),
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (request.method === "GET") {
      const organizationId = getRequestedOrganizationId(request);

      if (
        new URL(request.url).searchParams.has("organizationId") ||
        new URL(request.url).searchParams.has("organization_id")
      ) {
        if (!organizationId) {
          return errorResponse(
            "ID da organização inválido.",
            400,
            "ORGANIZATION_ID_INVALID",
          );
        }
      }

      await requireAdminPanelAccess(env, request, {
        organizationId,
        action: "admin.access.view",
        resourceType: organizationId ? "organization" : "platform",
        resourceId: organizationId || "admin.access",
      });

      const access = await listAccess(env, { organizationId });
      const lookups = await listUsersAndProjects(env, { organizationId });

      return jsonResponse({
        ok: true,
        scope: organizationId ? "organization" : "global",
        organizationId,
        access: access.map(publicAccess),
        users: lookups.users.map(publicLookupUser),
        projects: lookups.projects.map(publicLookupProject),
      });
    }

    if (request.method === "POST") {
      const sessionUser = await requireSession(env, request);
      const body = await readJsonBody(request);
      const userId = normalizePositiveInteger(body?.userId || body?.user_id);
      const projectId = normalizePositiveInteger(
        body?.projectId || body?.project_id,
      );
      const accessLevel = normalizeAccessLevel(
        body?.accessLevel || body?.access_level,
      );

      if (!userId || !projectId) {
        return errorResponse(
          "Informe usuário e projeto para criar o vínculo.",
          400,
          "ACCESS_REQUIRED_FIELDS",
        );
      }

      const project = await getProjectForAccess(env, projectId);

      if (!project) {
        return errorResponse(
          "Projeto não encontrado.",
          404,
          "PROJECT_NOT_FOUND",
        );
      }

      const organizationId = normalizePositiveInteger(project.organization_id);

      const { user } = await requireAdminPanelAccess(env, request, {
        user: sessionUser,
        organizationId,
        projectId,
        action: "admin.access.upsert",
        resourceType: organizationId ? "organization" : "project",
        resourceId: organizationId || projectId,
      });

      await env.DB.prepare(
        `INSERT INTO user_projects (user_id, project_id, access_level)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, project_id) DO UPDATE SET
           access_level = excluded.access_level`,
      )
        .bind(userId, projectId, accessLevel)
        .run();

      await logAudit(env, {
        userId: user.id,
        projectId,
        action: "admin.access.upsert",
        details: {
          targetUserId: userId,
          accessLevel,
          organizationId,
        },
      });

      return jsonResponse({ ok: true });
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_ACCESS_ERROR",
    );
  }
}