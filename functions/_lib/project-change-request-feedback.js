import {requireTicketAccess} from "./ticket-access.js";
import {can} from "./permissions.js";
import { getDb } from "./organizations.js";
import {
  cc08Enabled,
  ensureChangeRequestLifecycleSchema,
} from "./project-change-request-lifecycle.js";
const fail = (code) => {
  throw Object.assign(
    new Error("A proposta mudou; atualize antes de reenviar."),
    { code, status: 409 },
  );
};
export async function requestChangeInformation(context, comment) {
  const feedback = String(comment || "").trim();
  if (!feedback || feedback.length > 2000) fail("CHANGE_INFORMATION_REQUIRED");
  if (!["submitted", "under_review"].includes(context.row.status))
    fail("CHANGE_REQUEST_REVIEW_STATE_CONFLICT");
  await context.db
    .prepare(
      `INSERT INTO project_change_request_feedback(change_request_id,version,feedback,actor_id)
 SELECT id,lifecycle_version,?,? FROM project_change_requests WHERE id=? AND lifecycle_version=? AND status IN ('submitted','under_review')
 ON CONFLICT(change_request_id,version) DO NOTHING`,
    )
    .bind(
      feedback,
      context.user.id,
      context.row.id,
      context.row.lifecycle_version,
    )
    .run();
  const row = await context.db
    .prepare(
      "SELECT * FROM project_change_request_feedback WHERE change_request_id=? AND version=?",
    )
    .bind(context.row.id, context.row.lifecycle_version)
    .first();
  if (!row || row.feedback !== feedback) fail("CHANGE_INFORMATION_CONFLICT");
  return row;
}
export async function resubmissionStatements(env, user, project, input, newId) {
  if (!input?.supersedes) return [];
  if (!cc08Enabled(env)) fail("CHANGE_RESUBMISSION_DISABLED");
  await ensureChangeRequestLifecycleSchema(env);
  const db = getDb(env),
    old = await db
      .prepare(
        `SELECT r.* FROM project_change_requests r JOIN project_change_request_feedback f ON f.change_request_id=r.id
 WHERE r.id=? AND r.project_id=? AND r.organization_id=? AND r.requested_by_user_id=? AND r.status IN ('submitted','under_review')`,
      )
      .bind(
        String(input.supersedes),
        project.id,
        project.organization_id,
        user.id,
      )
      .first();
  if (!old) fail("CHANGE_RESUBMISSION_NOT_ALLOWED");
  const linked=(await db.prepare('SELECT ticket_id FROM ticket_change_links WHERE record_id=? AND active=1').bind('cr:'+old.id).all()).results||[];
  if(linked.length && !(await can(env,user,'ticket.view',{organizationId:project.organization_id,scopeType:'organization'})).allowed)fail('CHANGE_RESUBMISSION_TICKET_DENIED');
  for(const link of linked)await requireTicketAccess(env,project.organization_id,link.ticket_id,user);
  return [
    db
      .prepare(
        `UPDATE project_change_requests SET status='superseded',lifecycle_version=lifecycle_version+1,transition_actor_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lifecycle_version=? AND status=?`,
      )
      .bind(user.id, old.id, old.lifecycle_version, old.status),
    db.prepare("INSERT INTO cc08_cas_guard(value) VALUES(changes())"),
    db
      .prepare(
        "INSERT INTO project_change_request_lineage(previous_id,next_id,actor_id) VALUES(?,?,?)",
      )
      .bind(old.id, newId, user.id),
    db
      .prepare(
        `INSERT INTO ticket_change_links(ticket_id,organization_id,record_id,actor_id) SELECT ticket_id,organization_id,?,? FROM ticket_change_links WHERE record_id=? AND active=1 ON CONFLICT(ticket_id,record_id) DO NOTHING`,
      )
      .bind("cr:" + newId, user.id, "cr:" + old.id),
    db.prepare("DELETE FROM cc08_cas_guard"),
  ];
}
