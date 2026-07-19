import { normalizeRole, requireSession } from "../../_lib/auth.js";
import { getOrganizationAccessCapabilities, permissionCatalog } from "../../_lib/access-delegation.js";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../_lib/http.js";

export async function onRequestGet({ env, request }) {
  try {
    const user = await requireSession(env, request);
    const url = new URL(request.url);
    const organizationId = Number(url.searchParams.get("organizationId"));
    if (normalizeRole(user.role) === "super_admin") return jsonResponse({ ok: true, catalog: permissionCatalog(), mode: "platform" });
    if (!Number.isInteger(organizationId) || organizationId <= 0) return errorResponse("Organização obrigatória.", 400, "ORGANIZATION_CONTEXT_REQUIRED");
    const capabilities = await getOrganizationAccessCapabilities(env, user, organizationId);
    if (!capabilities.canManageAdditionalAccess) return errorResponse("Delegação organizacional necessária.", 403, capabilities.reason || "DELEGATION_REQUIRED");
    return jsonResponse({ ok: true, catalog: capabilities.catalog, capabilities, mode: "organization" });
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "PERMISSION_CATALOG_ERROR");
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed(["GET"]);
}
