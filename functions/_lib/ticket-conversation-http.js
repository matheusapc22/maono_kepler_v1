import { requireOrganizationPermission } from "./permissions.js";
import { requireTicketAccess } from "./ticket-access.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  parsePositiveInteger,
} from "./organizations.js";
import { ensureTicketCenterSchema } from "./ticket-center.js";
import { resolveTicketConversationContext } from "./ticket-conversations.js";

export function ticketConversationRouteIds(params) {
  return {
    organizationId: parsePositiveInteger(getRouteParam(params, "id"), "organizationId"),
    ticketId: parsePositiveInteger(getRouteParam(params, "ticketId"), "ticketId"),
  };
}

export async function authorizeTicketConversation(env, request, params) {
  const ids = ticketConversationRouteIds(params);
  const { user } = await requireOrganizationPermission(
    env,
    request,
    "ticket.view",
    {
      organizationId: ids.organizationId,
      scopeType: "organization",
      resourceType: "ticket",
      resourceId: ids.ticketId,
    },
    { audit: false, resourceType: "ticket" },
  );
  await getOrganizationOrThrow(env, ids.organizationId);
  await ensureTicketCenterSchema(env);
  await requireTicketAccess(env, ids.organizationId, ids.ticketId, user, "ticket.view");
  return {
    ...ids,
    user,
    conversationContext: await resolveTicketConversationContext(
      env,
      ids.organizationId,
      ids.ticketId,
      user,
      { ticketView: true },
    ),
  };
}
