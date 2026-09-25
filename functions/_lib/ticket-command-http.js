import { requireOrganizationPermission } from "./permissions.js";
import {
  getOrganizationOrThrow, getRouteParam, jsonResponse,
  parsePositiveInteger, readJsonBody,
} from "./organizations.js";
import { ensureTicketCenterSchema, ticketCenterErrorResponse } from "./ticket-center.js";
import { assertTicketCommandReady, readTicketCommandState } from "./ticket-commands.js";

export function ticketCommandRouteIds(params) {
  return {
    organizationId: parsePositiveInteger(getRouteParam(params, "id"), "organizationId"),
    ticketId: parsePositiveInteger(getRouteParam(params, "ticketId"), "ticketId"),
  };
}

async function authorize(env, request, ids, permission) {
  const { user } = await requireOrganizationPermission(env, request, permission, {
    organizationId: ids.organizationId, scopeType: "organization",
    resourceType: "ticket", resourceId: ids.ticketId,
  }, { audit: false, auditOnSuccess: false, resourceType: "ticket" });
  await getOrganizationOrThrow(env, ids.organizationId);
  await ensureTicketCenterSchema(env);
  await assertTicketCommandReady(env, ids.organizationId);
  return user;
}

// This ETag validates only the canonical state resource, not the detail
// envelope containing attachment progress, user names and authorized CR links.
export async function ticketCommandStateResponse({ env, request, params }) {
  try {
    const ids = ticketCommandRouteIds(params);
    await authorize(env, request, ids, "ticket.view");
    const { state, etag } = await readTicketCommandState(env, ids.organizationId, ids.ticketId);
    return jsonResponse({ ok: true, state }, { headers: {
      ETag: etag, "Cache-Control": "private, no-store",
      "Content-Location": new URL(request.url).pathname,
    } });
  } catch (error) { return ticketCenterErrorResponse(error, request); }
}

export async function ticketCommandResponse({ env, request, params }, execute, { correction = false } = {}) {
  try {
    const ids = ticketCommandRouteIds(params);
    // Keep the existing organizational management gate until CC-04 defines
    // granular action permissions and object ACLs. Never grant from a link.
    const user = await authorize(env, request, ids, "ticket.manage");
    const payload = await readJsonBody(request);
    const commandPayload = correction ? {
      ...payload,
      eventId: parsePositiveInteger(getRouteParam(params, "eventId"), "eventId"),
    } : payload;
    const result = await execute(env, ids.organizationId, ids.ticketId, user, commandPayload, request);
    return jsonResponse({ ok: true, ticket: result.ticket }, { status: result.status || 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return ticketCenterErrorResponse(error, request); }
}
