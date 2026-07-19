import { requireSession } from "../../../../../../_lib/auth.js";
import { accessGovernanceV2Enabled, authorizeLegacyPermissionMutation, authorizePermissionMutation } from "../../../../../../_lib/access-delegation.js";
import { recordAuditLog } from "../../../../../../_lib/permissions.js";
import { getRouteParam, handleApiError, jsonResponse, methodNotAllowed, parsePositiveInteger, revokeOrganizationPermission } from "../../../../../../_lib/organizations.js";

export async function onRequestDelete({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const targetUserId = parsePositiveInteger(getRouteParam(params, "userId"), "userId");
    const permission = decodeURIComponent(String(getRouteParam(params, "permission") || ""));
    const user = await requireSession(env, request);
    const authorization = accessGovernanceV2Enabled(env)
      ? await authorizePermissionMutation(env, request, user, organizationId, targetUserId, permission, "revoke")
      : await authorizeLegacyPermissionMutation(env, request, user, organizationId, targetUserId, permission, "revoke");
    const revoke = await revokeOrganizationPermission(env, organizationId, targetUserId, permission, user);
    if (authorization.mode === "delegated") await recordAuditLog(env, { actorUserId: user.id, organizationId, action: "delegated.permission.revoke", resourceType: "user", resourceId: targetUserId, result: "success", metadata: { permission, policyVersion: authorization.policyVersion }, request });
    return jsonResponse({ ok: true, revoke });
  } catch (error) { return handleApiError(error); }
}

export async function onRequest(context) {
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return methodNotAllowed(context.request.method, ["DELETE"]);
}
