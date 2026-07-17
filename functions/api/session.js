import {
  jsonResponse,
  errorResponse,
  methodNotAllowed,
} from "../_lib/http.js";
import { getSessionUser } from "../_lib/auth.js";
import { listProjectsForUser, publicProject } from "../_lib/projects.js";

const ROLE_ALIASES = {
  client: "owner",
};

const OFFICIAL_ROLES = new Set([
  "super_admin",
  "admin",
  "owner",
  "editor",
  "viewer",
]);

const PUBLIC_PERMISSION_SET = new Set([
  "project.view",
  "project.create",
  "project.edit",
  "project.save",
  "project.favorite",
  "project.thumbnail.update",

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
  "organization.edit",
  "organization.metrics.view",

  "limits.view",
  "limits.increase_request",

  "admin.panel.access",
  "audit.view",
]);

const OWNER_DEFAULT_PERMISSIONS = [
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
];

const PUBLIC_LIMIT_KEYS = new Set([
  "plan",
  "planName",
  "plan_name",
  "maxProjects",
  "max_projects",
  "projectLimit",
  "project_limit",
  "maxUsers",
  "max_users",
  "userLimit",
  "user_limit",
  "maxStorageMb",
  "max_storage_mb",
  "storageLimitMb",
  "storage_limit_mb",
  "maxExportsPerMonth",
  "max_exports_per_month",
]);

function normalizeRole(role) {
  const rawRole = String(role || "").trim().toLowerCase();
  const normalized = ROLE_ALIASES[rawRole] || rawRole;

  return OFFICIAL_ROLES.has(normalized) ? normalized : "viewer";
}

function normalizePermission(permission) {
  const value = String(permission || "").trim();

  return PUBLIC_PERMISSION_SET.has(value) ? value : null;
}

function uniqueStrings(values) {
  return [
    ...new Set(values.filter((value) => typeof value === "string" && value)),
  ];
}

function getDb(env) {
  return env.DB || env.D1 || env.MAONO_DB || null;
}

async function optionalAll(env, sql, params = []) {
  const db = getDb(env);

  if (!db || typeof db.prepare !== "function") {
    return [];
  }

  try {
    const statement = db.prepare(sql);
    const result =
      params.length > 0
        ? await statement.bind(...params).all()
        : await statement.all();

    return Array.isArray(result?.results) ? result.results : [];
  } catch (error) {
    console.warn("[Maono session] Consulta opcional ignorada:", error.message);
    return [];
  }
}

async function optionalAllOrNull(env, sql, params = []) {
  const db = getDb(env);

  if (!db || typeof db.prepare !== "function") {
    return [];
  }

  try {
    const statement = db.prepare(sql);
    const result =
      params.length > 0
        ? await statement.bind(...params).all()
        : await statement.all();

    return Array.isArray(result?.results) ? result.results : [];
  } catch (error) {
    console.warn("[Maono session] Consulta opcional ignorada:", error.message);
    return null;
  }
}

function normalizePermissionRows(rows) {
  return rows
    .map((row) => normalizePermission(row.permission || row.action || row.name))
    .filter(Boolean);
}

function toId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return value;
}

function toPublicBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1") {
    return true;
  }

  if (value === 0 || value === "0") {
    return false;
  }

  return undefined;
}

function getUserOrganizationId(user) {
  return (
    toId(user.activeOrganizationId) ||
    toId(user.active_organization_id) ||
    toId(user.organizationId) ||
    toId(user.organization_id) ||
    toId(user.organization?.id) ||
    toId(user.organization?.organizationId) ||
    null
  );
}

function getProjectOrganizationId(project) {
  return (
    toId(project.organizationId) ||
    toId(project.organization_id) ||
    toId(project.orgId) ||
    toId(project.org_id) ||
    null
  );
}

function publicOrganization(row) {
  if (!row) {
    return null;
  }

  const id =
    toId(row.id) ||
    toId(row.organizationId) ||
    toId(row.organization_id) ||
    null;

  if (!id) {
    return null;
  }

  return {
    id,
    name: row.name || row.organization_name || undefined,
    slug: row.slug || row.organization_slug || undefined,
    role: row.role || row.organizationRole || row.organization_role || undefined,
    accessLevel:
      row.accessLevel ||
      row.access_level ||
      row.organizationAccessLevel ||
      undefined,
    access_level:
      row.access_level ||
      row.accessLevel ||
      row.organizationAccessLevel ||
      undefined,
    active: toPublicBoolean(row.active),
    plan: row.plan || row.plan_name || undefined,
  };
}

function publicOrganizations(rows) {
  const organizations = rows.map(publicOrganization).filter(Boolean);
  const seen = new Set();

  return organizations.filter((organization) => {
    const key = String(organization.id);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function listActiveOrganizationsForSuperAdmin(env) {
  const activeRowsWithPlan = await optionalAll(
    env,
    `
      SELECT
        id,
        name,
        slug,
        active,
        plan,
        'super_admin' AS role,
        'owner' AS access_level
      FROM organizations
      WHERE active = 1
      ORDER BY name ASC
      LIMIT 100
    `,
  );

  if (activeRowsWithPlan.length > 0) {
    return publicOrganizations(activeRowsWithPlan);
  }

  const activeRows = await optionalAll(
    env,
    `
      SELECT
        id,
        name,
        slug,
        active,
        'super_admin' AS role,
        'owner' AS access_level
      FROM organizations
      WHERE active = 1
      ORDER BY name ASC
      LIMIT 100
    `,
  );

  if (activeRows.length > 0) {
    return publicOrganizations(activeRows);
  }

  const fallbackRows = await optionalAll(
    env,
    `
      SELECT
        id,
        name,
        slug,
        'super_admin' AS role,
        'owner' AS access_level
      FROM organizations
      ORDER BY name ASC
      LIMIT 100
    `,
  );

  return publicOrganizations(fallbackRows);
}

async function listOrganizationsForUser(env, user, role) {
  if (role === "super_admin") {
    const organizations = await listActiveOrganizationsForSuperAdmin(env);

    if (organizations.length > 0) {
      return organizations;
    }
  }

  const userId = user.id;

  const rowsWithPlan = await optionalAll(
    env,
    `
      SELECT
        o.id,
        o.name,
        o.slug,
        o.active,
        o.plan,
        ? AS role,
        ou.access_level
      FROM organization_users ou
      INNER JOIN organizations o ON o.id = ou.organization_id
      WHERE ou.user_id = ?
      ORDER BY o.name ASC
      LIMIT 100
    `,
    [role, userId],
  );

  const rows =
    rowsWithPlan.length > 0
      ? rowsWithPlan
      : await optionalAll(
          env,
          `
            SELECT
              o.id,
              o.name,
              o.slug,
              ? AS role,
              ou.access_level
            FROM organization_users ou
            INNER JOIN organizations o ON o.id = ou.organization_id
            WHERE ou.user_id = ?
            ORDER BY o.name ASC
            LIMIT 100
          `,
          [role, userId],
        );

  const organizations = publicOrganizations(rows);
  const fallbackOrganizationId = getUserOrganizationId(user);

  if (organizations.length === 0 && fallbackOrganizationId) {
    return [
      {
        id: fallbackOrganizationId,
        name: user.organization_name || user.organizationName || undefined,
        slug: user.organization_slug || user.organizationSlug || undefined,
        role: role === "owner" ? "owner" : undefined,
        accessLevel: user.accessLevel || user.access_level || undefined,
        access_level: user.access_level || user.accessLevel || undefined,
      },
    ];
  }

  return organizations;
}

function getActiveOrganizationId(user, organizations) {
  const explicit = getUserOrganizationId(user);

  if (explicit) {
    return explicit;
  }

  return organizations[0]?.id || null;
}

async function listDirectUserPermissions(env, userId) {
  const rows = await optionalAllOrNull(
    env,
    `
      SELECT permission
      FROM user_permissions
      WHERE user_id = ?
        AND active = 1
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      LIMIT 500
    `,
    [userId],
  );

  if (rows !== null) {
    return normalizePermissionRows(rows);
  }

  const fallbackRows = await optionalAll(
    env,
    `
      SELECT permission
      FROM user_permissions
      WHERE user_id = ?
      LIMIT 500
    `,
    [userId],
  );

  return normalizePermissionRows(fallbackRows);
}

async function listOrganizationUserPermissions(
  env,
  userId,
  activeOrganizationId,
) {
  if (!activeOrganizationId) {
    return [];
  }

  const rows = await optionalAllOrNull(
    env,
    `
      SELECT permission
      FROM organization_user_permissions
      WHERE user_id = ?
        AND organization_id = ?
        AND active = 1
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      LIMIT 500
    `,
    [userId, activeOrganizationId],
  );

  if (rows !== null) {
    return normalizePermissionRows(rows);
  }

  const fallbackRows = await optionalAll(
    env,
    `
      SELECT permission
      FROM organization_user_permissions
      WHERE user_id = ?
        AND organization_id = ?
      LIMIT 500
    `,
    [userId, activeOrganizationId],
  );

  return normalizePermissionRows(fallbackRows);
}

async function listRolePermissions(env, role) {
  const rows = await optionalAllOrNull(
    env,
    `
      SELECT permission
      FROM role_permissions
      WHERE role = ?
        AND active = 1
        AND (
          scope_type = 'global'
          OR scope_type = 'organization'
          OR scope_type = 'project'
        )
      LIMIT 500
    `,
    [role],
  );

  if (rows !== null) {
    return normalizePermissionRows(rows);
  }

  const fallbackRows = await optionalAll(
    env,
    `
      SELECT permission
      FROM role_permissions
      WHERE role = ?
      LIMIT 500
    `,
    [role],
  );

  return normalizePermissionRows(fallbackRows);
}

function listDefaultRolePermissions(role) {
  if (role === "super_admin") {
    return [...PUBLIC_PERMISSION_SET];
  }

  if (role === "owner") {
    return OWNER_DEFAULT_PERMISSIONS;
  }

  return [];
}

async function listConfiguredPermissions(env, user, role, activeOrganizationId) {
  const [directPermissions, organizationPermissions, rolePermissions] =
    await Promise.all([
      listDirectUserPermissions(env, user.id),
      listOrganizationUserPermissions(env, user.id, activeOrganizationId),
      listRolePermissions(env, role),
    ]);

  return uniqueStrings([
    ...listDefaultRolePermissions(role),
    ...directPermissions,
    ...organizationPermissions,
    ...rolePermissions,
  ]);
}

async function listStoredScopes(env, userId) {
  const rows = await optionalAll(
    env,
    `
      SELECT scope
      FROM user_scopes
      WHERE user_id = ?
      LIMIT 500
    `,
    [userId],
  );

  return rows
    .map((row) => row.scope)
    .filter((scope) => typeof scope === "string" && scope.trim());
}

function buildDefaultScopes(role, organizations) {
  if (role === "super_admin") {
    return ["platform:*"];
  }

  return organizations.map((organization) => `organization:${organization.id}`);
}

async function listScopes(env, user, role, organizations) {
  const storedScopes = await listStoredScopes(env, user.id);

  return uniqueStrings([
    ...buildDefaultScopes(role, organizations),
    ...storedScopes,
  ]);
}

async function listFeatureFlags(env, userId, activeOrganizationId) {
  const userRows = await optionalAll(
    env,
    `
      SELECT flag
      FROM user_feature_flags
      WHERE user_id = ?
      LIMIT 200
    `,
    [userId],
  );

  const organizationRows = activeOrganizationId
    ? await optionalAll(
        env,
        `
          SELECT flag
          FROM organization_feature_flags
          WHERE organization_id = ?
          LIMIT 200
        `,
        [activeOrganizationId],
      )
    : [];

  return uniqueStrings(
    [...userRows, ...organizationRows]
      .map((row) => row.flag || row.feature_flag || row.name)
      .filter((flag) => typeof flag === "string" && flag.trim()),
  );
}

function parseLimitValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  const numberValue = Number(trimmed);

  if (!Number.isNaN(numberValue) && trimmed !== "") {
    return numberValue;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function normalizeLimitKey(key) {
  const value = String(key || "").trim();

  return PUBLIC_LIMIT_KEYS.has(value) ? value : null;
}

async function getOrganizationLimits(env, activeOrganizationId) {
  if (!activeOrganizationId) {
    return {};
  }

  const rows = await optionalAll(
    env,
    `
      SELECT key, value
      FROM organization_limits
      WHERE organization_id = ?
      LIMIT 100
    `,
    [activeOrganizationId],
  );

  const limits = {};

  for (const row of rows) {
    const key = normalizeLimitKey(row.key || row.limit_key || row.name);

    if (!key) {
      continue;
    }

    limits[key] = parseLimitValue(row.value);
  }

  return limits;
}

function publicSafeProject(project) {
  const base = publicProject(project) || project || {};

  const id = toId(base.id);
  const slug = base.slug;
  const name = base.name;

  if (!id || !slug || !name) {
    return null;
  }

  const organizationId = getProjectOrganizationId(base);
  const accessLevel =
    base.accessLevel ||
    base.access_level ||
    base.projectAccessLevel ||
    "viewer";

  return {
    id,
    name,
    slug,
    description: base.description || undefined,
    organizationId,
    organization_id: organizationId,
    accessLevel,
    access_level: accessLevel,
    permissions: Array.isArray(base.permissions)
      ? base.permissions.map(normalizePermission).filter(Boolean)
      : [],
    active: typeof base.active === "boolean" ? base.active : undefined,
    thumbnailUrl: base.thumbnailUrl || base.thumbnail_url || undefined,
    createdAt: base.createdAt || base.created_at || undefined,
    updatedAt: base.updatedAt || base.updated_at || undefined,
  };
}

function publicSafeProjects(projects) {
  return projects.map(publicSafeProject).filter(Boolean);
}

function getActiveOrganization(organizations, activeOrganizationId) {
  if (!activeOrganizationId) {
    return organizations[0] || null;
  }

  return (
    organizations.find(
      (organization) => String(organization.id) === String(activeOrganizationId),
    ) ||
    organizations[0] ||
    null
  );
}

function publicUser(
  user,
  role,
  activeOrganizationId,
  organizations,
  permissions,
  scopes,
  featureFlags,
  limits,
) {
  const activeOrganization = getActiveOrganization(
    organizations,
    activeOrganizationId,
  );

  return {
    id: user.id,
    email: user.email,
    name: user.name || undefined,
    role,
    rawRole: user.role && String(user.role) !== role ? user.role : undefined,

    organizationId: activeOrganizationId,
    organization_id: activeOrganizationId,
    activeOrganizationId,
    activeOrganization,
    organization: activeOrganization,
    organizations,

    permissions,
    scopes,
    accessLevel: user.accessLevel || user.access_level || null,
    access_level: user.access_level || user.accessLevel || null,
    featureFlags,
    limits,
  };
}

function unauthenticatedSession() {
  return {
    authenticated: false,
    user: null,
    projects: [],
    activeOrganization: null,
    organizations: [],
    permissions: [],
    scopes: [],
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const user = await getSessionUser(env, request);

    if (!user) {
      return jsonResponse(unauthenticatedSession());
    }

    const role = normalizeRole(user.role);
    const organizations = await listOrganizationsForUser(env, user, role);
    const activeOrganizationId = getActiveOrganizationId(user, organizations);

    const [projects, permissions, scopes, featureFlags, limits] =
      await Promise.all([
        listProjectsForUser(env, user),
        listConfiguredPermissions(env, user, role, activeOrganizationId),
        listScopes(env, user, role, organizations),
        listFeatureFlags(env, user.id, activeOrganizationId),
        getOrganizationLimits(env, activeOrganizationId),
      ]);

    const publicProjects = publicSafeProjects(projects);
    const activeOrganization = getActiveOrganization(
      organizations,
      activeOrganizationId,
    );

    return jsonResponse({
      authenticated: true,
      user: publicUser(
        user,
        role,
        activeOrganizationId,
        organizations,
        permissions,
        scopes,
        featureFlags,
        limits,
      ),
      projects: publicProjects,
      activeOrganization,
      organizations,
      permissions,
      scopes,
    });
  } catch (error) {
    console.error("[Maono session] Falha ao carregar sessão:", error);

    return errorResponse(
      "Não foi possível carregar a sessão.",
      error.status || 500,
      error.code || "SESSION_ERROR",
    );
  }
}