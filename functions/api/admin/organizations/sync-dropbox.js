import { errorResponse, jsonResponse, methodNotAllowed } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { listDropboxFolder, normalizeDropboxFolderPath } from "../../../_lib/dropbox.js";
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

function titleFromFolderName(value) {
  const clean = normalizeText(value);
  if (!clean) return "Organização sem nome";

  return clean
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function requireAdmin(user) {
  if (user?.role !== "admin") {
    const error = new Error("Apenas administradores podem acessar este recurso.");
    error.status = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
}

function publicOrganization(row, syncStatus = "synced") {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    dropboxRootPath: row.dropbox_root_path,
    active: Boolean(row.active),
    syncStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertOrganizationFromFolder(env, folderEntry) {
  const folderName = normalizeText(folderEntry.name);
  const folderPath = normalizeDropboxFolderPath(folderEntry.path_display || folderEntry.path_lower);
  const slug = normalizeSlug(folderName);
  const name = titleFromFolderName(folderName);

  if (!folderName || !folderPath || !slug) {
    return null;
  }

  const existingByPath = await env.DB.prepare(
    `SELECT * FROM organizations WHERE dropbox_root_path = ? LIMIT 1`
  )
    .bind(folderPath)
    .first();

  if (existingByPath) {
    const updated = await env.DB.prepare(
      `UPDATE organizations
       SET active = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`
    )
      .bind(existingByPath.id)
      .first();

    return { organization: updated, status: existingByPath.active ? "already_exists" : "reactivated" };
  }

  const existingBySlug = await env.DB.prepare(
    `SELECT id FROM organizations WHERE slug = ? LIMIT 1`
  )
    .bind(slug)
    .first();

  const finalSlug = existingBySlug ? `${slug}-${Date.now().toString(36)}` : slug;

  const created = await env.DB.prepare(
    `INSERT INTO organizations (name, slug, description, dropbox_root_path, active)
     VALUES (?, ?, ?, ?, 1)
     RETURNING *`
  )
    .bind(name, finalSlug, "Organização importada automaticamente do Dropbox.", folderPath)
    .first();

  return { organization: created, status: "created" };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    const url = new URL(request.url);
    const rootPath = normalizeDropboxFolderPath(url.searchParams.get("rootPath") || DEFAULT_PROJECTS_ROOT);

    if (!rootPath || !rootPath.startsWith("/projects")) {
      return errorResponse("A sincronização só é permitida dentro de /projects.", 400, "DROPBOX_SYNC_ROOT_INVALID");
    }

    const dropbox = await listDropboxFolder(env, rootPath);
    const folders = (dropbox.entries || []).filter((entry) => entry[".tag"] === "folder");
    const synced = [];

    for (const folder of folders) {
      const result = await upsertOrganizationFromFolder(env, folder);
      if (result?.organization) {
        synced.push(publicOrganization(result.organization, result.status));
      }
    }

    await logAudit(env, {
      userId: user.id,
      action: "admin.organizations.sync_dropbox",
      details: {
        rootPath,
        foldersFound: folders.length,
        organizationsSynced: synced.length,
      },
    });

    return jsonResponse({
      ok: true,
      rootPath,
      foldersFound: folders.length,
      organizationsSynced: synced.length,
      organizations: synced,
    });
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_ORGANIZATIONS_SYNC_DROPBOX_ERROR");
  }
}
