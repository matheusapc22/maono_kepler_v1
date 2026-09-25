import { methodNotAllowed } from "../../../../../_lib/organizations.js";
import { ticketCommandResponse } from "../../../../../_lib/ticket-command-http.js";
import { executeTicketTransition } from "../../../../../_lib/ticket-commands.js";

export const onRequestPost = (context) => ticketCommandResponse(context, executeTicketTransition);
export function onRequest(context) {
  return context.request.method === "POST"
    ? onRequestPost(context)
    : methodNotAllowed(context.request.method, ["POST"]);
}
