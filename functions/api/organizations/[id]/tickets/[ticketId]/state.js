import { methodNotAllowed } from "../../../../../_lib/organizations.js";
import { ticketCommandStateResponse } from "../../../../../_lib/ticket-command-http.js";

export const onRequestGet = ticketCommandStateResponse;
export function onRequest(context) {
  return context.request.method === "GET"
    ? onRequestGet(context)
    : methodNotAllowed(context.request.method, ["GET"]);
}
