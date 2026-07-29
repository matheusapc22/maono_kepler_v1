import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import {
  resolveNewMapCreateContext,
} from "../../../_lib/map-panel-service.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const context = await resolveNewMapCreateContext(env, request);

    return jsonResponse({
      ok: true,
      ...context,
    });
  } catch (error) {
    return errorResponse(
      error?.message ||
        "Não foi possível abrir a área de criação de mapas.",
      Number(error?.status || 500),
      error?.code || "NEW_MAP_CONTEXT_ERROR",
      error?.details || null,
    );
  }
}
