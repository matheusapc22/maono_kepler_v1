import { errorResponse, methodNotAllowed } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject } from "../../../_lib/projects.js";
import { downloadDropboxBinaryFile, getPreviewFileNameFromConfigFile } from "../../../_lib/dropbox.js";

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

    const configFileName = project.default_config_file || "config.kepler.json";
    const previewFileName = getPreviewFileNameFromConfigFile(configFileName);
    const dropboxResponse = await downloadDropboxBinaryFile(env, project.dropbox_root_path, previewFileName);
    const body = await dropboxResponse.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const status = error.status || 404;
    return errorResponse(
      status === 404 ? "Preview PNG não encontrado para este projeto." : error.message,
      status,
      status === 404 ? "PROJECT_THUMBNAIL_NOT_FOUND" : "PROJECT_THUMBNAIL_ERROR"
    );
  }
}
