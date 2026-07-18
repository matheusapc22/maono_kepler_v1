import { requireOrganizationPermission } from "../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../_lib/organizations.js";
import {
  createTicket,
  ensureTicketCenterSchema,
  listTickets,
  migrateLegacyTickets,
  parseTicketListOptions,
  ticketCenterErrorResponse,
} from "../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);

  return methodNotAllowed(context.request.method, ["GET", "POST"]);
}

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );

    const { user } = await requireOrganizationPermission(
      env,
      request,
      "ticket.view",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "ticket",
      },
      {
        audit: false,
        resourceType: "ticket",
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    await migrateLegacyTickets(env, organizationId, user.id);

    const data = await listTickets(
      env,
      organizationId,
      parseTicketListOptions(request.url),
    );

    return jsonResponse({ ok: true, ...data });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );

    const { user } = await requireOrganizationPermission(
      env,
      request,
      "ticket.create",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "ticket",
      },
      {
        audit: false,
        resourceType: "ticket",
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    await migrateLegacyTickets(env, organizationId, user.id);

    const ticket = await createTicket(
      env,
      organizationId,
      user,
      await readJsonBody(request),
      request,
    );

    return jsonResponse({ ok: true, ticket }, { status: 201 });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
