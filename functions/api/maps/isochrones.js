import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../_lib/http.js";
import {
  generateIsochrone,
} from "../../_lib/isochrone-service.js";

const MAX_REQUEST_BYTES = 16 * 1024;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  const contentLength = Number(
    request.headers.get("content-length") || 0,
  );

  if (contentLength > MAX_REQUEST_BYTES) {
    return errorResponse(
      "A solicitação excede o limite permitido.",
      413,
      "ISOCHRONE_REQUEST_TOO_LARGE",
    );
  }

  try {
    const body = await readJsonBody(request);

    if (!body) {
      return errorResponse(
        "Envie uma solicitação JSON válida.",
        400,
        "INVALID_JSON_BODY",
      );
    }

    const result = await generateIsochrone(
      env,
      request,
      body,
    );

    return jsonResponse({
      ok: true,
      ...result,
    });
  } catch (error) {
    return errorResponse(
      error?.message || "Não foi possível gerar a isócrona.",
      Number(error?.status || 500),
      error?.code || "ISOCHRONE_GENERATION_ERROR",
      error?.details || null,
    );
  }
}
