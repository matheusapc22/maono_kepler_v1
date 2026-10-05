import { methodNotAllowed } from "../../../_lib/http.js";
import { retiredSaveProtocolResponse } from "../../../_lib/project-save-protocol.js";

export async function onRequest({ request }) {
  return request.method === "POST"
    ? retiredSaveProtocolResponse()
    : methodNotAllowed(["POST"]);
}
