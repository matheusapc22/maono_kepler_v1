import {
  can,
  requireOrganizationPermission,
} from "../../../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../../../_lib/organizations.js";
import {
  createTicketAttachment,
  ensureTicketCenterSchema,
  getTicketOrThrow,
  listTicketAttachments,
} from "../../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);

  return methodNotAllowed(context.request.method, ["GET", "POST"]);
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

async function ticketViewContext(env, request, organizationId, ticketId) {
  return requireOrganizationPermission(
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
}

export async function onRequestGet({ env, request, params }) {
  try {
    const { organizationId, ticketId } = routeIds(params);
    await ticketViewContext(env, request, organizationId, ticketId);
    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    await getTicketOrThrow(env, organizationId, ticketId);

    return jsonResponse({
      ok: true,
      attachments: await listTicketAttachments(
        env,
        organizationId,
        ticketId,
      ),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const { organizationId, ticketId } = routeIds(params);
    const { user } = await ticketViewContext(
      env,
      request,
      organizationId,
      ticketId,
    );
    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);

    const permissionContext = {
      organizationId,
      scopeType: "organization",
      resourceType: "ticket",
      resourceId: ticketId,
    };
    const createDecision = await can(
      env,
      user,
      "ticket.create",
      permissionContext,
    );
    const manageDecision = await can(
      env,
      user,
      "ticket.manage",
      permissionContext,
    );

    if (!createDecision.allowed && !manageDecision.allowed) {
      const error = new Error("Você não pode adicionar anexos a este chamado.");
      error.status = 403;
      error.code = "ATTACHMENT_UPLOAD_FORBIDDEN";
      throw error;
    }

    const attachment = await createTicketAttachment(
      env,
      organizationId,
      ticketId,
      user,
      request,
    );

    return jsonResponse({ ok: true, attachment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

