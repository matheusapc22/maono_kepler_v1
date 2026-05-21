import { errorResponse, jsonResponse, methodNotAllowed } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject, logAudit, publicProject } from "../../../_lib/projects.js";
import { downloadDropboxTextFile } from "../../../_lib/dropbox.js";

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const user = await requireSession(env, request);
    const slug = params.slug;
    const project = await getAuthorizedProject(env, user, slug);

    if (!project) {
      return errorResponse("Projeto não encontrado ou sem permissão de acesso.", 404, "PROJECT_NOT_FOUND");
    }

    const fileName = project.default_config_file || "config.kepler.json";
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
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "PROJECT_CONFIG_ERROR");
  }
}
