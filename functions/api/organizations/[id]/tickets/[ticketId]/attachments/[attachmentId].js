import {
  can,
  requireOrganizationPermission,
} from "../../../../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../../../../_lib/organizations.js";
import {
  canCreatorDeleteAttachment,
  deleteTicketAttachment,
  ensureTicketCenterSchema,
  getTicketAttachmentRecordOrThrow,
  getTicketOrThrow,
  ticketCenterErrorResponse,
  uploadTicketAttachmentChunk,
} from "../../../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "PATCH") return onRequestPatch(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return methodNotAllowed(context.request.method, ["PATCH", "DELETE"]);
}

export async function onRequestPatch({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );
    const ticketId = parsePositiveInteger(
      getRouteParam(params, "ticketId"),
      "ticketId",
    );
    const attachmentId = parsePositiveInteger(
      getRouteParam(params, "attachmentId"),
      "attachmentId",
    );
    const permissionContext = {
      organizationId,
      scopeType: "organization",
      resourceType: "ticket",
      resourceId: ticketId,
    };
    const { user } = await requireOrganizationPermission(
      env,
      request,
      "ticket.view",
      permissionContext,
      { audit: false, resourceType: "ticket" },
    );

    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
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

    const result = await uploadTicketAttachmentChunk(
      env,
      organizationId,
      ticketId,
      attachmentId,
      user,
      request,
    );
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestDelete({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );
    const ticketId = parsePositiveInteger(
      getRouteParam(params, "ticketId"),
      "ticketId",
    );
    const attachmentId = parsePositiveInteger(
      getRouteParam(params, "attachmentId"),
      "attachmentId",
    );

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
    const ticket = await getTicketOrThrow(env, organizationId, ticketId);
    const attachment = await getTicketAttachmentRecordOrThrow(
      env,
      organizationId,
      ticketId,
      attachmentId,
      ["ACTIVE", "PENDING"],
    );

    const manageDecision = await can(env, user, "ticket.manage", {
      organizationId,
      scopeType: "organization",
      resourceType: "ticket",
      resourceId: ticketId,
    });

    if (
      !manageDecision.allowed &&
      !canCreatorDeleteAttachment(ticket, attachment, user.id)
    ) {
      const error = new Error("Você não pode excluir este anexo.");
      error.status = 403;
      error.code = "ATTACHMENT_DELETE_FORBIDDEN";
      throw error;
    }

    await deleteTicketAttachment(
      env,
      organizationId,
      ticketId,
      attachmentId,
      user,
      request,
    );

    return jsonResponse({ ok: true, deleted: true });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
