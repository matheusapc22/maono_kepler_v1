import { hashPassword, normalizeRole, requireSession } from "../../../../_lib/auth.js";
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
    hasRoleOrAccessPatch(payload) || hasOwn(payload, "password")
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

    if (hasOwn(payload, "password")) {
      if (normalizeRole(user.role) !== "super_admin") {
        throw createForbiddenError("admin.users.update", "SUPER_ADMIN_REQUIRED");
      }
      const password = String(payload.password || "");
      if (password.length < 8) {
        const error = new Error("A nova senha precisa ter pelo menos 8 caracteres.");
        error.status = 400;
        error.code = "USER_PASSWORD_INVALID";
        throw error;
      }
      const passwordHash = await hashPassword(password);
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(passwordHash, targetUserId),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId),
      ]);
      await recordAuditLog(env, { actorUserId: user.id, organizationId, action: "admin.users.password_changed", resourceType: "user", resourceId: targetUserId, result: "success", metadata: { sessionsInvalidated: true }, request });
      delete payload.password;
      if (!hasSupportedPatch(payload)) {
        return jsonResponse({ ok: true, passwordChanged: true });
      }
    }

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

export async function onRequestDelete({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);
    const targetUserId = getUserId(params);
    const user = await requireSession(env, request);
    await requireOrganizationAction(env, request, user, organizationId, "users.delete", { resourceId: targetUserId, auditAction: "users.membership.delete" });
    if (Number(user.id) === Number(targetUserId)) {
      const error = new Error("Você não pode remover o próprio acesso em uso."); error.status = 400; error.code = "SELF_MEMBERSHIP_DELETE_BLOCKED"; throw error;
    }
    const target = await env.DB.prepare("SELECT ou.id, ou.access_level FROM organization_users ou WHERE ou.organization_id = ? AND ou.user_id = ? LIMIT 1").bind(organizationId, targetUserId).first();
    if (!target) { const error = new Error("Acesso não encontrado na organização."); error.status = 404; error.code = "MEMBERSHIP_NOT_FOUND"; throw error; }
    if (String(target.access_level).toLowerCase() === "owner") {
      const owners = await env.DB.prepare("SELECT COUNT(*) AS total FROM organization_users WHERE organization_id = ? AND LOWER(access_level) = 'owner'").bind(organizationId).first();
      if (Number(owners?.total || 0) <= 1) { const error = new Error("Não é possível remover o último responsável da organização."); error.status = 409; error.code = "LAST_OWNER_REMOVAL_BLOCKED"; throw error; }
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM user_permissions WHERE user_id = ? AND organization_id = ?").bind(targetUserId, organizationId),
      env.DB.prepare("DELETE FROM organization_users WHERE user_id = ? AND organization_id = ?").bind(targetUserId, organizationId),
    ]);
    await recordAuditLog(env, { actorUserId: user.id, organizationId, action: "users.membership.delete", resourceType: "user", resourceId: targetUserId, result: "success", request });
    return jsonResponse({ ok: true, removed: true });
  } catch (error) { return handleApiError(error); }
}

export async function onRequest(context) {
  if (context.request.method === "PATCH") return onRequestPatch(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return methodNotAllowed(context.request.method, ["PATCH", "DELETE"]);
}
