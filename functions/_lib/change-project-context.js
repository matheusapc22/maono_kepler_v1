import { getDb } from "./organizations.js";
import { getAuthorizedProject } from "./projects.js";
import { cc08Enabled } from "./project-change-request-lifecycle.js";
// A request-local copy only. A global Ticket grant never becomes project membership.
export async function resolveChangeProjectContext(env, user, slug) {
  if (!cc08Enabled(env))
    return { user, project: await getAuthorizedProject(env, user, slug) };
  const row = await getDb(env)
    .prepare(
      `SELECT p.organization_id FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.active=1 WHERE p.slug=?`,
    )
    .bind(slug)
    .first();
  if (!row) return { user, project: null };
  if (user.role !== "super_admin") {
    const membership = await getDb(env)
      .prepare(
        `SELECT 1 AS ok FROM organization_users ou JOIN user_projects up ON up.user_id=ou.user_id JOIN projects p ON p.id=up.project_id AND p.organization_id=ou.organization_id JOIN users u ON u.id=ou.user_id AND u.active=1 WHERE ou.user_id=? AND ou.organization_id=? AND p.slug=?`,
      )
      .bind(user.id, row.organization_id, slug)
      .first();
    if (!membership) return { user, project: null };
  }
  const scoped = {
    ...user,
    activeOrganizationId: row.organization_id,
    active_organization_id: row.organization_id,
    organizationId: row.organization_id,
    organization_id: row.organization_id,
  };
  return {
    user: scoped,
    project: await getAuthorizedProject(env, scoped, slug),
  };
}
