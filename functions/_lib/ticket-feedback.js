import { getDb } from "./organizations.js";
import { caseActor } from "./ticket-cases.js";
import {
  requireTicketAccess,
  assertTicketSelectiveAccessReady,
  buildTicketAccessPredicate,
} from "./ticket-access.js";
import { sha256 } from "./ticket-export-domain.js";
import {
  feedbackError as error,
  instrumentDefinition,
  responseValue,
} from "./ticket-feedback-domain.js";
export const feedbackEnabled = (env, org) =>
  String(env.MAONO_TICKET_FEEDBACK_ENABLED) === "true" &&
  String(env.MAONO_TICKET_FEEDBACK_ORGANIZATION_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .includes(String(org));
const rows = (r) => r?.results || [];
const stamp = () => new Date().toISOString();
const epoch = async (db) =>
  (
    await db
      .prepare("SELECT version FROM ticket_export_generation WHERE id=1")
      .first()
  ).version;
const key = (v) => {
  if (typeof v !== "string" || !/^[-\w]{16,100}$/.test(v))
    throw error("INVALID_KEY");
  return v;
};
export async function feedbackReady(env, org) {
  if (!feedbackEnabled(env, org)) throw error("DISABLED", 503);
  if (
    !["local", "production"].includes(env.MAONO_RUNTIME_ENV) ||
    String(env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED) !== "true"
  )
    throw error("RUNTIME_DENIED", 503);
  await assertTicketSelectiveAccessReady(env);
  const names = rows(
    await getDb(env)
      .prepare(
        "SELECT name FROM sqlite_master WHERE name LIKE 'ticket_feedback_%'",
      )
      .all(),
  ).map((x) => x.name);
  const required = [
    "instruments",
    "invites",
    "responses",
    "events",
    "withdrawals",
    "withdrawals_scope",
    "guard",
    "guard_clean",
    "response_scope",
  ];
  for (const t of [
    "instruments",
    "invites",
    "responses",
    "events",
    "withdrawals",
  ])
    required.push(t + "_update", t + "_delete", t + "_epoch");
  if (required.some((x) => !names.includes("ticket_feedback_" + x)))
    throw error("SCHEMA_REQUIRED", 503);
}
// Capture before authorization. Epoch protects membership, roles, tickets and ACL;
// optional legacy grant tables are snapshotted separately, including expiry.
export async function feedbackFence(db, ids) {
  const version = await epoch(db),
    statements = [
      db
        .prepare(
          "INSERT INTO ticket_feedback_guard VALUES((SELECT version FROM ticket_export_generation WHERE id=1)=?)",
        )
        .bind(version),
    ],
    checks = [];
  const names = rows(
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('role_permissions','user_permissions') AND type='table'",
      )
      .all(),
  ).map((x) => x.name);
  const marks = ids.map(() => "?").join(",");
  for (const t of names) {
    const query =
      t === "role_permissions"
        ? `SELECT coalesce(json_group_array(json_array(role,permission,scope_type,active)),'[]') value FROM (SELECT * FROM role_permissions WHERE role IN (SELECT role FROM users WHERE id IN (${marks})) ORDER BY role,permission,scope_type,active)`
        : `SELECT coalesce(json_group_array(json_array(user_id,permission,organization_id,project_id,expires_at,active,CASE WHEN expires_at IS NULL OR julianday(expires_at)>julianday('now') THEN 1 ELSE 0 END)),'[]') value FROM (SELECT * FROM user_permissions WHERE user_id IN (${marks}) ORDER BY user_id,permission,organization_id,project_id,expires_at,active)`;
    const value = (
      await db
        .prepare(query)
        .bind(...ids)
        .first()
    ).value;
    statements.push(
      db
        .prepare(`INSERT INTO ticket_feedback_guard VALUES((${query})=?)`)
        .bind(...ids, value),
    );
    checks.push(
      async () =>
        (
          await db
            .prepare(query)
            .bind(...ids)
            .first()
        ).value === value,
    );
  }
  return {
    statements,
    async verify() {
      if ((await epoch(db)) !== version) throw error("SOURCE_CHANGED", 409);
      for (const check of checks)
        if (!(await check())) throw error("SOURCE_CHANGED", 409);
    },
  };
}
async function transaction(db, fence, writes) {
  try {
    await db.batch([...fence.statements, ...writes]);
  } catch (e) {
    if (/CONSTRAINT|UNIQUE|FEEDBACK_|CHECK/.test(String(e)))
      throw error("CONFLICT", 409);
    throw e;
  }
}
async function recipient(env, org, ticketId, id) {
  const u = await caseActor(env, org, { id });
  await requireTicketAccess(env, org, ticketId, u, "ticket.view");
  return u;
}
export async function publishFeedbackInstrument(env, org, actor, body) {
  await feedbackReady(env, org);
  const db = getDb(env),
    fence = await feedbackFence(db, [actor.id]);
  await caseActor(env, org, actor, true);
  const def = instrumentDefinition(body.definition),
    requestKey = key(body.requestKey);
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 0)
    throw error("INVALID_VERSION");
  const version = body.expectedVersion + 1,
    definition = JSON.stringify(def);
  const replay = async () => {
    const r = await db
      .prepare(
        "SELECT * FROM ticket_feedback_instruments WHERE organization_id=? AND request_key=?",
      )
      .bind(org, requestKey)
      .first();
    if (!r) return null;
    if (
      r.actor_id !== actor.id ||
      r.definition_json !== definition ||
      r.version !== version
    )
      throw error("CONFLICT", 409);
    return { version: r.version, replayed: true };
  };
  const prior = await replay();
  if (prior) {
    const fresh = await feedbackFence(db, [actor.id]);
    await caseActor(env, org, actor, true);
    await fresh.verify();
    return prior;
  }
  const writes = [
    db
      .prepare(
        "INSERT INTO ticket_feedback_guard VALUES(coalesce((SELECT max(version) FROM ticket_feedback_instruments WHERE organization_id=?),0)=?)",
      )
      .bind(org, body.expectedVersion),
    db
      .prepare("INSERT INTO ticket_feedback_instruments VALUES(?,?,?,?,?,?)")
      .bind(org, version, definition, stamp(), actor.id, requestKey),
  ];
  try {
    await transaction(db, fence, writes);
  } catch (e) {
    const p = await replay();
    if (p) {
      const fresh = await feedbackFence(db, [actor.id]);
      await caseActor(env, org, actor, true);
      await fresh.verify();
      return p;
    }
    throw e;
  }
  return { version, replayed: false };
}
export async function feedbackInstrument(env, org, actor) {
  if (!feedbackEnabled(env, org)) return { enabled: false };
  await feedbackReady(env, org);
  const db = getDb(env),
    f = await feedbackFence(db, [actor.id]);
  await caseActor(env, org, actor, true);
  const r = await db
    .prepare(
      "SELECT * FROM ticket_feedback_instruments WHERE organization_id=? ORDER BY version DESC LIMIT 1",
    )
    .bind(org)
    .first();
  await f.verify();
  return {
    enabled: true,
    version: r?.version || 0,
    definition: r ? JSON.parse(r.definition_json) : null,
  };
}
// Explicit POST reconciler; never called by GET or by the closing transaction.
// A row cursor makes bounded scans resumable. Historical cycles before publication
// and unknown legacy baselines are deliberately ineligible.
export async function reconcileFeedback(env, org, actor, { after = 0 } = {}) {
  await feedbackReady(env, org);
  const db = getDb(env),
    operator = await caseActor(env, org, actor, true),
    acl = await buildTicketAccessPredicate(env, org, operator);
  if (!Number.isSafeInteger(after) || after < 0) throw error("INVALID_CURSOR");
  const cycles = rows(
    await db
      .prepare(
        `SELECT c.rowid cursor,c.*,t.created_by recipient_id FROM ticket_cycles c
 JOIN organization_tickets t ON t.id=c.ticket_id AND t.organization_id=c.organization_id
 WHERE c.organization_id=? AND c.rowid>? AND c.closed_at IS NOT NULL AND c.origin<>'observed_baseline' AND t.active=1 AND (${acl.sql})
 AND EXISTS(SELECT 1 FROM ticket_feedback_instruments d WHERE d.organization_id=c.organization_id AND julianday(d.created_at)<=julianday(c.closed_at))
 ORDER BY c.rowid LIMIT 26`,
      )
      .bind(org, after, ...acl.values)
      .all(),
  );
  let issued = 0,
    existing = 0,
    excluded = 0;
  for (const c of cycles.slice(0, 25)) {
    const f = await feedbackFence(db, [actor.id, c.recipient_id]),
      currentOperator = await caseActor(env, org, actor, true);
    try {
      await requireTicketAccess(
        env,
        org,
        c.ticket_id,
        currentOperator,
        "ticket.view",
      );
      await recipient(env, org, c.ticket_id, c.recipient_id);
    } catch (e) {
      if ([403, 404].includes(e.status)) {
        excluded++;
        continue;
      }
      throw e;
    }
    const prior = await db
      .prepare(
        "SELECT id FROM ticket_feedback_invites WHERE organization_id=? AND ticket_id=? AND cycle_number=? AND recipient_id=?",
      )
      .bind(org, c.ticket_id, c.cycle_number, c.recipient_id)
      .first();
    if (prior) {
      existing++;
      continue;
    }
    const d = await db
      .prepare(
        "SELECT * FROM ticket_feedback_instruments WHERE organization_id=? AND julianday(created_at)<=julianday(?) ORDER BY version DESC LIMIT 1",
      )
      .bind(org, c.closed_at)
      .first();
    if (!d) {
      excluded++;
      continue;
    }
    const def = JSON.parse(d.definition_json),
      id = crypto.randomUUID(),
      command = "feedback:" + id,
      at = stamp(),
      until = new Date(
        Date.parse(at) + def.windowHours * 3600000,
      ).toISOString();
    const writes = [
      db
        .prepare(
          `INSERT INTO ticket_feedback_guard VALUES(EXISTS(SELECT 1 FROM ticket_cycles c JOIN organization_tickets t ON t.id=c.ticket_id AND t.organization_id=c.organization_id WHERE c.organization_id=? AND c.ticket_id=? AND c.cycle_number=? AND c.closed_at=? AND c.origin<>'observed_baseline' AND t.created_by=? AND t.active=1))`,
        )
        .bind(org, c.ticket_id, c.cycle_number, c.closed_at, c.recipient_id),
      db
        .prepare(
          "INSERT INTO ticket_feedback_invites VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          org,
          c.ticket_id,
          c.cycle_number,
          c.recipient_id,
          d.version,
          at,
          until,
          c.closed_at,
        ),
      db
        .prepare(
          "INSERT INTO ticket_feedback_events(invite_id,event_type,actor_id,created_at) VALUES(?,'issued',?,?)",
        )
        .bind(id, actor.id, at),
      db
        .prepare(
          "INSERT INTO ticket_commands(id,organization_id,actor_user_id,operation,idempotency_key,request_hash,result_json,response_status,created_at) VALUES(?,?,?,'ticket.feedback.invited',?,?,?,200,?)",
        )
        .bind(
          command,
          org,
          actor.id,
          id,
          id,
          JSON.stringify({ inviteId: id }),
          at,
        ),
      db
        .prepare(
          "INSERT INTO ticket_events(organization_id,ticket_id,event_type,actor_user_id,metadata,created_at,command_id,audience) VALUES(?,?,'ticket.feedback.invited',?,?,?,?,'ticket')",
        )
        .bind(
          org,
          c.ticket_id,
          actor.id,
          JSON.stringify({ inviteId: id, cycleNumber: c.cycle_number }),
          at,
          command,
        ),
      db
        .prepare(
          "INSERT INTO ticket_command_outbox(id,command_id,organization_id,ticket_id,event_id,event_type,payload,created_at) SELECT ?,?,?,?,id,'ticket.feedback.invited','{}',? FROM ticket_events WHERE command_id=?",
        )
        .bind(command, command, org, c.ticket_id, at, command),
      db
        .prepare(
          "INSERT INTO ticket_notification_candidates(outbox_id,recipient_id) VALUES(?,?)",
        )
        .bind(command, c.recipient_id),
    ];
    try {
      await transaction(db, f, writes);
      issued++;
    } catch (e) {
      const winner = await db
        .prepare(
          "SELECT id FROM ticket_feedback_invites WHERE organization_id=? AND ticket_id=? AND cycle_number=? AND recipient_id=?",
        )
        .bind(org, c.ticket_id, c.cycle_number, c.recipient_id)
        .first();
      if (!winner) throw e;
      existing++;
    }
  }
  return {
    issued,
    existing,
    excluded,
    scanned: Math.min(25, cycles.length),
    nextCursor: cycles.length > 25 ? cycles[24].cursor : null,
  };
}
async function invite(env, org, actor, id) {
  const db = getDb(env),
    row = await db
      .prepare(
        "SELECT i.*,d.definition_json FROM ticket_feedback_invites i JOIN ticket_feedback_instruments d ON d.organization_id=i.organization_id AND d.version=i.instrument_version WHERE i.organization_id=? AND i.id=? AND i.recipient_id=?",
      )
      .bind(org, id, actor.id)
      .first();
  if (!row) throw error("NOT_FOUND", 404);
  await recipient(env, org, row.ticket_id, actor.id);
  return row;
}
export async function listFeedback(env, org, actor, { after = "" } = {}) {
  if (!feedbackEnabled(env, org))
    return { enabled: false, items: [], nextCursor: null };
  await feedbackReady(env, org);
  const db = getDb(env),
    f = await feedbackFence(db, [actor.id]),
    u = await caseActor(env, org, actor);
  if (typeof after !== "string" || after.length > 100)
    throw error("INVALID_CURSOR");
  const acl = await buildTicketAccessPredicate(env, org, u),
    at = stamp();
  const result = rows(
    await db
      .prepare(
        `SELECT i.*,d.definition_json,r.receipt,r.declined,w.created_at withdrawn_at FROM ticket_feedback_invites i
 JOIN organization_tickets t ON t.id=i.ticket_id AND t.organization_id=i.organization_id
 JOIN ticket_feedback_instruments d ON d.organization_id=i.organization_id AND d.version=i.instrument_version
 LEFT JOIN ticket_feedback_responses r ON r.invite_id=i.id
 LEFT JOIN ticket_feedback_withdrawals w ON w.invite_id=i.id
 WHERE i.organization_id=? AND i.recipient_id=? AND i.id>? AND t.active=1 AND (${acl.sql}) ORDER BY i.id LIMIT 26`,
      )
      .bind(org, actor.id, after, ...acl.values)
      .all(),
  );
  await f.verify();
  return {
    enabled: true,
    items: result
      .slice(0, 25)
      .map((r) => ({
        id: r.id,
        ticketId: r.ticket_id,
        cycle: r.cycle_number,
        version: r.instrument_version,
        issuedAt: r.issued_at,
        until: r.eligible_until,
        definition: JSON.parse(r.definition_json),
        receipt: r.receipt || null,
        state: r.withdrawn_at
          ? "withdrawn"
          : r.receipt
            ? r.declined
              ? "declined"
              : "responded"
            : r.eligible_until <= at
              ? "expired"
              : "open",
      })),
    nextCursor: result.length > 25 ? result[24].id : null,
  };
}
export async function respondFeedback(env, org, actor, id, body) {
  await feedbackReady(env, org);
  const db = getDb(env),
    f = await feedbackFence(db, [actor.id]),
    i = await invite(env, org, actor, id),
    value = responseValue(body, JSON.parse(i.definition_json)),
    hash = await sha256(value);
  const replay = async () => {
    const p = await db
      .prepare(
        "SELECT request_hash,receipt FROM ticket_feedback_responses WHERE invite_id=?",
      )
      .bind(i.id)
      .first();
    if (!p) return null;
    if (p.request_hash !== hash) throw error("ALREADY_RESPONDED", 409);
    return { receipt: p.receipt, replayed: true };
  };
  const prior = await replay();
  if (prior) {
    const fresh = await feedbackFence(db, [actor.id]);
    await invite(env, org, actor, id);
    await fresh.verify();
    return prior;
  }
  const at = stamp(),
    receipt = crypto.randomUUID();
  if (at >= i.eligible_until || at < i.issued_at) throw error("EXPIRED", 409);
  const writes = [
    db
      .prepare(
        "INSERT INTO ticket_feedback_guard VALUES(julianday('now')<julianday(?))",
      )
      .bind(i.eligible_until),
    db
      .prepare(
        "INSERT INTO ticket_feedback_responses VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        i.id,
        actor.id,
        value.outcome,
        value.effort,
        value.comment,
        value.consent,
        value.declined,
        at,
        hash,
        receipt,
      ),
    db
      .prepare(
        "INSERT INTO ticket_feedback_events(invite_id,event_type,actor_id,created_at) VALUES(?,?,?,?)",
      )
      .bind(i.id, value.declined ? "declined" : "responded", actor.id, at),
  ];
  try {
    await transaction(db, f, writes);
  } catch (e) {
    const fresh = await feedbackFence(db, [actor.id]);
    await invite(env, org, actor, id);
    const p = await replay();
    await fresh.verify();
    if (p) return p;
    throw e;
  }
  return { receipt, replayed: false };
}
export async function feedbackDeliveryAllowed(env, event, userId) {
  if (!feedbackEnabled(env, event.organization_id)) return false;
  await feedbackReady(env, event.organization_id);
  const i = await getDb(env)
    .prepare(
      `SELECT i.* FROM ticket_feedback_invites i JOIN ticket_commands c ON c.id='feedback:'||i.id JOIN ticket_events e ON e.command_id=c.id WHERE e.id=? AND i.organization_id=? AND i.ticket_id=? AND i.recipient_id=?`,
    )
    .bind(event.event_id, event.organization_id, event.ticket_id, userId)
    .first();
  return !!i && i.eligible_until > stamp();
}
// Authorized, bounded source for CC11 projections. Comments/identities never enter
// aggregate facts, rollups, checkpoints or CC12 exports.
export async function feedbackMetricSource(env, org, actor) {
  if (!feedbackEnabled(env, org)) return null;
  await feedbackReady(env, org);
  const db = getDb(env),
    f = await feedbackFence(db, [actor.id]);
  let u;
  try {
    u = await caseActor(env, org, actor, true);
  } catch (e) {
    if ([403, 404].includes(e.status)) return null;
    throw e;
  }
  const acl = await buildTicketAccessPredicate(env, org, u);
  const result = rows(
    await db
      .prepare(
        `SELECT i.ticket_id,i.cycle_number,i.instrument_version,i.issued_at,i.eligible_until,i.closed_at,d.definition_json,CASE WHEN w.invite_id IS NULL THEN r.outcome END outcome,CASE WHEN w.invite_id IS NULL THEN r.effort END effort,r.declined,r.created_at responded_at,w.created_at withdrawn_at,o.status delivery_status,n.state candidate_state
 FROM ticket_feedback_invites i JOIN organization_tickets t ON t.id=i.ticket_id AND t.organization_id=i.organization_id
 JOIN ticket_feedback_instruments d ON d.organization_id=i.organization_id AND d.version=i.instrument_version
 LEFT JOIN ticket_feedback_responses r ON r.invite_id=i.id LEFT JOIN ticket_feedback_withdrawals w ON w.invite_id=i.id LEFT JOIN ticket_command_outbox o ON o.id='feedback:'||i.id LEFT JOIN ticket_notification_candidates n ON n.outbox_id=o.id AND n.recipient_id=i.recipient_id
 WHERE i.organization_id=? AND t.active=1 AND (${acl.sql}) ORDER BY i.ticket_id,i.cycle_number LIMIT 2001`,
      )
      .bind(org, ...acl.values)
      .all(),
  );
  if (result.length > 2000) throw error("METRICS_LIMIT", 503);
  await f.verify();
  return { rows: result, verify: () => f.verify() };
}

// Withdrawal is a separate immutable event. It removes the answer from current
// aggregate processing (including historical queries), without silently rewriting it.
export async function withdrawFeedback(env, org, actor, id) {
  await feedbackReady(env, org);
  const db = getDb(env),
    f = await feedbackFence(db, [actor.id]);
  await invite(env, org, actor, id);
  const prior = await db
    .prepare(
      "SELECT receipt FROM ticket_feedback_withdrawals WHERE invite_id=?",
    )
    .bind(id)
    .first();
  if (prior) {
    const fresh = await feedbackFence(db, [actor.id]);
    await invite(env, org, actor, id);
    await fresh.verify();
    return { ...prior, replayed: true };
  }
  const response = await db
    .prepare("SELECT declined FROM ticket_feedback_responses WHERE invite_id=?")
    .bind(id)
    .first();
  if (!response || response.declined) throw error("NOT_RESPONDED", 409);
  const at = stamp(),
    receipt = crypto.randomUUID();
  try {
    await transaction(db, f, [
      db
        .prepare("INSERT INTO ticket_feedback_withdrawals VALUES(?,?,?,?)")
        .bind(id, actor.id, at, receipt),
      db
        .prepare(
          "INSERT INTO ticket_feedback_events(invite_id,event_type,actor_id,created_at) VALUES(?,'withdrawn',?,?)",
        )
        .bind(id, actor.id, at),
    ]);
  } catch (e) {
    const fresh = await feedbackFence(db, [actor.id]);
    await invite(env, org, actor, id);
    const winner = await db
      .prepare(
        "SELECT receipt FROM ticket_feedback_withdrawals WHERE invite_id=?",
      )
      .bind(id)
      .first();
    await fresh.verify();
    if (winner) return { ...winner, replayed: true };
    throw e;
  }
  return { receipt, replayed: false };
}
