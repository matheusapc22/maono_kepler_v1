import {
  recordAuditLog,
  requireOrganizationPermission,
} from "../../../../../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../../../../../_lib/organizations.js";
import {
  downloadTicketAttachment,
  ensureTicketCenterSchema,
  ticketCenterErrorResponse,
} from "../../../../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed(context.request.method, ["GET"]);
}

export async function onRequestGet({ env, request, params }) {
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
        resourceType: "ticket_attachment",
        resourceId: attachmentId,
      },
      {
        audit: false,
        resourceType: "ticket_attachment",
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    const download = await downloadTicketAttachment(
      env,
      organizationId,
      ticketId,
      attachmentId,
    );

    await recordAuditLog(env, {
      actorUserId: user.id,
      organizationId,
      action: "ticket.attachment.downloaded",
      resourceType: "ticket_attachment",
      resourceId: attachmentId,
      metadata: { ticketId, fileName: download.attachment.original_name },
      request,
    });

    return new Response(download.response.body, {
      status: 200,
      headers: download.headers,
    });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
