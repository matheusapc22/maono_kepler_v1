import { requireSession } from "../../../../../../_lib/auth.js";
import { authorizeOrganizationPermissionMutation } from "../../../../../../_lib/access-governance.js";
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
    if (!permission || permission.length > 120) {
      throw createInvalidPermissionError();
    }
    return permission;
  } catch (error) {
    if (error?.code === "INVALID_PERMISSION") throw error;
    throw createInvalidPermissionError();
  }
}

async function assertDoesNotBreakLastOperationalOwner(
  env,
  organizationId,
  targetUserId,
  permission,
) {
  if (!CRITICAL_OWNER_OPERATION_PERMISSIONS.has(permission)) return;

  const users = await listOrganizationUsers(env, organizationId);
  const targetUser = users.find(
    (user) => String(user.id) === String(targetUserId),
  );
  if (!targetUser) return;

  const targetIsActiveOwner =
    targetUser.active &&
    (targetUser.role === "owner" || targetUser.accessLevel === "owner");
  if (!targetIsActiveOwner) return;

  const activeOwners = await countActiveOwners(env, organizationId);
  if (activeOwners <= 1) throw createLastOwnerError();
}

export async function onRequestDelete({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);
    const targetUserId = getUserId(params);
    const permission = getPermissionParam(params);
    const actor = await requireSession(env, request);

    const authorization = await authorizeOrganizationPermissionMutation({
      env,
      request,
      actor,
      organizationId,
      targetUserId,
      permission,
      operation: "revoke",
    });

    await assertDoesNotBreakLastOperationalOwner(
      env,
      organizationId,
      targetUserId,
      permission,
    );

    const revoke = await revokeOrganizationPermission(
      env,
      organizationId,
      targetUserId,
      permission,
      actor,
      { authorization, request },
    );

    return jsonResponse({
      ok: true,
      revoke,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest({ request }) {
  return methodNotAllowed(request.method, ["DELETE"]);
}
