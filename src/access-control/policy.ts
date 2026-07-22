import type { MaonoRole } from "./roles";
import type { Permission } from "./permissions";
import { ALL_PERMISSIONS } from "./permissions";

export type IdLike = string | number;

export interface AccessControlOrganization {
  id?: IdLike | null;
  organizationId?: IdLike | null;
  slug?: string | null;
  deniedPermissions?: readonly string[] | null;
}

export interface AccessControlProject {
  id?: IdLike | null;
  slug?: string | null;
  organizationId?: IdLike | null;
  organization_id?: IdLike | null;
  accessLevel?: string | null;
  access_level?: string | null;
  permissions?: readonly string[] | null;
  deniedPermissions?: readonly string[] | null;
}

export interface AccessControlUser {
  id?: IdLike | null;
  role?: string | null;
  organizationId?: IdLike | null;
  organization_id?: IdLike | null;
  activeOrganizationId?: IdLike | null;
  organization?: AccessControlOrganization | null;
  organizations?: readonly AccessControlOrganization[] | null;
  permissions?: readonly string[] | null;
  deniedPermissions?: readonly string[] | null;
  scopes?: readonly string[] | null;
}

export interface PermissionContext {
  organization?: AccessControlOrganization | null;
  project?: AccessControlProject | null;
  organizationId?: IdLike | null;
  projectId?: IdLike | null;
  projectAccessLevel?: string | null;
  permissions?: readonly string[] | null;
  deniedPermissions?: readonly string[] | null;
  scopes?: readonly string[] | null;
  featureFlags?: readonly string[] | null;
}

const OWNER_NATIVE_PERMISSIONS: readonly Permission[] = [
  "project.create",
  "project.edit",
  "project.save",
  "project.thumbnail.update",

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

  "roadmap.view",
  "roadmap.comment.create",
  "roadmap.comment.edit_own",
  "roadmap.comment.moderate",
  "roadmap.manage",
  "roadmap.task.manage",
  "roadmap.dependency.manage",
];

export const ROLE_PERMISSIONS: Record<MaonoRole, readonly Permission[]> = {
  super_admin: ALL_PERMISSIONS,

  // Admin e owner compartilham o mesmo conjunto nativo somente dentro da
  // organização ativa e vinculada. GeoJSON amplo, auditoria, delegação e o
  // Painel Admin não integram este conjunto.
  admin: OWNER_NATIVE_PERMISSIONS,

  owner: OWNER_NATIVE_PERMISSIONS,

  // O editor salva apenas projeto ao qual esteja vinculado com nível de
  // edição. As demais capacidades organizacionais continuam explícitas.
  editor: ["project.save"],

  viewer: [],
};

export const PROJECT_CONTEXT_REQUIRED_PERMISSIONS: readonly Permission[] = [
  "project.save",
  "project.edit",
  "project.thumbnail.update",
];

export const PROJECT_VIEW_ACCESS_LEVELS = [
  "owner",
  "editor",
  "viewer",
  "write",
  "read",
] as const;

export const PROJECT_SAVE_ACCESS_LEVELS = ["owner", "editor", "write"] as const;

export function roleAllows(role: MaonoRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
