import { getDb } from "./organizations.js";
import { can } from "./permissions.js";
import {
  requireTicketAccess,
  assertTicketSelectiveAccessReady,
} from "./ticket-access.js";
import { authorizeChangeRecord } from "./ticket-changes.js";
import {
  createTicketMessage,
  resolveTicketConversationContext,
} from "./ticket-conversations.js";
import { sha256 } from "./ticket-export-domain.js";

export const CASE_SOURCES = [
  "ticket_cases",
  "ticket_case_members",
  "ticket_case_links",
  "ticket_case_events",
];
export const caseError = (code, status = 400) =>
  Object.assign(
    new Error(
      "Não foi possível concluir a operação. Atualize os dados e confira o acesso.",
    ),
    { code: "TICKET_CASE_" + code, status },
  );
export const casesEnabled = (env, org) =>
  String(env.MAONO_TICKET_CASES_ENABLED) === "true" &&
  String(env.MAONO_TICKET_CASE_ORGANIZATION_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .includes(String(org));
const rows = (r) => r?.results || [];
const scope = (organizationId) => ({
  organizationId,
  scopeType: "organization",
  resourceType: "ticket",
});
const now = () => new Date().toISOString();
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const text = (v, max, required = false) => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw caseError("INVALID_FIELD");
  return v.trim();
};
const id = (v) => {
  if (typeof v !== "string" || !/^[\w:-]{1,150}$/.test(v))
    throw caseError("INVALID_ID");
  return v;
};
const integer = (v) => {
  if (!Number.isSafeInteger(v) || v < 1) throw caseError("INVALID_ID");
  return v;
};
const keys = (v, allowed) => {
  if (!object(v) || Object.keys(v).some((k) => !allowed.includes(k)))
    throw caseError("INVALID_FIELD");
};
export async function casesReady(env, org) {
  if (!casesEnabled(env, org)) throw caseError("DISABLED", 503);
  if (!["local", "production"].includes(env.MAONO_RUNTIME_ENV))
    throw caseError("RUNTIME_DENIED", 503);
  if (String(env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED) !== "true")
    throw caseError("ACCESS_REQUIRED", 503);
  await assertTicketSelectiveAccessReady(env);
  const names = rows(
    await getDb(env)
      .prepare(
        "SELECT name FROM sqlite_master WHERE name LIKE 'ticket_case_%' OR name LIKE 'ticket_export_epoch_ticket_case%'",
      )
      .all(),
  ).map((r) => r.name);
  const required = [
    ...CASE_SOURCES,
    "ticket_case_commands",
    "ticket_case_guard",
    "ticket_case_events_immutable",
    "ticket_case_events_no_delete",
    "ticket_case_link_tenant_insert",
    "ticket_case_link_tenant_update",
    ...CASE_SOURCES.flatMap((t) =>
      (t === "ticket_case_events"
        ? ["insert", "delete"]
        : ["insert", "update", "delete"]
      ).map((a) => `ticket_export_epoch_${t}_${a}`),
    ),
  ];
  if (required.some((n) => !names.includes(n)))
    throw caseError("SCHEMA_REQUIRED", 503);
}
export async function caseActor(env, org, actor, write = false) {
  const user = await getDb(env)
    .prepare(
      `SELECT u.id,u.role FROM users u JOIN organization_users ou ON ou.user_id=u.id JOIN organizations o ON o.id=ou.organization_id WHERE u.id=? AND u.active=1 AND o.id=? AND o.active=1`,
    )
    .bind(actor.id, org)
    .first();
  if (!user) throw caseError("NOT_FOUND", 404);
  user.activeOrganizationId = org;
  for (const permission of ["ticket.view", ...(write ? ["ticket.manage"] : [])])
    if (!(await can(env, user, permission, scope(org))).allowed)
      throw caseError("NOT_FOUND", 404);
  return user;
}
export const casePredicate = (user, alias = "c") => ({
  sql: `(${alias}.visibility='organization' OR ${alias}.created_by=? OR ${alias}.coordinator_id=? OR EXISTS(SELECT 1 FROM ticket_case_members m WHERE m.organization_id=${alias}.organization_id AND m.case_id=${alias}.id AND m.user_id=?))`,
  values: [user.id, user.id, user.id],
});
async function record(env, org, user, caseId) {
  const acl = casePredicate(user);
  const row = await getDb(env)
    .prepare(
      `SELECT c.* FROM ticket_cases c WHERE c.organization_id=? AND c.id=? AND ${acl.sql}`,
    )
    .bind(org, id(caseId), ...acl.values)
    .first();
  if (!row) throw caseError("NOT_FOUND", 404);
  return row;
}
const publicRecord = (r) => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  state: r.state,
  visibility: r.visibility,
  coordinatorId: r.coordinator_id,
  createdBy: r.created_by,
  version: r.version,
  data: JSON.parse(r.data_json),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
async function epoch(db) {
  return (
    await db
      .prepare("SELECT version FROM ticket_export_generation WHERE id=1")
      .first()
  ).version;
}
async function stable(db, g) {
  if (g !== (await epoch(db))) throw caseError("SOURCE_CHANGED", 409);
}
async function targetAllowed(env, org, user, target) {
  if (target.type === "ticket") {
    await requireTicketAccess(
      env,
      org,
      integer(target.id),
      user,
      "ticket.view",
    );
    return;
  }
  if (target.type === "case") {
    await record(env, org, user, target.id);
    return;
  }
  if (target.type === "change") {
    const r = await getDb(env)
      .prepare("SELECT * FROM change_records WHERE organization_id=? AND id=?")
      .bind(org, id(target.id))
      .first();
    if (!r) throw caseError("NOT_FOUND", 404);
    await authorizeChangeRecord(env, r, user);
    return;
  }
  throw caseError("INVALID_TARGET");
}
const targetOf = (l) =>
  l.ticket_id != null
    ? { type: "ticket", id: l.ticket_id }
    : l.target_case_id
      ? { type: "case", id: l.target_case_id }
      : { type: "change", id: l.change_id };
async function visibleTarget(env, org, user, target) {
  try {
    await targetAllowed(env, org, user, target);
    return true;
  } catch (e) {
    if ([403, 404].includes(e.status)) return false;
    throw e;
  }
}
export async function listCases(
  env,
  org,
  actor,
  { kind = "", query = "", after = "" } = {},
) {
  if (!casesEnabled(env, org))
    return { enabled: false, items: [], nextCursor: null };
  await casesReady(env, org);
  const db = getDb(env),
    g = await epoch(db),
    user = await caseActor(env, org, actor),
    acl = casePredicate(user);
  if (kind && !["incident", "problem"].includes(kind))
    throw caseError("INVALID_KIND");
  text(query, 100);
  if (after) await record(env, org, user, after);
  const result = rows(
    await db
      .prepare(
        `SELECT c.* FROM ticket_cases c WHERE c.organization_id=? AND ${acl.sql} AND (?='' OR c.kind=?) AND instr(lower(c.title),lower(?))>0 AND c.id>? ORDER BY c.id LIMIT 21`,
      )
      .bind(org, ...acl.values, kind, kind, query, after)
      .all(),
  );
  const items = await Promise.all(
    result.slice(0, 20).map(async (r) => ({
      ...publicRecord(r),
      version: await versionToken(r),
    })),
  );
  await stable(db, g);
  return {
    enabled: true,
    items,
    nextCursor: result.length > 20 ? result[19].id : null,
  };
}
export async function readCase(env, org, actor, caseId) {
  await casesReady(env, org);
  const db = getDb(env),
    g = await epoch(db),
    user = await caseActor(env, org, actor),
    r = await record(env, org, user, caseId);
  const links = rows(
    await db
      .prepare(
        "SELECT * FROM ticket_case_links WHERE organization_id=? AND case_id=? ORDER BY id LIMIT 101",
      )
      .bind(org, caseId)
      .all(),
  );
  if (links.length > 100) throw caseError("LINK_LIMIT", 422);
  const visible = [];
  for (const l of links)
    if (await visibleTarget(env, org, user, targetOf(l)))
      visible.push({ id: l.id, target: targetOf(l), relation: l.relation });
  // Bound history, expose only authorized events. No unfiltered totals/cursors.
  const events = rows(
    await db
      .prepare(
        "SELECT * FROM ticket_case_events WHERE organization_id=? AND case_id=? ORDER BY id DESC LIMIT 201",
      )
      .bind(org, caseId)
      .all(),
  );
  if (events.length > 200) throw caseError("HISTORY_LIMIT", 422);
  const history = [];
  for (const e of events) {
    const data = JSON.parse(e.data_json);
    if (data.target && !(await visibleTarget(env, org, user, data.target)))
      continue;
    history.push({
      action: e.action,
      at: e.created_at,
      actorId: e.actor_id,
      data,
    });
  }
  // Versions are opaque hashes at the transport boundary; hidden links must not reveal event counts.
  await stable(db, g);
  return {
    record: { ...publicRecord(r), version: await versionToken(r) },
    links: visible,
    history,
    canManage: (await can(env, user, "ticket.manage", scope(org))).allowed,
  };
}
const versionToken = (r) => sha256([r.id, r.version, r.updated_at]);
function normalizeData(raw, previous = {}) {
  keys(raw, [
    "impact",
    "observedAt",
    "mitigation",
    "restoration",
    "nextUpdateAt",
    "causeStatus",
    "cause",
    "causeEvidence",
    "conclusion",
    "postMortem",
    "actions",
    "reason",
  ]);
  const data = {
    impact: "",
    observedAt: null,
    mitigation: "",
    restoration: "",
    nextUpdateAt: null,
    causeStatus: "unknown",
    cause: "",
    causeEvidence: "",
    conclusion: "",
    postMortem: "",
    actions: "",
    ...previous,
  };
  for (const [k, v] of Object.entries(raw)) {
    if (k === "reason") continue;
    if (["observedAt", "nextUpdateAt"].includes(k)) {
      if (v === null || v === "") {
        data[k] = null;
        continue;
      }
      if (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
        throw caseError("INVALID_DATE");
      data[k] = new Date(v).toISOString();
    } else data[k] = text(v, k === "postMortem" ? 6000 : 2000);
  }
  if (!["unknown", "hypothesis", "confirmed"].includes(data.causeStatus))
    throw caseError("INVALID_CAUSE");
  if (data.causeStatus === "unknown" && (data.cause || data.causeEvidence))
    throw caseError("UNKNOWN_CAUSE_TEXT");
  if (data.causeStatus !== "unknown" && !data.cause)
    throw caseError("CAUSE_REQUIRED");
  if (data.causeStatus === "confirmed" && !data.causeEvidence)
    throw caseError("EVIDENCE_REQUIRED");
  return data;
}
async function eligible(db, org, userId) {
  if (
    !(await db
      .prepare(
        "SELECT 1 FROM organization_users ou JOIN users u ON u.id=ou.user_id WHERE ou.organization_id=? AND u.id=? AND u.active=1",
      )
      .bind(org, integer(userId))
      .first())
  )
    throw caseError("INVALID_MEMBER");
}
const statePaths = {
  incident: {
    open: ["mitigating", "restored"],
    mitigating: ["restored"],
    restored: ["closed", "open"],
    closed: ["open"],
  },
  problem: {
    open: ["investigating"],
    investigating: ["action_defined", "resolved"],
    action_defined: ["resolved", "investigating"],
    resolved: ["investigating"],
  },
};
export async function commandCase(env, org, actor, caseId, body) {
  await casesReady(env, org);
  keys(body, [
    "action",
    "idempotencyKey",
    "version",
    "kind",
    "title",
    "visibility",
    "coordinatorId",
    "data",
    "state",
    "target",
    "relation",
    "members",
  ]);
  const db = getDb(env),
    g = await epoch(db),
    user = await caseActor(env, org, actor, true),
    action = body.action;
  if (
    ![
      "create",
      "update",
      "transition",
      "link",
      "unlink",
      "audience",
      "review_duplicate",
    ].includes(action)
  )
    throw caseError("INVALID_ACTION");
  if ((action === "create") !== !caseId) throw caseError("INVALID_ACTION");
  const key = id(body.idempotencyKey);
  if (key.length < 16) throw caseError("INVALID_KEY");
  const commandId = await sha256([org, user.id, key]),
    hash = await sha256([caseId, body]);
  let current = caseId ? await record(env, org, user, caseId) : null;
  const replay = async () => {
    const r = await db
      .prepare("SELECT * FROM ticket_case_commands WHERE id=?")
      .bind(commandId)
      .first();
    if (!r) return null;
    if (r.request_hash !== hash) throw caseError("IDEMPOTENCY_CONFLICT", 409);
    const result = JSON.parse(r.result_json);
    await record(env, org, user, result.id);
    if (body.target) await targetAllowed(env, org, user, body.target);
    return { ...result, replayed: true };
  };
  const previous = await replay();
  if (previous) return previous;
  if (current && body.version !== (await versionToken(current)))
    throw caseError("VERSION_CONFLICT", 409);
  const stamp = now(),
    caseKey = caseId || crypto.randomUUID();
  let statements = [],
    event = {};
  const guard = (sql) =>
    db.prepare(`INSERT INTO ticket_case_guard(value) VALUES(${sql})`);
  if (action === "create") {
    if (!["incident", "problem"].includes(body.kind))
      throw caseError("INVALID_KIND");
    const title = text(body.title, 200, true),
      visibility = body.visibility || "private";
    if (!["private", "organization"].includes(visibility))
      throw caseError("INVALID_AUDIENCE");
    const coordinator = body.coordinatorId ?? user.id;
    await eligible(db, org, coordinator);
    const data = normalizeData(body.data || {});
    statements.push(
      db
        .prepare(
          "INSERT INTO ticket_cases(id,organization_id,kind,title,state,visibility,created_by,coordinator_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          caseKey,
          org,
          body.kind,
          title,
          "open",
          visibility,
          user.id,
          coordinator,
          JSON.stringify(data),
          stamp,
          stamp,
        ),
    );
    event = { title, visibility, data };
  } else {
    let data = JSON.parse(current.data_json),
      title = current.title,
      state = current.state,
      visibility = current.visibility,
      coordinator = current.coordinator_id;
    if (["update", "transition"].includes(action)) {
      data = normalizeData(body.data || {}, data);
      if (body.title !== undefined) title = text(body.title, 200, true);
      if (body.coordinatorId !== undefined) {
        coordinator = integer(body.coordinatorId);
        await eligible(db, org, coordinator);
      }
    }
    if (action === "transition") {
      if (!statePaths[current.kind][state].includes(body.state))
        throw caseError("INVALID_TRANSITION", 409);
      text(body.data?.reason, 2000, true);
      state = body.state;
      if (["restored", "closed"].includes(state) && !data.restoration)
        throw caseError("RESTORATION_REQUIRED");
      if (state === "resolved" && !data.conclusion)
        throw caseError("CONCLUSION_REQUIRED");
    }
    if (action === "audience") {
      if (
        !["private", "organization"].includes(body.visibility) ||
        !Array.isArray(body.members) ||
        body.members.length > 30 ||
        new Set(body.members).size !== body.members.length
      )
        throw caseError("INVALID_AUDIENCE");
      visibility = body.visibility;
      for (const m of body.members) await eligible(db, org, m);
      statements.push(
        db
          .prepare(
            "DELETE FROM ticket_case_members WHERE organization_id=? AND case_id=?",
          )
          .bind(org, caseKey),
      );
      for (const m of body.members)
        statements.push(
          db
            .prepare(
              "INSERT INTO ticket_case_members(organization_id,case_id,user_id) VALUES(?,?,?)",
            )
            .bind(org, caseKey, m),
        );
      event = { visibility };
    }
    if (["link", "unlink", "review_duplicate"].includes(action)) {
      keys(body.target, ["type", "id"]);
      await targetAllowed(env, org, user, body.target);
      const t = body.target;
      if (t.type === "case" && t.id === caseKey) throw caseError("SELF_LINK");
      const column =
        t.type === "ticket"
          ? "ticket_id"
          : t.type === "case"
            ? "target_case_id"
            : "change_id";
      const relation = body.relation || "related";
      if (
        ![
          "related",
          "duplicate_candidate",
          "duplicate_confirmed",
          "duplicate_rejected",
          "implements",
        ].includes(relation)
      )
        throw caseError("INVALID_RELATION");
      if (relation.startsWith("duplicate_")) {
        if (
          t.type !== "case" ||
          (await record(env, org, user, t.id)).kind !== current.kind
        )
          throw caseError("INVALID_DUPLICATE");
      }
      if (action === "link") {
        if (["duplicate_confirmed", "duplicate_rejected"].includes(relation))
          throw caseError("REVIEW_REQUIRED");
        const count = await db
          .prepare("SELECT COUNT(*) n FROM ticket_case_links WHERE case_id=?")
          .bind(caseKey)
          .first();
        if (count.n >= 100) throw caseError("LINK_LIMIT", 422);
        statements.push(
          db
            .prepare(
              `INSERT INTO ticket_case_links(id,organization_id,case_id,${column},relation,created_by,created_at) VALUES(?,?,?,?,?,?,?)`,
            )
            .bind(
              crypto.randomUUID(),
              org,
              caseKey,
              t.id,
              relation,
              user.id,
              stamp,
            ),
        );
      } else if (action === "unlink")
        statements.push(
          db
            .prepare(
              `DELETE FROM ticket_case_links WHERE organization_id=? AND case_id=? AND ${column}=?`,
            )
            .bind(org, caseKey, t.id),
          guard("changes()"),
        );
      else {
        if (!["duplicate_confirmed", "duplicate_rejected"].includes(relation))
          throw caseError("INVALID_REVIEW");
        text(body.data?.reason, 2000, true);
        statements.push(
          db
            .prepare(
              `UPDATE ticket_case_links SET relation=? WHERE organization_id=? AND case_id=? AND ${column}=? AND relation='duplicate_candidate'`,
            )
            .bind(relation, org, caseKey, t.id),
          guard("changes()"),
        );
      }
      event = { target: t, relation, reason: body.data?.reason || "" };
    }
    if (["update", "transition"].includes(action))
      event = { title, state, data, reason: body.data?.reason || "" };
    // Epoch fence is checked BEFORE any source writes; the record CAS is checked after its UPDATE.
    statements.push(
      db
        .prepare(
          "UPDATE ticket_cases SET title=?,state=?,visibility=?,coordinator_id=?,data_json=?,version=version+1,updated_at=? WHERE organization_id=? AND id=? AND version=?",
        )
        .bind(
          title,
          state,
          visibility,
          coordinator,
          JSON.stringify(data),
          stamp,
          org,
          caseKey,
          current.version,
        ),
      guard("changes()"),
    );
  }
  const history = await db
    .prepare("SELECT COUNT(*) n FROM ticket_case_events WHERE case_id=?")
    .bind(caseKey)
    .first();
  if (history.n >= 200) throw caseError("HISTORY_LIMIT", 422);
  const result = { id: caseKey };
  await caseActor(env, org, user, true);
  await stable(db, g);
  try {
    await db.batch([
      guard("(SELECT version FROM ticket_export_generation WHERE id=1)=?").bind(
        g,
      ),
      db
        .prepare("INSERT INTO ticket_case_commands VALUES(?,?,?,?,?,?)")
        .bind(commandId, org, user.id, hash, JSON.stringify(result), stamp),
      ...statements,
      db
        .prepare(
          "INSERT INTO ticket_case_events(organization_id,case_id,command_id,actor_id,version,action,data_json,created_at) SELECT organization_id,id,?,?,version,?,?,? FROM ticket_cases WHERE id=? AND organization_id=?",
        )
        .bind(
          commandId,
          user.id,
          action,
          JSON.stringify(event),
          stamp,
          caseKey,
          org,
        ),
      db.prepare("DELETE FROM ticket_case_guard"),
    ]);
  } catch (e) {
    const prior = await replay();
    if (prior) return prior;
    if (/constraint|CC13_/i.test(e.message)) throw caseError("CONFLICT", 409);
    throw e;
  }
  return { ...result, replayed: false };
}

// Explicit human-reviewed message. CC05 owns message/event/outbox atomicity and CC07 reauthorizes delivery.
export async function communicateCase(env, org, actor, caseId, body, request) {
  await casesReady(env, org);
  keys(body, ["ticketId", "version", "kind", "body"]);
  const db = getDb(env),
    g = await epoch(db),
    user = await caseActor(env, org, actor, true),
    r = await record(env, org, user, caseId);
  if (body.version !== (await versionToken(r)))
    throw caseError("VERSION_CONFLICT", 409);
  await targetAllowed(env, org, user, { type: "ticket", id: body.ticketId });
  if (
    !(await db
      .prepare(
        "SELECT 1 FROM ticket_case_links WHERE organization_id=? AND case_id=? AND ticket_id=?",
      )
      .bind(org, caseId, body.ticketId)
      .first())
  )
    throw caseError("NOT_FOUND", 404);
  const context = await resolveTicketConversationContext(
    env,
    org,
    body.ticketId,
    user,
  );
  // Server-only guard prevents a revocation between authorization and the CC05 transaction.
  return createTicketMessage(
    env,
    context,
    { kind: body.kind, body: text(body.body, 6000, true), attachmentIds: [] },
    request,
    {
      beforeWrite: [
        db
          .prepare(
            "INSERT INTO ticket_case_guard(value) VALUES((SELECT version FROM ticket_export_generation WHERE id=1)=?)",
          )
          .bind(g),
      ],
      afterWrite: [db.prepare("DELETE FROM ticket_case_guard")],
    },
  );
}

// CC12 grain: one ticket row, with distinct authorized incident/problem records. No CR/private target data.
export async function caseFactsForTicket(env, org, user, ticketId) {
  await casesReady(env, org);
  const acl = casePredicate(user);
  const result = rows(
    await getDb(env)
      .prepare(
        `SELECT DISTINCT c.* FROM ticket_cases c JOIN ticket_case_links l ON l.case_id=c.id AND l.organization_id=c.organization_id WHERE l.organization_id=? AND l.ticket_id=? AND ${acl.sql} ORDER BY c.id LIMIT 101`,
      )
      .bind(org, ticketId, ...acl.values)
      .all(),
  );
  if (result.length > 100) throw caseError("LINK_LIMIT", 422);
  return Promise.all(
    result.map(async (r) => {
      const d = JSON.parse(r.data_json);
      return {
        id: r.id,
        kind: r.kind,
        title: r.title,
        state: r.state,
        revision: await versionToken(r),
        causeStatus: d.causeStatus,
        cause: d.cause,
        causeEvidence: d.causeEvidence,
        restoration: d.restoration,
        updatedAt: r.updated_at,
      };
    }),
  );
}
export async function authorizeCaseSnapshot(env, org, user, db, jobId) {
  await casesReady(env, org);
  const acl = casePredicate(user);
  const result = await db
    .prepare(
      `SELECT COUNT(*) denied FROM ticket_export_items i,json_each(i.fact_json,'$.cases') x LEFT JOIN ticket_cases c ON c.id=json_extract(x.value,'$.id') AND c.organization_id=i.organization_id WHERE i.job_id=? AND (c.id IS NULL OR NOT ${acl.sql} OR NOT EXISTS(SELECT 1 FROM ticket_case_links l WHERE l.organization_id=i.organization_id AND l.case_id=c.id AND l.ticket_id=i.ticket_id))`,
    )
    .bind(jobId, ...acl.values)
    .first();
  if (result.denied) throw caseError("NOT_FOUND", 404);
}
