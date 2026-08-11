import {
  errorResponse,
  errorResponseFromError,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../_lib/http.js";
import { requireSession } from "../../_lib/auth.js";
import { getOrCreateCorrelationId } from "../../_lib/maono-error.js";
import {
  logMapLoadTrace,
  sanitizeMapLoadTracePayload,
} from "../../_lib/map-load-observability.js";

export async function onRequest(context) {
  const { request, env } = context;
  const requestCorrelationId = getOrCreateCorrelationId(request);

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"], { correlationId: requestCorrelationId });
  }

  try {
    await requireSession(env, request);
    const body = await readJsonBody(request);
    const trace = sanitizeMapLoadTracePayload(body);

    if (!trace) {
      return errorResponse(
        "Trace de carregamento inválido.",
        400,
        "OBSERVABILITY_MAP_LOAD_TRACE_INVALID",
        null,
        { correlationId: requestCorrelationId },
      );
    }

    logMapLoadTrace(trace);

    return jsonResponse(
      {
        ok: true,
        correlationId: trace.correlationId,
      },
      {
        status: 202,
        headers: {
          "X-Correlation-Id": trace.correlationId,
        },
      },
    );
  } catch (error) {
    return errorResponseFromError(error, {
      correlationId: requestCorrelationId,
      publicMessage: "Não foi possível registrar a telemetria de carregamento.",
    });
  }
}
