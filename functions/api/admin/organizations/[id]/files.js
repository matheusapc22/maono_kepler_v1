import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../../_lib/http.js";
import { requireSession } from "../../../../_lib/auth.js";
import {
  joinDropboxPath,
  listDropboxFolder,
  uploadDropboxTextFile,
} from "../../../../_lib/dropbox.js";
import { logAudit } from "../../../../_lib/projects.js";

const ADMIN_ROLES = new Set(["super_admin", "admin"]);

function requireAdmin(user) {
  if (!ADMIN_ROLES.has(user?.role)) {
    const error = new Error("Apenas administradores podem acessar este recurso.");
    error.status = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOrganizationId(value) {
  const organizationId = Number(value);

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return null;
  }

  return organizationId;
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

function publicOrganizationFile(row) {
  const linkedProject = row.project_id
    ? {
        id: row.project_id,
        name: row.project_name,
        slug: row.project_slug,
        active: Boolean(row.project_active),
      }
    : null;

  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    fileName: row.file_name,
    fileType: row.file_type,
    sizeBytes: row.size_bytes,
    isProject: Boolean(row.is_project),
    linkedProject,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicAdminDropboxEntry(entry) {
  return {
    tag: entry[".tag"],
    name: entry.name,
    id: entry.id,
    size: entry.size,
  };
}

async function getOrganization(env, organizationId) {
  return env.DB.prepare(
    `SELECT id, name, slug, dropbox_root_path, active
     FROM organizations
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(organizationId)
    .first();
}

async function listOrganizationFiles(env, organizationId) {
  const { results } = await env.DB.prepare(
    `SELECT
      organization_files.*,
      projects.id AS project_id,
      projects.name AS project_name,
      projects.slug AS project_slug,
      projects.active AS project_active
     FROM organization_files
     LEFT JOIN projects ON projects.organization_file_id = organization_files.id
     WHERE organization_files.organization_id = ?
     ORDER BY
      organization_files.active DESC,
      organization_files.file_type ASC,
      organization_files.name ASC,
      projects.active DESC`,
  )
    .bind(organizationId)
    .all();

  const rows = results || [];
  const byFile = new Map();

  for (const row of rows) {
    const previous = byFile.get(row.id);

    if (!previous || (!previous.project_active && row.project_active)) {
      byFile.set(row.id, row);
    }
  }

  return Array.from(byFile.values());
}

async function upsertOrganizationFile(env, organization, file, requestedName) {
  const fileName = normalizeText(file.name);
  const displayName = normalizeText(requestedName) || fileName;

  if (!fileName) {
    return {
      error: errorResponse(
        "O arquivo enviado não possui nome.",
        400,
        "FILE_NAME_REQUIRED",
      ),
    };
  }

  const content = await file.arrayBuffer();
  const dropboxPath = joinDropboxPath(organization.dropbox_root_path, fileName);
  const fileType = inferFileType(fileName);
  const sizeBytes = Number(file.size || content.byteLength || 0);

  await uploadDropboxTextFile(
    env,
    organization.dropbox_root_path,
    fileName,
    content,
  );

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
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 1)
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
      displayName,
      fileName,
      dropboxPath,
      fileType,
      sizeBytes,
    )
    .first();

  return { file: savedFile };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    const organizationId = normalizeOrganizationId(params.id);

    if (!organizationId) {
      return errorResponse(
        "ID da organização inválido.",
        400,
        "ORGANIZATION_ID_INVALID",
      );
    }

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

    if (request.method === "GET") {
      const files = await listOrganizationFiles(env, organizationId);
      const dropbox = await listDropboxFolder(
        env,
        organization.dropbox_root_path,
      );

      return jsonResponse({
        ok: true,
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          active: Boolean(organization.active),
        },
        files: files.map(publicOrganizationFile),
        dropboxEntries: (dropbox.entries || []).map(publicAdminDropboxEntry),
      });
    }

    if (request.method === "POST") {
      const form = await request.formData();
      const file = form.get("file");
      const name = normalizeText(form.get("name"));

      if (!file || typeof file.arrayBuffer !== "function") {
        return errorResponse(
          "Envie um arquivo para a organização.",
          400,
          "ORGANIZATION_FILE_REQUIRED",
        );
      }

      const { file: savedFile, error } = await upsertOrganizationFile(
        env,
        organization,
        file,
        name,
      );

      if (error) {
        return error;
      }

      await logAudit(env, {
        userId: user.id,
        action: "admin.organization_files.upload",
        details: {
          organizationId: organization.id,
          fileId: savedFile.id,
          fileName: savedFile.file_name,
          fileType: savedFile.file_type,
          sizeBytes: savedFile.size_bytes,
        },
      });

      return jsonResponse(
        {
          ok: true,
          file: publicOrganizationFile(savedFile),
        },
        { status: 201 },
      );
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_ORGANIZATION_FILES_ERROR",
    );
  }
}