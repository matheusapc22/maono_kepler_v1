export const PERMISSION = {
  PROJECT_VIEW: "project.view",
  PROJECT_CREATE: "project.create",
  PROJECT_SAVE: "project.save",
  PROJECT_FAVORITE: "project.favorite",

  DOCUMENT_VIEW: "document.view",
  DOCUMENT_UPLOAD: "document.upload",
  DOCUMENT_DOWNLOAD: "document.download",
  DOCUMENT_DELETE: "document.delete",

  TICKET_VIEW: "ticket.view",
  TICKET_CREATE: "ticket.create",
  TICKET_MANAGE: "ticket.manage",

  USERS_VIEW: "users.view",
  USERS_CREATE: "users.create",
  USERS_MANAGE_ACCESS: "users.manage_access",

  PERMISSION_GRANT: "permission.grant",
  PERMISSION_REVOKE: "permission.revoke",

  ORGANIZATION_VIEW: "organization.view",
  ORGANIZATION_EDIT: "organization.edit",

  LIMITS_VIEW: "limits.view",
  LIMITS_INCREASE_REQUEST: "limits.increase_request",

  ADMIN_PANEL_ACCESS: "admin.panel.access",
  AUDIT_VIEW: "audit.view",

  EXPORT_VIEW: "export.view",
  EXPORT_CREATE: "export.create",
  EXPORT_DOWNLOAD: "export.download",
} as const;

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

export const PERMISSIONS = Object.values(PERMISSION) as readonly Permission[];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;

const PERMISSION_SET = new Set<string>(PERMISSIONS);

export function isPermission(permission: unknown): permission is Permission {
  return typeof permission === "string" && PERMISSION_SET.has(permission);
}

export function normalizePermissions(
  permissions: readonly unknown[] | null | undefined,
): Permission[] {
  if (!permissions) {
    return [];
  }

  return permissions.filter(isPermission);
}