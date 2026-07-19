import { requireSession } from "../../../_lib/auth.js";
import { getOrganizationAccessCapabilities } from "../../../_lib/access-delegation.js";
import { handleApiError, jsonResponse, methodNotAllowed, parsePositiveInteger, getRouteParam } from "../../../_lib/organizations.js";

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const user = await requireSession(env, request);
    const capabilities = await getOrganizationAccessCapabilities(env, user, organizationId);
    return jsonResponse({ ok: true, capabilities }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed(context.request.method, ["GET"]);
}
