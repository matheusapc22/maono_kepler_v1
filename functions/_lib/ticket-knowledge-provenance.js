import { getDb } from "./organizations.js";
// Called only for messages already authorized by CC05. Never returns source metadata or article body.
export async function knowledgeProvenance(
  env,
  organizationId,
  ticketId,
  messageIds,
) {
  const db = getDb(env),
    map = new Map();
  if (
    !messageIds.length ||
    !(await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ticket_knowledge_uses'",
      )
      .first())
  )
    return map;
  const result = await db
    .prepare(
      `SELECT u.message_id,u.article_id,u.revision_id,r.number,u.reviewed_at FROM ticket_knowledge_uses u JOIN ticket_knowledge_revisions r ON r.id=u.revision_id AND r.organization_id=u.organization_id WHERE u.organization_id=? AND u.ticket_id=? AND u.message_id IN (${messageIds.map(() => "?").join(",")})`,
    )
    .bind(organizationId, ticketId, ...messageIds)
    .all();
  for (const r of result?.results || [])
    map.set(r.message_id, {
      articleId: r.article_id,
      revisionId: r.revision_id,
      revisionNumber: r.number,
      reviewedAt: r.reviewed_at,
    });
  return map;
}
