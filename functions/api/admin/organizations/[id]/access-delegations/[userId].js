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
import { recordAuditLog } from "../../../../../_lib/permissions.js";

function ids(params) {
  return {
    organizationId: parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    ),
    userId: parsePositiveInteger(
      getRouteParam(params, "userId"),
      "userId",
    ),
  };
}

async function requireSuperAdmin({
  env,
  request,
  actor,
  organizationId,
  userId,
  operation,
}) {
  if (normalizeRole(actor?.role) === "super_admin") return;

  await recordAuditLog(env, {
    actorUserId: actor?.id,
    organizationId,
    action: "delegation.policy.denied",
    resourceType: "user",
    resourceId: userId,
    result: "denied",
    metadata: {
      operation,
      code: "SUPER_ADMIN_REQUIRED",
      reason: "SUPER_ADMIN_REQUIRED",
    },
    request,
  });

  const error = new Error("Somente Super Admin pode configurar delegações.");
  error.status = 403;
  error.code = "SUPER_ADMIN_REQUIRED";
  throw error;
}

export async function onRequestGet({ env, request, params }) {
  try {
    const actor = await requireSession(env, request);
    const { organizationId, userId } = ids(params);
    await requireSuperAdmin({
      env,
      request,
      actor,
      organizationId,
      userId,
      operation: "read",
    });
    const result = await getDelegationPolicy(env, organizationId, userId);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequestPut({ env, request, params }) {
  try {
    const actor = await requireSession(env, request);
    const { organizationId, userId } = ids(params);
    await requireSuperAdmin({
      env,
      request,
      actor,
      organizationId,
      userId,
      operation: "save",
    });
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
    const { organizationId, userId } = ids(params);
    await requireSuperAdmin({
      env,
      request,
      actor,
      organizationId,
      userId,
      operation: "disable",
    });
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
  if (request.method === "DELETE") {
    return onRequestDelete({ request, ...context });
  }
  return methodNotAllowed(request.method, ["GET", "PUT", "DELETE"]);
}
