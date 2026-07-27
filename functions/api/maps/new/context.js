import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import {
  resolveNewMapEditorContext,
} from "../../../_lib/map-panel-service.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const context = await resolveNewMapEditorContext(env, request);

    return jsonResponse({
      ok: true,
      ...context,
    });
  } catch (error) {
    return errorResponse(
      error?.message ||
        "Não foi possível abrir o editor de um novo mapa.",
      Number(error?.status || 500),
      error?.code || "NEW_MAP_CONTEXT_ERROR",
      error?.details || null,
    );
  }
}
