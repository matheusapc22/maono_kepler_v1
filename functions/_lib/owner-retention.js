import { readRequestSchema } from './request-schema.js';

export function lastOwnerError(code = 'LAST_OWNER_REQUIRED') {
  return Object.assign(new Error('A organização precisa manter pelo menos um responsável ativo.'), { status: 409, code });
}

// The predicate is evaluated by SQLite inside each write, never by a prior count.
// It remains false for every statement of a rejected batch, and true after an
// accepted change. D1 batch serializes those statements in one transaction.
export async function ownerRetention(env, { userId, organizationId = null, accessLevel = null, role = null, active = null, removing = false }) {
  const membershipActive = await readRequestSchema(env, 'owner-retention:membership-active', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(organization_users)').all();
    return results.some(column => column.name === 'active');
  });
  const eligible = alias => membershipActive ? `COALESCE(${alias}.active, 1) = 1` : '1 = 1';
  const sql = `NOT EXISTS (
    SELECT 1 FROM organization_users m JOIN users u ON u.id = m.user_id
    CROSS JOIN (SELECT ? AS target, ? AS org, ? AS level, ? AS role, ? AS active, ? AS removing) next
    WHERE m.user_id = next.target
      AND (next.org IS NULL OR m.organization_id = next.org OR next.role IS NOT NULL OR next.active IS NOT NULL)
      AND (
        (LOWER(m.access_level) = 'owner'
          AND (next.removing = 1 OR (m.organization_id = next.org AND next.level IS NOT NULL AND next.level <> 'owner'))
          AND NOT EXISTS (
            SELECT 1 FROM organization_users other JOIN users peer ON peer.id = other.user_id
            WHERE other.organization_id = m.organization_id AND other.user_id <> m.user_id
              AND LOWER(other.access_level) = 'owner' AND COALESCE(peer.active, 1) = 1 AND ${eligible('other')}
          ))
        OR (COALESCE(u.active, 1) = 1 AND ${eligible('m')}
          AND (LOWER(u.role) IN ('owner','client') OR LOWER(m.access_level) = 'owner')
          AND (next.removing = 1 OR COALESCE(next.active, u.active, 1) = 0 OR (
            LOWER(COALESCE(next.role, u.role)) NOT IN ('owner','client')
            AND LOWER(CASE WHEN m.organization_id = next.org THEN COALESCE(next.level, m.access_level) ELSE m.access_level END) <> 'owner'
          ))
          AND NOT EXISTS (
            SELECT 1 FROM organization_users other JOIN users peer ON peer.id = other.user_id
            WHERE other.organization_id = m.organization_id AND other.user_id <> m.user_id
              AND (LOWER(peer.role) IN ('owner','client') OR LOWER(other.access_level) = 'owner')
              AND COALESCE(peer.active, 1) = 1 AND ${eligible('other')}
          ))
      )
  )`;
  return { sql, args: [userId, organizationId, accessLevel, role, active, removing ? 1 : 0] };
}

export function guardedAudit(env, guard, { userId, action, details }) {
  return env.DB.prepare(`INSERT INTO audit_logs (user_id, project_id, action, details)
    SELECT ?, NULL, ?, ? WHERE ${guard.sql}`).bind(userId, action, JSON.stringify(details), ...guard.args);
}

export async function changeMembership(env, { userId, organizationId, accessLevel, remove = false, code = 'LAST_OWNER_REMOVAL_BLOCKED' }) {
  const guard = await ownerRetention(env, { userId, organizationId, accessLevel: accessLevel ?? null, removing: remove });
  let result;
  if (remove) {
    // Cleanup runs only after the conditional delete actually removed the link.
    // A blocked last-owner removal leaves both grants and denials untouched.
    const hasGrants = await readRequestSchema(env, 'owner-retention:grants-table', async () => Boolean(
      await env.DB.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'user_permissions'").first(),
    ));
    [result] = await env.DB.batch([
      env.DB.prepare(`DELETE FROM organization_users WHERE user_id = ? AND organization_id = ? AND ${guard.sql}`).bind(userId, organizationId, ...guard.args),
      ...(hasGrants ? [env.DB.prepare(`DELETE FROM user_permissions WHERE user_id = ? AND organization_id = ?
        AND NOT EXISTS (SELECT 1 FROM organization_users WHERE user_id = ? AND organization_id = ?)`)
        .bind(userId, organizationId, userId, organizationId)] : []),
    ]);
  } else {
    result = await env.DB.prepare(`INSERT INTO organization_users (organization_id, user_id, access_level, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id, user_id) DO UPDATE SET access_level = excluded.access_level WHERE ${guard.sql}`)
      .bind(organizationId, userId, accessLevel, ...guard.args).run();
  }
  if (Number(result.meta?.changes) !== 1) throw lastOwnerError(code);
}
