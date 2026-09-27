import { requireOrganizationPermission } from "../../../../../../_lib/permissions.js";
import { requireTicketAccess } from "../../../../../../_lib/ticket-access.js";
import { resolveTicketConversationContext } from "../../../../../../_lib/ticket-conversations.js";
import {
  getTicketResumableUploadCapability,
  listTicketAttachmentUploadSessions,
} from "../../../../../../_lib/ticket-attachment-uploads.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../../../../_lib/organizations.js";
import { ensureTicketCenterSchema, ticketCenterErrorResponse } from "../../../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed(context.request.method, ["GET"]);
}

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const ticketId = parsePositiveInteger(getRouteParam(params, "ticketId"), "ticketId");
    const { user } = await requireOrganizationPermission(
      env,
      request,
      "ticket.view",
      { organizationId, scopeType: "organization", resourceType: "ticket", resourceId: ticketId },
      { audit: false, resourceType: "ticket" },
    );
    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    await requireTicketAccess(env, organizationId, ticketId, user, "ticket.comment");
    const context = await resolveTicketConversationContext(env, organizationId, ticketId, user, { ticketView: true });
    const capability = await getTicketResumableUploadCapability(env);
    if (!capability.configured) {
      return jsonResponse(
        { ok: true, configured: false, schemaReady: false, sessions: [] },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const sessions = await listTicketAttachmentUploadSessions(env, context);
    return jsonResponse(
      { ok: true, configured: true, schemaReady: true, sessions },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
