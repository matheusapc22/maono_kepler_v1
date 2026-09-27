import { getDb, tableExists } from "./organizations.js";
import { can } from "./permissions.js";
import {
  requireTicketAccess,
  getTicketSelectiveAccessCapability,
} from "./ticket-access.js";
import {
  cc08Enabled,
  ensureChangeRequestLifecycleSchema,
} from "./project-change-request-lifecycle.js";
import { resolveChangeProjectContext } from "./change-project-context.js";
import { resolveEffectiveProjectMapRoute } from "./project-map-route-policy.js";
export const changeError = (code, status = 409) =>
  Object.assign(
    new Error(
      "Não foi possível processar a mudança. Atualize os dados e confira suas permissões.",
    ),
    { code, status },
  );
const text = (v, max, required = true) => {
  const s = String(v ?? "").trim();
  if (s.length > max || (required && !s))
    throw changeError("CHANGE_FIELD_INVALID", 400);
  return s;
};
export async function changesReady(env) {
  if (!cc08Enabled(env)) return false;
  if (!["local", "production"].includes(String(env.MAONO_RUNTIME_ENV)))
    throw changeError("CHANGE_RUNTIME_DENIED", 503);
  await ensureChangeRequestLifecycleSchema(env);
  for (const name of [
    "change_records",
    "ticket_change_links",
    "change_record_events",
    "project_change_request_apply_artifacts",
    "project_change_request_feedback",
    "project_change_request_lineage",
  ])
    if (!(await tableExists(env, name)))
      throw changeError("CHANGE_SCHEMA_OUTDATED", 503);
  const legacy = await getDb(env)
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('trg_change_request_lifecycle_sync','trg_ticket_change_request_status_guard') LIMIT 1",
    )
    .first();
  if (legacy) throw changeError("CHANGE_LEGACY_TRIGGER_CONFLICT", 503);
  if (!(await getTicketSelectiveAccessCapability(env)))
    throw changeError("CHANGE_SELECTIVE_ACCESS_REQUIRED", 503);
  return true;
}
export async function authorizeChangeTicket(
  env,
  org,
  ticket,
  user,
  write = false,
) {
  const membership = await getDb(env)
    .prepare(
      "SELECT 1 AS ok FROM organization_users WHERE organization_id=? AND user_id=?",
    )
    .bind(org, user.id)
    .first();
  if (!membership && user.role !== "super_admin")
    throw changeError("CHANGE_ORGANIZATION_DENIED", 403);
  const action = write ? "ticket.manage" : "ticket.view";
  if (
    !(
      await can(env, user, action, {
        organizationId: org,
        scopeType: "organization",
      })
    ).allowed
  )
    throw changeError("CHANGE_TICKET_DENIED", 403);
  await requireTicketAccess(env, org, ticket, user, action);
}
export async function authorizeChangeRecord(
  env,
  record,
  user,
  { review = false } = {},
) {
  if (record.domain !== "map_project") {
    if (user.role !== "super_admin")
      throw changeError("CHANGE_RECORD_DENIED", 404);
    return { canReview: true, canApply: false };
  }
  const cr = await getDb(env)
    .prepare(
      "SELECT r.*,p.slug FROM project_change_requests r JOIN projects p ON p.id=r.project_id AND p.organization_id=r.organization_id WHERE r.id=? AND r.organization_id=?",
    )
    .bind(record.change_request_id, record.organization_id)
    .first();
  if (!cr) throw changeError("CHANGE_RECORD_DENIED", 404);
  const scoped = await resolveChangeProjectContext(env, user, cr.slug);
  if (!scoped.project) throw changeError("CHANGE_RECORD_DENIED", 404);
  const scope = {
    organizationId: record.organization_id,
    project: scoped.project,
    projectId: cr.project_id,
    scopeType: "project",
  };
  const readable = (await can(env, scoped.user, "project.view", scope)).allowed;
  const reviewer =
    resolveEffectiveProjectMapRoute(scoped.user, scoped.project).mode ===
      "editor" &&
    (await can(env, scoped.user, "project.map.edit", scope)).allowed;
  if (
    !readable ||
    (!reviewer && Number(cr.requested_by_user_id) !== Number(user.id)) ||
    (review && !reviewer)
  )
    throw changeError("CHANGE_RECORD_DENIED", 404);
  return {
    cr,
    canReview: reviewer,
    canApply:
      reviewer && (await can(env, scoped.user, "project.save", scope)).allowed,
  };
}
async function hash(value) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function runCommand(env, org, user, input, key, build) {
  const db = getDb(env),
    id = await hash(`${org}:${user.id}:${text(key, 200)}`),
    requestHash = await hash(JSON.stringify(input));
  const replay = async () => {
    const row = await db
      .prepare("SELECT * FROM change_commands WHERE id=?")
      .bind(id)
      .first();
    if (!row) return null;
    if (row.request_hash !== requestHash)
      throw changeError("CHANGE_IDEMPOTENCY_CONFLICT");
    return JSON.parse(row.result_json);
  };
  const existing = await replay();
  if (existing) return { ...existing, replayed: true };
  const { sql, result } = await build(db, id);
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO change_commands(id,organization_id,actor_id,request_hash,result_json) VALUES(?,?,?,?,?)",
        )
        .bind(id, org, user.id, requestHash, JSON.stringify(result)),
      ...sql,
      db.prepare("INSERT INTO cc08_cas_guard(value) VALUES(changes())"),
      db.prepare("DELETE FROM cc08_cas_guard"),
    ]);
  } catch (error) {
    const prior = await replay();
    if (prior) return { ...prior, replayed: true };
    if (String(error.message).includes("CHECK constraint"))
      throw changeError("CHANGE_VERSION_CONFLICT");
    throw error;
  }
  return result;
}
export async function listTicketChanges(
  env,
  org,
  ticket,
  user,
  { after = "", limit = 20 } = {},
) {
  if (!(await changesReady(env))) return { enabled: false, items: [] };
  await authorizeChangeTicket(env, org, ticket, user);
  const db = getDb(env),
    items = [];
  // Bounded keyset scan. No unfiltered total is exposed.
  const rows =
    (
      await db
        .prepare(
          `SELECT r.*,l.active,l.version AS link_version,l.source_version,l.source_status,l.divergence,l.reconcile_attempts,l.reconcile_error
 FROM ticket_change_links l JOIN change_records r ON r.id=l.record_id AND r.organization_id=l.organization_id
 WHERE l.organization_id=? AND l.ticket_id=? AND r.id>? ORDER BY r.id LIMIT 101`,
        )
        .bind(org, ticket, String(after))
        .all()
    ).results || [];
  let cursor = null;
  for (const row of rows.slice(0, 100)) {
    cursor = row.id;
    let access;
    try {
      access = await authorizeChangeRecord(env, row, user);
    } catch (e) {
      if ([403, 404].includes(e.status)) continue;
      throw e;
    }
    const history =
      (
        await db
          .prepare(
            "SELECT version,status,feedback,evidence_url,created_at FROM change_record_events WHERE record_id=? ORDER BY version DESC LIMIT 20",
          )
          .bind(row.id)
          .all()
      ).results || [];
    const information = access.cr
      ? await db
          .prepare(
            "SELECT feedback,version FROM project_change_request_feedback WHERE change_request_id=? ORDER BY version DESC LIMIT 1",
          )
          .bind(access.cr.id)
          .first()
      : null;
    const crHistory = access.cr
      ? (
          await db
            .prepare(
              "SELECT version,from_status,to_status,created_at FROM project_change_request_events WHERE change_request_id=? ORDER BY version DESC LIMIT 20",
            )
            .bind(access.cr.id)
            .all()
        ).results
      : [];
    items.push({
      id: row.id,
      domain: row.domain,
      title: row.title,
      proposal: row.proposal,
      status: access.cr?.status || row.status,
      version: row.version,
      linkVersion: row.link_version,
      active: !!row.active,
      sourceVersion: row.source_version,
      divergence: row.divergence,
      reconcileAttempts: row.reconcile_attempts,
      reconcileError: row.reconcile_error,
      canRetryReconcile: user.role === "super_admin",
      informationRequested: information,
      resubmit:
        information &&
        Number(access.cr?.requested_by_user_id) === Number(user.id)
          ? { slug: access.cr.slug, id: access.cr.id }
          : null,
      appliedRevision: access.cr?.applied_revision ?? null,
      feedback: access.cr?.feedback || row.feedback,
      history,
      crHistory,
      reviewUrl:
        access.canReview && access.cr
          ? `/projects/${encodeURIComponent(access.cr.slug)}/review/${encodeURIComponent(access.cr.id)}`
          : null,
      canReview: access.canReview,
      canApply: access.canApply,
    });
    if (items.length >= Math.min(50, Math.max(1, limit))) break;
  }
  return {
    enabled: true,
    items,
    nextCursor: cursor && cursor !== rows.at(-1)?.id ? cursor : null,
  };
}
export async function executeChangeCommand(env, org, ticket, user, input, key) {
  if (!(await changesReady(env))) throw changeError("CHANGE_DISABLED", 404);
  await authorizeChangeTicket(env, org, ticket, user, true);
  const db = getDb(env),
    action = text(input.action, 40),
    recordId = String(input.recordId || "");
  let record = null,
    access = null;
  if (action !== "create") {
    record = await db
      .prepare("SELECT * FROM change_records WHERE id=? AND organization_id=?")
      .bind(recordId, org)
      .first();
    if (!record) throw changeError("CHANGE_RECORD_NOT_FOUND", 404);
    access = await authorizeChangeRecord(env, record, user);
  }
  if (action === "retry_reconcile") {
    if (user.role !== "super_admin")
      throw changeError("CHANGE_RETRY_DENIED", 403);
    return runCommand(
      env,
      org,
      user,
      { ...input, targetTicket: ticket },
      key,
      async (db) => ({
        result: { recordId, retry: true },
        sql: [
          db
            .prepare(
              "UPDATE ticket_change_links SET reconcile_attempts=0,reconcile_next_at=NULL,reconcile_error=NULL WHERE ticket_id=? AND record_id=? AND active=1",
            )
            .bind(ticket, recordId),
        ],
      }),
    );
  }
  if (action === "reconcile")
    return reconcileChangeLink(env, org, ticket, record, user);
  if (action === "create") {
    if (
      user.role !== "super_admin" ||
      !["platform", "database"].includes(input.domain)
    )
      throw changeError("CHANGE_RECORD_DENIED", 403);
    const title = text(input.title, 200),
      proposal = text(input.proposal, 10000);
    return runCommand(
      env,
      org,
      user,
      { ...input, targetTicket: ticket },
      key,
      async (db, id) => ({
        result: { recordId: `change:${id}`, version: 1 },
        sql: [
          db
            .prepare(
              `INSERT INTO change_records(id,organization_id,domain,title,proposal,status,created_by,actor_id) VALUES(?,?,?,?,?,'submitted',?,?)`,
            )
            .bind(
              `change:${id}`,
              org,
              input.domain,
              title,
              proposal,
              user.id,
              user.id,
            ),
          db
            .prepare(
              "INSERT INTO ticket_change_links(ticket_id,organization_id,record_id,actor_id) VALUES(?,?,?,?)",
            )
            .bind(ticket, org, `change:${id}`, user.id),
        ],
      }),
    );
  }
  if (action === "link" || action === "unlink") {
    const current = await db
      .prepare(
        "SELECT * FROM ticket_change_links WHERE ticket_id=? AND record_id=?",
      )
      .bind(ticket, recordId)
      .first();
    const expected = Number(input.linkVersion ?? 0),
      next = action === "link" ? 1 : 0;
    if (!Number.isSafeInteger(expected) || expected < 0)
      throw changeError("CHANGE_VERSION_REQUIRED", 400);
    return runCommand(
      env,
      org,
      user,
      { ...input, targetTicket: ticket },
      key,
      async (db) => ({
        result: { recordId, linkVersion: expected + 1 },
        sql: current
          ? [
              db
                .prepare(
                  "UPDATE ticket_change_links SET active=?,version=version+1,actor_id=?,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND record_id=? AND version=?",
                )
                .bind(next, user.id, ticket, recordId, expected),
            ]
          : [
              db
                .prepare(
                  "INSERT INTO ticket_change_links(ticket_id,organization_id,record_id,actor_id) SELECT ?,?,?,? WHERE ?=0 AND ?=1",
                )
                .bind(ticket, org, recordId, user.id, expected, next),
            ],
      }),
    );
  }
  if (record.domain === "map_project")
    throw changeError("CHANGE_USE_CANONICAL_CR_REVIEW", 409);
  if (!access.canReview) throw changeError("CHANGE_REVIEW_DENIED", 403);
  const states = {
    request_information: ["submitted", "planned"],
    resubmit: ["information_requested"],
    plan: ["submitted"],
    approve: ["submitted", "planned"],
    reject: ["submitted", "planned"],
    deliver: ["approved"],
  };
  const to = {
    request_information: "information_requested",
    resubmit: "submitted",
    plan: "planned",
    approve: "approved",
    reject: "rejected",
    deliver: "delivered",
  };
  if (!states[action]?.includes(record.status))
    throw changeError("CHANGE_STATE_CONFLICT");
  const feedback = text(input.feedback, 2000),
    proposal =
      action === "resubmit" ? text(input.proposal, 10000) : record.proposal;
  let evidence = record.evidence_url;
  if (action === "deliver") {
    evidence = text(input.evidenceUrl, 2000);
    let url;
    try {
      url = new URL(evidence);
    } catch {
      throw changeError("CHANGE_EVIDENCE_INVALID", 400);
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw changeError("CHANGE_EVIDENCE_INVALID", 400);
  }
  const version = Number(input.version);
  if (!Number.isSafeInteger(version))
    throw changeError("CHANGE_VERSION_REQUIRED", 400);
  return runCommand(
    env,
    org,
    user,
    { ...input, targetTicket: ticket },
    key,
    async (db) => ({
      result: { recordId, version: version + 1, status: to[action] },
      sql: [
        db
          .prepare(
            `UPDATE change_records SET status=?,proposal=?,feedback=?,evidence_url=?,actor_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND version=? AND status=?`,
          )
          .bind(
            to[action],
            proposal,
            feedback,
            evidence ?? null,
            user.id,
            recordId,
            org,
            version,
            record.status,
          ),
      ],
    }),
  );
}
export async function reconcileChangeLink(env, org, ticket, record, user) {
  const db = getDb(env),
    link = await db
      .prepare(
        "SELECT * FROM ticket_change_links WHERE ticket_id=? AND record_id=? AND organization_id=? AND active=1",
      )
      .bind(ticket, record.id, org)
      .first();
  if (!link) throw changeError("CHANGE_LINK_NOT_FOUND", 404);
  const source =
    record.domain === "map_project"
      ? await db
          .prepare(
            "SELECT lifecycle_version AS version,status FROM project_change_requests WHERE id=? AND organization_id=?",
          )
          .bind(record.change_request_id, org)
          .first()
      : record;
  if (!source) throw changeError("CHANGE_SOURCE_MISSING", 409);
  if (
    source.version < link.source_version ||
    (source.version === link.source_version &&
      link.source_status !== null &&
      source.status !== link.source_status)
  ) {
    await db
      .prepare(
        "UPDATE ticket_change_links SET divergence=? WHERE ticket_id=? AND record_id=?",
      )
      .bind("SOURCE_VERSION_DIVERGENCE", ticket, record.id)
      .run();
    throw changeError("CHANGE_SOURCE_DIVERGENCE");
  }
  if (
    source.version === link.source_version &&
    source.status === link.source_status
  )
    return { reconciled: true, idempotent: true };
  const stamp = new Date().toISOString(),
    id = `cc08:${ticket}:${record.id}:${source.version}`;
  // Durable event and notification intent share the CAS transaction. Generic message
  // contains no CR title/body/decision; CR content is authorized separately on open.
  await db.batch([
    db
      .prepare(
        "UPDATE ticket_change_links SET source_version=?,source_status=?,divergence=NULL,reconcile_attempts=0,reconcile_next_at=NULL,reconcile_error=NULL,updated_at=? WHERE ticket_id=? AND record_id=? AND source_version=? AND active=1",
      )
      .bind(
        source.version,
        source.status,
        stamp,
        ticket,
        record.id,
        link.source_version,
      ),
    db.prepare("INSERT INTO cc08_cas_guard(value) VALUES(changes())"),
    db
      .prepare(
        `INSERT INTO ticket_commands(id,organization_id,actor_user_id,operation,idempotency_key,request_hash,result_json,response_status,created_at) VALUES(?,?,?,'ticket.change.updated',?,?,?,200,?)`,
      )
      .bind(id, org, user.id, id, id, "{}", stamp),
    db
      .prepare(
        `INSERT INTO ticket_events(organization_id,ticket_id,event_type,actor_user_id,metadata,command_id,created_at) VALUES(?,?,'ticket.change.updated',?,'{}',?,?)`,
      )
      .bind(org, ticket, user.id, id, stamp),
    db
      .prepare(
        `INSERT INTO ticket_command_outbox(id,command_id,organization_id,ticket_id,event_id,event_type,payload,created_at) SELECT ?,?,?,?,id,'ticket.change.updated','{}',? FROM ticket_events WHERE command_id=?`,
      )
      .bind(id, id, org, ticket, stamp, id),
    db.prepare("DELETE FROM cc08_cas_guard"),
  ]);
  return { reconciled: true, sourceVersion: source.version };
}

export async function consumeChangeReconciliations(env, { limit = 10 } = {}) {
  if (String(env.MAONO_CHANGE_RECONCILIATION_ENABLED) !== "true")
    return { enabled: false, processed: 0 };
  if (!(await changesReady(env))) throw changeError("CHANGE_DISABLED", 503);
  const orgs = String(env.MAONO_CHANGE_RECONCILIATION_ORGANIZATION_IDS || "")
      .split(",")
      .map(Number),
    actorId = Number(env.MAONO_CHANGE_RECONCILIATION_ACTOR_ID);
  if (
    !orgs.length ||
    orgs.length > 20 ||
    orgs.some((x) => !Number.isSafeInteger(x) || x < 1) ||
    !Number.isSafeInteger(actorId) ||
    actorId < 1
  )
    throw changeError("CHANGE_RECONCILIATION_SCOPE_REQUIRED", 503);
  const db = getDb(env),
    actor = await db
      .prepare(
        "SELECT id,role FROM users WHERE id=? AND active=1 AND role='super_admin'",
      )
      .bind(actorId)
      .first();
  if (!actor) throw changeError("CHANGE_RECONCILIATION_ACTOR_REQUIRED", 503);
  const stamp = new Date().toISOString();
  const rows =
    (
      await db
        .prepare(
          `SELECT c.*,l.ticket_id,l.source_version,l.reconcile_attempts FROM ticket_change_links l
 JOIN change_records c ON c.id=l.record_id AND c.organization_id=l.organization_id LEFT JOIN project_change_requests r ON r.id=c.change_request_id
 WHERE l.active=1 AND l.organization_id IN(${orgs.map(() => "?").join(",")}) AND l.reconcile_attempts<5
 AND (l.reconcile_next_at IS NULL OR l.reconcile_next_at<=?)
 AND (l.source_version<>CASE WHEN c.domain='map_project' THEN r.lifecycle_version ELSE c.version END OR l.source_status IS NULL)
 ORDER BY l.updated_at,l.ticket_id,l.record_id LIMIT ?`,
        )
        .bind(...orgs, stamp, Math.max(1, Math.min(25, Number(limit) || 10)))
        .all()
    ).results || [];
  let processed = 0,
    failed = 0;
  for (const record of rows) {
    const user = { ...actor, activeOrganizationId: record.organization_id };
    try {
      await authorizeChangeTicket(
        env,
        record.organization_id,
        record.ticket_id,
        user,
        true,
      );
      await authorizeChangeRecord(env, record, user);
      await reconcileChangeLink(
        env,
        record.organization_id,
        record.ticket_id,
        record,
        user,
      );
      processed++;
    } catch (error) {
      failed++;
      const attempts = Number(record.reconcile_attempts) + 1;
      const next = new Date(
        Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000,
      ).toISOString();
      await db
        .prepare(
          "UPDATE ticket_change_links SET reconcile_attempts=reconcile_attempts+1,reconcile_next_at=?,reconcile_error=? WHERE ticket_id=? AND record_id=? AND source_version=?",
        )
        .bind(
          next,
          String(error.code || "RECONCILIATION_FAILED").slice(0, 120),
          record.ticket_id,
          record.id,
          record.source_version,
        )
        .run();
    }
  }
  return { enabled: true, processed, failed };
}
