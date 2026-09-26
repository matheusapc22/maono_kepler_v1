import { recordAuditLog, requireOrganizationPermission } from "../../../../_lib/permissions.js";
import { createTicketAccessGroup, listTicketAccessGroups } from "../../../../_lib/ticket-access.js";
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
    organizationId, scopeType: "organization", resourceType: "ticket_access_group",
  }, { audit: false, auditOnSuccess: false, resourceType: "ticket_access_group" });
  await getOrganizationOrThrow(env, organizationId);
  await ensureTicketCenterSchema(env);
  return { organizationId, user };
}

export async function onRequestGet({ env, request, params }) {
  try {
    const { organizationId } = await authorize(env, request, params);
    return jsonResponse({ ok: true, groups: await listTicketAccessGroups(env, organizationId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return ticketCenterErrorResponse(error, request); }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const { organizationId, user } = await authorize(env, request, params);
    const group = await createTicketAccessGroup(env, organizationId, await readJsonBody(request), user.id);
    await recordAuditLog(env, { actorUserId: user.id, organizationId, action: "ticket.access.group.created", resourceType: "ticket_access_group", resourceId: group.id, metadata: { name: group.name }, request });
    return jsonResponse({ ok: true, group }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return ticketCenterErrorResponse(error, request); }
}
