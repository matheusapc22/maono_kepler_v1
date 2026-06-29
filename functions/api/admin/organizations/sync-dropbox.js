import { errorResponse, jsonResponse, methodNotAllowed } from "../../../_lib/http.js";
import { requirePermission } from "../../../_lib/permissions.js";
import {
  listDropboxFolder,
  normalizeDropboxFolderPath,
} from "../../../_lib/dropbox.js";
import { logAudit } from "../../../_lib/projects.js";

const DEFAULT_PROJECTS_ROOT = "/projects";

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

function inferFileType(fileName) {
  const lower = String(fileName || "").toLowerCase();

  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".geojson")) return "geojson";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "spreadsheet";
  if (lower.endsWith(".zip")) return "zip";

  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp")
  ) {
    return "image";
  }

  return "other";
}

function titleFromFolderName(value) {
  const clean = normalizeText(value);

  if (!clean) {
    return "Organização sem nome";
  }

  return clean
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
      resourceId: "admin.organizations.sync_dropbox",
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

function publicOrganization(
  row,
  syncStatus = "synced",
  filesSynced = 0,
  projectsLinked = 0,
) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    active: Boolean(row.active),
    dropboxRootConfigured: Boolean(row.dropbox_root_path),
    syncStatus,
    filesSynced,
    projectsLinked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertOrganizationFromFolder(env, folderEntry) {
  const folderName = normalizeText(folderEntry.name);
  const folderPath = normalizeDropboxFolderPath(
    folderEntry.path_display || folderEntry.path_lower,
  );
  const slug = normalizeSlug(folderName);
  const name = titleFromFolderName(folderName);

  if (!folderName || !folderPath || !slug) {
    return null;
  }

  const existingByPath = await env.DB.prepare(
    `SELECT *
     FROM organizations
     WHERE dropbox_root_path = ?
     LIMIT 1`,
  )
    .bind(folderPath)
    .first();

  if (existingByPath) {
    const updated = await env.DB.prepare(
      `UPDATE organizations
       SET active = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`,
    )
      .bind(existingByPath.id)
      .first();

    return {
      organization: updated,
      status: existingByPath.active ? "already_exists" : "reactivated",
    };
  }

  const existingBySlug = await env.DB.prepare(
    `SELECT id
     FROM organizations
     WHERE slug = ?
     LIMIT 1`,
  )
    .bind(slug)
    .first();

  const finalSlug = existingBySlug ? `${slug}-${Date.now().toString(36)}` : slug;

  const created = await env.DB.prepare(
    `INSERT INTO organizations (
      name,
      slug,
      description,
      dropbox_root_path,
      active
    )
    VALUES (?, ?, ?, ?, 1)
    RETURNING *`,
  )
    .bind(
      name,
      finalSlug,
      "Organização importada automaticamente do Dropbox.",
      folderPath,
    )
    .first();

  return {
    organization: created,
    status: "created",
  };
}

async function linkExistingProjectsToOrganizationFile(env, organization, file) {
  const { results } = await env.DB.prepare(
    `SELECT id
     FROM projects
     WHERE active = 1
       AND (
         organization_file_id = ?
         OR (
           LOWER(dropbox_root_path) = LOWER(?)
           AND LOWER(default_config_file) = LOWER(?)
         )
         OR LOWER(TRIM(dropbox_root_path, '/') || '/' || TRIM(default_config_file, '/')) = LOWER(TRIM(?, '/'))
       )`,
  )
    .bind(
      file.id,
      organization.dropbox_root_path,
      file.file_name,
      file.dropbox_path,
    )
    .all();

  const projects = results || [];

  if (projects.length) {
    await env.DB.batch(
      projects.map((project) =>
        env.DB.prepare(
          `UPDATE projects
           SET organization_id = ?,
               organization_file_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(organization.id, file.id, project.id),
      ),
    );

    await env.DB.prepare(
      `UPDATE organization_files
       SET is_project = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(file.id)
      .run();
  }

  return projects.length;
}

async function upsertOrganizationFileFromDropboxEntry(
  env,
  organization,
  fileEntry,
) {
  const fileName = normalizeText(fileEntry.name);
  const dropboxPath = normalizeDropboxFolderPath(
    fileEntry.path_display || fileEntry.path_lower,
  );

  if (!fileName || !dropboxPath) {
    return {
      file: null,
      projectsLinked: 0,
    };
  }

  const fileType = inferFileType(fileName);
  const sizeBytes = Number(fileEntry.size || 0);

  const savedFile = await env.DB.prepare(
    `INSERT INTO organization_files (
      organization_id,
      name,
      file_name,
      dropbox_path,
      file_type,
      size_bytes,
      is_project,
      active
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
    ON CONFLICT(dropbox_path) DO UPDATE SET
      organization_id = excluded.organization_id,
      name = excluded.name,
      file_name = excluded.file_name,
      file_type = excluded.file_type,
      size_bytes = excluded.size_bytes,
      active = 1,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`,
  )
    .bind(
      organization.id,
      fileName,
      fileName,
      dropboxPath,
      fileType,
      sizeBytes,
    )
    .first();

  const projectsLinked = savedFile
    ? await linkExistingProjectsToOrganizationFile(env, organization, savedFile)
    : 0;

  return {
    file: savedFile,
    projectsLinked,
  };
}

async function syncFilesForOrganization(env, organization) {
  const dropbox = await listDropboxFolder(env, organization.dropbox_root_path);
  const files = (dropbox.entries || []).filter(
    (entry) => entry[".tag"] === "file",
  );
  let filesSynced = 0;
  let projectsLinked = 0;

  for (const fileEntry of files) {
    const result = await upsertOrganizationFileFromDropboxEntry(
      env,
      organization,
      fileEntry,
    );

    if (result.file) {
      filesSynced += 1;
    }

    projectsLinked += result.projectsLinked || 0;
  }

  return {
    filesSynced,
    projectsLinked,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  let auditUserId = null;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    const { user } = await requireGlobalAdminPanelAccess(
      env,
      request,
      "admin.organizations.sync_dropbox",
    );
    auditUserId = user.id;

    const url = new URL(request.url);
    const rootPath = normalizeDropboxFolderPath(
      url.searchParams.get("rootPath") || DEFAULT_PROJECTS_ROOT,
    );

    if (!rootPath || !rootPath.startsWith("/projects")) {
      return errorResponse(
        "A sincronização só é permitida dentro de /projects.",
        400,
        "DROPBOX_SYNC_ROOT_INVALID",
      );
    }

    await logAudit(env, {
      userId: user.id,
      action: "admin.organizations.sync_dropbox.start",
      details: {
        rootPathConfigured: Boolean(rootPath),
      },
    });

    const dropbox = await listDropboxFolder(env, rootPath);
    const folders = (dropbox.entries || []).filter(
      (entry) => entry[".tag"] === "folder",
    );
    const synced = [];
    let filesSyncedTotal = 0;
    let projectsLinkedTotal = 0;

    for (const folder of folders) {
      const result = await upsertOrganizationFromFolder(env, folder);

      if (result?.organization) {
        const { filesSynced, projectsLinked } =
          await syncFilesForOrganization(env, result.organization);

        filesSyncedTotal += filesSynced;
        projectsLinkedTotal += projectsLinked;

        synced.push(
          publicOrganization(
            result.organization,
            result.status,
            filesSynced,
            projectsLinked,
          ),
        );
      }
    }

    await logAudit(env, {
      userId: user.id,
      action: "admin.organizations.sync_dropbox.success",
      details: {
        rootPathConfigured: Boolean(rootPath),
        foldersFound: folders.length,
        organizationsSynced: synced.length,
        filesSynced: filesSyncedTotal,
        projectsLinked: projectsLinkedTotal,
      },
    });

    return jsonResponse({
      ok: true,
      rootPathConfigured: Boolean(rootPath),
      foldersFound: folders.length,
      organizationsSynced: synced.length,
      filesSynced: filesSyncedTotal,
      projectsLinked: projectsLinkedTotal,
      organizations: synced,
    });
  } catch (error) {
    if (auditUserId) {
      await logAudit(env, {
        userId: auditUserId,
        action: "admin.organizations.sync_dropbox.failure",
        details: {
          errorCode: error.code || "ADMIN_ORGANIZATIONS_SYNC_DROPBOX_ERROR",
          status: error.status || 500,
        },
      });
    }

    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_ORGANIZATIONS_SYNC_DROPBOX_ERROR",
    );
  }
}