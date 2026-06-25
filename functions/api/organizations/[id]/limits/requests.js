import {
  recordAuditLog,
  requireOrganizationPermission,
} from "../../../../_lib/permissions.js";
import {
  createLimitIncreaseRequest,
  getRouteParam,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../../_lib/organizations.js";

function getOrganizationId(params) {
  return parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
}

function createInvalidPayloadError(message = "Payload inválido.") {
  const error = new Error(message);
  error.status = 400;
  error.code = "INVALID_PAYLOAD";

  return error;
}

function normalizeRequestPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createInvalidPayloadError();
  }

  const requestType = String(payload.requestType || "").trim();
  const requestedPlan =
    payload.requestedPlan == null
      ? null
      : String(payload.requestedPlan).trim();
  const reason =
    payload.reason == null
      ? ""
      : String(payload.reason).trim();

  if (!requestType) {
    throw createInvalidPayloadError("Tipo de solicitação não informado.");
  }

  if (requestType.length > 80) {
    throw createInvalidPayloadError("Tipo de solicitação excede o limite.");
  }

  if (requestedPlan && requestedPlan.length > 40) {
    throw createInvalidPayloadError("Plano solicitado excede o limite.");
  }

  if (reason.length > 1000) {
    throw createInvalidPayloadError("Motivo excede o limite permitido.");
  }

  return {
    ...payload,
    requestType,
    requestedPlan,
    reason,
  };
}

function sanitizeLimitRequestResponse(limitRequest) {
  return {
    id: limitRequest?.id,
    status: limitRequest?.status || "pending",
  };
}

export async function onRequestPost({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);
    const payload = normalizeRequestPayload(await readJsonBody(request));

    const { user } = await requireOrganizationPermission(
      env,
      request,
      "limits.increase_request",
      organizationId,
      {
        resourceType: "organization",
        resourceId: organizationId,

        /**
         * A auditoria de sucesso só deve acontecer depois que a solicitação
         * pending for criada. Isso evita registrar sucesso se o insert falhar.
         */
        auditOnSuccess: false,
      },
    );

    const limitRequest = await createLimitIncreaseRequest(
      env,
      organizationId,
      payload,
      user,
    );

    await recordAuditLog(env, {
      actorUserId: user?.id,
      organizationId,
      action: "limits.increase_request",
      resourceType: "organization_limit_request",
      resourceId: limitRequest?.id,
      result: "success",
      metadata: {
        organizationId,
        requestId: limitRequest?.id,
        requestType: payload.requestType,
        requestedPlan: payload.requestedPlan || null,
      },
      request,
    });

    return jsonResponse(
      {
        ok: true,
        request: sanitizeLimitRequestResponse(limitRequest),
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