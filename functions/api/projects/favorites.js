import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../_lib/http.js";
import { requireSession } from "../../_lib/auth.js";
import { listFavoriteWorkspaceProjectsForUser } from "../../_lib/workspace-projects.js";

function logUnexpectedError(error) {
  const status = error?.status || 500;

  if (status >= 500) {
    console.error("[Maono projects] Falha ao listar favoritos:", error);
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const user = await requireSession(env, request);
    const projects = await listFavoriteWorkspaceProjectsForUser(env, user);

    return jsonResponse({
      ok: true,
      projects,
    });
  } catch (error) {
    logUnexpectedError(error);

    const status = error.status || 500;
    const code = error.code || "PROJECTS_FAVORITES_ERROR";

    if (status === 401) {
      return errorResponse(
        "Sessão inválida ou expirada.",
        401,
        code,
      );
    }

    if (status === 403) {
      return errorResponse(
        "Você não tem permissão para visualizar projetos favoritos.",
        403,
        code,
      );
    }

    return errorResponse(
      "Não foi possível carregar os projetos favoritos.",
      status,
      code,
    );
  }
}