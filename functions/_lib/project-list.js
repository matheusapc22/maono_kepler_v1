import { getActiveOrganizationId, publicProject } from "./projects.js";

const ACCESS_LEVELS = new Set(["owner", "editor", "viewer"]);

function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "client") return "owner";
  return normalized || "viewer";
}

function normalizeAccessLevel(accessLevel) {
  const normalized = String(accessLevel || "").trim().toLowerCase();
  return ACCESS_LEVELS.has(normalized) ? normalized : "viewer";
}

function nowIso() {
  return new Date().toISOString();
}

function publicSafeProject(project, favoriteProjectIds = new Set()) {
  const base = publicProject(project) || project || {};

  const id = base.id ?? project?.id;
  const slug = base.slug ?? project?.slug;
  const name = base.name ?? project?.name;

  if (!id || !slug || !name) {
    return null;
  }

  const organizationId =
    base.organizationId ??
    base.organization_id ??
    project?.organization_id ??
    null;

  return {
    id,
    name,
    slug,
    description: base.description ?? undefined,
    organizationId,
    organization_id: organizationId,
    accessLevel: normalizeAccessLevel(
      base.accessLevel ?? base.access_level ?? project?.access_level,
    ),
    permissions: Array.isArray(base.permissions) ? base.permissions : [],
    active:
      typeof base.active === "boolean"
        ? base.active
        : project?.active === 1 || project?.active === true,
    thumbnailUrl: base.thumbnailUrl ?? base.thumbnail_url ?? undefined,
    createdAt:
      base.createdAt ??
      base.created_at ??
      project?.created_at ??
      undefined,
    updatedAt:
      base.updatedAt ??
      base.updated_at ??
      project?.updated_at ??
      undefined,
    favorite: favoriteProjectIds.has(Number(id)),
  };
}

function sortByUpdatedAtDesc(projects) {
  return [...projects].sort((left, right) => {
    const leftDate = Date.parse(left.updatedAt || left.createdAt || "");
    const rightDate = Date.parse(right.updatedAt || right.createdAt || "");

    if (Number.isNaN(leftDate) && Number.isNaN(rightDate)) {
      return String(left.name).localeCompare(String(right.name), "pt-BR");
    }

    if (Number.isNaN(leftDate)) return 1;
    if (Number.isNaN(rightDate)) return -1;

    return rightDate - leftDate;
  });
}

function isRecentProject(project, days = 5) {
  const reference = project.updatedAt || project.createdAt;

  if (!reference) {
    return false;
  }

  const timestamp = Date.parse(reference);

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}

async function listFavoriteIdsForUser(env, userId) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT project_id
       FROM favorite_projects
       WHERE user_id = ?`,
    )
      .bind(userId)
      .all();

    return new Set((results || []).map((row) => Number(row.project_id)));
  } catch (error) {
    console.warn("[Maono projects] favorite_projects indisponível:", error.message);
    return new Set();
  }
}

export async function listProjectsForActiveOrganization(env, user) {
  const role = normalizeRole(user?.role);
  const activeOrganizationId = getActiveOrganizationId(user);

  if (!activeOrganizationId) {
    return [];
  }

  const favoriteIds = await listFavoriteIdsForUser(env, user.id);

  if (role === "super_admin") {
    const { results } = await env.DB.prepare(
      `SELECT
        projects.id,
        projects.name,
        projects.slug,
        projects.description,
        projects.organization_id,
        projects.active,
        projects.created_at,
        projects.updated_at,
        'owner' AS access_level
       FROM projects
       INNER JOIN organizations
         ON organizations.id = projects.organization_id
        AND organizations.active = 1
       WHERE projects.active = 1
         AND projects.organization_id = ?
       ORDER BY projects.updated_at DESC, projects.name ASC`,
    )
      .bind(activeOrganizationId)
      .all();

    return (results || [])
      .map((project) => publicSafeProject(project, favoriteIds))
      .filter(Boolean);
  }

  const { results } = await env.DB.prepare(
    `SELECT
      projects.id,
      projects.name,
      projects.slug,
      projects.description,
      projects.organization_id,
      projects.active,
      projects.created_at,
      projects.updated_at,
      user_projects.access_level
     FROM user_projects
     INNER JOIN projects ON projects.id = user_projects.project_id
     INNER JOIN organizations
       ON organizations.id = projects.organization_id
      AND organizations.active = 1
     INNER JOIN organization_users
       ON organization_users.organization_id = projects.organization_id
      AND organization_users.user_id = user_projects.user_id
     WHERE user_projects.user_id = ?
       AND projects.active = 1
       AND projects.organization_id = ?
     ORDER BY projects.updated_at DESC, projects.name ASC`,
  )
    .bind(user.id, activeOrganizationId)
    .all();

  return (results || [])
    .map((project) => publicSafeProject(project, favoriteIds))
    .filter(Boolean);
}

export async function listRecentProjectsForActiveOrganization(env, user) {
  const projects = await listProjectsForActiveOrganization(env, user);
  return sortByUpdatedAtDesc(projects.filter((project) => isRecentProject(project)));
}

export async function listFavoriteProjectsForActiveOrganization(env, user) {
  const projects = await listProjectsForActiveOrganization(env, user);
  return sortByUpdatedAtDesc(projects.filter((project) => project.favorite));
}

export async function getAccessibleProjectBySlug(env, user, slug) {
  const normalizedSlug = String(slug || "").trim();

  if (!normalizedSlug) {
    return null;
  }

  const role = normalizeRole(user?.role);
  const activeOrganizationId = getActiveOrganizationId(user);

  if (!activeOrganizationId) {
    return null;
  }

  const favoriteIds = await listFavoriteIdsForUser(env, user.id);

  if (role === "super_admin") {
    const project = await env.DB.prepare(
      `SELECT
        projects.id,
        projects.name,
        projects.slug,
        projects.description,
        projects.organization_id,
        projects.active,
        projects.created_at,
        projects.updated_at,
        'owner' AS access_level
       FROM projects
       INNER JOIN organizations
         ON organizations.id = projects.organization_id
        AND organizations.active = 1
       WHERE projects.slug = ?
         AND projects.active = 1
         AND projects.organization_id = ?
       LIMIT 1`,
    )
      .bind(normalizedSlug, activeOrganizationId)
      .first();

    return project ? publicSafeProject(project, favoriteIds) : null;
  }

  const project = await env.DB.prepare(
    `SELECT
      projects.id,
      projects.name,
      projects.slug,
      projects.description,
      projects.organization_id,
      projects.active,
      projects.created_at,
      projects.updated_at,
      user_projects.access_level
     FROM user_projects
     INNER JOIN projects ON projects.id = user_projects.project_id
     INNER JOIN organizations
       ON organizations.id = projects.organization_id
      AND organizations.active = 1
     INNER JOIN organization_users
       ON organization_users.organization_id = projects.organization_id
      AND organization_users.user_id = user_projects.user_id
     WHERE user_projects.user_id = ?
       AND projects.slug = ?
       AND projects.active = 1
       AND projects.organization_id = ?
     LIMIT 1`,
  )
    .bind(user.id, normalizedSlug, activeOrganizationId)
    .first();

  return project ? publicSafeProject(project, favoriteIds) : null;
}

export function canFavoriteProject(user, project) {
  if (!user || !project) {
    return false;
  }

  const role = normalizeRole(user.role);

  if (role === "super_admin") {
    return true;
  }

  const accessLevel = String(
    project.accessLevel ?? project.access_level ?? "",
  )
    .trim()
    .toLowerCase();

  return ACCESS_LEVELS.has(accessLevel);
}

export function canCreateProject(user) {
  const role = normalizeRole(user?.role);

  if (role === "super_admin") {
    return true;
  }

  // Sprint 6 deve trocar isto por permissions.js + escopo/limite/plano.
  // Por segurança, admin/owner/editor sem backend granular não criam por chamada direta.
  return false;
}

export async function markProjectFavorite(env, user, project) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO favorite_projects (user_id, project_id, created_at)
     VALUES (?, ?, ?)`,
  )
    .bind(user.id, project.id, nowIso())
    .run();

  return {
    ...project,
    favorite: true,
  };
}

export async function unmarkProjectFavorite(env, user, project) {
  await env.DB.prepare(
    `DELETE FROM favorite_projects
     WHERE user_id = ?
       AND project_id = ?`,
  )
    .bind(user.id, project.id)
    .run();

  return {
    ...project,
    favorite: false,
  };
}
