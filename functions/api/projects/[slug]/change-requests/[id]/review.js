import { readJsonBody } from "../../../../../_lib/organizations.js";
import {
  getProjectChangeRequestReview,
  reviewProjectChangeRequestAction,
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
  const code = error?.code || "PROJECT_CHANGE_REQUEST_REVIEW_INTERNAL_ERROR";
  const retryable = Boolean(error?.retryable || error?.details?.retryable);
  const message =
    safeStatus >= 500 && !error?.publicMessage
      ? "Erro interno ao processar o Review da solicitação."
      : error?.publicMessage || error?.message || "Erro no Review da solicitação.";

  if (safeStatus >= 500) {
    console.error(`[Maono change request review][${requestId}][${code}]`, error);
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

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, POST" },
  });
}

export async function onRequestGet({ env, request, params }) {
  try {
    const review = await getProjectChangeRequestReview(
      env,
      request,
      routeValue(params, "slug"),
      routeValue(params, "id"),
    );
    return Response.json({ ok: true, review });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const review = await reviewProjectChangeRequestAction(
      env,
      request,
      routeValue(params, "slug"),
      routeValue(params, "id"),
      await readJsonBody(request),
    );
    return Response.json({ ok: true, review });
  } catch (error) {
    return errorResponse(error, request);
  }
}
