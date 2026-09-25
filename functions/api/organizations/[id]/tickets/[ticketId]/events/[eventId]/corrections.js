import { methodNotAllowed } from "../../../../../../../_lib/organizations.js";
import { ticketCommandResponse } from "../../../../../../../_lib/ticket-command-http.js";
import { executeTicketEventCorrection } from "../../../../../../../_lib/ticket-commands.js";

export const onRequestPost = (context) => ticketCommandResponse(context, executeTicketEventCorrection, { correction: true });
export function onRequest(context) {
  return context.request.method === "POST"
    ? onRequestPost(context)
    : methodNotAllowed(context.request.method, ["POST"]);
}
