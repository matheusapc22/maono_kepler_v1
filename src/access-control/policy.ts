import type { MaonoRole } from "./roles";
import type { Permission } from "./permissions";
import { ALL_PERMISSIONS } from "./permissions";

export type IdLike = string | number;

export interface AccessControlOrganization {
  id?: IdLike | null;
  organizationId?: IdLike | null;
  slug?: string | null;
}

export interface AccessControlProject {
  id?: IdLike | null;
  slug?: string | null;
  organizationId?: IdLike | null;
  organization_id?: IdLike | null;
  accessLevel?: string | null;
  access_level?: string | null;
  permissions?: readonly string[] | null;
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
  scopes?: readonly string[] | null;
}

export interface PermissionContext {
  organization?: AccessControlOrganization | null;
  project?: AccessControlProject | null;
  organizationId?: IdLike | null;
  projectId?: IdLike | null;
  projectAccessLevel?: string | null;
  permissions?: readonly string[] | null;
  scopes?: readonly string[] | null;
  featureFlags?: readonly string[] | null;
}

export const ROLE_PERMISSIONS: Record<MaonoRole, readonly Permission[]> = {
  super_admin: ALL_PERMISSIONS,

  // Admins internos da Maõno não recebem acesso global por padrão.
  // Acesso real deve vir de permissions/scopes retornados pela sessão segura.
  admin: [],

  owner: [
    "project.view",
    "project.create",
    "project.save",
    "project.favorite",

    "document.view",
    "document.upload",
    "document.download",
    "document.delete",

    "ticket.view",
    "ticket.create",
    "ticket.manage",

    "users.view",
    "users.create",
    "users.manage_access",

    "permission.grant",
    "permission.revoke",

    "organization.view",
    "organization.edit",

    "limits.view",
    "limits.increase_request",

    "export.view",
    "export.create",
    "export.download",
  ],

  editor: [
    "project.view",
    "project.save",
    "project.favorite",

    "document.view",
    "document.upload",
    "document.download",

    "ticket.view",
    "ticket.create",

    "export.view",
    "export.create",
    "export.download",
  ],

  viewer: [
    "project.view",
    "project.favorite",
  ],
};

export const PROJECT_CONTEXT_REQUIRED_PERMISSIONS: readonly Permission[] = [
  "project.save",
];

export const PROJECT_VIEW_ACCESS_LEVELS = [
  "owner",
  "editor",
  "viewer",
  "write",
  "read",
] as const;

export const PROJECT_SAVE_ACCESS_LEVELS = [
  "owner",
  "editor",
  "write",
] as const;

export function roleAllows(role: MaonoRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
