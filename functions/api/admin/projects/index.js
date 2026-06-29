import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { requirePermission } from "../../../_lib/permissions.js";
import { logAudit } from "../../../_lib/projects.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePositiveInteger(value) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeDropboxPath(value) {
  return normalizeText(value).replace(/\/+$/g, "");
}

function isDropboxPathInsideOrganizationRoot(projectPath, organizationRootPath) {
  const normalizedProjectPath = normalizeDropboxPath(projectPath).toLowerCase();
  const normalizedOrganizationRootPath = normalizeDropboxPath(
    organizationRootPath,
  ).toLowerCase();

  if (!normalizedProjectPath || !normalizedOrganizationRootPath) {
    return false;
  }

  return (
    normalizedProjectPath === normalizedOrganizationRootPath ||
    normalizedProjectPath.startsWith(`${normalizedOrganizationRootPath}/`)
  );
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
    action = "admin.projects.view",
  } = {},
) {
  const scopedOrganizationId = normalizePositiveInteger(organizationId);

  return requirePermission(
    env,
    request,
    "admin.panel.access",
    scopedOrganizationId
      ? {
          organizationId: scopedOrganizationId,
          scopeType: "organization",
        }
      : {
          scopeType: "global",
        },
    {
      user,
      resourceType: scopedOrganizationId ? "organization" : "platform",
      resourceId: scopedOrganizationId || "admin.projects",
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

function publicAdminProject(project) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    organizationId: project.organization_id || null,
    organization: project.organization_id
      ? {
          id: project.organization_id,
          name: project.organization_name,
          slug: project.organization_slug,
        }
      : null,
    dropboxRootPath: project.dropbox_root_path,
    defaultConfigFile: project.default_config_file,
    active: Boolean(project.active),
    accessCount: project.access_count || 0,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

async function getOrganization(env, organizationId) {
  return env.DB.prepare(
    `SELECT
      id,
      name,
      slug,
      dropbox_root_path,
      active
     FROM organizations
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(organizationId)
    .first();
}

async function listAdminProjects(env, { organizationId = null } = {}) {
  const scopedOrganizationId = normalizePositiveInteger(organizationId);

  const sql = scopedOrganizationId
    ? `SELECT
        projects.id,
        projects.name,
        projects.slug,
        projects.description,
        projects.dropbox_root_path,
        projects.default_config_file,
        projects.organization_id,
        organizations.name AS organization_name,
        organizations.slug AS organization_slug,
        projects.active,
        projects.created_at,
        projects.updated_at,
        COUNT(user_projects.id) AS access_count
      FROM projects
      LEFT JOIN organizations ON organizations.id = projects.organization_id
      LEFT JOIN user_projects ON user_projects.project_id = projects.id
      WHERE projects.organization_id = ?
      GROUP BY projects.id
      ORDER BY projects.updated_at DESC, projects.name ASC`
    : `SELECT
        projects.id,
        projects.name,
        projects.slug,
        projects.description,
        projects.dropbox_root_path,
        projects.default_config_file,
        projects.organization_id,
        organizations.name AS organization_name,
        organizations.slug AS organization_slug,
        projects.active,
        projects.created_at,
        projects.updated_at,
        COUNT(user_projects.id) AS access_count
      FROM projects
      LEFT JOIN organizations ON organizations.id = projects.organization_id
      LEFT JOIN user_projects ON user_projects.project_id = projects.id
      GROUP BY projects.id
      ORDER BY projects.updated_at DESC, projects.name ASC`;

  const statement = env.DB.prepare(sql);
  const result = scopedOrganizationId
    ? await statement.bind(scopedOrganizationId).all()
    : await statement.all();

  return result.results || [];
}

async function createProject(env, body, organization) {
  const organizationId = normalizePositiveInteger(organization?.id);
  const name = normalizeText(body?.name);
  const slug = normalizeSlug(body?.slug || body?.name);
  const description = normalizeText(body?.description);
  const requestedDropboxRootPath = normalizeText(
    body?.dropboxRootPath || body?.dropbox_root_path,
  );
  const dropboxRootPath = normalizeDropboxPath(
    requestedDropboxRootPath || organization?.dropbox_root_path,
  );
  const defaultConfigFile = normalizeText(
    body?.defaultConfigFile ||
      body?.default_config_file ||
      "config.kepler.json",
  );
  const active = body?.active === false ? 0 : 1;

  if (!organizationId) {
    return {
      error: errorResponse(
        "Informe a organização do projeto.",
        400,
        "PROJECT_ORGANIZATION_REQUIRED",
      ),
    };
  }

  if (!name) {
    return {
      error: errorResponse(
        "Informe o nome do projeto.",
        400,
        "PROJECT_NAME_REQUIRED",
      ),
    };
  }

  if (!slug) {
    return {
      error: errorResponse(
        "Informe um slug válido para o projeto.",
        400,
        "PROJECT_SLUG_REQUIRED",
      ),
    };
  }

  if (!dropboxRootPath.startsWith("/")) {
    return {
      error: errorResponse(
        "A pasta Dropbox deve começar com /. Exemplo: /projects/cliente-a.",
        400,
        "PROJECT_PATH_INVALID",
      ),
    };
  }

  if (
    !isDropboxPathInsideOrganizationRoot(
      dropboxRootPath,
      organization.dropbox_root_path,
    )
  ) {
    return {
      error: errorResponse(
        "A pasta Dropbox do projeto precisa ficar dentro da pasta da organização.",
        400,
        "PROJECT_PATH_OUTSIDE_ORGANIZATION",
      ),
    };
  }

  if (!defaultConfigFile) {
    return {
      error: errorResponse(
        "Informe o arquivo JSON principal do projeto.",
        400,
        "PROJECT_FILE_REQUIRED",
      ),
    };
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO projects (
        name,
        slug,
        description,
        dropbox_root_path,
        default_config_file,
        organization_id,
        active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *`,
    )
      .bind(
        name,
        slug,
        description || null,
        dropboxRootPath,
        defaultConfigFile,
        organizationId,
        active,
      )
      .first();

    return {
      project: {
        ...result,
        organization_name: organization.name,
        organization_slug: organization.slug,
      },
    };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return {
        error: errorResponse(
          "Já existe um projeto com este slug.",
          409,
          "PROJECT_SLUG_EXISTS",
        ),
      };
    }

    throw error;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const hasOrganizationFilter =
        url.searchParams.has("organizationId") ||
        url.searchParams.has("organization_id");
      const organizationId = getRequestedOrganizationId(request);

      if (hasOrganizationFilter && !organizationId) {
        return errorResponse(
          "ID da organização inválido.",
          400,
          "ORGANIZATION_ID_INVALID",
        );
      }

      await requireAdminPanelAccess(env, request, {
        organizationId,
        action: organizationId
          ? "admin.projects.organization_view"
          : "admin.projects.global_view",
      });

      const projects = await listAdminProjects(env, { organizationId });

      return jsonResponse({
        ok: true,
        scope: organizationId ? "organization" : "global",
        organizationId,
        projects: projects.map(publicAdminProject),
      });
    }

    if (request.method === "POST") {
      const sessionUser = await requireSession(env, request);
      const body = await readJsonBody(request);
      const organizationId = normalizePositiveInteger(
        body?.organizationId || body?.organization_id,
      );

      if (!organizationId) {
        return errorResponse(
          "Informe a organização do projeto.",
          400,
          "PROJECT_ORGANIZATION_REQUIRED",
        );
      }

      const { user } = await requireAdminPanelAccess(env, request, {
        user: sessionUser,
        organizationId,
        action: "admin.projects.create",
      });

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

      const { project, error } = await createProject(
        env,
        body,
        organization,
      );

      if (error) {
        return error;
      }

      await logAudit(env, {
        userId: user.id,
        projectId: project.id,
        action: "admin.projects.create",
        details: {
          organizationId,
          slug: project.slug,
          active: Boolean(project.active),
        },
      });

      return jsonResponse(
        {
          ok: true,
          project: publicAdminProject({
            ...project,
            access_count: 0,
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
      error.code || "ADMIN_PROJECTS_ERROR",
    );
  }
}