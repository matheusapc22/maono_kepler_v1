export async function listProjectsForUser(env, user) {
  const activeOrganizationId = getActiveOrganizationId(user);

  if (!activeOrganizationId) {
    return [];
  }

  if (user.role === "super_admin") {
    const { results } = await env.DB.prepare(
      `SELECT
        projects.id,
        projects.name,
        projects.slug,
        projects.description,
        projects.dropbox_root_path,
        projects.default_config_file,
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
      ORDER BY projects.updated_at DESC, projects.name ASC`
    )
      .bind(activeOrganizationId)
      .all();

    return results || [];
  }

  const { results } = await env.DB.prepare(
    `SELECT
      projects.id,
      projects.name,
      projects.slug,
      projects.description,
      projects.dropbox_root_path,
      projects.default_config_file,
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
    ORDER BY projects.updated_at DESC, projects.name ASC`
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
        projects.id,
        projects.name,
        projects.slug,
        projects.description,
        projects.dropbox_root_path,
        projects.default_config_file,
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
      LIMIT 1`
    )
      .bind(slug, activeOrganizationId)
      .first();

    return project || null;
  }

  const project = await env.DB.prepare(
    `SELECT
      projects.id,
      projects.name,
      projects.slug,
      projects.description,
      projects.dropbox_root_path,
      projects.default_config_file,
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
    LIMIT 1`
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

export function publicProject(project) {
  const organizationId = project.organization_id ?? null;
  const accessLevel = project.access_level ?? null;

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    organizationId,
    organization_id: organizationId,
    accessLevel,
    access_level: accessLevel,
    active: Boolean(project.active),
    dropboxRootPath: project.dropbox_root_path,
    defaultConfigFile: project.default_config_file,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
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
