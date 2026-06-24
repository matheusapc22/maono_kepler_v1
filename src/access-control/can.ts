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

const ORGANIZATION_CONTEXT_PERMISSION_PREFIXES = [
  "document.",
  "ticket.",
  "export.",
] as const;

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

  if (
    scopes.includes("*") ||
    scopes.includes("platform:*") ||
    scopes.includes("platform:all")
  ) {
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

function organizationPermissionAllows(
  user: AccessControlUser,
  role: string,
  permission: Permission,
  context: PermissionContext,
  explicitPermission: boolean,
): boolean {
  /**
   * Permissões de documentos, chamados e exportações sempre precisam de
   * contexto organizacional na UI. Sem organizationId, não há como garantir
   * que o item exibido pertence ao escopo correto do usuário.
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
   * Admin continua configurável: só vê ações de organização quando a sessão
   * ou o contexto trouxer permissão explícita e escopo compatível.
   */
  if (role === "admin") {
    return explicitPermission;
  }

  /**
   * Owner pode receber permissões visuais da própria organização por policy,
   * mas também respeita permissões explícitas quando vierem do backend.
   */
  if (role === "owner") {
    return explicitPermission || roleAllows(role, permission);
  }

  /**
   * Editor e Viewer não recebem documentos, chamados ou exportações apenas por role.
   * Para Sprint 7, eles precisam de permissão explícita no payload/contexto.
   *
   * Isso impede, por padrão, casos sensíveis como export.download para Viewer.
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

  if (role === "super_admin") {
    return true;
  }

  const explicitPermission = hasExplicitPermission(user, permission, context);

  /**
   * Permissões organization-scoped entram antes da regra geral de role.
   * Isso evita liberar document.*, ticket.* e export.* por acidente para
   * editor/viewer apenas porque roleAllows(...) permite algo no futuro.
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

  if (role === "admin") {
    return explicitPermission && hasScope(user, context);
  }

  if (requiresProjectContext(permission) && !hasProjectContext(context)) {
    return false;
  }

  const allowedByRole = roleAllows(role, permission);
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