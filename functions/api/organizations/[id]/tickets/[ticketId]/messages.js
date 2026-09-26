import { authorizeTicketConversation } from "../../../../../_lib/ticket-conversation-http.js";
import {
  createTicketMessage,
  listTicketMessages,
} from "../../../../../_lib/ticket-conversations.js";
import {
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../../../_lib/organizations.js";
import { ticketCenterErrorResponse } from "../../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed(context.request.method, ["GET", "POST"]);
}

export async function onRequestGet({ env, request, params }) {
  try {
    const { conversationContext } = await authorizeTicketConversation(env, request, params);
    const url = new URL(request.url);
    const page = await listTicketMessages(env, conversationContext, {
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
    });
    return jsonResponse({ ok: true, ...page }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const { conversationContext } = await authorizeTicketConversation(env, request, params);
    const result = await createTicketMessage(
      env,
      conversationContext,
      await readJsonBody(request),
      request,
    );
    return jsonResponse({ ok: true, message: result.message }, {
      status: result.replayed ? 200 : 201,
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
