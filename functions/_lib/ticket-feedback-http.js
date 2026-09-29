import {
  jsonResponse,
  methodNotAllowed,
  getRouteParam,
  parsePositiveInteger,
} from "./organizations.js";
import { requireOrganizationPermission } from "./permissions.js";
import { ticketCenterErrorResponse } from "./ticket-center.js";
import { feedbackError } from "./ticket-feedback-domain.js";
import {
  listFeedback,
  feedbackInstrument,
  publishFeedbackInstrument,
  reconcileFeedback,
  respondFeedback,
  withdrawFeedback,
} from "./ticket-feedback.js";
async function body(request) {
  if (
    request.headers.get("Origin") &&
    request.headers.get("Origin") !== new URL(request.url).origin
  )
    throw feedbackError("ORIGIN_DENIED", 403);
  if (
    !String(request.headers.get("Content-Type")).startsWith("application/json")
  )
    throw feedbackError("JSON_REQUIRED", 415);
  const reader = request.body?.getReader();
  if (!reader) throw feedbackError("BODY_REQUIRED");
  let count = 0,
    raw = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > 16000) {
        await reader.cancel();
        throw feedbackError("BODY_LIMIT", 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw feedbackError("INVALID_JSON");
  }
}
export function ticketFeedbackRoute(action = "collection") {
  return async ({ env, request, params }) => {
    const methods =
      action === "reconcile" || action === "response"
        ? ["POST"]
        : action === "instrument"
          ? ["GET", "POST"]
          : ["GET"];
    if (!methods.includes(request.method))
      return methodNotAllowed(request.method, methods);
    try {
      const org = parsePositiveInteger(
        getRouteParam(params, "id"),
        "organizationId",
      );
      const { user } = await requireOrganizationPermission(
        env,
        request,
        ["instrument", "reconcile"].includes(action)
          ? "ticket.manage"
          : "ticket.view",
        {
          organizationId: org,
          scopeType: "organization",
          resourceType: "ticket",
        },
        { audit: false },
      );
      let result;
      if (request.method === "GET")
        result =
          action === "instrument"
            ? await feedbackInstrument(env, org, user)
            : await listFeedback(env, org, user, {
                after: new URL(request.url).searchParams.get("after") || "",
              });
      else {
        const v = await body(request);
        result =
          action === "instrument"
            ? await publishFeedbackInstrument(env, org, user, v)
            : action === "reconcile"
              ? await reconcileFeedback(env, org, user, v)
              : v.action === "withdraw"
                ? await withdrawFeedback(
                    env,
                    org,
                    user,
                    getRouteParam(params, "inviteId"),
                  )
                : await respondFeedback(
                    env,
                    org,
                    user,
                    getRouteParam(params, "inviteId"),
                    v,
                  );
      }
      return jsonResponse(
        { ok: true, ...result },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (e) {
      const response = ticketCenterErrorResponse(
        e.status && e.status < 500 ? e : feedbackError("UNAVAILABLE", 503),
        request,
      );
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  };
}
