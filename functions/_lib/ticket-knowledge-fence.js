// Optional grant tables are not part of every historical install. Snapshot relevant
// rows before authorization and compare them inside the same D1 write transaction.
// This avoids creating permission tables or assuming their presence in a migration.
export async function knowledgeGrantFence(
  db,
  org,
  actorId,
  articleId = null,
  reviewerId = null,
) {
  const guards = [],
    checks = [];
  const names = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('role_permissions','user_permissions')",
      )
      .all()
  ).results.map((r) => r.name);
  const actors = `SELECT id FROM users WHERE id=? OR id=? OR id=(SELECT reviewer_id FROM ticket_knowledge_articles WHERE organization_id=? AND id=?)`;
  for (const table of names) {
    const q =
      table === "role_permissions"
        ? `SELECT coalesce(json_group_array(json_array(role,permission,scope_type,active)),'[]') value FROM (SELECT role,permission,scope_type,active FROM role_permissions WHERE role IN (SELECT role FROM users WHERE id IN (${actors})) ORDER BY role,permission,scope_type,active)`
        : `SELECT coalesce(json_group_array(json_array(user_id,permission,organization_id,project_id,expires_at,active,CASE WHEN expires_at IS NULL OR julianday(expires_at)>julianday('now') THEN 1 ELSE 0 END)),'[]') value FROM (SELECT user_id,permission,organization_id,project_id,expires_at,active FROM user_permissions WHERE user_id IN (${actors}) ORDER BY user_id,permission,organization_id,project_id,expires_at,active)`;
    const args = [actorId, reviewerId, org, articleId],
      value = (
        await db
          .prepare(q)
          .bind(...args)
          .first()
      ).value;
    checks.push(
      async () =>
        (
          await db
            .prepare(q)
            .bind(...args)
            .first()
        ).value === value,
    );
    guards.push(
      db
        .prepare(`INSERT INTO ticket_knowledge_guard(value) VALUES((${q})=?)`)
        .bind(...args, value),
    );
  }
  guards.verify = async () => {
    for (const check of checks) if (!(await check())) return false;
    return true;
  };
  return guards;
}
