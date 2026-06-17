import { requireSession, normalizeRole } from "./auth.js";

export const PERMISSIONS = [
  "project.view",
  "project.create",
  "project.edit",
  "project.save",
  "project.favorite",
  "project.thumbnail.update",

  "document.view",
  "document.upload",
  "document.download",
  "document.edit",
  "document.delete",
  "document.manage",

  "ticket.view",
  "ticket.create",
  "ticket.comment",
  "ticket.manage",
  "ticket.close",
  "ticket.assign",

  "export.view",
  "export.create",
  "export.download",
  "export.manage",

  "users.view",
  "users.create",
  "users.edit",
  "users.disable",
  "users.delete",
  "users.invite",
  "users.manage_access",

  "permission.grant",
  "permission.revoke",
  "role.assign",

  "organization.view",
  "organization.edit",
  "organization.metrics.view",

  "billing.view",
  "plan.view",
  "plan.change_request",
  "limits.view",
  "limits.increase_request",

  "admin.panel.access",
  "audit.view",
  "audit.export",
  "audit.security.view",
  "audit.platform.view",
  "audit.organization.view",
];

const PERMISSION_SET = new Set(PERMISSIONS);

const PROJECT_VIEW_ACCESS_LEVELS = new Set(["viewer", "editor", "owner"]);
const PROJECT_SAVE_ACCESS_LEVELS = new Set(["editor", "owner"]);

const OWNER_ORGANIZATION_PERMISSIONS = new Set([
  "project.view",
  "project.favorite",
  "document.view",
  "ticket.view",
  "ticket.create",
  "ticket.comment",
  "users.view",
  "users.create",
  "users.edit",
  "users.disable",
  "users.invite",
  "users.manage_access",
  "permission.grant",
  "permission.revoke",
  "organization.view",
  "organization.edit",
  "organization.metrics.view",
  "plan.view",
  "limits.view",
  "limits.increase_request",
]);

const PROJECT_CONTEXT_PERMISSIONS = new Set([
  "project.view",
  "project.edit",
  "project.save",
  "project.favorite",
  "project.thumbnail.update",
]);

const SENSITIVE_ACTIONS = new Set([
  "project.create",
  "project.edit",
  "project.save",
  "project.favorite",
  "project.thumbnail.update",
  "document.upload",
  "document.download",
  "document.edit",
  "document.delete",
  "document.manage",
  "ticket.create",
  "ticket.comment",
  "ticket.manage",
  "ticket.close",
  "ticket.assign",
  "export.create",
  "export.download",
  "export.manage",
  "users.create",
  "users.edit",
  "users.disable",
  "users.delete",
  "users.invite",
  "users.manage_access",
  "permission.grant",
  "permission.revoke",
  "role.assign",
  "organization.edit",
  "plan.change_request",
  "limits.increase_request",
  "admin.panel.access",
  "audit.export",
]);

function getDb(env) {
  const db = env.DB || env.D1 || env.MAONO_DB;

  if (!db || typeof db.prepare !== "function") {
    const error = new Error("Banco de dados D1 não configurado.");
    error.status = 500;
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }

  return db;
}

function toId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value);
}

function normalizePermission(permission) {
  const value = String(permission || "").trim();
  return PERMISSION_SET.has(value) ? value : null;
}

function nowIso() {
  return new Date().toISOString();
}

async function optionalAll(env, sql, params = []) {
  const db = getDb(env);

  try {
    const statement = db.prepare(sql);
    const result =
      params.length > 0
        ? await statement.bind(...params).all()
        : await statement.all();

    return Array.isArray(result?.results) ? result.results : [];
  } catch (error) {
    console.warn("[Maono permissions] Consulta opcional ignorada:", error.message);
    return [];
  }
}

async function optionalFirst(env, sql, params = []) {
  const rows = await optionalAll(env, sql, params);
  return rows[0] || null;
}

async function optionalRun(env, sql, params = []) {
  const db = getDb(env);

  try {
    const statement = db.prepare(sql);
    return params.length > 0
      ? await statement.bind(...params).run()
      : await statement.run();
  } catch (error) {
    console.warn("[Maono permissions] Escrita opcional ignorada:", error.message);
    return null;
  }
}

function isExpiredPermission(row) {
  if (!row?.expires_at) {
    return false;
  }

  return new Date(row.expires_at).getTime() <= Date.now();
}

function normalizeAccessLevel(value) {
  return String(value || "").trim().toLowerCase();
}

function getContextOrganizationId(context) {
  return (
    toId(context?.organizationId) ||
    toId(context?.organization_id) ||
    toId(context?.organization?.id) ||
    toId(context?.organization?.organizationId) ||
    toId(context?.project?.organization_id) ||
    toId(context?.project?.organizationId) ||
    null
  );
}

function getContextProjectId(context) {
  return (
    toId(context?.projectId) ||
    toId(context?.project_id) ||
    toId(context?.project?.id) ||
    null
  );
}

function getContextProjectSlug(context) {
  return (
    context?.projectSlug ||
    context?.project_slug ||
    context?.project?.slug ||
    null
  );
}

async function getProjectContext(env, context = {}) {
  if (context.project && (context.project.id || context.project.slug)) {
    return {
      id: context.project.id,
      slug: context.project.slug,
      name: context.project.name,
      organization_id:
        context.project.organization_id || context.project.organizationId || null,
      active: context.project.active,
    };
  }

  const projectId = getContextProjectId(context);
  const projectSlug = getContextProjectSlug(context);

  if (!projectId && !projectSlug) {
    return null;
  }

  const where = projectId ? "id = ?" : "slug = ?";
  const value = projectId || projectSlug;

  return optionalFirst(
    env,
    `
      SELECT id, slug, name, organization_id, active
      FROM projects
      WHERE ${where}
      LIMIT 1
    `,
    [value],
  );
}

async function getOrganizationMembership(env, userId, organizationId) {
  if (!userId || !organizationId) {
    return null;
  }

  const membership = await optionalFirst(
    env,
    `
      SELECT organization_id, user_id, access_level, role, active
      FROM organization_users
      WHERE user_id = ?
        AND organization_id = ?
      LIMIT 1
    `,
    [userId, organizationId],
  );

  if (!membership) {
    return null;
  }

  if (membership.active === 0 || membership.active === "0") {
    return null;
  }

  return membership;
}

async function getProjectAccess(env, userId, projectId) {
  if (!userId || !projectId) {
    return null;
  }

  const access = await optionalFirst(
    env,
    `
      SELECT user_id, project_id, access_level
      FROM user_projects
      WHERE user_id = ?
        AND project_id = ?
      LIMIT 1
    `,
    [userId, projectId],
  );

  return access || null;
}

async function hasUserPermission(env, user, permission, context) {
  const organizationId = getContextOrganizationId(context);
  const projectId = getContextProjectId(context);

  const rows = await optionalAll(
    env,
    `
      SELECT id, permission, organization_id, project_id, expires_at, active
      FROM user_permissions
      WHERE user_id = ?
        AND permission = ?
        AND active = 1
        AND (expires_at IS NULL OR expires_at > ?)
        AND (
          (organization_id IS NULL AND project_id IS NULL)
          OR (organization_id = ?)
          OR (project_id = ?)
        )
      LIMIT 20
    `,
    [
      user.id,
      permission,
      nowIso(),
      organizationId ? Number(organizationId) || organizationId : null,
      projectId ? Number(projectId) || projectId : null,
    ],
  );

  return rows.some((row) => !isExpiredPermission(row));
}

async function hasRolePermission(env, role, permission, context) {
  const scopeType = getContextProjectId(context)
    ? "project"
    : getContextOrganizationId(context)
      ? "organization"
      : "global";

  const rows = await optionalAll(
    env,
    `
      SELECT role, permission, scope_type, active
      FROM role_permissions
      WHERE role = ?
        AND permission = ?
        AND active = 1
        AND (scope_type = ? OR scope_type = 'global')
      LIMIT 20
    `,
    [role, permission, scopeType],
  );

  return rows.length > 0;
}

function canProjectAccessLevel(permission, accessLevel) {
  const normalized = normalizeAccessLevel(accessLevel);

  if (!normalized) {
    return false;
  }

  if (permission === "project.view" || permission === "project.favorite") {
    return PROJECT_VIEW_ACCESS_LEVELS.has(normalized);
  }

  if (
    permission === "project.save" ||
    permission === "project.edit" ||
    permission === "project.thumbnail.update"
  ) {
    return PROJECT_SAVE_ACCESS_LEVELS.has(normalized);
  }

  return false;
}

async function ownerWithinOrganization(env, user, permission, context) {
  if (!OWNER_ORGANIZATION_PERMISSIONS.has(permission)) {
    return false;
  }

  const organizationId = getContextOrganizationId(context);

  if (!organizationId) {
    return false;
  }

  const membership = await getOrganizationMembership(env, user.id, organizationId);

  if (!membership) {
    return false;
  }

  const membershipRole = normalizeRole(
    membership.role || membership.access_level || user.role,
  );

  return (
    membershipRole === "owner" ||
    normalizeAccessLevel(membership.access_level) === "owner"
  );
}

async function projectMembershipAllows(env, user, permission, context, project) {
  if (!PROJECT_CONTEXT_PERMISSIONS.has(permission)) {
    return false;
  }

  if (!project?.id) {
    return false;
  }

  const access = await getProjectAccess(env, user.id, project.id);

  if (!access) {
    return false;
  }

  return canProjectAccessLevel(permission, access.access_level);
}

async function buildResolvedContext(env, context = {}) {
  const project = await getProjectContext(env, context);
  const organizationId =
    getContextOrganizationId(context) ||
    (project ? toId(project.organization_id) : null);

  return {
    ...context,
    project: project || context.project || null,
    projectId: project?.id || getContextProjectId(context),
    projectSlug: project?.slug || getContextProjectSlug(context),
    organizationId,
  };
}

export async function can(env, user, permission, context = {}) {
  const normalizedPermission = normalizePermission(permission);

  if (!user || !normalizedPermission) {
    return {
      allowed: false,
      reason: "DENY_BY_DEFAULT",
      user: user || null,
      permission,
      context,
    };
  }

  const role = normalizeRole(user.role);

  if (!role) {
    return {
      allowed: false,
      reason: "INVALID_ROLE",
      user,
      permission: normalizedPermission,
      context,
    };
  }

  const resolvedContext = await buildResolvedContext(env, context);
  const project = resolvedContext.project;

  if (role === "super_admin") {
    return {
      allowed: true,
      reason: "SUPER_ADMIN",
      user,
      permission: normalizedPermission,
      context: resolvedContext,
    };
  }

  const explicitUserPermission = await hasUserPermission(
    env,
    user,
    normalizedPermission,
    resolvedContext,
  );

  const configuredRolePermission = await hasRolePermission(
    env,
    role,
    normalizedPermission,
    resolvedContext,
  );

  if (role === "admin") {
    return {
      allowed: explicitUserPermission || configuredRolePermission,
      reason:
        explicitUserPermission || configuredRolePermission
          ? "ADMIN_CONFIGURED_PERMISSION"
          : "ADMIN_REQUIRES_PERMISSION",
      user,
      permission: normalizedPermission,
      context: resolvedContext,
    };
  }

  if (explicitUserPermission) {
    return {
      allowed: true,
      reason: "USER_PERMISSION",
      user,
      permission: normalizedPermission,
      context: resolvedContext,
    };
  }

  if (
    project &&
    configuredRolePermission &&
    await projectMembershipAllows(
      env,
      user,
      normalizedPermission,
      resolvedContext,
      project,
    )
  ) {
    return {
      allowed: true,
      reason: "PROJECT_ACCESS_LEVEL",
      user,
      permission: normalizedPermission,
      context: resolvedContext,
    };
  }

  if (
    configuredRolePermission &&
    await ownerWithinOrganization(env, user, normalizedPermission, resolvedContext)
  ) {
    return {
      allowed: true,
      reason: "ORGANIZATION_ROLE",
      user,
      permission: normalizedPermission,
      context: resolvedContext,
    };
  }

  return {
    allowed: false,
    reason: "DENY_BY_DEFAULT",
    user,
    permission: normalizedPermission,
    context: resolvedContext,
  };
}

export async function requirePermission(
  env,
  request,
  permission,
  context = {},
  options = {},
) {
  const user = options.user || await requireSession(env, request);
  const decision = await can(env, user, permission, context);

  const shouldAudit =
    options.audit === true ||
    options.auditAction ||
    SENSITIVE_ACTIONS.has(decision.permission || permission);

  if (!decision.allowed) {
    if (shouldAudit) {
      await recordAuditLog(env, {
        actorUserId: user?.id,
        organizationId: decision.context?.organizationId,
        projectId: decision.context?.projectId,
        action: options.auditAction || permission,
        resourceType: options.resourceType || inferResourceType(permission),
        resourceId:
          options.resourceId ||
          decision.context?.projectSlug ||
          decision.context?.projectId ||
          decision.context?.organizationId ||
          null,
        result: "denied",
        metadata: {
          reason: decision.reason,
          permission,
        },
        request,
      });
    }

    const error = new Error("Acesso negado.");
    error.status = 403;
    error.code = "FORBIDDEN";
    error.permission = permission;
    error.reason = decision.reason;
    throw error;
  }

  if (shouldAudit && options.auditOnSuccess !== false) {
    await recordAuditLog(env, {
      actorUserId: user?.id,
      organizationId: decision.context?.organizationId,
      projectId: decision.context?.projectId,
      action: options.auditAction || permission,
      resourceType: options.resourceType || inferResourceType(permission),
      resourceId:
        options.resourceId ||
        decision.context?.projectSlug ||
        decision.context?.projectId ||
        decision.context?.organizationId ||
        null,
      result: "success",
      metadata: {
        reason: decision.reason,
        permission,
      },
      request,
    });
  }

  return {
    user,
    decision,
    context: decision.context,
  };
}

export async function requireProjectPermission(
  env,
  request,
  permission,
  projectSlugOrId,
  options = {},
) {
  const context =
    typeof projectSlugOrId === "object"
      ? projectSlugOrId
      : {
          projectSlug: projectSlugOrId,
        };

  return requirePermission(env, request, permission, context, {
    ...options,
    resourceType: options.resourceType || "project",
  });
}

export async function recordAuditLog(env, event) {
  const details = JSON.stringify({
    organizationId: event.organizationId || null,
    resourceType: event.resourceType || null,
    resourceId: event.resourceId || null,
    result: event.result || "success",
    metadata: event.metadata || {},
    userAgent: event.request?.headers?.get("user-agent") || null,
  });

  return optionalRun(
    env,
    `
      INSERT INTO audit_logs (
        user_id,
        project_id,
        action,
        details,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      event.actorUserId || null,
      event.projectId || null,
      event.action,
      details,
      nowIso(),
    ],
  );
}

function inferResourceType(permission) {
  const prefix = String(permission || "").split(".")[0];

  if (prefix === "project") return "project";
  if (prefix === "document") return "document";
  if (prefix === "ticket") return "ticket";
  if (prefix === "export") return "export";
  if (prefix === "users" || prefix === "permission" || prefix === "role") {
    return "user";
  }
  if (prefix === "organization" || prefix === "limits" || prefix === "plan") {
    return "organization";
  }
  if (prefix === "admin" || prefix === "audit") return "platform";

  return "unknown";
}

export function isKnownPermission(permission) {
  return Boolean(normalizePermission(permission));
}