import { errorResponse, jsonResponse, methodNotAllowed, readJsonBody } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject, logAudit, publicProject } from "../../../_lib/projects.js";
import { downloadDropboxTextFile, uploadDropboxTextFile } from "../../../_lib/dropbox.js";

function canSaveProject(user, project) {
  if (user?.role === "admin") return true;
  return ["editor", "owner"].includes(String(project?.access_level || "").toLowerCase());
}

function validateKeplerConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "Envie uma configuração Kepler em formato JSON.";
  }

  if (!config.version) {
    return "O JSON não possui campo version.";
  }

  if (!config.config || typeof config.config !== "object") {
    return "O JSON não possui o objeto config.";
  }

  if (!Array.isArray(config.datasets)) {
    return "O JSON não possui datasets em formato de lista.";
  }

  return null;
}

function jsonSizeBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

async function updateLinkedOrganizationFileSize(env, project, sizeBytes) {
  if (!project.organization_file_id) return;

  await env.DB.prepare(
    `UPDATE organization_files
     SET size_bytes = ?, is_project = 1, active = 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(sizeBytes, project.organization_file_id)
    .run();
}

async function markProjectConfigUpdated(env, projectId) {
  const updated = await env.DB.prepare(
    `UPDATE projects
     SET updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
     RETURNING *`
  )
    .bind(projectId)
    .first();

  return updated;
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (!["GET", "PUT"].includes(request.method)) {
    return methodNotAllowed(["GET", "PUT"]);
  }

  try {
    const user = await requireSession(env, request);
    const slug = params.slug;
    const project = await getAuthorizedProject(env, user, slug);

    if (!project) {
      return errorResponse("Projeto não encontrado ou sem permissão de acesso.", 404, "PROJECT_NOT_FOUND");
    }

    const fileName = project.default_config_file || "config.kepler.json";

    if (request.method === "GET") {
      const fileText = await downloadDropboxTextFile(env, project.dropbox_root_path, fileName);

      await logAudit(env, {
        userId: user.id,
        projectId: project.id,
        action: "projects.config.read",
        details: { slug, fileName },
      });

      let parsedConfig = null;
      try {
        parsedConfig = JSON.parse(fileText);
      } catch (_error) {
        return errorResponse("O arquivo do Dropbox não contém um JSON válido.", 500, "INVALID_PROJECT_CONFIG");
      }

      return jsonResponse({
        ok: true,
        project: publicProject(project),
        config: parsedConfig,
      });
    }

    if (!canSaveProject(user, project)) {
      return errorResponse(
        "Você não tem permissão para salvar alterações neste projeto.",
        403,
        "PROJECT_SAVE_FORBIDDEN"
      );
    }

    const body = await readJsonBody(request);
    const config = body?.config;
    const validationError = validateKeplerConfig(config);

    if (validationError) {
      return errorResponse(validationError, 400, "INVALID_KEPLER_CONFIG");
    }

    const content = JSON.stringify(config, null, 2);
    const sizeBytes = jsonSizeBytes(content);

    await uploadDropboxTextFile(env, project.dropbox_root_path, fileName, content);
    await updateLinkedOrganizationFileSize(env, project, sizeBytes);
    const updatedProject = await markProjectConfigUpdated(env, project.id);

    await logAudit(env, {
      userId: user.id,
      projectId: project.id,
      action: "projects.config.save",
      details: {
        slug,
        fileName,
        dropboxRootPath: project.dropbox_root_path,
        sizeBytes,
      },
    });

    return jsonResponse({
      ok: true,
      project: publicProject({ ...project, ...updatedProject }),
      fileName,
      dropboxRootPath: project.dropbox_root_path,
      sizeBytes,
    });
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "PROJECT_CONFIG_ERROR");
  }
}
