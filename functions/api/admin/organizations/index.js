import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import {
  ensureDropboxFolder,
  normalizeDropboxFolderPath,
} from "../../../_lib/dropbox.js";
import { requirePermission } from "../../../_lib/permissions.js";
import { logAudit } from "../../../_lib/projects.js";

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
      resourceId: "admin.organizations",
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

function publicOrganization(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    dropboxRootPath: row.dropbox_root_path,
    active: Boolean(row.active),
    storageStatus: row.storage_status || null,
    storageError: row.storage_error || null,
    storageCheckedAt: row.storage_checked_at || null,
    fileCount: row.file_count || 0,
    projectCount: row.project_count || 0,
    userCount: row.user_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listOrganizations(env, { includeInactive = false } = {}) {
  const whereClause = includeInactive ? "" : "WHERE organizations.active = 1";

  const { results } = await env.DB.prepare(
    `SELECT
      organizations.*,
      COUNT(DISTINCT organization_files.id) AS file_count,
      COUNT(DISTINCT projects.id) AS project_count,
      COUNT(DISTINCT organization_users.id) AS user_count
    FROM organizations
    LEFT JOIN organization_files
      ON organization_files.organization_id = organizations.id
      AND organization_files.active = 1
    LEFT JOIN projects
      ON projects.organization_id = organizations.id
      AND projects.active = 1
    LEFT JOIN organization_users
      ON organization_users.organization_id = organizations.id
    ${whereClause}
    GROUP BY organizations.id
    ORDER BY organizations.active DESC, organizations.name ASC`,
  ).all();

  return results || [];
}

async function createOrganization(env, body) {
  const name = normalizeText(body?.name);
  const slug = normalizeSlug(body?.slug || name);
  const description = normalizeText(body?.description);
  const active = body?.active === false ? 0 : 1;
  const requestedPath = normalizeText(
    body?.dropboxRootPath || body?.dropbox_root_path,
  );
  const dropboxRootPath = normalizeDropboxFolderPath(
    requestedPath || `/projects/${slug}`,
  );

  if (!name) {
    return {
      error: errorResponse(
        "Informe o nome da organização.",
        400,
        "ORGANIZATION_NAME_REQUIRED",
      ),
    };
  }

  if (!slug) {
    return {
      error: errorResponse(
        "Informe um identificador válido para a organização.",
        400,
        "ORGANIZATION_SLUG_REQUIRED",
      ),
    };
  }

  if (!dropboxRootPath || !dropboxRootPath.startsWith("/projects/")) {
    return {
      error: errorResponse(
        "A pasta da organização deve ficar dentro de /projects. Exemplo: /projects/cliente-a.",
        400,
        "ORGANIZATION_PATH_INVALID",
      ),
    };
  }

  // Invariante: antes de uma organização ser persistida como ativa, a raiz e
  // a subpasta de documentos precisam existir fisicamente no Dropbox.
  if (active) {
    await ensureDropboxFolder(env, `${dropboxRootPath}/documents`);
  }

  const checkedAt = new Date().toISOString();

  try {
    const organization = await env.DB.prepare(
      `INSERT INTO organizations (
        name,
        slug,
        description,
        dropbox_root_path,
        active,
        storage_status,
        storage_error,
        storage_checked_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
      RETURNING *`,
    )
      .bind(
        name,
        slug,
        description || null,
        dropboxRootPath,
        active,
        active ? "READY" : "DISABLED",
        checkedAt,
      )
      .first();

    return { organization };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return {
        error: errorResponse(
          "Já existe uma organização com este identificador ou pasta Dropbox.",
          409,
          "ORGANIZATION_EXISTS",
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
      await requireGlobalAdminPanelAccess(
        env,
        request,
        "admin.organizations.view",
      );

      const url = new URL(request.url);
      const includeInactive =
        url.searchParams.get("includeInactive") === "true";
      const organizations = await listOrganizations(env, { includeInactive });

      return jsonResponse({
        ok: true,
        scope: "global",
        organizations: organizations.map(publicOrganization),
      });
    }

    if (request.method === "POST") {
      const { user } = await requireGlobalAdminPanelAccess(
        env,
        request,
        "admin.organizations.create",
      );

      const body = await readJsonBody(request);
      const { organization, error } = await createOrganization(env, body);

      if (error) {
        return error;
      }

      await logAudit(env, {
        userId: user.id,
        action: "admin.organizations.create",
        details: {
          organizationId: organization.id,
          slug: organization.slug,
          active: Boolean(organization.active),
          storageProvisioned: Boolean(organization.active),
          storageStatus: organization.storage_status || null,
        },
      });

      return jsonResponse(
        {
          ok: true,
          organization: publicOrganization(organization),
        },
        { status: 201 },
      );
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_ORGANIZATIONS_ERROR",
    );
  }
}
