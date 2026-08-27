import { methodNotAllowed } from "../../_lib/http.js";
import { generateIsochrone } from "../../_lib/isochrone-service.js";
import {
  ensureMapAnalysisRateLimitSchema,
  resolveIsochroneFeatureState,
  withMapAnalysisRuntimeDefaults,
} from "../../_lib/map-analysis-runtime.js";

const MAX_REQUEST_BYTES = 16 * 1024;

const MODE_LABELS = {
  drive_traffic: "Carro com trânsito",
  drive: "Carro",
  bicycle: "Bicicleta",
  walk: "Caminhada",
};

const FEATURE_DISABLED_MESSAGES = Object.freeze({
  OVERLAY_DISABLED: "A ferramenta de isócronas não está disponível porque os controles de análise do mapa estão desabilitados.",
  KILL_SWITCH_ACTIVE: "A ferramenta de isócronas está temporariamente desabilitada.",
  PROVIDER_NOT_CONFIGURED: "O provedor de isócronas não está configurado neste ambiente.",
});

function endpointError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function apiErrorResponse(error) {
  const status = Number(error?.status || 500);
  const details = error?.details || null;
  const retryAfterSeconds = Number(details?.retryAfterSeconds);
  const headers =
    status === 429 &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds > 0
      ? { "Retry-After": String(Math.ceil(retryAfterSeconds)) }
      : {};

  return jsonResponse(
    {
      ok: false,
      error: {
        message:
          error?.message || "Não foi possível gerar a isócrona.",
        code:
          error?.code || "ISOCHRONE_GENERATION_ERROR",
        details,
      },
    },
    status,
    headers,
  );
}

function validateRequestOrigin(request) {
  const origin = request.headers.get("origin");

  if (!origin) return;

  let requestOrigin;

  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw endpointError(
      "A origem da solicitação é inválida.",
      400,
      "ISOCHRONE_REQUEST_ORIGIN_INVALID",
    );
  }

  if (origin !== requestOrigin) {
    throw endpointError(
      "A origem da solicitação não é permitida.",
      403,
      "ISOCHRONE_CROSS_ORIGIN_FORBIDDEN",
    );
  }
}

function assertIsochroneFeatureEnabled(env) {
  const state = resolveIsochroneFeatureState(env);
  if (state.enabled) return state;

  throw endpointError(
    FEATURE_DISABLED_MESSAGES[state.reason] ||
      "A ferramenta de isócronas não está disponível neste ambiente.",
    503,
    "ISOCHRONE_FEATURE_DISABLED",
    { reason: state.reason },
  );
}

async function readBoundedJsonBody(request) {
  const declaredLength = Number(
    request.headers.get("content-length") || 0,
  );

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BYTES
  ) {
    throw endpointError(
      "A solicitação excede o limite permitido.",
      413,
      "ISOCHRONE_REQUEST_TOO_LARGE",
    );
  }

  const contentType = String(
    request.headers.get("content-type") || "",
  )
    .split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    throw endpointError(
      "Envie a solicitação como application/json.",
      415,
      "ISOCHRONE_CONTENT_TYPE_INVALID",
    );
  }

  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = "";

  if (!reader) {
    throw endpointError(
      "Envie uma solicitação JSON válida.",
      400,
      "INVALID_JSON_BODY",
    );
  }

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      byteCount += value.byteLength;

      if (byteCount > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw endpointError(
          "A solicitação excede o limite permitido.",
          413,
          "ISOCHRONE_REQUEST_TOO_LARGE",
        );
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  if (!text.trim()) {
    throw endpointError(
      "Envie uma solicitação JSON válida.",
      400,
      "INVALID_JSON_BODY",
    );
  }

  try {
    const body = JSON.parse(text);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TypeError("JSON body must be an object");
    }

    return body;
  } catch {
    throw endpointError(
      "Envie uma solicitação JSON válida.",
      400,
      "INVALID_JSON_BODY",
    );
  }
}

function formatRangeLabel(range, type) {
  const numeric = Number(range);
  if (!Number.isFinite(numeric)) return null;

  const formatted = Number.isInteger(numeric)
    ? String(numeric)
    : String(Number(numeric.toFixed(2)));
  return type === "distance"
    ? `${formatted} km`
    : `${formatted} min`;
}

export function enrichIsochroneResult(result) {
  const features = result?.geojson?.features;
  if (!Array.isArray(features)) return result;

  const mode = result?.metadata?.mode;
  const type = result?.metadata?.type;
  const modeLabel = MODE_LABELS[mode] || String(mode || "");

  return {
    ...result,
    geojson: {
      ...result.geojson,
      features: features.map((feature) => {
        const properties =
          feature?.properties && typeof feature.properties === "object"
            ? feature.properties
            : {};

        if (properties.maono_analysis === "isochrone_origin") {
          return {
            ...feature,
            properties: {
              ...properties,
              analysis_label: "Origem da análise",
              mode_label: modeLabel,
              range_label: "Origem",
            },
          };
        }

        if (properties.maono_analysis === "isochrone") {
          return {
            ...feature,
            properties: {
              ...properties,
              analysis_label: "Área alcançável",
              mode_label: modeLabel,
              range_label: formatRangeLabel(properties.range, type),
            },
          };
        }

        return feature;
      }),
    },
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    validateRequestOrigin(request);
    const body = await readBoundedJsonBody(request);
    assertIsochroneFeatureEnabled(env);
    const runtimeEnv = withMapAnalysisRuntimeDefaults(env);
    await ensureMapAnalysisRateLimitSchema(runtimeEnv);
    const result = enrichIsochroneResult(
      await generateIsochrone(runtimeEnv, request, body),
    );

    return jsonResponse({
      ok: true,
      ...result,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
