import {
  applyProjectChangeRequest,
} from "../../../../../_lib/project-change-request-review.js";

function routeValue(params, key) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function errorResponse(error, request) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const requestId =
    request?.headers?.get("X-Request-Id")?.trim() ||
    request?.headers?.get("X-Correlation-Id")?.trim() ||
    crypto.randomUUID();
  const code = error?.code || "PROJECT_CHANGE_REQUEST_APPLY_INTERNAL_ERROR";
  const retryable = Boolean(error?.retryable || error?.details?.retryable);
  const message =
    safeStatus >= 500 && !error?.publicMessage
      ? "Erro interno ao aplicar a solicitação de alteração."
      : error?.publicMessage || error?.message || "Erro ao aplicar a solicitação.";

  if (safeStatus >= 500) {
    console.error(`[Maono change request apply][${requestId}][${code}]`, error);
  }

  return Response.json(
    {
      ok: false,
      error: {
        code,
        message,
        retryable,
        requestId,
        details: error?.details || undefined,
      },
    },
    { status: safeStatus, headers: { "X-Request-Id": requestId } },
  );
}

export async function onRequest({ env, request, params }) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  try {
    const result = await applyProjectChangeRequest(
      env,
      request,
      routeValue(params, "slug"),
      routeValue(params, "id"),
    );
    return Response.json({
      ok: true,
      appliedRevision: result.appliedRevision,
      idempotent: result.idempotent,
      projectIdentity: result.projectIdentity || null,
      review: result.workspace,
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
