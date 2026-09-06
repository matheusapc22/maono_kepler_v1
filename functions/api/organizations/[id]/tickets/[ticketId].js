import { getTicketReviewLink } from "../../../../_lib/project-change-request-inbox.js";
import { requireOrganizationPermission } from "../../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../../_lib/organizations.js";
import {
  ensureTicketCenterSchema,
  getTicketDetails,
  migrateLegacyTickets,
  ticketCenterErrorResponse,
  updateTicket,
} from "../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);

  return methodNotAllowed(context.request.method, ["GET", "PATCH"]);
}

function routeIds(params) {
  return {
    organizationId: parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    ),
    ticketId: parsePositiveInteger(
      getRouteParam(params, "ticketId"),
      "ticketId",
    ),
  };
}

export async function onRequestGet({ env, request, params }) {
  try {
    const { organizationId, ticketId } = routeIds(params);
    const { user } = await requireOrganizationPermission(
      env,
      request,
      "ticket.view",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "ticket",
        resourceId: ticketId,
      },
      {
        audit: false,
        resourceType: "ticket",
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    await migrateLegacyTickets(env, organizationId, user.id);

    const detail = await getTicketDetails(env, organizationId, ticketId);
    const changeRequest = await getTicketReviewLink(env, request, organizationId, ticketId);
    const response = jsonResponse({ ok: true, ...detail, changeRequest });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestPatch({ env, request, params }) {
  try {
    const { organizationId, ticketId } = routeIds(params);
    const { user } = await requireOrganizationPermission(
      env,
      request,
      "ticket.manage",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "ticket",
        resourceId: ticketId,
      },
      {
        audit: false,
        resourceType: "ticket",
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    await migrateLegacyTickets(env, organizationId, user.id);

    const ticket = await updateTicket(
      env,
      organizationId,
      ticketId,
      user,
      await readJsonBody(request),
      request,
    );

    return jsonResponse({ ok: true, ticket });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
