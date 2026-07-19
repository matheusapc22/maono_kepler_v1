import { requireSession } from "../../../_lib/auth.js";
import { getAccessGovernanceCapabilities } from "../../../_lib/access-governance.js";
import {
  getRouteParam,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../_lib/organizations.js";

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );
    const actor = await requireSession(env, request);
    const capabilities = await getAccessGovernanceCapabilities(
      env,
      organizationId,
      actor,
    );

    return jsonResponse({ ok: true, capabilities });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest({ request, ...context }) {
  if (request.method === "GET") return onRequestGet({ request, ...context });
  return methodNotAllowed(request.method, ["GET"]);
}
