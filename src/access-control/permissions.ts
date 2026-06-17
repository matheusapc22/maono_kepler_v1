export const PERMISSIONS = [
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

  "admin.panel.access",
  "audit.view",

  "export.view",
  "export.create",
  "export.download",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

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
