import { authorizeTicketConversation } from "../../../../../../../_lib/ticket-conversation-http.js";
import { listTicketMessageRevisions } from "../../../../../../../_lib/ticket-conversations.js";
import {
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
} from "../../../../../../../_lib/organizations.js";
import { ticketCenterErrorResponse } from "../../../../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed(context.request.method, ["GET"]);
}

export async function onRequestGet({ env, request, params }) {
  try {
    const { conversationContext } = await authorizeTicketConversation(env, request, params);
    const revisions = await listTicketMessageRevisions(
      env,
      conversationContext,
      getRouteParam(params, "messageId"),
    );
    return jsonResponse({ ok: true, revisions }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
