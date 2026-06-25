import { requireOrganizationPermission } from "../../../_lib/permissions.js";
import {
  getOrganizationLimits,
  getRouteParam,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../_lib/organizations.js";

function getOrganizationId(params) {
  return parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
}

function normalizeLimitsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      limits: {
        plan: "free",
        users: {
          used: 0,
          limit: 10,
        },
        projects: {
          used: 0,
          limit: 5,
        },
        storageMb: {
          used: 0,
          limit: 500,
        },
        exports: {
          used: 0,
          limit: 50,
        },
      },
      pendingRequests: [],
    };
  }

  if ("limits" in payload) {
    return {
      limits: payload.limits,
      pendingRequests: Array.isArray(payload.pendingRequests)
        ? payload.pendingRequests
        : [],
    };
  }

  return {
    limits: {
      plan: payload.plan || "free",
      users: payload.users || {
        used: 0,
        limit: 10,
      },
      projects: payload.projects || {
        used: 0,
        limit: 5,
      },
      storageMb: payload.storageMb || {
        used: 0,
        limit: 500,
      },
      exports: payload.exports || {
        used: 0,
        limit: 50,
      },
    },
    pendingRequests: Array.isArray(payload.pendingRequests)
      ? payload.pendingRequests
      : [],
  };
}

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);

    await requireOrganizationPermission(
      env,
      request,
      "limits.view",
      organizationId,
      {
        resourceType: "organization",
        resourceId: organizationId,
      },
    );

    const limitsPayload = await getOrganizationLimits(env, organizationId);
    const { limits, pendingRequests } = normalizeLimitsPayload(limitsPayload);

    return jsonResponse({
      ok: true,
      limits,
      pendingRequests,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest({ request }) {
  return methodNotAllowed(request.method, ["GET"]);
}