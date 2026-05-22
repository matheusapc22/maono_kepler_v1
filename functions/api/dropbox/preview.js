import { errorResponse, methodNotAllowed } from "../../_lib/http.js";
import { requireSession } from "../../_lib/auth.js";
import { downloadDropboxTextFile } from "../../_lib/dropbox.js";

function normalizeText(value) {
  return String(value || "").trim();
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const user = await requireSession(env, request);

    if (user.role !== "admin") {
      return errorResponse("Apenas administradores podem pré-visualizar arquivos do Dropbox.", 403, "FORBIDDEN");
    }

    const url = new URL(request.url);
    const rootPath = normalizeText(url.searchParams.get("rootPath"));
    const fileName = normalizeText(url.searchParams.get("fileName"));

    if (!rootPath || !rootPath.startsWith("/")) {
      return errorResponse("Informe uma pasta Dropbox válida começando com /.", 400, "DROPBOX_PATH_INVALID");
    }

    if (!fileName) {
      return errorResponse("Informe o nome do arquivo JSON.", 400, "DROPBOX_FILE_REQUIRED");
    }

    const text = await downloadDropboxTextFile(env, rootPath, fileName);

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "DROPBOX_PREVIEW_ERROR");
  }
}
