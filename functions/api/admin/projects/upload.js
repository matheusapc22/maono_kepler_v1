import { methodNotAllowed } from "../../../_lib/http.js";
import { retiredSaveProtocolResponse } from "../../../_lib/project-save-protocol.js";

// Retired multipart overwrite/create API. Imported maps use the same durable
// creation reservation and operation endpoints as maps created in the editor.
export async function onRequest({request}) {
  return request.method === "POST" ? retiredSaveProtocolResponse() : methodNotAllowed(["POST"]);
}
