import {
  jsonResponse,
  methodNotAllowed,
  getRouteParam,
  parsePositiveInteger,
} from "./organizations.js";
import { requireOrganizationPermission } from "./permissions.js";
import { ticketCenterErrorResponse } from "./ticket-center.js";
import {
  listKnowledge,
  readKnowledge,
  commandKnowledge,
  sendKnowledge,
  selectKnowledge,
  knowledgeError,
} from "./ticket-knowledge.js";
async function body(request) {
  if (
    request.headers.get("Origin") &&
    request.headers.get("Origin") !== new URL(request.url).origin
  )
    throw knowledgeError("ORIGIN_DENIED", 403);
  if (
    !String(request.headers.get("Content-Type")).startsWith("application/json")
  )
    throw knowledgeError("JSON_REQUIRED", 415);
  const reader = request.body?.getReader();
  if (!reader) throw knowledgeError("BODY_REQUIRED");
  let count = 0,
    raw = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > 80000) {
        await reader.cancel();
        throw knowledgeError("BODY_LIMIT", 413);
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
    throw knowledgeError("INVALID_JSON");
  }
}
export function ticketKnowledgeRoute(action = "collection") {
  return async ({ env, request, params }) => {
    const methods = ["send", "select"].includes(action)
      ? ["POST"]
      : ["GET", "POST"];
    if (!methods.includes(request.method))
      return methodNotAllowed(request.method, methods);
    try {
      const org = parsePositiveInteger(
          getRouteParam(params, "id"),
          "organizationId",
        ),
        articleId = getRouteParam(params, "articleId");
      const { user } = await requireOrganizationPermission(
        env,
        request,
        request.method === "POST" && !["select", "send"].includes(action)
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
      if (request.method === "GET") {
        const q = new URL(request.url).searchParams;
        result =
          action === "collection"
            ? await listKnowledge(env, org, user, {
                suggestions: q.get("suggestions") === "true",
                query: q.get("q") || "",
                after: q.get("after") || "",
              })
            : await readKnowledge(env, org, user, articleId, {
                before: Number(q.get("before") || 2147483647),
                eventsBefore: Number(
                  q.get("eventsBefore") || Number.MAX_SAFE_INTEGER,
                ),
              });
      } else {
        const value = await body(request);
        result =
          action === "send"
            ? await sendKnowledge(env, org, user, articleId, value, request)
            : action === "select"
              ? await selectKnowledge(env, org, user, articleId, value)
              : await commandKnowledge(
                  env,
                  org,
                  user,
                  articleId || null,
                  value,
                );
      }
      return jsonResponse(
        { ok: true, ...result },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (e) {
      const error =
        e.status && e.status < 500 ? e : knowledgeError("UNAVAILABLE", 503);
      const response = ticketCenterErrorResponse(error, request);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  };
}
