import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import { resolveExistingProjectMapNavigation } from "../../../_lib/map-panel-service.js";
import { withMapAnalysisRuntimeDefaults } from "../../../_lib/map-analysis-runtime.js";

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const url = new URL(request.url);
    const runtimeEnv = withMapAnalysisRuntimeDefaults(env);
    const navigation = await resolveExistingProjectMapNavigation(
      runtimeEnv,
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
