import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import { resolveExistingProjectMapNavigation } from "../../../_lib/map-panel-service.js";

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const url = new URL(request.url);
    const navigation = await resolveExistingProjectMapNavigation(
      env,
      request,
      params?.slug,
      {
        requestedMode:
          url.searchParams.get("mode") ||
          url.searchParams.get("requestedMode") ||
          "manage",
      },
    );

    return jsonResponse({
      ok: true,
      ...navigation,
    });
  } catch (error) {
    return errorResponse(
      error?.message || "Não foi possível resolver o painel do mapa.",
      Number(error?.status || 500),
      error?.code || "MAP_NAVIGATION_ERROR",
      error?.details || null,
    );
  }
}
