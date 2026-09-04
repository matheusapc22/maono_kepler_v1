import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import { getOrCreateCorrelationId } from "../../../_lib/maono-error.js";
import { resolveCanonicalExistingProjectMapNavigation } from "../../../_lib/project-map-navigation-service.js";
import { withWorkspaceEditingParity } from "../../../_lib/project-map-workspace-capabilities.js";
import {
  resolveIsochroneFeatureState,
  withMapAnalysisRuntimeDefaults,
} from "../../../_lib/map-analysis-runtime.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const correlationId = getOrCreateCorrelationId(request);

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"], { correlationId });
  }

  try {
    const url = new URL(request.url);
    const isochroneFeatureState = resolveIsochroneFeatureState(env);
    const runtimeEnv = withMapAnalysisRuntimeDefaults(env);
    const navigation = withWorkspaceEditingParity(
      await resolveCanonicalExistingProjectMapNavigation(
        runtimeEnv,
        request,
        params?.slug,
        {
          requestedMode:
            url.searchParams.get("mode") ||
            url.searchParams.get("requestedMode") ||
            "manage",
        },
      ),
    );

    return jsonResponse(
      {
        ok: true,
        ...navigation,
        features: {
          ...navigation.features,
          maonoIsochroneState: isochroneFeatureState,
        },
      },
      {
        headers: {
          "X-Correlation-Id": correlationId,
        },
      },
    );
  } catch (error) {
    return errorResponse(
      error?.message || "Não foi possível resolver o painel do mapa.",
      Number(error?.status || 500),
      error?.code || "MAP_NAVIGATION_ERROR",
      error?.details || null,
      { correlationId, error },
    );
  }
}
