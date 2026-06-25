import { requireSession } from "../../../../_lib/auth.js";
import { can, recordAuditLog } from "../../../../_lib/permissions.js";
import {
  getRouteParam,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
  updateOrganizationUser,
} from "../../../../_lib/organizations.js";

function getOrganizationId(params) {
  return parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
}

function getUserId(params) {
  return parsePositiveInteger(getRouteParam(params, "userId"), "userId");
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function hasNamePatch(payload) {
  return hasOwn(payload, "name") || hasOwn(payload, "fullName");
}

function hasActivePatch(payload) {
  return hasOwn(payload, "active");
}

function hasRoleOrAccessPatch(payload) {
  return (
    hasOwn(payload, "role") ||
    hasOwn(payload, "accessLevel") ||
    hasOwn(payload, "access_level")
  );
}

function hasSupportedPatch(payload) {
  return (
    hasNamePatch(payload) ||
    hasActivePatch(payload) ||
    hasRoleOrAccessPatch(payload)
  );
}

function createForbiddenError(permission, reason = "FORBIDDEN") {
  const error = new Error("Acesso negado.");
  error.status = 403;
  error.code = "FORBIDDEN";
  error.permission = permission;
  error.reason = reason;

  return error;
}

function createInvalidPayloadError() {
  const error = new Error("Nenhuma alteração válida informada.");
  error.status = 400;
  error.code = "INVALID_PAYLOAD";

  return error;
}

async function requireOrganizationAction(
  env,
  request,
  user,
  organizationId,
  permission,
  {
    resourceId,
    resourceType = "user",
    auditAction = permission,
    metadata = {},
  } = {},
) {
  const decision = await can(env, user, permission, {
    organizationId,
    scopeType: "organization",
    resourceId,
  });

  if (!decision.allowed) {
    await recordAuditLog(env, {
      actorUserId: user?.id,
      organizationId,
      action: auditAction,
      resourceType,
      resourceId,
      result: "denied",
      metadata: {
        ...metadata,
        permission,
        reason: decision.reason,
      },
      request,
    });

    throw createForbiddenError(permission, decision.reason);
  }

  return decision;
}

async function requireRoleOrAccessManagement(
  env,
  request,
  user,
  organizationId,
  targetUserId,
) {
  const roleAssignDecision = await can(env, user, "role.assign", {
    organizationId,
    scopeType: "organization",
    resourceId: targetUserId,
  });

  if (roleAssignDecision.allowed) {
    return {
      permission: "role.assign",
      decision: roleAssignDecision,
    };
  }

  const manageAccessDecision = await can(env, user, "users.manage_access", {
    organizationId,
    scopeType: "organization",
    resourceId: targetUserId,
  });

  if (manageAccessDecision.allowed) {
    return {
      permission: "users.manage_access",
      decision: manageAccessDecision,
    };
  }

  await recordAuditLog(env, {
    actorUserId: user?.id,
    organizationId,
    action: "role.assign",
    resourceType: "user",
    resourceId: targetUserId,
    result: "denied",
    metadata: {
      reason: "ROLE_ASSIGN_OR_USERS_MANAGE_ACCESS_REQUIRED",
      roleAssignReason: roleAssignDecision.reason,
      manageAccessReason: manageAccessDecision.reason,
    },
    request,
  });

  throw createForbiddenError(
    "role.assign",
    "ROLE_ASSIGN_OR_USERS_MANAGE_ACCESS_REQUIRED",
  );
}

export async function onRequestPatch({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);
    const targetUserId = getUserId(params);
    const payload = await readJsonBody(request);

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw createInvalidPayloadError();
    }

    if (!hasSupportedPatch(payload)) {
      throw createInvalidPayloadError();
    }

    const user = await requireSession(env, request);

    if (hasNamePatch(payload)) {
      await requireOrganizationAction(
        env,
        request,
        user,
        organizationId,
        "users.edit",
        {
          resourceId: targetUserId,
          metadata: {
            fields: ["name"],
          },
        },
      );
    }

    if (hasActivePatch(payload)) {
      if (payload.active === false || payload.active === 0 || payload.active === "0") {
        await requireOrganizationAction(
          env,
          request,
          user,
          organizationId,
          "users.disable",
          {
            resourceId: targetUserId,
            metadata: {
              fields: ["active"],
            },
          },
        );
      } else {
        await requireOrganizationAction(
          env,
          request,
          user,
          organizationId,
          "users.edit",
          {
            resourceId: targetUserId,
            metadata: {
              fields: ["active"],
            },
          },
        );
      }
    }

    let roleManagementPermission = null;

    if (hasRoleOrAccessPatch(payload)) {
      const roleManagement = await requireRoleOrAccessManagement(
        env,
        request,
        user,
        organizationId,
        targetUserId,
      );

      roleManagementPermission = roleManagement.permission;
    }

    const updatedUser = await updateOrganizationUser(
      env,
      organizationId,
      targetUserId,
      payload,
      user,
    );

    /**
     * updateOrganizationUser registra users.edit/users.disable.
     * Quando houver alteração de role/accessLevel, registramos também
     * role.assign para cumprir a auditoria específica da Sprint 8.
     */
    if (hasRoleOrAccessPatch(payload)) {
      await recordAuditLog(env, {
        actorUserId: user?.id,
        organizationId,
        action: "role.assign",
        resourceType: "user",
        resourceId: targetUserId,
        result: "success",
        metadata: {
          permissionUsed: roleManagementPermission,
          role: payload.role || null,
          accessLevel: payload.accessLevel || payload.access_level || null,
        },
        request,
      });
    }

    return jsonResponse({
      ok: true,
      user: updatedUser,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest({ request }) {
  return methodNotAllowed(request.method, ["PATCH"]);
}