import { errorResponse, jsonResponse, methodNotAllowed } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
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
    accessCount: 0,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
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
    return { valid: false, message: "O JSON precisa ter um objeto na raiz." };
  }

  if (!Array.isArray(parsed.datasets)) {
    return { valid: false, message: "O JSON precisa conter a propriedade datasets como lista." };
  }

  const rawConfig = parsed.config;
  const normalizedConfig = rawConfig?.config && typeof rawConfig.config === "object"
    ? rawConfig.config
    : rawConfig;

  if (!normalizedConfig || typeof normalizedConfig !== "object" || Array.isArray(normalizedConfig)) {
    return { valid: false, message: "O JSON precisa conter a propriedade config." };
  }

  // Aceita o formato oficial salvo do Kepler: config.config.{visState,mapState,mapStyle}
  // e também o formato já processado: config.{visState,mapState,mapStyle}.
  const requiredSections = ["visState", "mapState", "mapStyle"];
  const missing = requiredSections.filter(
    (section) => !normalizedConfig[section] || typeof normalizedConfig[section] !== "object"
  );

  if (missing.length) {
    return {
      valid: false,
      message: `Estrutura Kepler incompleta. Seções ausentes: ${missing.join(", ")}.`,
    };
  }

  return { valid: true };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    const form = await request.formData();
    const file = form.get("file");
    const name = normalizeText(form.get("name"));
    const slug = normalizeSlug(form.get("slug") || name);
    const description = normalizeText(form.get("description"));
    const active = String(form.get("active") || "true") !== "false" ? 1 : 0;
    const requestedRootPath = normalizeText(form.get("dropboxRootPath"));
    const requestedFileName = normalizeText(form.get("defaultConfigFile"));

    if (!name) {
      return errorResponse("Informe o nome do projeto.", 400, "PROJECT_NAME_REQUIRED");
    }

    if (!slug) {
      return errorResponse("Informe um identificador válido para o projeto.", 400, "PROJECT_SLUG_REQUIRED");
    }

    if (!file || typeof file.text !== "function") {
      return errorResponse("Envie um arquivo JSON do Kepler.", 400, "PROJECT_UPLOAD_FILE_REQUIRED");
    }

    const fileName = requestedFileName || file.name || "config.kepler.json";

    if (!fileName.toLowerCase().endsWith(".json")) {
      return errorResponse("O arquivo enviado precisa ser .json.", 400, "PROJECT_UPLOAD_JSON_REQUIRED");
    }

    const dropboxRootPath = requestedRootPath && requestedRootPath !== "/projects/"
      ? requestedRootPath.replace(/\/+$/g, "")
      : `/projects/${slug}`;

    if (!dropboxRootPath.startsWith("/")) {
      return errorResponse("A pasta Dropbox deve começar com /. Exemplo: /projects/cliente-a.", 400, "PROJECT_PATH_INVALID");
    }

    const text = await file.text();
    const validation = validateKeplerJsonText(text);

    if (!validation.valid) {
      return errorResponse(validation.message, 400, "PROJECT_UPLOAD_INVALID_JSON");
    }

    let project = null;

    try {
      project = await env.DB.prepare(
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
        .bind(name, slug, description || null, dropboxRootPath, fileName, active)
        .first();
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE")) {
        return errorResponse("Já existe um projeto com este identificador.", 409, "PROJECT_SLUG_EXISTS");
      }
      throw error;
    }

    try {
      await uploadDropboxTextFile(env, dropboxRootPath, fileName, text);
    } catch (error) {
      await env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(project.id).run();
      throw error;
    }

    await logAudit(env, {
      userId: user.id,
      projectId: project.id,
      action: "admin.projects.upload_create",
      details: { slug: project.slug, dropboxRootPath, fileName },
    });

    return jsonResponse(
      {
        ok: true,
        project: publicAdminProject(project),
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_PROJECT_UPLOAD_ERROR");
  }
}
