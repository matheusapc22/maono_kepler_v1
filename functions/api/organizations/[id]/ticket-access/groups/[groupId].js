import { recordAuditLog, requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import { updateTicketAccessGroup } from "../../../../../_lib/ticket-access.js";
import { ensureTicketCenterSchema, ticketCenterErrorResponse } from "../../../../../_lib/ticket-center.js";
import {
  getOrganizationOrThrow, getRouteParam, jsonResponse, methodNotAllowed,
  parsePositiveInteger, readJsonBody,
} from "../../../../../_lib/organizations.js";

export async function onRequest(context) {
  return context.request.method === "PATCH" ? onRequestPatch(context) : methodNotAllowed(context.request.method, ["PATCH"]);
}

export async function onRequestPatch({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const groupId = String(getRouteParam(params, "groupId") || "").trim();
    const { user } = await requireOrganizationPermission(env, request, "ticket.access.manage", {
      organizationId, scopeType: "organization", resourceType: "ticket_access_group", resourceId: groupId,
    }, { audit: false, auditOnSuccess: false, resourceType: "ticket_access_group" });
    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    const group = await updateTicketAccessGroup(env, organizationId, groupId, await readJsonBody(request), user.id);
    await recordAuditLog(env, { actorUserId: user.id, organizationId, action: "ticket.access.group.updated", resourceType: "ticket_access_group", resourceId: group.id, metadata: { active: group.active, memberCount: group.memberCount }, request });
    return jsonResponse({ ok: true, group }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return ticketCenterErrorResponse(error, request); }
}
