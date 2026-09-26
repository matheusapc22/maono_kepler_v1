import { authorizeTicketConversation } from "../../../../../../_lib/ticket-conversation-http.js";
import { editTicketMessage } from "../../../../../../_lib/ticket-conversations.js";
import {
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../../../../_lib/organizations.js";
import { ticketCenterErrorResponse } from "../../../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "PATCH") return onRequestPatch(context);
  return methodNotAllowed(context.request.method, ["PATCH"]);
}

export async function onRequestPatch({ env, request, params }) {
  try {
    const { conversationContext } = await authorizeTicketConversation(env, request, params);
    const result = await editTicketMessage(
      env,
      conversationContext,
      getRouteParam(params, "messageId"),
      await readJsonBody(request),
      request,
    );
    return jsonResponse({ ok: true, message: result.message }, {
      headers: {
        "Cache-Control": "private, no-store",
        "Idempotency-Replayed": String(result.replayed),
        ETag: result.message.etag,
      },
    });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
