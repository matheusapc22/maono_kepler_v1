import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { canEditProject, requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject, logAudit } from "../../../_lib/projects.js";
import { uploadDropboxTextFile } from "../../../_lib/dropbox.js";

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    const user = await requireSession(env, request);
    const slug = params.slug;
    const project = await getAuthorizedProject(env, user, slug);

    if (!project) {
      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        "PROJECT_NOT_FOUND"
      );
    }

    if (!canEditProject(user, project.access_level)) {
      return errorResponse(
        "Você não tem permissão para salvar este projeto.",
        403,
        "FORBIDDEN"
      );
    }

    const body = await readJsonBody(request);
    const config = body?.config;

    if (!config) {
      return errorResponse(
        "Envie o campo config no corpo da requisição.",
        400,
        "MISSING_CONFIG"
      );
    }

    const fileName = project.default_config_file || "config.kepler.json";
    const content = JSON.stringify(config, null, 2);
    const dropboxResult = await uploadDropboxTextFile(
      env,
      project.dropbox_root_path,
      fileName,
      content
    );

    await logAudit(env, {
      userId: user.id,
      projectId: project.id,
      action: "projects.config.save",
      details: {
        slug,
        fileName,
        dropboxRev: dropboxResult?.rev,
      },
    });

    return jsonResponse({
      ok: true,
      saved: true,
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name,
      },
      dropbox: {
        id: dropboxResult?.id,
        name: dropboxResult?.name,
        rev: dropboxResult?.rev,
        pathDisplay: dropboxResult?.path_display,
      },
    });
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "PROJECT_SAVE_ERROR"
    );
  }
}
