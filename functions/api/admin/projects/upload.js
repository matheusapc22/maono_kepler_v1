import { errorResponse, jsonResponse, methodNotAllowed } from "../../../_lib/http.js";
import { requirePermission } from "../../../_lib/permissions.js";
import { logAudit } from "../../../_lib/projects.js";
import { uploadDropboxTextFile } from "../../../_lib/dropbox.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePositiveInteger(value) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeDropboxPath(value) {
  const clean = normalizeText(value).replace(/\/+$/g, "");

  return clean || "/";
}

function joinDropboxPath(rootPath, childPath) {
  const root = normalizeDropboxPath(rootPath);
  const child = normalizeText(childPath).replace(/^\/+/g, "");

  if (!child) {
    return root;
  }

  return `${root}/${child}`.replace(/\/{2,}/g, "/");
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

function hasOrganizationQueryParam(request) {
  const url = new URL(request.url);

  return (
    url.searchParams.has("organizationId") ||
    url.searchParams.has("organization_id")
  );
}

async function requireAdminPanelAccess(
  env,
  request,
  {
    organizationId = null,
    action = "admin.projects.upload_create",
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
      resourceType: scopedOrganizationId ? "organization" : "platform",
      resourceId: scopedOrganizationId || "admin.projects.upload",
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
    dropboxRootPath: project.dropbox_root_path,
    defaultConfigFile: project.default_config_file,
    organizationId: project.organization_id || null,
    organization: project.organization_id
      ? {
          id: project.organization_id,
          name: project.organization_name,
          slug: project.organization_slug,
        }
      : null,
    active: Boolean(project.active),
    accessCount: 0,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

async function getOrganizationById(env, organizationId) {
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

async function findOrganizationByDropboxPath(env, dropboxRootPath) {
  const normalizedPath = normalizeDropboxPath(dropboxRootPath);

  if (!normalizedPath || normalizedPath === "/") {
    return null;
  }

  return env.DB.prepare(
    `SELECT
      id,
      name,
      slug,
      dropbox_root_path,
      active
     FROM organizations
     WHERE ? = dropbox_root_path
        OR ? LIKE dropbox_root_path || '/%'
     ORDER BY LENGTH(dropbox_root_path) DESC
     LIMIT 1`,
  )
    .bind(normalizedPath, normalizedPath)
    .first();
}

function validateKeplerJsonText(text) {
  let parsed = null;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      valid: false,
      message: `O arquivo enviado não é um JSON válido: ${error.message}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      valid: false,
      message: "O JSON precisa ter um objeto na raiz.",
    };
  }

  if (!Array.isArray(parsed.datasets)) {
    return {
      valid: false,
      message: "O JSON precisa conter a propriedade datasets como lista.",
    };
  }

  const rawConfig = parsed.config;
  const normalizedConfig =
    rawConfig?.config && typeof rawConfig.config === "object"
      ? rawConfig.config
      : rawConfig;

  if (
    !normalizedConfig ||
    typeof normalizedConfig !== "object" ||
    Array.isArray(normalizedConfig)
  ) {
    return {
      valid: false,
      message: "O JSON precisa conter a propriedade config.",
    };
  }

  const requiredSections = ["visState", "mapState", "mapStyle"];
  const missing = requiredSections.filter(
    (section) =>
      !normalizedConfig[section] ||
      typeof normalizedConfig[section] !== "object",
  );

  if (missing.length) {
    return {
      valid: false,
      message: `Estrutura Kepler incompleta. Seções ausentes: ${missing.join(", ")}.`,
    };
  }

  return { valid: true };
}

async function createProject(env, data) {
  const {
    name,
    slug,
    description,
    dropboxRootPath,
    fileName,
    active,
    organization,
  } = data;

  try {
    const project = await env.DB.prepare(
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
        fileName,
        organization?.id || null,
        active,
      )
      .first();

    return {
      project: {
        ...project,
        organization_name: organization?.name || null,
        organization_slug: organization?.slug || null,
      },
    };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return errorResponse(
        "Já existe um projeto com este identificador.",
        409,
        "PROJECT_SLUG_EXISTS",
      );
    }

    throw error;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    const queryHasOrganization = hasOrganizationQueryParam(request);
    const queryOrganizationId = getRequestedOrganizationId(request);

    if (queryHasOrganization && !queryOrganizationId) {
      return errorResponse(
        "ID da organização inválido.",
        400,
        "ORGANIZATION_ID_INVALID",
      );
    }

    /**
     * Autorização antes de request.formData().
     *
     * Para Admin organizacional, a chamada deve enviar:
     * /api/admin/projects/upload?organizationId=ID
     *
     * Sem organizationId na query, o endpoint exige permissão global antes de
     * processar o multipart.
     */
    const { user } = await requireAdminPanelAccess(env, request, {
      organizationId: queryOrganizationId,
      action: "admin.projects.upload_create",
    });

    const form = await request.formData();
    const file = form.get("file");
    const name = normalizeText(form.get("name"));
    const slug = normalizeSlug(form.get("slug") || name);
    const description = normalizeText(form.get("description"));
    const active = String(form.get("active") || "true") !== "false" ? 1 : 0;
    const requestedRootPath = normalizeText(form.get("dropboxRootPath"));
    const requestedFileName = normalizeText(form.get("defaultConfigFile"));
    const formOrganizationId = normalizePositiveInteger(
      form.get("organizationId") || form.get("organization_id"),
    );
    const formHasOrganization =
      form.has("organizationId") || form.has("organization_id");

    if (formHasOrganization && !formOrganizationId) {
      return errorResponse(
        "ID da organização inválido.",
        400,
        "ORGANIZATION_ID_INVALID",
      );
    }

    if (
      queryOrganizationId &&
      formOrganizationId &&
      queryOrganizationId !== formOrganizationId
    ) {
      return errorResponse(
        "A organização informada na query não confere com a organização enviada no formulário.",
        400,
        "PROJECT_ORGANIZATION_MISMATCH",
      );
    }

    if (!name) {
      return errorResponse(
        "Informe o nome do projeto.",
        400,
        "PROJECT_NAME_REQUIRED",
      );
    }

    if (!slug) {
      return errorResponse(
        "Informe um identificador válido para o projeto.",
        400,
        "PROJECT_SLUG_REQUIRED",
      );
    }

    if (!file || typeof file.text !== "function") {
      return errorResponse(
        "Envie um arquivo JSON do Kepler.",
        400,
        "PROJECT_UPLOAD_FILE_REQUIRED",
      );
    }

    const fileName = requestedFileName || file.name || "config.kepler.json";

    if (!fileName.toLowerCase().endsWith(".json")) {
      return errorResponse(
        "O arquivo enviado precisa ser .json.",
        400,
        "PROJECT_UPLOAD_JSON_REQUIRED",
      );
    }

    let organization = null;
    const organizationId = queryOrganizationId || formOrganizationId;

    if (organizationId) {
      organization = await getOrganizationById(env, organizationId);

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
    }

    let dropboxRootPath = requestedRootPath
      ? normalizeDropboxPath(requestedRootPath)
      : organization
        ? joinDropboxPath(organization.dropbox_root_path, slug)
        : `/projects/${slug}`;

    if (!dropboxRootPath.startsWith("/")) {
      return errorResponse(
        "A pasta Dropbox deve começar com /. Exemplo: /projects/cliente-a.",
        400,
        "PROJECT_PATH_INVALID",
      );
    }

    if (!organization && requestedRootPath) {
      organization = await findOrganizationByDropboxPath(env, dropboxRootPath);

      if (organization && !organization.active) {
        return errorResponse(
          "Organização inativa.",
          403,
          "ORGANIZATION_INACTIVE",
        );
      }
    }

    if (
      organization &&
      !isDropboxPathInsideOrganizationRoot(
        dropboxRootPath,
        organization.dropbox_root_path,
      )
    ) {
      return errorResponse(
        "A pasta Dropbox do projeto precisa ficar dentro da pasta da organização.",
        400,
        "PROJECT_PATH_OUTSIDE_ORGANIZATION",
      );
    }

    if (!organization && !dropboxRootPath.startsWith("/projects/")) {
      return errorResponse(
        "A pasta Dropbox de projeto legado precisa ficar dentro de /projects.",
        400,
        "PROJECT_PATH_INVALID",
      );
    }

    const text = await file.text();
    const validation = validateKeplerJsonText(text);

    if (!validation.valid) {
      return errorResponse(
        validation.message,
        400,
        "PROJECT_UPLOAD_INVALID_JSON",
      );
    }

    const created = await createProject(env, {
      name,
      slug,
      description,
      dropboxRootPath,
      fileName,
      active,
      organization,
    });

    if (created instanceof Response) {
      return created;
    }

    const { project } = created;

    try {
      await uploadDropboxTextFile(env, dropboxRootPath, fileName, text);
    } catch (error) {
      await env.DB.prepare(`DELETE FROM projects WHERE id = ?`)
        .bind(project.id)
        .run();

      throw error;
    }

    await logAudit(env, {
      userId: user.id,
      projectId: project.id,
      action: "admin.projects.upload_create",
      details: {
        slug: project.slug,
        organizationId: project.organization_id || null,
        fileName,
        dropboxRootConfigured: Boolean(dropboxRootPath),
      },
    });

    return jsonResponse(
      {
        ok: true,
        project: publicAdminProject(project),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_PROJECT_UPLOAD_ERROR",
    );
  }
}