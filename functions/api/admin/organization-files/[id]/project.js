import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../../_lib/http.js";
import { requireSession } from "../../../../_lib/auth.js";
import { logAudit } from "../../../../_lib/projects.js";

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

function makeShortId(length = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function generateUniqueProjectSlug(env, baseSlug) {
  const base = normalizeSlug(baseSlug) || "projeto";

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${base}-${makeShortId(6)}`;
    const existing = await env.DB.prepare(
      `SELECT id FROM projects WHERE slug = ? LIMIT 1`
    )
      .bind(candidate)
      .first();

    if (!existing) return candidate;
  }

  return `${base}-${Date.now().toString(36)}-${makeShortId(4)}`;
}

function requireAdmin(user) {
  if (user?.role !== "admin") {
    return errorResponse("Apenas administradores podem acessar este recurso.", 403, "FORBIDDEN");
  }
  return null;
}

function publicProject(project, accessCount) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    dropboxRootPath: project.dropbox_root_path,
    defaultConfigFile: project.default_config_file,
    organizationId: project.organization_id,
    organizationFileId: project.organization_file_id,
    active: Boolean(project.active),
    accessCount,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

async function getManagedFile(env, fileId) {
  return await env.DB.prepare(
    `SELECT
      organization_files.*,
      organizations.name AS organization_name,
      organizations.slug AS organization_slug,
      organizations.dropbox_root_path AS organization_dropbox_root_path,
      organizations.active AS organization_active
    FROM organization_files
    INNER JOIN organizations ON organizations.id = organization_files.organization_id
    WHERE organization_files.id = ?
    LIMIT 1`
  )
    .bind(fileId)
    .first();
}

async function copyOrganizationAccessToProject(env, organizationId, projectId) {
  const { results } = await env.DB.prepare(
    `SELECT user_id, access_level
     FROM organization_users
     WHERE organization_id = ?`
  )
    .bind(organizationId)
    .all();

  const rows = results || [];
  if (!rows.length) return 0;

  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare(
        `INSERT INTO user_projects (user_id, project_id, access_level)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, project_id) DO UPDATE SET access_level = excluded.access_level`
      ).bind(row.user_id, projectId, row.access_level || "viewer")
    )
  );

  return rows.length;
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    const user = await requireSession(env, request);
    const adminError = requireAdmin(user);
    if (adminError) return adminError;

    const fileId = Number(params.id);
    if (!fileId) {
      return errorResponse("ID do arquivo inválido.", 400, "ORGANIZATION_FILE_ID_INVALID");
    }

    const file = await getManagedFile(env, fileId);
    if (!file) {
      return errorResponse("Arquivo não encontrado.", 404, "ORGANIZATION_FILE_NOT_FOUND");
    }

    const fileName = String(file.file_name || "").toLowerCase();
    if (!fileName.endsWith(".json")) {
      return errorResponse("Somente arquivos JSON podem virar projeto Kepler.", 400, "ORGANIZATION_FILE_NOT_JSON");
    }

    if (!file.active || !file.organization_active) {
      return errorResponse("Arquivo ou organização inativa.", 400, "ORGANIZATION_FILE_INACTIVE");
    }

    const body = await readJsonBody(request);
    const name = normalizeText(body?.name || file.name || file.file_name);
    const description = normalizeText(body?.description || `Projeto criado a partir de ${file.file_name}.`);
    const shouldCopyOrganizationAccess = body?.copyOrganizationAccess !== false;

    if (!name) {
      return errorResponse("Informe um nome válido para o projeto.", 400, "PROJECT_DATA_REQUIRED");
    }

    const baseSlug = normalizeSlug(
      body?.slug || `${file.organization_slug || "org"}-${name}`
    );
    const slug = body?.autoGenerateSlug === false && body?.slug
      ? normalizeSlug(body.slug)
      : await generateUniqueProjectSlug(env, baseSlug);

    let project;

    try {
      project = await env.DB.prepare(
        `INSERT INTO projects (
          name,
          slug,
          description,
          dropbox_root_path,
          default_config_file,
          organization_id,
          organization_file_id,
          active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        RETURNING *`
      )
        .bind(
          name,
          slug,
          description || null,
          file.organization_dropbox_root_path,
          file.file_name,
          file.organization_id,
          file.id
        )
        .first();
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE")) {
        return errorResponse("Já existe um projeto com este identificador.", 409, "PROJECT_SLUG_EXISTS");
      }
      throw error;
    }

    await env.DB.prepare(
      `UPDATE organization_files SET is_project = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
      .bind(file.id)
      .run();

    const accessCount = shouldCopyOrganizationAccess
      ? await copyOrganizationAccessToProject(env, file.organization_id, project.id)
      : 0;

    await logAudit(env, {
      userId: user.id,
      projectId: project.id,
      action: "admin.organization_files.project_create",
      details: {
        organizationId: file.organization_id,
        fileId: file.id,
        slug: project.slug,
        accessCount,
      },
    });

    return jsonResponse(
      { ok: true, project: publicProject(project, accessCount) },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_ORGANIZATION_FILE_PROJECT_ERROR");
  }
}
