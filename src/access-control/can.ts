import { normalizePermissions, type Permission } from "./permissions";
import { normalizeRole } from "./roles";
import {
  PROJECT_CONTEXT_REQUIRED_PERMISSIONS,
  PROJECT_SAVE_ACCESS_LEVELS,
  PROJECT_VIEW_ACCESS_LEVELS,
  roleAllows,
  type AccessControlOrganization,
  type AccessControlProject,
  type AccessControlUser,
  type IdLike,
  type PermissionContext,
} from "./policy";

export type {
  AccessControlOrganization,
  AccessControlProject,
  AccessControlUser,
  IdLike,
  Permission,
  PermissionContext,
};

type RoleAllowsRole = Parameters<typeof roleAllows>[0];

type ProjectSlugContext = PermissionContext & {
  projectSlug?: IdLike;
};

const ORGANIZATION_CONTEXT_PERMISSION_PREFIXES = [
  "document.",
  "ticket.",
  "export.",
  "roadmap.",
  "users.",
  "permission.",
  "role.",
  "organization.",
  "limits.",
  "plan.",
] as const;

const ADMINISTRATIVE_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(
  [
    "admin.panel.access",
    "audit.view",
    "audit.export",
    "audit.security.view",
    "audit.platform.view",
    "audit.organization.view",
  ],
);

const AUDIT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "audit.view",
  "audit.export",
  "audit.security.view",
  "audit.platform.view",
  "audit.organization.view",
]);

const PLATFORM_AUDIT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(
  ["audit.security.view", "audit.platform.view"],
);

const ORGANIZATION_AUDIT_PERMISSIONS: ReadonlySet<Permission> =
  new Set<Permission>([
    "audit.view",
    "audit.export",
    "audit.organization.view",
  ]);

const OWNER_ORGANIZATION_POLICY_PERMISSIONS: ReadonlySet<Permission> =
  new Set<Permission>([
    "document.view",
    "document.upload",
    "document.download",
    "document.delete",

    "ticket.view",
    "ticket.create",
    "ticket.comment",
    "ticket.manage",
    "ticket.close",
    "ticket.assign",

    "roadmap.view",
    "roadmap.comment.create",
    "roadmap.comment.edit_own",
    "roadmap.comment.moderate",
    "roadmap.manage",
    "roadmap.task.manage",
    "roadmap.dependency.manage",

    "users.view",
    "users.create",
    "users.edit",
    "users.disable",
    "users.delete",
    "users.invite",

    "organization.view",
    "organization.edit",
    "organization.metrics.view",

    "limits.view",
    "limits.increase_request",
    "plan.view",
  ]);

const PROJECT_PERSISTENCE_PERMISSIONS: ReadonlySet<Permission> =
  new Set<Permission>([
    "project.save",
    "project.edit",
    "project.thumbnail.update",
  ]);

const PROJECT_MEMBERSHIP_ONLY_PERMISSIONS: ReadonlySet<Permission> =
  new Set<Permission>(["project.view", "project.favorite"]);

function toId(value: IdLike | null | undefined): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value);
}

function toLowerString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return normalized || null;
}

function getUserOrganizationId(user: AccessControlUser): string | null {
  return (
    toId(user.activeOrganizationId) ??
    toId(user.organizationId) ??
    toId(user.organization_id) ??
    toId(user.organization?.id) ??
    toId(user.organization?.organizationId)
  );
}

function getTargetOrganizationId(context: PermissionContext): string | null {
  return (
    toId(context.organizationId) ??
    toId(context.organization?.id) ??
    toId(context.organization?.organizationId) ??
    toId(context.project?.organizationId) ??
    toId(context.project?.organization_id)
  );
}

function getTargetOrUserOrganizationId(
  user: AccessControlUser,
  context: PermissionContext,
): string | null {
  return getTargetOrganizationId(context) ?? getUserOrganizationId(user);
}

function getTargetProjectId(context: PermissionContext): string | null {
  const projectSlug = (context as ProjectSlugContext).projectSlug;

  return (
    toId(context.projectId) ??
    toId(projectSlug) ??
    toId(context.project?.id) ??
    toId(context.project?.slug)
  );
}

function getProjectAccessLevel(context: PermissionContext): string | null {
  return (
    toLowerString(context.projectAccessLevel) ??
    toLowerString(context.project?.accessLevel) ??
    toLowerString(context.project?.access_level)
  );
}

function getOrganizationPermissions(
  context: PermissionContext,
): readonly unknown[] | undefined {
  const organization = context.organization as
    | (AccessControlOrganization & {
        permissions?: readonly unknown[];
      })
    | undefined;

  return organization?.permissions;
}

function getOrganizationDeniedPermissions(
  context: PermissionContext,
): readonly unknown[] | undefined {
  return context.organization?.deniedPermissions ?? undefined;
}

function hasOrganizationInUserList(
  user: AccessControlUser,
  organizationId: string,
): boolean {
  return Boolean(
    user.organizations?.some((organization) => {
      const candidateId =
        toId(organization.id) ?? toId(organization.organizationId);

      return candidateId === organizationId;
    }),
  );
}

function isSameOrganization(
  user: AccessControlUser,
  context: PermissionContext,
): boolean {
  const targetOrganizationId = getTargetOrganizationId(context);

  if (!targetOrganizationId) {
    return true;
  }

  const userOrganizationId = getUserOrganizationId(user);

  if (userOrganizationId) {
    return userOrganizationId === targetOrganizationId;
  }

  return hasOrganizationInUserList(user, targetOrganizationId);
}

function isSameAdministrativeOrganization(
  user: AccessControlUser,
  context: PermissionContext,
): boolean {
  const organizationId = getTargetOrUserOrganizationId(user, context);

  if (!organizationId) {
    return false;
  }

  return isSameOrganization(user, {
    ...context,
    organizationId,
  });
}

function getExplicitPermissions(
  user: AccessControlUser,
  context: PermissionContext,
): Permission[] {
  return [
    ...normalizePermissions(user.permissions),
    ...normalizePermissions(context.permissions),
    ...normalizePermissions(context.project?.permissions),
    ...normalizePermissions(getOrganizationPermissions(context)),
  ];
}

function hasExplicitPermission(
  user: AccessControlUser,
  permission: Permission,
  context: PermissionContext,
): boolean {
  return getExplicitPermissions(user, context).includes(permission);
}

function getExplicitDenials(
  user: AccessControlUser,
  context: PermissionContext,
): Permission[] {
  return [
    ...normalizePermissions(user.deniedPermissions),
    ...normalizePermissions(context.deniedPermissions),
    ...normalizePermissions(context.project?.deniedPermissions),
    ...normalizePermissions(getOrganizationDeniedPermissions(context)),
  ];
}

function hasExplicitDenial(
  user: AccessControlUser,
  permission: Permission,
  context: PermissionContext,
): boolean {
  return getExplicitDenials(user, context).includes(permission);
}

function hasProjectContext(context: PermissionContext): boolean {
  return Boolean(context.project || getTargetProjectId(context));
}

function hasOrganizationContext(context: PermissionContext): boolean {
  return Boolean(context.organization || getTargetOrganizationId(context));
}

function requiresProjectContext(permission: Permission): boolean {
  return PROJECT_CONTEXT_REQUIRED_PERMISSIONS.includes(permission);
}

function isOrganizationScopedPermission(permission: Permission): boolean {
  return ORGANIZATION_CONTEXT_PERMISSION_PREFIXES.some((prefix) =>
    permission.startsWith(prefix),
  );
}

function isAdministrativePermission(permission: Permission): boolean {
  return ADMINISTRATIVE_PERMISSIONS.has(permission);
}

function isAuditPermission(permission: Permission): boolean {
  return AUDIT_PERMISSIONS.has(permission);
}

function isPlatformAuditPermission(permission: Permission): boolean {
  return PLATFORM_AUDIT_PERMISSIONS.has(permission);
}

function isOrganizationAuditPermission(permission: Permission): boolean {
  return ORGANIZATION_AUDIT_PERMISSIONS.has(permission);
}

function isProjectPersistencePermission(permission: Permission): boolean {
  return PROJECT_PERSISTENCE_PERMISSIONS.has(permission);
}

function ownerPolicyAllows(permission: Permission): boolean {
  return OWNER_ORGANIZATION_POLICY_PERMISSIONS.has(permission);
}

function roleForPolicy(role: string): RoleAllowsRole | null {
  if (role === "client") {
    return "owner" as RoleAllowsRole;
  }

  if (
    role === "super_admin" ||
    role === "admin" ||
    role === "owner" ||
    role === "editor" ||
    role === "viewer"
  ) {
    return role as RoleAllowsRole;
  }

  return null;
}

function roleAllowsSafely(role: string, permission: Permission): boolean {
  const policyRole = roleForPolicy(role);

  if (!policyRole) {
    return false;
  }

  return roleAllows(policyRole, permission);
}

function projectAccessAllows(
  permission: Permission,
  context: PermissionContext,
): boolean {
  const accessLevel = getProjectAccessLevel(context);

  if (!accessLevel) {
    return false;
  }

  if (permission === "project.view" || permission === "project.favorite") {
    return PROJECT_VIEW_ACCESS_LEVELS.includes(
      accessLevel as (typeof PROJECT_VIEW_ACCESS_LEVELS)[number],
    );
  }

  return false;
}

function getScopes(
  user: AccessControlUser,
  context: PermissionContext,
): readonly string[] {
  return [...(user.scopes ?? []), ...(context.scopes ?? [])];
}

function hasPlatformScope(
  user: AccessControlUser,
  context: PermissionContext,
): boolean {
  const scopes = getScopes(user, context);

  return (
    scopes.includes("*") ||
    scopes.includes("platform:*") ||
    scopes.includes("platform:all")
  );
}

function hasOrganizationScope(
  user: AccessControlUser,
  context: PermissionContext,
): boolean {
  const organizationId = getTargetOrUserOrganizationId(user, context);

  if (!organizationId) {
    return false;
  }

  if (!isSameAdministrativeOrganization(user, context)) {
    return false;
  }

  const scopes = getScopes(user, context);

  if (scopes.length === 0) {
    return true;
  }

  return (
    scopes.includes(`organization:${organizationId}`) ||
    scopes.includes(`org:${organizationId}`) ||
    scopes.includes("organization:*") ||
    scopes.includes("org:*")
  );
}

function hasAdministrativeScope(
  user: AccessControlUser,
  context: PermissionContext,
): boolean {
  return hasPlatformScope(user, context) || hasOrganizationScope(user, context);
}

function hasScope(
  user: AccessControlUser,
  context: PermissionContext,
): boolean {
  const scopes = getScopes(user, context);

  if (scopes.length === 0) {
    return true;
  }

  if (hasPlatformScope(user, context)) {
    return true;
  }

  const organizationId = getTargetOrganizationId(context);
  const projectId = getTargetProjectId(context);

  if (
    organizationId &&
    (scopes.includes(`organization:${organizationId}`) ||
      scopes.includes(`org:${organizationId}`) ||
      scopes.includes("organization:*") ||
      scopes.includes("org:*"))
  ) {
    return true;
  }

  if (
    projectId &&
    (scopes.includes(`project:${projectId}`) || scopes.includes("project:*"))
  ) {
    return true;
  }

  return !organizationId && !projectId;
}

function administrativePermissionAllows(
  user: AccessControlUser,
  role: string,
  permission: Permission,
  context: PermissionContext,
  explicitPermission: boolean,
): boolean {
  if (permission === "admin.panel.access" || isAuditPermission(permission)) {
    // Painel Admin e todas as superfícies de Auditoria são exclusivos do
    // Super Admin. O bypass do Super Admin ocorre no início de can(). Grants,
    // roles e scopes não podem ampliar esta fronteira.
    return false;
  }

  if (!isAuditPermission(permission)) {
    return false;
  }

  if (isPlatformAuditPermission(permission)) {
    return explicitPermission && hasPlatformScope(user, context);
  }

  if (role === "admin") {
    return explicitPermission && hasAdministrativeScope(user, context);
  }

  if (role === "owner" || role === "client") {
    return (
      explicitPermission &&
      isOrganizationAuditPermission(permission) &&
      hasOrganizationScope(user, context)
    );
  }

  if (role === "editor" || role === "viewer") {
    return explicitPermission && hasAdministrativeScope(user, context);
  }

  return false;
}

function organizationPermissionAllows(
  user: AccessControlUser,
  role: string,
  permission: Permission,
  context: PermissionContext,
  explicitPermission: boolean,
): boolean {
  if (!hasOrganizationContext(context)) {
    return false;
  }

  if (!isSameOrganization(user, context)) {
    return false;
  }

  if (!hasScope(user, context)) {
    return false;
  }

  if (role === "admin" || role === "owner" || role === "client") {
    return (
      explicitPermission ||
      ownerPolicyAllows(permission) ||
      roleAllowsSafely(role, permission)
    );
  }

  if (role === "editor" || role === "viewer") {
    return explicitPermission;
  }

  return false;
}

function projectPersistencePermissionAllows(
  user: AccessControlUser,
  role: string,
  permission: Permission,
  context: PermissionContext,
  explicitPermission: boolean,
): boolean {
  if (!hasProjectContext(context)) {
    return false;
  }

  if (!isSameOrganization(user, context) || !hasScope(user, context)) {
    return false;
  }

  const nativeAdminOrOwnerPersistence =
    (role === "admin" || role === "owner") &&
    PROJECT_PERSISTENCE_PERMISSIONS.has(permission);
  const projectAccessLevel = getProjectAccessLevel(context);
  const nativeEditorSave =
    role === "editor" &&
    permission === "project.save" &&
    Boolean(
      projectAccessLevel &&
        PROJECT_SAVE_ACCESS_LEVELS.includes(
          projectAccessLevel as (typeof PROJECT_SAVE_ACCESS_LEVELS)[number],
        ),
    );

  return (
    nativeAdminOrOwnerPersistence || nativeEditorSave || explicitPermission
  );
}

function projectCreationPermissionAllows(
  user: AccessControlUser,
  role: string,
  context: PermissionContext,
  explicitPermission: boolean,
): boolean {
  if (!hasOrganizationContext(context)) {
    return false;
  }

  if (!isSameOrganization(user, context) || !hasScope(user, context)) {
    return false;
  }

  return role === "admin" || role === "owner" || explicitPermission;
}

export function can(
  user: AccessControlUser | null | undefined,
  permission: Permission,
  context: PermissionContext = {},
): boolean {
  if (!user) {
    return false;
  }

  const role = normalizeRole(user.role);

  if (!role) {
    return false;
  }

  if (role === "super_admin") {
    return true;
  }

  // Uma negação explícita definida pelo Super Admin prevalece sobre grants,
  // role_permissions e capacidades nativas do perfil. O bypass acima preserva
  // o acesso irrestrito do próprio Super Admin.
  if (hasExplicitDenial(user, permission, context)) {
    return false;
  }

  const explicitPermission = hasExplicitPermission(user, permission, context);

  if (isAdministrativePermission(permission)) {
    return administrativePermissionAllows(
      user,
      role,
      permission,
      context,
      explicitPermission,
    );
  }

  if (isOrganizationScopedPermission(permission)) {
    return organizationPermissionAllows(
      user,
      role,
      permission,
      context,
      explicitPermission,
    );
  }

  if (permission === "project.create") {
    return projectCreationPermissionAllows(
      user,
      role,
      context,
      explicitPermission,
    );
  }

  if (requiresProjectContext(permission) && !hasProjectContext(context)) {
    return false;
  }

  if (isProjectPersistencePermission(permission)) {
    return projectPersistencePermissionAllows(
      user,
      role,
      permission,
      context,
      explicitPermission,
    );
  }

  const allowedByRole = roleAllowsSafely(role, permission);
  const allowedByProjectAccess = projectAccessAllows(permission, context);

  if (
    hasProjectContext(context) &&
    PROJECT_MEMBERSHIP_ONLY_PERMISSIONS.has(permission)
  ) {
    return allowedByProjectAccess;
  }

  if (!allowedByRole && !explicitPermission) {
    return false;
  }

  if (!isSameOrganization(user, context)) {
    return false;
  }

  return hasScope(user, context);
}
