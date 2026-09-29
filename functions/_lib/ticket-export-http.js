import {
  jsonResponse,
  methodNotAllowed,
  getRouteParam,
  parsePositiveInteger,
} from "./organizations.js";
import { requireOrganizationPermission } from "./permissions.js";
import { ticketCenterErrorResponse } from "./ticket-center.js";
import { exportError } from "./ticket-export-domain.js";
import {
  createTicketExport,
  listTicketExports,
  readTicketExport,
  cancelTicketExport,
  retryTicketExport,
  downloadTicketExport,
} from "./ticket-exports.js";

async function readBody(request) {
  if (
    request.headers.get("Origin") &&
    request.headers.get("Origin") !== new URL(request.url).origin
  )
    throw exportError("ORIGIN_DENIED", 403);
  if (
    !String(request.headers.get("Content-Type")).startsWith("application/json")
  )
    throw exportError("JSON_REQUIRED", 415);
  if (Number(request.headers.get("Content-Length") || 0) > 4096)
    throw exportError("BODY_LIMIT", 413);
  const reader = request.body?.getReader();
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  if (!reader) throw exportError("INVALID_REQUEST");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        throw exportError("BODY_LIMIT", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw exportError("INVALID_JSON");
  }
}
export function ticketExportRoute(action = "collection") {
  return async ({ env, request, params }) => {
    const methods =
      action === "collection"
        ? ["GET", "POST"]
        : ["cancel", "retry"].includes(action)
          ? ["POST"]
          : ["GET"];
    if (!methods.includes(request.method))
      return methodNotAllowed(request.method, methods);
    try {
      const org = parsePositiveInteger(
        getRouteParam(params, "id"),
        "organizationId",
      );
      const permission =
        request.method === "POST"
          ? "export.create"
          : action === "download"
            ? "export.download"
            : "export.view";
      const authenticate = () =>
        requireOrganizationPermission(
          env,
          request,
          permission,
          {
            organizationId: org,
            scopeType: "organization",
            resourceType: "ticket",
          },
          { audit: false },
        );
      const { user } = await authenticate(),
        id = getRouteParam(params, "exportId");
      let result;
      if (action === "download")
        return await downloadTicketExport(env, org, user, id, {
          reauthenticate: authenticate,
        });
      if (action === "collection")
        result =
          request.method === "POST"
            ? await createTicketExport(env, org, user, await readBody(request))
            : await listTicketExports(
                env,
                org,
                user,
                new URL(request.url).searchParams.get("before"),
              );
      else if (action === "detail")
        result = await readTicketExport(env, org, user, id);
      else {
        const body = await readBody(request);
        result =
          action === "cancel"
            ? await cancelTicketExport(env, org, user, id)
            : await retryTicketExport(env, org, user, id, body?.idempotencyKey);
      }
      return jsonResponse(
        { ok: true, ...result },
        {
          status:
            request.method === "POST" && action === "collection" ? 202 : 200,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    } catch (error) {
      // Provider/database exceptions can include private paths/SQL. Only safe domain messages leave this boundary.
      const safe =
        error.status && error.status < 500
          ? error
          : exportError(
              "UNAVAILABLE",
              503,
              "Exportação temporariamente indisponível. Tente novamente mais tarde.",
            );
      const response = ticketCenterErrorResponse(safe, request);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  };
}
