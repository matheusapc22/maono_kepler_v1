import { errorResponse, jsonResponse, methodNotAllowed, readJsonBody } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject, logAudit, publicProject } from "../../../_lib/projects.js";
import {
  deleteDropboxPathIfExists,
  downloadDropboxTextFile,
  getPreviewFileNameFromConfigFile,
  joinDropboxPath,
  uploadDropboxBinaryFile,
  uploadDropboxTextFile,
} from "../../../_lib/dropbox.js";

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

function decodeDataUrl(dataUrl) {
  const value = String(dataUrl || "");
  const match = value.match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/i);

  if (!match) {
    return null;
  }

  const contentType = match[1].toLowerCase();
  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return { bytes, contentType };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Erro desconhecido.");
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

async function saveProjectThumbnail(env, project, fileName, thumbnailDataUrl) {
  const decoded = decodeDataUrl(thumbnailDataUrl);

  if (!decoded) {
    return null;
  }

  const previewFileName = getPreviewFileNameFromConfigFile(fileName);
  const previewPath = joinDropboxPath(project.dropbox_root_path, previewFileName);

  // Política Maõno: apenas uma imagem canônica por projeto.
  // Exclui a anterior antes de salvar a nova para não acumular previews.
  await deleteDropboxPathIfExists(env, previewPath);

  await uploadDropboxBinaryFile(
    env,
    project.dropbox_root_path,
    previewFileName,
    decoded.bytes,
    decoded.contentType
  );

  return {
    previewFileName,
    previewPath,
    previewSizeBytes: decoded.bytes.byteLength,
    previewContentType: decoded.contentType,
  };
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

    // O JSON é o arquivo crítico. A falha do preview nunca deve bloquear o salvamento do projeto.
    await uploadDropboxTextFile(env, project.dropbox_root_path, fileName, content);

    let preview = null;
    let previewError = null;

    if (body?.thumbnailDataUrl) {
      try {
        preview = await saveProjectThumbnail(env, project, fileName, body.thumbnailDataUrl);
      } catch (error) {
        previewError = getErrorMessage(error);
      }
    }

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
        preview,
        previewError,
        thumbnailCapture: body?.thumbnailCapture || null,
      },
    });

    return jsonResponse({
      ok: true,
      project: publicProject({ ...project, ...updatedProject }),
      fileName,
      dropboxRootPath: project.dropbox_root_path,
      sizeBytes,
      preview,
      previewError,
    });
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "PROJECT_CONFIG_ERROR");
  }
}
