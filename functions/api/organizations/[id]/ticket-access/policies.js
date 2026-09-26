import { recordAuditLog, requireOrganizationPermission } from "../../../../_lib/permissions.js";
import { createTicketAccessPolicy, listTicketAccessPolicies } from "../../../../_lib/ticket-access.js";
import { ensureTicketCenterSchema, ticketCenterErrorResponse } from "../../../../_lib/ticket-center.js";
import {
  getOrganizationOrThrow, getRouteParam, jsonResponse, methodNotAllowed,
  parsePositiveInteger, readJsonBody,
} from "../../../../_lib/organizations.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed(context.request.method, ["GET", "POST"]);
}

async function authorize(env, request, params) {
  const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
  const { user } = await requireOrganizationPermission(env, request, "ticket.access.manage", {
    organizationId, scopeType: "organization", resourceType: "ticket_access_policy",
  }, { audit: false, auditOnSuccess: false, resourceType: "ticket_access_policy" });
  await getOrganizationOrThrow(env, organizationId);
  await ensureTicketCenterSchema(env);
  return { organizationId, user };
}

export async function onRequestGet({ env, request, params }) {
  try {
    const { organizationId } = await authorize(env, request, params);
    return jsonResponse({ ok: true, policies: await listTicketAccessPolicies(env, organizationId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return ticketCenterErrorResponse(error, request); }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const { organizationId, user } = await authorize(env, request, params);
    const policy = await createTicketAccessPolicy(env, organizationId, await readJsonBody(request), user.id);
    await recordAuditLog(env, { actorUserId: user.id, organizationId, action: "ticket.access.policy.created", resourceType: "ticket_access_policy", resourceId: policy.id, metadata: { name: policy.name, entries: policy.entries.length }, request });
    return jsonResponse({ ok: true, policy }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return ticketCenterErrorResponse(error, request); }
}
