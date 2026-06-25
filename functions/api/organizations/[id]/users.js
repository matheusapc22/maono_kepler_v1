import { requireOrganizationPermission } from "../../../_lib/permissions.js";
import {
  createOrganizationUser,
  getRouteParam,
  handleApiError,
  jsonResponse,
  listOrganizationUsers,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../_lib/organizations.js";

function getOrganizationId(params) {
  return parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
}

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);

    await requireOrganizationPermission(
      env,
      request,
      "users.view",
      organizationId,
      {
        resourceType: "organization",
        resourceId: organizationId,
      },
    );

    const users = await listOrganizationUsers(env, organizationId);

    return jsonResponse({
      ok: true,
      users,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);

    const { user } = await requireOrganizationPermission(
      env,
      request,
      "users.create",
      organizationId,
      {
        resourceType: "organization",
        resourceId: organizationId,

        /**
         * users.create é ação sensível e requireOrganizationPermission
         * audita negações automaticamente. No sucesso, a auditoria detalhada
         * fica em createOrganizationUser(...), com target user, role e accessLevel.
         * Isso evita auditoria duplicada.
         */
        auditOnSuccess: false,
      },
    );

    const payload = await readJsonBody(request);
    const createdUser = await createOrganizationUser(
      env,
      organizationId,
      payload,
      user,
    );

    return jsonResponse(
      {
        ok: true,
        user: createdUser,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest({ request }) {
  return methodNotAllowed(request.method, ["GET", "POST"]);
}