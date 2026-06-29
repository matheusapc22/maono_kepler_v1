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

const ORGANIZATION_CONTEXT_PERMISSION_PREFIXES = [
  "document.",
  "ticket.",
  "export.",
  "users.",
  "permission.",
  "role.",
  "organization.",
  "limits.",
  "plan.",
] as const;

const ADMINISTRATIVE_PERMISSIONS: ReadonlySet<Permission> =
  new Set<Permission>([
    "admin.panel.access",
    "audit.view",
    "audit.export",
    "audit.security.view",
    "audit.platform.view",
    "audit.organization.view",
  ]);

const AUDIT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "audit.view",
  "audit.export",
  "audit.security.view",
  "audit.platform.view",
  "audit.organization.view",
]);

const PLATFORM_AUDIT_PERMISSIONS: ReadonlySet<Permission> =
  new Set<Permission>([
    "audit.security.view",
    "audit.platform.view",
  ]);

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
    "ticket.manage",

    "export.view",
    "export.create",
    "export.download",

    "users.view",
    "users.create",
    "users.edit",
    "users.disable",
    "users.manage_access",

    "permission.grant",
    "permission.revoke",
    "role.assign",

    "organization.view",
    "organization.metrics.view",

    "limits.view",
    "limits.increase_request",
  ]);

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
  return (
    toId(context.projectId) ??
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

  if (userOrganizationId === targetOrganizationId) {
    return true;
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

  if (permission === "project.save") {
    return PROJECT_SAVE_ACCESS_LEVELS.includes(
      accessLevel as (typeof PROJECT_SAVE_ACCESS_LEVELS)[number],
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

  /**
   * Compatibilidade visual: se a sessão ainda não trouxe scopes, mas trouxe
   * vínculo claro de organização, a UI pode exibir itens autorizados por
   * permissão explícita. A segurança real continua no backend.
   */
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

function hasScope(user: AccessControlUser, context: PermissionContext): boolean {
  const scopes = getScopes(user, context);

  /**
   * Compatibilidade com a sessão atual:
   * enquanto scopes ainda não estiverem populados para todos os usuários,
   * a autorização visual depende de role, organização, accessLevel e permissions.
   *
   * Endpoints sensíveis continuam obrigados a validar permissão no backend.
   */
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

  /**
   * Quando não há contexto específico, a permissão explícita já é suficiente
   * para adaptar a UI. A validação real de escopo deve acontecer no backend.
   */
  return !organizationId && !projectId;
}

function administrativePermissionAllows(
  user: AccessControlUser,
  role: string,
  permission: Permission,
  context: PermissionContext,
  explicitPermission: boolean,
): boolean {
  if (permission === "admin.panel.access") {
    if (role === "admin") {
      return explicitPermission && hasAdministrativeScope(user, context);
    }

    /**
     * Owner, Editor e Viewer não devem visualizar Painel Admin por role.
     * Mesmo com UI manipulada, backend e rotas precisam bloquear.
     */
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
    /**
     * Owner só visualiza auditoria organizacional se vier autorizado por
     * permissão explícita e estiver no escopo da própria organização.
     */
    return (
      explicitPermission &&
      isOrganizationAuditPermission(permission) &&
      hasOrganizationScope(user, context)
    );
  }

  if (role === "editor" || role === "viewer") {
    /**
     * Editor e Viewer dependem de permissão explícita. Por padrão, como não
     * recebem audit.* na sessão, não veem Auditoria.
     */
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
  /**
   * Permissões de organização sempre precisam de contexto organizacional na UI.
   * Sem organizationId, não há como exibir uma ação scoped de forma confiável.
   */
  if (!hasOrganizationContext(context)) {
    return false;
  }

  if (!isSameOrganization(user, context)) {
    return false;
  }

  if (!hasScope(user, context)) {
    return false;
  }

  /**
   * Admin depende de escopo e permissão explícita.
   * Isso evita liberar Gestão apenas pelo role "admin".
   */
  if (role === "admin") {
    return explicitPermission;
  }

  /**
   * Owner pode visualizar e operar Gestão dentro da própria organização,
   * conforme policy visual da Sprint 8. Regras finas de escalada continuam
   * no backend.
   */
  if (role === "owner" || role === "client") {
    return (
      explicitPermission ||
      ownerPolicyAllows(permission) ||
      roleAllowsSafely(role, permission)
    );
  }

  /**
   * Editor e Viewer dependem de permissões explícitas para qualquer permissão
   * organizacional nova ou antiga.
   */
  if (role === "editor" || role === "viewer") {
    return explicitPermission;
  }

  return false;
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

  /**
   * Super Admin pode visualizar tudo na UI.
   * Segurança real continua nos endpoints.
   */
  if (role === "super_admin") {
    return true;
  }

  const explicitPermission = hasExplicitPermission(user, permission, context);

  /**
   * Permissões administrativas e de auditoria entram antes das permissões
   * organization-scoped. Isso impede que audit.* ou admin.panel.access sejam
   * liberadas por policy genérica de Owner/Admin.
   */
  if (isAdministrativePermission(permission)) {
    return administrativePermissionAllows(
      user,
      role,
      permission,
      context,
      explicitPermission,
    );
  }

  /**
   * Permissões organization-scoped entram antes da regra geral de role.
   * Isso cobre Sprint 7 e Sprint 8:
   * document.*, ticket.*, export.*, users.*, permission.*, role.*,
   * organization.*, limits.* e plan.*.
   */
  if (isOrganizationScopedPermission(permission)) {
    return organizationPermissionAllows(
      user,
      role,
      permission,
      context,
      explicitPermission,
    );
  }

  /**
   * Admin continua configurável: fora do bloco organization-scoped e fora
   * do bloco administrativo, depende de permissão explícita e escopo.
   */
  if (role === "admin") {
    return explicitPermission && hasScope(user, context);
  }

  if (requiresProjectContext(permission) && !hasProjectContext(context)) {
    return false;
  }

  const allowedByRole = roleAllowsSafely(role, permission);
  const allowedByProjectAccess = projectAccessAllows(permission, context);

  /**
   * Se o backend retornou um projeto com accessLevel, a UI deve respeitar
   * esse vínculo direto usuário-projeto, mesmo quando a organização ativa
   * do usuário for diferente da organização proprietária do projeto.
   *
   * Isso mantém favoritos comuns para viewer/editor/owner e mantém
   * salvamento restrito a editor/owner via PROJECT_SAVE_ACCESS_LEVELS.
   * A segurança real continua no backend.
   */
  if (hasProjectContext(context) && allowedByProjectAccess) {
    return true;
  }

  if (!allowedByRole && !explicitPermission) {
    return false;
  }

  if (!isSameOrganization(user, context)) {
    return false;
  }

  return hasScope(user, context);
}