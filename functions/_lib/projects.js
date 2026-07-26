import {
  serializePublicProjectMetadata,
} from "./project-service.js";
import { publicProjectPreview } from "./project-preview.js";

const INTERNAL_PROJECT_COLUMNS = `
  projects.id,
  projects.name,
  projects.slug,
  projects.description,
  projects.dropbox_root_path,
  projects.default_config_file,
  projects.organization_id,
  projects.organization_file_id,
  projects.created_by,
  projects.created_by_name_snapshot,
  projects.updated_by,
  projects.updated_by_name_snapshot,
  projects.metadata_version,
  projects.active,
  projects.created_at,
  projects.updated_at,
  projects.config_revision,
  projects.preview_status,
  projects.preview_revision,
  projects.preview_updated_at,
  projects.preview_attempts,
  organizations.name AS organization_name,
  organizations.slug AS organization_slug,
  creator.id AS creator_user_id,
  creator.name AS creator_current_name,
  updater.id AS updater_user_id,
  updater.name AS updater_current_name
`;

const ACTOR_JOINS = `
  LEFT JOIN users AS creator
    ON creator.id = projects.created_by
  LEFT JOIN users AS updater
    ON updater.id = projects.updated_by
`;

export async function listProjectsForUser(env, user) {
  const activeOrganizationId = getActiveOrganizationId(user);

  if (!activeOrganizationId) {
    return [];
  }

  if (user.role === "super_admin") {
    const { results } = await env.DB.prepare(
      `SELECT
        ${INTERNAL_PROJECT_COLUMNS},
        'owner' AS access_level
      FROM projects
      INNER JOIN organizations
        ON organizations.id = projects.organization_id
       AND organizations.active = 1
      ${ACTOR_JOINS}
      WHERE projects.active = 1
        AND projects.organization_id = ?
      ORDER BY projects.updated_at DESC, projects.name ASC`,
    )
      .bind(activeOrganizationId)
      .all();

    return results || [];
  }

  const { results } = await env.DB.prepare(
    `SELECT
      ${INTERNAL_PROJECT_COLUMNS},
      user_projects.access_level
    FROM user_projects
    INNER JOIN projects ON projects.id = user_projects.project_id
    INNER JOIN organizations
      ON organizations.id = projects.organization_id
     AND organizations.active = 1
    INNER JOIN organization_users
      ON organization_users.organization_id = projects.organization_id
     AND organization_users.user_id = user_projects.user_id
    ${ACTOR_JOINS}
    WHERE user_projects.user_id = ?
      AND projects.active = 1
      AND projects.organization_id = ?
    ORDER BY projects.updated_at DESC, projects.name ASC`,
  )
    .bind(user.id, activeOrganizationId)
    .all();

  return results || [];
}

export async function getAuthorizedProject(env, user, slug) {
  const activeOrganizationId = getActiveOrganizationId(user);

  if (!activeOrganizationId) {
    return null;
  }

  if (user.role === "super_admin") {
    const project = await env.DB.prepare(
      `SELECT
        ${INTERNAL_PROJECT_COLUMNS},
        'owner' AS access_level
      FROM projects
      INNER JOIN organizations
        ON organizations.id = projects.organization_id
       AND organizations.active = 1
      ${ACTOR_JOINS}
      WHERE projects.slug = ?
        AND projects.active = 1
        AND projects.organization_id = ?
      LIMIT 1`,
    )
      .bind(slug, activeOrganizationId)
      .first();

    return project || null;
  }

  const project = await env.DB.prepare(
    `SELECT
      ${INTERNAL_PROJECT_COLUMNS},
      user_projects.access_level
    FROM user_projects
    INNER JOIN projects ON projects.id = user_projects.project_id
    INNER JOIN organizations
      ON organizations.id = projects.organization_id
     AND organizations.active = 1
    INNER JOIN organization_users
      ON organization_users.organization_id = projects.organization_id
     AND organization_users.user_id = user_projects.user_id
    ${ACTOR_JOINS}
    WHERE user_projects.user_id = ?
      AND projects.slug = ?
      AND projects.active = 1
      AND projects.organization_id = ?
    LIMIT 1`,
  )
    .bind(user.id, slug, activeOrganizationId)
    .first();

  return project || null;
}

export function getActiveOrganizationId(user) {
  return (
    user?.activeOrganizationId ??
    user?.active_organization_id ??
    user?.organizationId ??
    user?.organization_id ??
    null
  );
}

/**
 * DTO público. Não expõe Dropbox, arquivo de configuração, hashes,
 * credenciais ou demais campos internos.
 */
export function publicProject(project) {
  if (!project) {
    return null;
  }

  const metadata = serializePublicProjectMetadata(project);
  const accessLevel = project.access_level ?? project.accessLevel ?? null;

  return {
    ...metadata,
    ...publicProjectPreview(project),
    accessLevel,
    access_level: accessLevel,
    permissions: Array.isArray(project.permissions) ? project.permissions : [],
    thumbnailUrl:
      project.thumbnail_url ??
      project.thumbnailUrl ??
      undefined,
  };
}

export async function logAudit(
  env,
  { userId, projectId = null, action, details = null },
) {
  await env.DB.prepare(
    `INSERT INTO audit_logs (user_id, project_id, action, details) VALUES (?, ?, ?, ?)`,
  )
    .bind(
      userId || null,
      projectId,
      action,
      details ? JSON.stringify(details) : null,
    )
    .run();
}
