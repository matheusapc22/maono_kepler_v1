import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
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

function requireAdmin(user) {
  if (user?.role !== "admin") {
    const error = new Error("Apenas administradores podem acessar este recurso.");
    error.status = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
}

function publicAdminProject(project) {
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
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

async function getProjectById(env, projectId) {
  return await env.DB.prepare(
    `SELECT
      id,
      name,
      slug,
      description,
      dropbox_root_path,
      default_config_file,
      organization_id,
      organization_file_id,
      active,
      created_at,
      updated_at
    FROM projects
    WHERE id = ?
    LIMIT 1`
  )
    .bind(projectId)
    .first();
}

async function syncOrganizationFileProjectFlag(env, organizationFileId) {
  if (!organizationFileId) return;

  const activeProject = await env.DB.prepare(
    `SELECT id FROM projects WHERE organization_file_id = ? AND active = 1 LIMIT 1`
  )
    .bind(organizationFileId)
    .first();

  await env.DB.prepare(
    `UPDATE organization_files
     SET is_project = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(activeProject ? 1 : 0, organizationFileId)
    .run();
}

async function updateProject(env, projectId, body) {
  const current = await getProjectById(env, projectId);

  if (!current) {
    return { error: errorResponse("Projeto não encontrado.", 404, "PROJECT_NOT_FOUND") };
  }

  const name = normalizeText(body?.name ?? current.name);
  const slug = normalizeSlug(body?.slug ?? current.slug);
  const description = normalizeText(body?.description ?? current.description);
  const dropboxRootPath = normalizeText(
    body?.dropboxRootPath ?? body?.dropbox_root_path ?? current.dropbox_root_path
  );
  const defaultConfigFile = normalizeText(
    body?.defaultConfigFile ?? body?.default_config_file ?? current.default_config_file
  );
  const active = body?.active === false ? 0 : body?.active === true ? 1 : Number(current.active || 0);

  if (!name) {
    return { error: errorResponse("Informe o nome do projeto.", 400, "PROJECT_NAME_REQUIRED") };
  }

  if (!slug) {
    return { error: errorResponse("Informe um slug válido para o projeto.", 400, "PROJECT_SLUG_REQUIRED") };
  }

  if (!dropboxRootPath.startsWith("/")) {
    return { error: errorResponse("A pasta Dropbox deve começar com /. Exemplo: /projects/cliente-a.", 400, "PROJECT_PATH_INVALID") };
  }

  if (!defaultConfigFile) {
    return { error: errorResponse("Informe o arquivo JSON principal do projeto.", 400, "PROJECT_FILE_REQUIRED") };
  }

  try {
    const updated = await env.DB.prepare(
      `UPDATE projects
       SET
        name = ?,
        slug = ?,
        description = ?,
        dropbox_root_path = ?,
        default_config_file = ?,
        active = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`
    )
      .bind(name, slug, description || null, dropboxRootPath, defaultConfigFile, active, projectId)
      .first();

    await syncOrganizationFileProjectFlag(env, updated.organization_file_id);

    return { project: updated };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return { error: errorResponse("Já existe outro projeto com este slug.", 409, "PROJECT_SLUG_EXISTS") };
    }
    throw error;
  }
}

async function deleteProject(env, projectId, hardDelete = false) {
  const current = await getProjectById(env, projectId);

  if (!current) {
    return { error: errorResponse("Projeto não encontrado.", 404, "PROJECT_NOT_FOUND") };
  }

  if (hardDelete) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM user_projects WHERE project_id = ?`).bind(projectId),
      env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(projectId),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM user_projects WHERE project_id = ?`).bind(projectId),
      env.DB.prepare(`UPDATE projects SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(projectId),
    ]);
  }

  await syncOrganizationFileProjectFlag(env, current.organization_file_id);

  return { project: current };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    const projectId = Number(params.id);

    if (!projectId) {
      return errorResponse("ID do projeto inválido.", 400, "PROJECT_ID_INVALID");
    }

    if (request.method === "GET") {
      const project = await getProjectById(env, projectId);

      if (!project) {
        return errorResponse("Projeto não encontrado.", 404, "PROJECT_NOT_FOUND");
      }

      return jsonResponse({ ok: true, project: publicAdminProject(project) });
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      const body = await readJsonBody(request);
      const { project, error } = await updateProject(env, projectId, body);

      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        projectId: project.id,
        action: "admin.projects.update",
        details: { slug: project.slug, active: Boolean(project.active) },
      });

      return jsonResponse({ ok: true, project: publicAdminProject(project) });
    }

    if (request.method === "DELETE") {
      const url = new URL(request.url);
      const hardDelete = url.searchParams.get("hard") === "true";
      const { project, error } = await deleteProject(env, projectId, hardDelete);

      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        projectId: null,
        action: hardDelete ? "admin.projects.delete" : "admin.projects.deactivate",
        details: { projectId, slug: project.slug, name: project.name },
      });

      return jsonResponse({ ok: true });
    }

    return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]);
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_PROJECT_ERROR");
  }
} 