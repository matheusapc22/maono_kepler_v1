export const PERMISSION = {
  PROJECT_VIEW: "project.view",
  PROJECT_CREATE: "project.create",
  PROJECT_SAVE: "project.save",
  PROJECT_EDIT: "project.edit",
  PROJECT_FAVORITE: "project.favorite",
  PROJECT_THUMBNAIL_UPDATE: "project.thumbnail.update",

  DOCUMENT_VIEW: "document.view",
  DOCUMENT_UPLOAD: "document.upload",
  DOCUMENT_DOWNLOAD: "document.download",
  DOCUMENT_EDIT: "document.edit",
  DOCUMENT_DELETE: "document.delete",
  DOCUMENT_MANAGE: "document.manage",

  TICKET_VIEW: "ticket.view",
  TICKET_CREATE: "ticket.create",
  TICKET_COMMENT: "ticket.comment",
  TICKET_MANAGE: "ticket.manage",
  TICKET_CLOSE: "ticket.close",
  TICKET_ASSIGN: "ticket.assign",

  EXPORT_VIEW: "export.view",
  EXPORT_CREATE: "export.create",
  EXPORT_DOWNLOAD: "export.download",

  ROADMAP_VIEW: "roadmap.view",
  ROADMAP_COMMENT_CREATE: "roadmap.comment.create",
  ROADMAP_COMMENT_EDIT_OWN: "roadmap.comment.edit_own",
  ROADMAP_COMMENT_MODERATE: "roadmap.comment.moderate",
  ROADMAP_MANAGE: "roadmap.manage",
  ROADMAP_TASK_MANAGE: "roadmap.task.manage",
  ROADMAP_DEPENDENCY_MANAGE: "roadmap.dependency.manage",

  USERS_VIEW: "users.view",
  USERS_CREATE: "users.create",
  USERS_EDIT: "users.edit",
  USERS_DISABLE: "users.disable",
  USERS_DELETE: "users.delete",
  USERS_INVITE: "users.invite",
  USERS_MANAGE_ACCESS: "users.manage_access",

  PERMISSION_GRANT: "permission.grant",
  PERMISSION_REVOKE: "permission.revoke",

  ROLE_ASSIGN: "role.assign",

  ORGANIZATION_VIEW: "organization.view",
  ORGANIZATION_EDIT: "organization.edit",
  ORGANIZATION_METRICS_VIEW: "organization.metrics.view",
  ORGANIZATION_PROJECTS_GEOJSON_VIEW: "organization.projects.geojson.view",
  ORGANIZATION_USERS_PERMISSIONS_DELEGATE:
    "organization.users.permissions.delegate",

  LIMITS_VIEW: "limits.view",
  LIMITS_INCREASE_REQUEST: "limits.increase_request",
  PLAN_VIEW: "plan.view",
  PLAN_CHANGE_REQUEST: "plan.change_request",

  ADMIN_PANEL_ACCESS: "admin.panel.access",

  AUDIT_VIEW: "audit.view",
  AUDIT_EXPORT: "audit.export",
  AUDIT_SECURITY_VIEW: "audit.security.view",
  AUDIT_PLATFORM_VIEW: "audit.platform.view",
  AUDIT_ORGANIZATION_VIEW: "audit.organization.view",
} as const;

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

export const PERMISSIONS = Object.values(PERMISSION) as readonly Permission[];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;

export const PROJECT_MAP_PERMISSIONS = [
  PERMISSION.PROJECT_VIEW,
  PERMISSION.PROJECT_SAVE,
  PERMISSION.PROJECT_EDIT,
  PERMISSION.PROJECT_THUMBNAIL_UPDATE,
] as const satisfies readonly Permission[];

export const PROJECT_PERSISTENCE_PERMISSIONS = [
  PERMISSION.PROJECT_SAVE,
  PERMISSION.PROJECT_EDIT,
  PERMISSION.PROJECT_THUMBNAIL_UPDATE,
] as const satisfies readonly Permission[];

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
