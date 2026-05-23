export async function listProjectsForUser(env, user) {
  if (user.role === "admin") {
    const { results } = await env.DB.prepare(
      `SELECT
        projects.id,
        projects.name,
        projects.slug,
        projects.description,
        projects.dropbox_root_path,
        projects.default_config_file,
        projects.active,
        projects.created_at,
        projects.updated_at,
        'owner' AS access_level
      FROM projects
      WHERE projects.active = 1
      ORDER BY projects.updated_at DESC, projects.name ASC`
    ).all();

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
      projects.active,
      projects.created_at,
      projects.updated_at,
      user_projects.access_level
    FROM user_projects
    INNER JOIN projects ON projects.id = user_projects.project_id
    WHERE user_projects.user_id = ?
      AND projects.active = 1
    ORDER BY projects.updated_at DESC, projects.name ASC`
  )
    .bind(user.id)
    .all();

  return results || [];
}

export async function getAuthorizedProject(env, user, slug) {
  if (user.role === "admin") {
    const project = await env.DB.prepare(
      `SELECT
        projects.id,
        projects.name,
        projects.slug,
        projects.description,
        projects.dropbox_root_path,
        projects.default_config_file,
        projects.active,
        projects.created_at,
        projects.updated_at,
        'owner' AS access_level
      FROM projects
      WHERE projects.slug = ?
        AND projects.active = 1
      LIMIT 1`
    )
      .bind(slug)
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
      projects.active,
      projects.created_at,
      projects.updated_at,
      user_projects.access_level
    FROM user_projects
    INNER JOIN projects ON projects.id = user_projects.project_id
    WHERE user_projects.user_id = ?
      AND projects.slug = ?
      AND projects.active = 1
    LIMIT 1`
  )
    .bind(user.id, slug)
    .first();

  return project || null;
}

export function publicProject(project) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    accessLevel: project.access_level,
    active: Boolean(project.active),
    dropboxRootPath: project.dropbox_root_path,
    defaultConfigFile: project.default_config_file,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

export async function logAudit(env, { userId, projectId = null, action, details = null }) {
  await env.DB.prepare(
    `INSERT INTO audit_logs (user_id, project_id, action, details) VALUES (?, ?, ?, ?)`
  )
    .bind(userId || null, projectId, action, details ? JSON.stringify(details) : null)
    .run();
}