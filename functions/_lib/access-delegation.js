import { normalizeRole } from "./auth.js";
import { can, recordAuditLog } from "./permissions.js";
import {
  ACCESS_DELEGATION_PERMISSION,
  isOwnerDelegablePermission,
  ownerDelegablePermissions,
  permissionCatalog,
} from "./permission-catalog.js";

const TARGET_LEVELS = new Set(["viewer", "editor"]);

function db(env) {
  const value = env.DB || env.D1 || env.MAONO_DB;
  if (!value?.prepare) throw accessError("Banco D1 não configurado.", 500, "DATABASE_NOT_CONFIGURED");
  return value;
}

function id(value, name = "id") {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw accessError(`${name} inválido.`, 400, "INVALID_IDENTIFIER");
  return parsed;
}

function accessError(message, status, code, reason = code, extras = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.reason = reason;
  Object.assign(error, extras);
  return error;
}

function activeOrganizationId(user) {
  return user?.activeOrganizationId ?? user?.active_organization_id ?? user?.organizationId ?? user?.organization_id ?? null;
}

function databaseBoolean(value) {
  return value === true || value === 1 || value === "1";
}

export function accessGovernanceV2Enabled(env) {
  return String(env.ACCESS_GOVERNANCE_V2 ?? "false").toLowerCase() === "true";
}

async function membership(env, organizationId, userId) {
  return db(env).prepare(`SELECT ou.id, ou.access_level, u.role, u.active
    FROM organization_users ou INNER JOIN users u ON u.id = ou.user_id
    WHERE ou.organization_id = ? AND ou.user_id = ? LIMIT 1`).bind(organizationId, userId).first();
}

export async function readDelegationPolicy(env, organizationIdValue, delegateUserIdValue) {
  const organizationId = id(organizationIdValue, "organizationId");
  const delegateUserId = id(delegateUserIdValue, "delegateUserId");
  const row = await db(env).prepare(`SELECT * FROM organization_access_delegations
    WHERE organization_id = ? AND delegate_user_id = ? LIMIT 1`).bind(organizationId, delegateUserId).first();
  if (!row) return null;
  const [permissionsResult, levelsResult] = await Promise.all([
    db(env).prepare(`SELECT permission, can_grant, can_revoke FROM delegation_permissions WHERE delegation_id = ? ORDER BY permission`).bind(row.id).all(),
    db(env).prepare(`SELECT access_level FROM delegation_target_levels WHERE delegation_id = ? ORDER BY access_level`).bind(row.id).all(),
  ]);
  return {
    id: row.id,
    organizationId,
    delegateUserId,
    enabled: databaseBoolean(row.enabled),
    expiresAt: row.expires_at || null,
    version: Number(row.version || 1),
    permissions: (permissionsResult.results || []).map((item) => ({ permission: item.permission, canGrant: databaseBoolean(item.can_grant), canRevoke: databaseBoolean(item.can_revoke) })),
    targetLevels: (levelsResult.results || []).map((item) => item.access_level),
    updatedAt: row.updated_at || null,
  };
}

function policyIsActive(policy) {
  return Boolean(policy?.enabled) && (!policy.expiresAt || new Date(policy.expiresAt).getTime() > Date.now());
}

async function eligibleDelegate(env, organizationId, user) {
  const row = await membership(env, organizationId, user?.id);
  if (!row || !databaseBoolean(row.active)) return { eligible: false, row, reason: "DELEGATE_MEMBERSHIP_REQUIRED" };
  const eligible = normalizeRole(row.role) === "admin" || String(row.access_level).toLowerCase() === "owner";
  return { eligible, row, reason: eligible ? "ELIGIBLE_DELEGATE" : "DELEGATE_ROLE_NOT_ALLOWED" };
}

export async function getOrganizationAccessCapabilities(env, user, organizationIdValue) {
  const organizationId = id(organizationIdValue, "organizationId");
  if (!accessGovernanceV2Enabled(env)) {
    return { governanceV2: false, canManageAdditionalAccess: false, reason: "ACCESS_GOVERNANCE_V2_DISABLED", catalog: permissionCatalog(), allowedPermissions: [], allowedOperations: [], targetLevels: [] };
  }
  if (String(activeOrganizationId(user)) !== String(organizationId)) {
    return { governanceV2: true, canManageAdditionalAccess: false, reason: "ACTIVE_ORGANIZATION_CONTEXT_MISMATCH", catalog: permissionCatalog(), allowedPermissions: [], allowedOperations: [], targetLevels: [] };
  }
  if (normalizeRole(user?.role) === "super_admin") {
    return { governanceV2: true, canManageAdditionalAccess: false, configureInAdmin: true, reason: "SUPER_ADMIN_USES_ADMIN_PANEL", catalog: permissionCatalog(), allowedPermissions: [], allowedOperations: [], targetLevels: [] };
  }
  const eligibility = await eligibleDelegate(env, organizationId, user);
  if (!eligibility.eligible) return { governanceV2: true, canManageAdditionalAccess: false, reason: eligibility.reason, catalog: permissionCatalog(), allowedPermissions: [], allowedOperations: [], targetLevels: [] };
  const policy = await readDelegationPolicy(env, organizationId, user.id);
  if (!policyIsActive(policy)) return { governanceV2: true, canManageAdditionalAccess: false, reason: policy?.enabled ? "DELEGATION_EXPIRED" : "DELEGATION_REQUIRED", catalog: permissionCatalog(), allowedPermissions: [], allowedOperations: [], targetLevels: [] };
  return {
    governanceV2: accessGovernanceV2Enabled(env),
    canManageAdditionalAccess: true,
    reason: "DELEGATION_POLICY_ACTIVE",
    policyVersion: policy.version,
    expiresAt: policy.expiresAt,
    catalog: permissionCatalog(),
    allowedPermissions: policy.permissions.map((item) => item.permission),
    allowedOperations: Array.from(new Set(policy.permissions.flatMap((item) => [item.canGrant ? "grant" : null, item.canRevoke ? "revoke" : null]).filter(Boolean))),
    permissionOperations: policy.permissions,
    targetLevels: policy.targetLevels,
  };
}

async function auditDenied(env, request, user, organizationId, targetUserId, operation, permission, error, policyVersion = null) {
  await recordAuditLog(env, { actorUserId: user?.id, organizationId, action: "delegated.operation.denied", resourceType: "user", resourceId: targetUserId, result: "denied", metadata: { targetUserId, operation, permission, code: error.code, reason: error.reason, policyVersion }, request });
}

export async function authorizeLegacyPermissionMutation(env, request, user, organizationIdValue, targetUserIdValue, permission, operation) {
  const organizationId = id(organizationIdValue, "organizationId");
  const targetUserId = id(targetUserIdValue, "targetUserId");
  const operationPermission = operation === "grant" ? "permission.grant" : "permission.revoke";
  const context = { organizationId, scopeType: "organization", resourceId: targetUserId };
  const [manageDecision, operationDecision] = await Promise.all([
    can(env, user, "users.manage_access", context),
    can(env, user, operationPermission, context),
  ]);
  if (manageDecision.allowed && operationDecision.allowed) return { mode: "legacy", policyVersion: null };
  const error = accessError("Acesso negado.", 403, "FORBIDDEN", "USERS_MANAGE_ACCESS_AND_PERMISSION_OPERATION_REQUIRED");
  await recordAuditLog(env, { actorUserId: user?.id, organizationId, action: `permission.${operation}`, resourceType: "user", resourceId: targetUserId, result: "denied", metadata: { targetUserId, permission, operation, usersManageAccess: manageDecision, operationDecision }, request });
  throw error;
}

export async function authorizePermissionMutation(env, request, user, organizationIdValue, targetUserIdValue, permission, operation) {
  const organizationId = id(organizationIdValue, "organizationId");
  const targetUserId = id(targetUserIdValue, "targetUserId");
  const actorRole = normalizeRole(user?.role);
  if (actorRole === "super_admin") return { mode: "super_admin", policyVersion: null };
  let policy = null;
  try {
    if (!accessGovernanceV2Enabled(env)) throw accessError("Governança V2 desativada.", 403, "DELEGATION_REQUIRED");
    if (String(activeOrganizationId(user)) !== String(organizationId)) throw accessError("Organização ativa incompatível.", 403, "CROSS_ORGANIZATION_DENIED");
    if (Number(user?.id) === targetUserId) throw accessError("O delegado não pode alterar os próprios acessos.", 403, "SELF_SERVICE_BLOCKED");
    const eligibility = await eligibleDelegate(env, organizationId, user);
    if (!eligibility.eligible) throw accessError("Delegação exige owner ou admin ativo.", 403, "DELEGATION_REQUIRED", eligibility.reason);
    policy = await readDelegationPolicy(env, organizationId, user.id);
    if (!policyIsActive(policy)) throw accessError("Delegação ausente ou expirada.", 403, "DELEGATION_REQUIRED", policy?.enabled ? "DELEGATION_EXPIRED" : "DELEGATION_REQUIRED");
    if (!isOwnerDelegablePermission(permission)) throw accessError("Permissão fora do teto delegável.", 403, "OWNER_CEILING_EXCEEDED");
    const configured = policy.permissions.find((item) => item.permission === permission);
    if (!configured || (operation === "grant" ? !configured.canGrant : !configured.canRevoke)) throw accessError("Operação fora da política configurada.", 403, "POLICY_PERMISSION_DENIED");
    const target = await membership(env, organizationId, targetUserId);
    const targetLevel = String(target?.access_level || "").toLowerCase();
    const targetRole = normalizeRole(target?.role);
    if (!target || !databaseBoolean(target.active) || !TARGET_LEVELS.has(targetLevel) || !["viewer", "editor"].includes(targetRole) || !policy.targetLevels.includes(targetLevel)) throw accessError("Perfil de destino não permitido.", 403, "TARGET_ROLE_NOT_ALLOWED");
    const ownDecision = await can(env, user, permission, { organizationId, scopeType: "organization", resourceType: "delegated_permission" });
    if (!ownDecision.allowed) throw accessError("O delegante não possui a capacidade que tentou conceder.", 403, "ACTOR_PERMISSION_REQUIRED", ownDecision.reason);
    return { mode: "delegated", policyVersion: policy.version };
  } catch (error) {
    await auditDenied(env, request, user, organizationId, targetUserId, operation, permission, error, policy?.version || null);
    throw error;
  }
}

function validatePolicyPayload(payload) {
  const targetLevels = Array.from(new Set((payload?.targetLevels || []).map((item) => String(item).toLowerCase())));
  if (!targetLevels.length || targetLevels.some((item) => !TARGET_LEVELS.has(item))) throw accessError("Selecione Consulta e/ou Colaborador.", 400, "POLICY_TARGET_LEVELS_INVALID");
  const permissions = Array.isArray(payload?.permissions) ? payload.permissions : [];
  if (!permissions.length) throw accessError("Selecione pelo menos um acesso delegável.", 400, "POLICY_PERMISSIONS_REQUIRED");
  const byPermission = new Map();
  for (const item of permissions) {
    const permission = String(item?.permission || "");
    const previous = byPermission.get(permission) || { permission, canGrant: false, canRevoke: false };
    byPermission.set(permission, { permission, canGrant: previous.canGrant || item?.canGrant === true, canRevoke: previous.canRevoke || item?.canRevoke === true });
  }
  const normalized = Array.from(byPermission.values());
  if (normalized.some((item) => !isOwnerDelegablePermission(item.permission) || (!item.canGrant && !item.canRevoke))) throw accessError("A política contém acesso ou ação fora do teto.", 400, "OWNER_CEILING_EXCEEDED");
  const expiresDate = payload?.expiresAt ? new Date(payload.expiresAt) : null;
  if (expiresDate && !Number.isFinite(expiresDate.getTime())) throw accessError("Data de expiração inválida.", 400, "POLICY_EXPIRATION_INVALID");
  const expiresAt = expiresDate ? expiresDate.toISOString() : null;
  if (expiresDate && expiresDate.getTime() <= Date.now()) throw accessError("A expiração precisa estar no futuro.", 400, "POLICY_EXPIRATION_INVALID");
  return { targetLevels, permissions: normalized, expiresAt, enabled: payload?.enabled !== false };
}

function revisionToken() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function saveDelegationPolicy(env, request, actor, organizationIdValue, delegateUserIdValue, payload) {
  if (normalizeRole(actor?.role) !== "super_admin") throw accessError("Somente Super Admin pode configurar delegação.", 403, "SUPER_ADMIN_REQUIRED");
  const organizationId = id(organizationIdValue, "organizationId");
  const delegateUserId = id(delegateUserIdValue, "delegateUserId");
  const eligibility = await eligibleDelegate(env, organizationId, { id: delegateUserId });
  if (!eligibility.eligible) throw accessError("O destinatário deve ser owner ou admin ativo da organização.", 400, "DELEGATE_ROLE_NOT_ALLOWED");
  const input = validatePolicyPayload(payload);
  const current = await readDelegationPolicy(env, organizationId, delegateUserId);
  const expectedVersion = Number(payload?.version || 0);
  if ((current?.version || 0) !== expectedVersion) throw accessError("A política foi alterada por outra sessão.", 409, "POLICY_VERSION_CONFLICT", "POLICY_VERSION_CONFLICT", { policyVersion: current?.version || 0 });
  const nextVersion = (current?.version || 0) + 1;
  const token = revisionToken();
  const policyMutation = current
    ? db(env).prepare(`UPDATE organization_access_delegations SET enabled = ?, expires_at = ?, version = ?, revision_token = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`).bind(input.enabled ? 1 : 0, input.expiresAt, nextVersion, token, actor.id, current.id, expectedVersion)
    : db(env).prepare(`INSERT INTO organization_access_delegations (organization_id, delegate_user_id, enabled, expires_at, version, revision_token, granted_by, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`).bind(organizationId, delegateUserId, input.enabled ? 1 : 0, input.expiresAt, token, actor.id, actor.id);
  const delegationIdSql = `(SELECT id FROM organization_access_delegations WHERE organization_id = ? AND delegate_user_id = ? AND revision_token = ? LIMIT 1)`;
  const statements = [
    policyMutation,
    db(env).prepare(`DELETE FROM delegation_permissions WHERE delegation_id = ${delegationIdSql}`).bind(organizationId, delegateUserId, token),
    db(env).prepare(`DELETE FROM delegation_target_levels WHERE delegation_id = ${delegationIdSql}`).bind(organizationId, delegateUserId, token),
    ...input.permissions.map((item) => db(env).prepare(`INSERT INTO delegation_permissions (delegation_id, permission, can_grant, can_revoke) VALUES (${delegationIdSql}, ?, ?, ?)`).bind(organizationId, delegateUserId, token, item.permission, item.canGrant ? 1 : 0, item.canRevoke ? 1 : 0)),
    ...input.targetLevels.map((level) => db(env).prepare(`INSERT INTO delegation_target_levels (delegation_id, access_level) VALUES (${delegationIdSql}, ?)`).bind(organizationId, delegateUserId, token, level)),
  ];
  try {
    await db(env).batch(statements);
  } catch (error) {
    const latest = await readDelegationPolicy(env, organizationId, delegateUserId).catch(() => null);
    if ((latest?.version || 0) !== expectedVersion) throw accessError("A política foi alterada por outra sessão.", 409, "POLICY_VERSION_CONFLICT", "POLICY_VERSION_CONFLICT", { policyVersion: latest?.version || 0 });
    throw error;
  }
  await recordAuditLog(env, { actorUserId: actor.id, organizationId, action: current ? "delegation.policy.update" : "delegation.policy.create", resourceType: "user", resourceId: delegateUserId, result: "success", metadata: { policyVersion: nextVersion, expiresAt: input.expiresAt, permissions: input.permissions.map((item) => item.permission), targetLevels: input.targetLevels }, request });
  return readDelegationPolicy(env, organizationId, delegateUserId);
}

export async function disableDelegationPolicy(env, request, actor, organizationIdValue, delegateUserIdValue) {
  if (normalizeRole(actor?.role) !== "super_admin") throw accessError("Somente Super Admin pode revogar delegação.", 403, "SUPER_ADMIN_REQUIRED");
  const organizationId = id(organizationIdValue, "organizationId");
  const delegateUserId = id(delegateUserIdValue, "delegateUserId");
  await db(env).prepare(`UPDATE organization_access_delegations SET enabled = 0, version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ? AND delegate_user_id = ?`).bind(actor.id, organizationId, delegateUserId).run();
  await recordAuditLog(env, { actorUserId: actor.id, organizationId, action: "delegation.policy.disable", resourceType: "user", resourceId: delegateUserId, result: "success", request });
  return { disabled: true };
}

export async function disableDelegationsIfIneligible(env, userId) {
  const memberships = await db(env).prepare(`SELECT ou.organization_id, ou.access_level, u.role, u.active FROM organization_users ou INNER JOIN users u ON u.id = ou.user_id WHERE ou.user_id = ?`).bind(userId).all();
  for (const row of memberships.results || []) {
    const eligible = databaseBoolean(row.active) && (normalizeRole(row.role) === "admin" || String(row.access_level).toLowerCase() === "owner");
    if (!eligible) await db(env).prepare(`UPDATE organization_access_delegations SET enabled = 0, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ? AND delegate_user_id = ? AND enabled = 1`).bind(row.organization_id, userId).run();
  }
}

export { ACCESS_DELEGATION_PERMISSION, ownerDelegablePermissions, permissionCatalog };
