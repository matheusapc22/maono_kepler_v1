import { requireSession, normalizeRole } from "../../../../../_lib/auth.js";
import {
  disableDelegationPolicy,
  getDelegationPolicy,
  saveDelegationPolicy,
} from "../../../../../_lib/access-governance.js";
import {
  getRouteParam,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../../../_lib/organizations.js";

function ids(params) {
  return {
    organizationId: parsePositiveInteger(getRouteParam(params, "id"), "organizationId"),
    userId: parsePositiveInteger(getRouteParam(params, "userId"), "userId"),
  };
}

function requireSuperAdmin(actor) {
  if (normalizeRole(actor?.role) !== "super_admin") {
    const error = new Error("Somente Super Admin pode configurar delegações.");
    error.status = 403;
    error.code = "SUPER_ADMIN_REQUIRED";
    throw error;
  }
}

export async function onRequestGet({ env, request, params }) {
  try {
    const actor = await requireSession(env, request);
    requireSuperAdmin(actor);
    const { organizationId, userId } = ids(params);
    const result = await getDelegationPolicy(env, organizationId, userId);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequestPut({ env, request, params }) {
  try {
    const actor = await requireSession(env, request);
    requireSuperAdmin(actor);
    const { organizationId, userId } = ids(params);
    const payload = await readJsonBody(request);
    const delegation = await saveDelegationPolicy(
      env,
      organizationId,
      userId,
      payload,
      actor,
      request,
    );
    return jsonResponse({ ok: true, delegation });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequestDelete({ env, request, params }) {
  try {
    const actor = await requireSession(env, request);
    requireSuperAdmin(actor);
    const { organizationId, userId } = ids(params);
    const delegation = await disableDelegationPolicy(
      env,
      organizationId,
      userId,
      actor,
      request,
    );
    return jsonResponse({ ok: true, delegation });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest({ request, ...context }) {
  if (request.method === "GET") return onRequestGet({ request, ...context });
  if (request.method === "PUT") return onRequestPut({ request, ...context });
  if (request.method === "DELETE") return onRequestDelete({ request, ...context });
  return methodNotAllowed(request.method, ["GET", "PUT", "DELETE"]);
}
