import { requireSession } from "../../../../../_lib/auth.js";
import { can, recordAuditLog } from "../../../../../_lib/permissions.js";
import {
  getRouteParam,
  grantOrganizationPermission,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../../../_lib/organizations.js";

function getOrganizationId(params) {
  return parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
}

function getUserId(params) {
  return parsePositiveInteger(getRouteParam(params, "userId"), "userId");
}

function createForbiddenError(reason = "FORBIDDEN") {
  const error = new Error("Acesso negado.");
  error.status = 403;
  error.code = "FORBIDDEN";
  error.reason = reason;

  return error;
}

function createInvalidPayloadError(message = "Payload inválido.") {
  const error = new Error(message);
  error.status = 400;
  error.code = "INVALID_PAYLOAD";

  return error;
}

function normalizePermissionFromPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createInvalidPayloadError();
  }

  const permission = String(payload.permission || "").trim();

  if (!permission) {
    throw createInvalidPayloadError("Permissão não informada.");
  }

  if (permission.length > 120) {
    throw createInvalidPayloadError("Permissão excede o limite permitido.");
  }

  return permission;
}

async function requireGrantAccess(
  env,
  request,
  user,
  organizationId,
  targetUserId,
  permission,
) {
  const context = {
    organizationId,
    scopeType: "organization",
    resourceId: targetUserId,
  };

  const manageAccessDecision = await can(
    env,
    user,
    "users.manage_access",
    context,
  );

  const grantDecision = await can(
    env,
    user,
    "permission.grant",
    context,
  );

  if (manageAccessDecision.allowed && grantDecision.allowed) {
    return {
      manageAccessDecision,
      grantDecision,
    };
  }

  await recordAuditLog(env, {
    actorUserId: user?.id,
    organizationId,
    action: "permission.grant",
    resourceType: "user",
    resourceId: targetUserId,
    result: "denied",
    metadata: {
      targetUserId,
      permission,
      requiredPermissions: ["users.manage_access", "permission.grant"],
      usersManageAccess: {
        allowed: manageAccessDecision.allowed,
        reason: manageAccessDecision.reason,
      },
      permissionGrant: {
        allowed: grantDecision.allowed,
        reason: grantDecision.reason,
      },
    },
    request,
  });

  throw createForbiddenError("USERS_MANAGE_ACCESS_AND_PERMISSION_GRANT_REQUIRED");
}

export async function onRequestPost({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);
    const targetUserId = getUserId(params);
    const payload = await readJsonBody(request);
    const permission = normalizePermissionFromPayload(payload);
    const user = await requireSession(env, request);

    await requireGrantAccess(
      env,
      request,
      user,
      organizationId,
      targetUserId,
      permission,
    );

    const grant = await grantOrganizationPermission(
      env,
      organizationId,
      targetUserId,
      permission,
      user,
    );

    return jsonResponse(
      {
        ok: true,
        grant,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest({ request }) {
  return methodNotAllowed(request.method, ["POST"]);
}