import { requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import {
  getRouteParam,
  parsePositiveInteger,
  readJsonBody,
} from "../../../../../_lib/organizations.js";
import {
  listTicketChanges,
  executeChangeCommand,
  changeError,
} from "../../../../../_lib/ticket-changes.js";
import { ticketCenterErrorResponse } from "../../../../../_lib/ticket-center.js";
export async function onRequest({ env, request, params }) {
  try {
    if (!["GET", "POST"].includes(request.method))
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, POST" },
      });
    const organizationId = parsePositiveInteger(
        getRouteParam(params, "id"),
        "organizationId",
      ),
      ticketId = parsePositiveInteger(
        getRouteParam(params, "ticketId"),
        "ticketId",
      );
    if (request.method === "POST") {
      const origin = request.headers.get("Origin");
      if (origin && origin !== new URL(request.url).origin)
        throw changeError("CHANGE_ORIGIN_DENIED", 403);
      if (
        !String(request.headers.get("Content-Type")).startsWith(
          "application/json",
        )
      )
        throw changeError("CHANGE_JSON_REQUIRED", 415);
    }
    const { user } = await requireOrganizationPermission(
      env,
      request,
      request.method === "GET" ? "ticket.view" : "ticket.manage",
      { organizationId, scopeType: "organization", resourceType: "ticket" },
      { audit: false },
    );
    const url = new URL(request.url);
    const result =
      request.method === "GET"
        ? await listTicketChanges(env, organizationId, ticketId, user, {
            after: url.searchParams.get("after") || "",
          })
        : await executeChangeCommand(
            env,
            organizationId,
            ticketId,
            user,
            await readJsonBody(request),
            request.headers.get("Idempotency-Key"),
          );
    return Response.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
