import { errorResponse, jsonResponse, methodNotAllowed } from "../../_lib/http.js";
import { requireSession } from "../../_lib/auth.js";
import { listDropboxFolder } from "../../_lib/dropbox.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const user = await requireSession(env, request);

    if (user.role !== "admin") {
      return errorResponse("Apenas administradores podem listar pastas do Dropbox.", 403, "FORBIDDEN");
    }

    const url = new URL(request.url);
    const path = url.searchParams.get("path") || "";
    const result = await listDropboxFolder(env, path);

    return jsonResponse({
      ok: true,
      path,
      entries: (result.entries || []).map((entry) => ({
        tag: entry[".tag"],
        name: entry.name,
        pathLower: entry.path_lower,
        pathDisplay: entry.path_display,
        id: entry.id,
      })),
    });
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "DROPBOX_LIST_ERROR"
    );
  }
}
