import { authorizeTicketConversation } from "../../../../../_lib/ticket-conversation-http.js";
import {
  createTicketDraft,
  listTicketDrafts,
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
    const drafts = await listTicketDrafts(env, conversationContext);
    return jsonResponse({ ok: true, drafts }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const { conversationContext } = await authorizeTicketConversation(env, request, params);
    const draft = await createTicketDraft(env, conversationContext, await readJsonBody(request));
    return jsonResponse({ ok: true, draft }, {
      status: 201,
      headers: { "Cache-Control": "private, no-store", ETag: draft.etag },
    });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
