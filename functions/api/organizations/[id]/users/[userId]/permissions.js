import { requireSession } from "../../../../../_lib/auth.js";
import { authorizeOrganizationPermissionMutation } from "../../../../../_lib/access-governance.js";
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
    const actor = await requireSession(env, request);

    if (
      permission === "organization.projects.geojson.view" &&
      justification.length > 500
    ) {
      throw createInvalidPayloadError("Justificativa excede o limite permitido.");
    }

    await authorizeOrganizationPermissionMutation({
      env,
      request,
      actor,
      organizationId,
      targetUserId,
      permission,
      operation: "grant",
    });

    const grant = await grantOrganizationPermission(
      env,
      organizationId,
      targetUserId,
      permission,
      actor,
      { warningAcknowledged, justification },
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
