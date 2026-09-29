import {
  jsonResponse,
  methodNotAllowed,
  getRouteParam,
  parsePositiveInteger,
} from "./organizations.js";
import { requireOrganizationPermission } from "./permissions.js";
import { ticketCenterErrorResponse } from "./ticket-center.js";
import {
  listCases,
  readCase,
  commandCase,
  communicateCase,
  caseError,
} from "./ticket-cases.js";
async function body(request) {
  if (
    request.headers.get("Origin") &&
    request.headers.get("Origin") !== new URL(request.url).origin
  )
    throw caseError("ORIGIN_DENIED", 403);
  if (
    !String(request.headers.get("Content-Type")).startsWith("application/json")
  )
    throw caseError("JSON_REQUIRED", 415);
  const reader = request.body?.getReader();
  if (!reader) throw caseError("BODY_REQUIRED");
  let count = 0,
    raw = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > 24000) {
        await reader.cancel();
        throw caseError("BODY_LIMIT", 413);
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
    throw caseError("INVALID_JSON");
  }
}
export function ticketCaseRoute(action = "collection") {
  return async ({ env, request, params }) => {
    const methods = action === "communicate" ? ["POST"] : ["GET", "POST"];
    if (!methods.includes(request.method))
      return methodNotAllowed(request.method, methods);
    try {
      const org = parsePositiveInteger(
          getRouteParam(params, "id"),
          "organizationId",
        ),
        caseId = getRouteParam(params, "caseId");
      const { user } = await requireOrganizationPermission(
        env,
        request,
        request.method === "POST" ? "ticket.manage" : "ticket.view",
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
            ? await listCases(env, org, user, {
                kind: q.get("kind") || "",
                query: q.get("q") || "",
                after: q.get("after") || "",
              })
            : await readCase(env, org, user, caseId);
      } else {
        const value = await body(request);
        result =
          action === "communicate"
            ? await communicateCase(env, org, user, caseId, value, request)
            : await commandCase(env, org, user, caseId || null, value);
      }
      return jsonResponse(
        { ok: true, ...result },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (e) {
      const error =
        e.status && e.status < 500 ? e : caseError("UNAVAILABLE", 503);
      const response = ticketCenterErrorResponse(error, request);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  };
}
