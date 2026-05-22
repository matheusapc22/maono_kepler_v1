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
    active: Boolean(project.active),
    accessCount: project.access_count || 0,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

async function listAdminProjects(env) {
  const { results } = await env.DB.prepare(
    `SELECT
      projects.id,
      projects.name,
      projects.slug,
      projects.description,
      projects.dropbox_root_path,
      projects.default_config_file,
      projects.active,
      projects.created_at,
      projects.updated_at,
      COUNT(user_projects.id) AS access_count
    FROM projects
    LEFT JOIN user_projects ON user_projects.project_id = projects.id
    GROUP BY projects.id
    ORDER BY projects.updated_at DESC, projects.name ASC`
  ).all();

  return results || [];
}

async function createProject(env, body) {
  const name = normalizeText(body?.name);
  const slug = normalizeSlug(body?.slug || body?.name);
  const description = normalizeText(body?.description);
  const dropboxRootPath = normalizeText(body?.dropboxRootPath || body?.dropbox_root_path);
  const defaultConfigFile = normalizeText(
    body?.defaultConfigFile || body?.default_config_file || "config.kepler.json"
  );
  const active = body?.active === false ? 0 : 1;

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
    const result = await env.DB.prepare(
      `INSERT INTO projects (
        name,
        slug,
        description,
        dropbox_root_path,
        default_config_file,
        active
      ) VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *`
    )
      .bind(name, slug, description || null, dropboxRootPath, defaultConfigFile, active)
      .first();

    return { project: result };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return { error: errorResponse("Já existe um projeto com este slug.", 409, "PROJECT_SLUG_EXISTS") };
    }
    throw error;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    if (request.method === "GET") {
      const projects = await listAdminProjects(env);
      return jsonResponse({
        ok: true,
        projects: projects.map(publicAdminProject),
      });
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const { project, error } = await createProject(env, body);

      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        projectId: project.id,
        action: "admin.projects.create",
        details: { slug: project.slug },
      });

      return jsonResponse(
        {
          ok: true,
          project: publicAdminProject({ ...project, access_count: 0 }),
        },
        { status: 201 }
      );
    }

    return methodNotAllowed(["GET", "POST"]);
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_PROJECTS_ERROR");
  }
}
