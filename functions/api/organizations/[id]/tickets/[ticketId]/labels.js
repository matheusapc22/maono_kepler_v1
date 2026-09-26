import { recordAuditLog, requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import { getTicketLabels, replaceTicketLabels, requireTicketAccess } from "../../../../../_lib/ticket-access.js";
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
    const permission = write ? "ticket.manage" : "ticket.view";
    const { user } = await requireOrganizationPermission(env, request, permission, {
      organizationId, scopeType: "organization", resourceType: "ticket", resourceId: ticketId,
    }, { audit: false, auditOnSuccess: false, resourceType: "ticket" });
    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    await requireTicketAccess(env, organizationId, ticketId, user, permission);
    const data = write
      ? await replaceTicketLabels(env, organizationId, ticketId, await readJsonBody(request), user.id)
      : await getTicketLabels(env, organizationId, ticketId);
    if (write) await recordAuditLog(env, { actorUserId: user.id, organizationId, action: "ticket.labels.updated", resourceType: "ticket", resourceId: ticketId, metadata: { labels: data.labels.map((label) => label.name) }, request });
    return jsonResponse({ ok: true, ...data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return ticketCenterErrorResponse(error, request); }
}
