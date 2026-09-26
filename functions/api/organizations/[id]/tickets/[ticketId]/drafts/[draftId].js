import { authorizeTicketConversation } from "../../../../../../_lib/ticket-conversation-http.js";
import {
  discardTicketDraft,
  getTicketDraft,
  updateTicketDraft,
} from "../../../../../../_lib/ticket-conversations.js";
import {
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../../../../_lib/organizations.js";
import { ticketCenterErrorResponse } from "../../../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return methodNotAllowed(context.request.method, ["GET", "PATCH", "DELETE"]);
}

export async function onRequestGet({ env, request, params }) {
  try {
    const { conversationContext } = await authorizeTicketConversation(env, request, params);
    const draft = await getTicketDraft(env, conversationContext, getRouteParam(params, "draftId"));
    return jsonResponse({ ok: true, draft }, {
      headers: { "Cache-Control": "private, no-store", ETag: draft.etag },
    });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestPatch({ env, request, params }) {
  try {
    const { conversationContext } = await authorizeTicketConversation(env, request, params);
    const draft = await updateTicketDraft(
      env,
      conversationContext,
      getRouteParam(params, "draftId"),
      await readJsonBody(request),
      request.headers.get("If-Match"),
    );
    return jsonResponse({ ok: true, draft }, {
      headers: { "Cache-Control": "private, no-store", ETag: draft.etag },
    });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestDelete({ env, request, params }) {
  try {
    const { conversationContext } = await authorizeTicketConversation(env, request, params);
    await discardTicketDraft(
      env,
      conversationContext,
      getRouteParam(params, "draftId"),
      request.headers.get("If-Match"),
    );
    return jsonResponse({ ok: true, discarded: true }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
