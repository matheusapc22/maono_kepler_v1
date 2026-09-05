import { readJsonBody } from "../../../../../_lib/organizations.js";
import {
  getProjectChangeRequestReview,
  reviewProjectChangeRequestAction,
} from "../../../../../_lib/project-change-request-review.js";

function routeValue(params, key) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function requestId(request) {
  return (
    request?.headers?.get("X-Request-Id")?.trim() ||
    request?.headers?.get("X-Correlation-Id")?.trim() ||
    crypto.randomUUID()
  );
}

function responseHeaders(id) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": id,
  };
}

function reviewResponse(review, request) {
  const id = requestId(request);
  const body = JSON.stringify({ ok: true, review });
  console.info("[Maono change request review]", {
    event: "change_request_review_served",
    requestId: id,
    changeRequestId: review?.changeRequest?.id || null,
    projectId: review?.project?.id || null,
    baseRevision: review?.base?.revision ?? null,
    currentRevision: review?.project?.currentRevision ?? null,
    operationCount: review?.operations?.length ?? 0,
    baseConfigSizeBytes: review?.base?.sizeBytes ?? null,
    reviewPayloadBytes: new TextEncoder().encode(body).byteLength,
    contractVersion: review?.contractVersion ?? null,
  });
  return new Response(body, {
    status: 200,
    headers: responseHeaders(id),
  });
}

function errorResponse(error, request) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const id = requestId(request);
  const code = error?.code || "PROJECT_CHANGE_REQUEST_REVIEW_INTERNAL_ERROR";
  const retryable = Boolean(error?.retryable || error?.details?.retryable);
  const message =
    safeStatus >= 500 && !error?.publicMessage
      ? "Erro interno ao processar o Review da solicitação."
      : error?.publicMessage || error?.message || "Erro no Review da solicitação.";

  if (safeStatus >= 500) {
    console.error(`[Maono change request review][${id}][${code}]`, error);
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        retryable,
        requestId: id,
        details: error?.details || undefined,
      },
    }),
    { status: safeStatus, headers: responseHeaders(id) },
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
    return reviewResponse(review, request);
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
    return reviewResponse(review, request);
  } catch (error) {
    return errorResponse(error, request);
  }
}
