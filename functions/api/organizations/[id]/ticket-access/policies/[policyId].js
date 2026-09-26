import { recordAuditLog, requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import { updateTicketAccessPolicy } from "../../../../../_lib/ticket-access.js";
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
    const policyId = String(getRouteParam(params, "policyId") || "").trim();
    const { user } = await requireOrganizationPermission(env, request, "ticket.access.manage", {
      organizationId, scopeType: "organization", resourceType: "ticket_access_policy", resourceId: policyId,
    }, { audit: false, auditOnSuccess: false, resourceType: "ticket_access_policy" });
    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    const policy = await updateTicketAccessPolicy(env, organizationId, policyId, await readJsonBody(request), user.id);
    await recordAuditLog(env, { actorUserId: user.id, organizationId, action: "ticket.access.policy.updated", resourceType: "ticket_access_policy", resourceId: policy.id, metadata: { active: policy.active, entries: policy.entries.length }, request });
    return jsonResponse({ ok: true, policy }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return ticketCenterErrorResponse(error, request); }
}
