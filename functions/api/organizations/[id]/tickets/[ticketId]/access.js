import { recordAuditLog, requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import { getTicketAccessConfiguration, replaceTicketAccessConfiguration } from "../../../../../_lib/ticket-access.js";
import { ensureTicketCenterSchema, ticketCenterErrorResponse } from "../../../../../_lib/ticket-center.js";
import {
  getOrganizationOrThrow, getRouteParam, jsonResponse, methodNotAllowed,
  parsePositiveInteger, readJsonBody,
} from "../../../../../_lib/organizations.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return handle(context, false);
  if (context.request.method === "PUT") return handle(context, true);
  return methodNotAllowed(context.request.method, ["GET", "PUT"]);
}

async function handle({ env, request, params }, write) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const ticketId = parsePositiveInteger(getRouteParam(params, "ticketId"), "ticketId");
    const { user } = await requireOrganizationPermission(env, request, "ticket.access.manage", {
      organizationId, scopeType: "organization", resourceType: "ticket", resourceId: ticketId,
    }, { audit: false, auditOnSuccess: false, resourceType: "ticket" });
    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    const access = write
      ? await replaceTicketAccessConfiguration(env, organizationId, ticketId, await readJsonBody(request), user.id)
      : await getTicketAccessConfiguration(env, organizationId, ticketId);
    if (write) await recordAuditLog(env, { actorUserId: user.id, organizationId, action: "ticket.access.updated", resourceType: "ticket", resourceId: ticketId, metadata: { visibility: access.visibility, aclEntries: access.acl.length, policies: access.policies.length }, request });
    return jsonResponse({ ok: true, access }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return ticketCenterErrorResponse(error, request); }
}
