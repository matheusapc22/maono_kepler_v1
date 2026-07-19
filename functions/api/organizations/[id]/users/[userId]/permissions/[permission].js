import { requireSession } from "../../../../../../_lib/auth.js";
import {
  accessGovernanceV2Enabled,
  authorizeLegacyPermissionMutation,
  authorizePermissionMutation,
} from "../../../../../../_lib/access-delegation.js";
import { recordAuditLog } from "../../../../../../_lib/permissions.js";
import {
  countActiveOwners,
  getRouteParam,
  handleApiError,
  jsonResponse,
  listOrganizationUsers,
  methodNotAllowed,
  parsePositiveInteger,
  revokeOrganizationPermission,
} from "../../../../../../_lib/organizations.js";

const CRITICAL_OWNER_OPERATION_PERMISSIONS = new Set([
  "users.view",
  "users.manage_access",
  "permission.grant",
  "permission.revoke",
  "role.assign",
]);

function getOrganizationId(params) {
  return parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
}

function getUserId(params) {
  return parsePositiveInteger(getRouteParam(params, "userId"), "userId");
}

function createInvalidPermissionError() {
  const error = new Error("Permissão inválida.");
  error.status = 400;
  error.code = "INVALID_PERMISSION";
  return error;
}

function createLastOwnerError() {
  const error = new Error("A organização precisa manter pelo menos um Owner ativo.");
  error.status = 409;
  error.code = "LAST_OWNER_REQUIRED";
  return error;
}

function getPermissionParam(params) {
  const rawValue = getRouteParam(params, "permission");
  if (!rawValue) throw createInvalidPermissionError();
  try {
    const permission = decodeURIComponent(String(rawValue)).trim();
    if (!permission || permission.length > 120) throw createInvalidPermissionError();
    return permission;
  } catch (error) {
    if (error?.code === "INVALID_PERMISSION") throw error;
    throw createInvalidPermissionError();
  }
}

async function assertDoesNotBreakLastOperationalOwner(env, organizationId, targetUserId, permission) {
  if (!CRITICAL_OWNER_OPERATION_PERMISSIONS.has(permission)) return;
  const users = await listOrganizationUsers(env, organizationId);
  const targetUser = users.find((item) => String(item.id) === String(targetUserId));
  if (!targetUser) return;
  const targetIsActiveOwner = targetUser.active && (targetUser.role === "owner" || targetUser.accessLevel === "owner");
  if (!targetIsActiveOwner) return;
  if (await countActiveOwners(env, organizationId) <= 1) throw createLastOwnerError();
}

export async function onRequestDelete({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);
    const targetUserId = getUserId(params);
    const permission = getPermissionParam(params);
    const user = await requireSession(env, request);
    const authorization = accessGovernanceV2Enabled(env)
      ? await authorizePermissionMutation(env, request, user, organizationId, targetUserId, permission, "revoke")
      : await authorizeLegacyPermissionMutation(env, request, user, organizationId, targetUserId, permission, "revoke");

    await assertDoesNotBreakLastOperationalOwner(env, organizationId, targetUserId, permission);
    const revoke = await revokeOrganizationPermission(env, organizationId, targetUserId, permission, user);
    if (authorization.mode === "delegated") {
      await recordAuditLog(env, {
        actorUserId: user.id,
        organizationId,
        action: "delegated.permission.revoke",
        resourceType: "user",
        resourceId: targetUserId,
        result: "success",
        metadata: { permission, policyVersion: authorization.policyVersion },
        request,
      });
    }
    return jsonResponse({ ok: true, revoke });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest({ request }) {
  return methodNotAllowed(request.method, ["DELETE"]);
}
