import { requireSession, normalizeRole } from "../../../../../_lib/auth.js";
import { ACCESS_DELEGATION_PERMISSION, accessGovernanceV2Enabled, authorizeLegacyPermissionMutation, authorizePermissionMutation } from "../../../../../_lib/access-delegation.js";
import { recordAuditLog } from "../../../../../_lib/permissions.js";
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

export async function onRequestPost({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);
    const targetUserId = getUserId(params);
    const payload = await readJsonBody(request);
    const permission = normalizePermissionFromPayload(payload);
    const warningAcknowledged = payload.warningAcknowledged === true;
    const justification = String(payload.justification || "").trim();
    const user = await requireSession(env, request);

    if (permission === ACCESS_DELEGATION_PERMISSION) {
      throw createForbiddenError("DELEGATION_POLICY_ENDPOINT_REQUIRED");
    }

    if (
      permission === "organization.projects.geojson.view" &&
      normalizeRole(user.role) !== "super_admin"
    ) {
      throw createForbiddenError("SUPER_ADMIN_REQUIRED");
    }

    if (
      permission === "organization.projects.geojson.view" &&
      justification.length > 500
    ) {
      throw createInvalidPayloadError("Justificativa excede o limite permitido.");
    }

    const authorization = accessGovernanceV2Enabled(env)
      ? await authorizePermissionMutation(env, request, user, organizationId, targetUserId, permission, "grant")
      : await authorizeLegacyPermissionMutation(env, request, user, organizationId, targetUserId, permission, "grant");

    const grant = await grantOrganizationPermission(
      env,
      organizationId,
      targetUserId,
      permission,
      user,
      { warningAcknowledged, justification },
    );

    if (authorization.mode === "delegated") {
      await recordAuditLog(env, { actorUserId: user.id, organizationId, action: "delegated.permission.grant", resourceType: "user", resourceId: targetUserId, result: "success", metadata: { permission, policyVersion: authorization.policyVersion }, request });
    }

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
