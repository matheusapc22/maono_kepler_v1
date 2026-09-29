import { knowledgeGrantFence } from "./ticket-knowledge-fence.js";
import { getDb } from "./organizations.js";
import { can } from "./permissions.js";
import {
  assertTicketSelectiveAccessReady,
  requireTicketAccess,
} from "./ticket-access.js";
import { caseActor, casePredicate } from "./ticket-cases.js";
import {
  createTicketMessage,
  resolveTicketConversationContext,
} from "./ticket-conversations.js";
import { canWriteConversation } from "./ticket-conversation-policy.js";
import { sha256 } from "./ticket-export-domain.js";

export const knowledgeError = (code, status = 400) =>
  Object.assign(
    new Error(
      "Não foi possível concluir. Atualize o conteúdo e confira sua permissão.",
    ),
    { code: "TICKET_KNOWLEDGE_" + code, status },
  );
const rows = (r) => r?.results || [];
const identifier = (v) => {
  if (typeof v !== "string" || !/^[\w:-]{1,150}$/.test(v))
    throw knowledgeError("INVALID_ID");
  return v;
};
const integer = (v) => {
  if (!Number.isSafeInteger(v) || v < 1) throw knowledgeError("INVALID_ID");
  return v;
};
const text = (v, max) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw knowledgeError("INVALID_TEXT");
  return v.trim();
};
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const key = (v) => {
  identifier(v);
  if (v.length < 16) throw knowledgeError("INVALID_KEY");
  return v;
};
const stamp = () => new Date().toISOString();
const epoch = async (db) =>
  (
    await db
      .prepare("SELECT version FROM ticket_export_generation WHERE id=1")
      .first()
  ).version;
const guard = (db, sql, ...args) =>
  db
    .prepare(`INSERT INTO ticket_knowledge_guard(value) VALUES(${sql})`)
    .bind(...args);
const fence = (db, g) =>
  guard(db, "(SELECT version FROM ticket_export_generation WHERE id=1)=?", g);
const stable = async (db, g) => {
  if ((await epoch(db)) !== g) throw knowledgeError("SOURCE_CHANGED", 409);
};
export const knowledgeEnabled = (env, org) =>
  String(env.MAONO_TICKET_KNOWLEDGE_ENABLED) === "true" &&
  String(env.MAONO_TICKET_KNOWLEDGE_ORGANIZATION_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .includes(String(org));
export async function knowledgeReady(env, org) {
  if (!knowledgeEnabled(env, org)) throw knowledgeError("DISABLED", 503);
  if (!["local", "production"].includes(env.MAONO_RUNTIME_ENV))
    throw knowledgeError("RUNTIME_DENIED", 503);
  if (String(env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED) !== "true")
    throw knowledgeError("ACCESS_REQUIRED", 503);
  await assertTicketSelectiveAccessReady(env);
  const names = rows(
    await getDb(env)
      .prepare(
        "SELECT name FROM sqlite_master WHERE name LIKE 'ticket_knowledge_%'",
      )
      .all(),
  ).map((r) => r.name);
  const required = [
    "articles",
    "revisions",
    "sources",
    "commands",
    "events",
    "uses",
    "guard",
  ].map((n) => "ticket_knowledge_" + n);
  required.push(
    "ticket_knowledge_uses_no_delete",
    "ticket_knowledge_article_revision_scope",
    "ticket_knowledge_source_tenant",
    "ticket_knowledge_use_tenant",
    "ticket_knowledge_use_message",
  );
  for (const t of ["revisions", "events", "sources"])
    for (const a of ["update", "delete"])
      required.push(`ticket_knowledge_${t}_${a}_immutable`);
  for (const t of [
    "ticket_knowledge_articles",
    "ticket_knowledge_revisions",
    "ticket_knowledge_uses",
  ])
    for (const a of ["insert", "update", "delete"])
      required.push(`ticket_knowledge_epoch_${t}_${a}`);
  if (required.some((n) => !names.includes(n)))
    throw knowledgeError("SCHEMA_REQUIRED", 503);
}
const editor = (a, u) => a.created_by === u.id || a.reviewer_id === u.id;
async function article(db, org, id) {
  const a = await db
    .prepare(
      "SELECT * FROM ticket_knowledge_articles WHERE organization_id=? AND id=?",
    )
    .bind(org, identifier(id))
    .first();
  if (!a) throw knowledgeError("NOT_FOUND", 404);
  return a;
}
async function revision(db, org, id) {
  return db
    .prepare(
      "SELECT * FROM ticket_knowledge_revisions WHERE organization_id=? AND id=?",
    )
    .bind(org, id)
    .first();
}
const version = (a) => sha256([a.id, a.version, a.updated_at]);
const publicRevision = (r) => ({
  id: r.id,
  number: r.number,
  title: r.title,
  body: r.body,
  audience: r.audience,
  authorId: r.author_id,
  createdAt: r.created_at,
  hash: r.content_hash,
});
async function sourceAllowed(env, org, u, s) {
  if (s.type === "ticket") {
    await requireTicketAccess(env, org, integer(s.id), u, "ticket.view");
    return;
  }
  if (s.type === "case") {
    const acl = casePredicate(u);
    const found = await getDb(env)
      .prepare(
        `SELECT c.id FROM ticket_cases c WHERE c.organization_id=? AND c.id=? AND ${acl.sql}`,
      )
      .bind(org, identifier(s.id), ...acl.values)
      .first();
    if (!found) throw knowledgeError("NOT_FOUND", 404);
    return;
  }
  throw knowledgeError("INVALID_SOURCE");
}
async function readable(env, org, u, a) {
  const r = a.published_id
    ? await revision(getDb(env), org, a.published_id)
    : null;
  if (!editor(a, u) && r?.audience !== "organization")
    throw knowledgeError("NOT_FOUND", 404);
  return r;
}
export async function listKnowledge(
  env,
  org,
  actor,
  { query = "", after = "", suggestions = false } = {},
) {
  if (!knowledgeEnabled(env, org))
    return { enabled: false, items: [], nextCursor: null };
  await knowledgeReady(env, org);
  const db = getDb(env),
    g = await epoch(db),
    grants = await knowledgeGrantFence(db, org, actor.id),
    u = await caseActor(env, org, actor);
  if (typeof query !== "string" || query.length > 100)
    throw knowledgeError("INVALID_QUERY");
  if (after) identifier(after);
  // Select and search only the revision visible to this actor. Draft text never enters organization search.
  const choice = suggestions
    ? "a.published_id"
    : "CASE WHEN a.created_by=? OR a.reviewer_id=? THEN a.candidate_id ELSE a.published_id END";
  const params = suggestions ? [] : [u.id, u.id];
  const result = rows(
    await db
      .prepare(
        `SELECT a.id,a.created_by,a.reviewer_id,a.state,r.* FROM ticket_knowledge_articles a JOIN ticket_knowledge_revisions r ON r.id=${choice} AND r.organization_id=a.organization_id WHERE a.organization_id=? AND ${suggestions ? "r.audience='organization' AND a.published_id=r.id" : "(a.created_by=? OR a.reviewer_id=? OR (a.published_id=r.id AND r.audience='organization'))"} AND a.id>? AND (instr(lower(r.title),lower(?))>0 OR instr(lower(r.body),lower(?))>0) ORDER BY a.id LIMIT 21`,
      )
      .bind(
        ...params,
        org,
        ...(suggestions ? [] : [u.id, u.id]),
        after,
        query,
        query,
      )
      .all(),
  );
  await stable(db, g);
  if (!(await grants.verify())) throw knowledgeError("SOURCE_CHANGED", 409);
  return {
    enabled: true,
    items: result.slice(0, 20).map((r) => ({
      id: r.article_id,
      revisionId: r.id,
      number: r.number,
      title: r.title,
      audience: r.audience,
      state: editor(r, u) ? r.state : "published",
    })),
    nextCursor: result.length > 20 ? result[19].article_id : null,
  };
}
export async function readKnowledge(
  env,
  org,
  actor,
  id,
  { before = 2147483647, eventsBefore = Number.MAX_SAFE_INTEGER } = {},
) {
  await knowledgeReady(env, org);
  const db = getDb(env),
    g = await epoch(db),
    grants = await knowledgeGrantFence(db, org, actor.id, id),
    u = await caseActor(env, org, actor),
    a = await article(db, org, id),
    published = await readable(env, org, u, a),
    isEditor = editor(a, u);
  const r = isEditor ? await revision(db, org, a.candidate_id) : published;
  const result = {
    id: a.id,
    revision: publicRevision(r),
    published:
      published && (isEditor || published.audience === "organization")
        ? publicRevision(published)
        : null,
    canEdit: false,
    canReview: false,
    state: isEditor ? a.state : "published",
    version: isEditor ? await version(a) : null,
  };
  if (isEditor) {
    const allowed = (
      await can(env, u, "ticket.manage", {
        organizationId: org,
        scopeType: "organization",
        resourceType: "ticket",
      })
    ).allowed;
    Object.assign(result, {
      canEdit: allowed,
      canRevise: allowed && u.id === a.created_by,
      canReview: allowed && u.id === a.reviewer_id && u.id !== r.author_id,
      reviewerId: a.reviewer_id,
    });
    const history = rows(
      await db
        .prepare(
          "SELECT * FROM ticket_knowledge_revisions WHERE organization_id=? AND article_id=? AND number<? ORDER BY number DESC LIMIT 21",
        )
        .bind(org, id, integer(before))
        .all(),
    );
    result.history = history.slice(0, 20).map(publicRevision);
    result.nextHistory = history.length > 20 ? history[19].number : null;
    const events = rows(
      await db
        .prepare(
          "SELECT rowid AS sequence,action,reason,actor_id AS actorId,revision_id AS revisionId,created_at AS createdAt FROM ticket_knowledge_events WHERE organization_id=? AND article_id=? AND rowid<? ORDER BY rowid DESC LIMIT 101",
        )
        .bind(org, id, integer(eventsBefore))
        .all(),
    );
    result.events = events.slice(0, 100);
    result.nextEvents = events.length > 100 ? events[99].sequence : null;
    const s = await db
      .prepare(
        "SELECT * FROM ticket_knowledge_sources WHERE organization_id=? AND article_id=?",
      )
      .bind(org, id)
      .first();
    if (s) {
      const target = s.ticket_id
        ? { type: "ticket", id: s.ticket_id }
        : { type: "case", id: s.case_id };
      try {
        await sourceAllowed(env, org, u, target);
        result.source = target;
      } catch (e) {
        if (![403, 404].includes(e.status)) throw e;
      }
    }
  }
  await stable(db, g);
  if (!(await grants.verify())) throw knowledgeError("SOURCE_CHANGED", 409);
  return result;
}
export async function commandKnowledge(env, org, actor, id, body) {
  await knowledgeReady(env, org);
  if (!object(body)) throw knowledgeError("INVALID_BODY");
  const db = getDb(env),
    g = await epoch(db),
    grants = await knowledgeGrantFence(
      db,
      org,
      actor.id,
      id,
      body.reviewerId ?? null,
    ),
    u = await caseActor(env, org, actor, true),
    action = body.action;
  const allowed = {
    create: ["title", "body", "reviewerId", "source"],
    revise: ["title", "body", "audience"],
    submit: ["reason"],
    approve: ["reason"],
    reject: ["reason"],
    publish: ["reason"],
    withdraw: ["reason"],
    reviewer: ["reviewerId", "reason"],
  };
  if (
    !allowed[action] ||
    Object.keys(body).some(
      (k) =>
        !["action", "version", "idempotencyKey", ...allowed[action]].includes(
          k,
        ),
    )
  )
    throw knowledgeError("INVALID_ACTION");
  const commandId = await sha256([org, u.id, key(body.idempotencyKey)]),
    hash = await sha256([id, body]);
  const existing = await db
    .prepare("SELECT * FROM ticket_knowledge_commands WHERE id=?")
    .bind(commandId)
    .first();
  if (existing) {
    if (existing.request_hash !== hash) throw knowledgeError("KEY_REUSED", 409);
    const result = JSON.parse(existing.result_json);
    await readKnowledge(env, org, u, result.id);
    return { ...result, replayed: true };
  }
  let a = id ? await article(db, org, id) : null;
  if ((action === "create") !== !a) throw knowledgeError("INVALID_ACTION");
  if (a && !editor(a, u)) throw knowledgeError("NOT_FOUND", 404);
  if (a && body.version !== (await version(a)))
    throw knowledgeError("CONFLICT", 409);
  const at = stamp(),
    aid = a?.id || "knowledge:" + crypto.randomUUID(),
    statements = [],
    eventId = crypto.randomUUID();
  let rid = a?.candidate_id,
    r = a ? await revision(db, org, rid) : null;
  let reviewerId = a?.reviewer_id;
  if (action === "create" || action === "reviewer") {
    reviewerId = integer(body.reviewerId);
    await caseActor(env, org, { id: reviewerId }, true);
    if (reviewerId === (a?.created_by || u.id) || reviewerId === r?.author_id)
      throw knowledgeError("INDEPENDENT_REVIEW_REQUIRED", 422);
  }
  if (action === "create" || action === "revise") {
    if (a && a.created_by !== u.id)
      throw knowledgeError("AUTHOR_REQUIRED", 403);
    const title = text(body.title, 200),
      content = text(body.body, 12000),
      audience = action === "create" ? "private" : body.audience;
    if (!["private", "organization"].includes(audience))
      throw knowledgeError("INVALID_AUDIENCE");
    rid = "revision:" + crypto.randomUUID();
    const n = a
      ? (
          await db
            .prepare(
              "SELECT MAX(number) n FROM ticket_knowledge_revisions WHERE article_id=?",
            )
            .bind(aid)
            .first()
        ).n + 1
      : 1;
    if (action === "create")
      statements.push(
        db
          .prepare(
            "INSERT INTO ticket_knowledge_articles(id,organization_id,created_by,reviewer_id,candidate_id,state,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?)",
          )
          .bind(aid, org, u.id, reviewerId, rid, at, at),
      );
    statements.push(
      db
        .prepare(
          "INSERT INTO ticket_knowledge_revisions VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          rid,
          org,
          aid,
          n,
          u.id,
          title,
          content,
          audience,
          await sha256([title, content, audience]),
          at,
        ),
    );
    if (action === "create" && body.source) {
      if (
        !object(body.source) ||
        Object.keys(body.source).some((k) => !["type", "id"].includes(k))
      )
        throw knowledgeError("INVALID_SOURCE");
      await sourceAllowed(env, org, u, body.source);
      statements.push(
        db
          .prepare("INSERT INTO ticket_knowledge_sources VALUES(?,?,?,?)")
          .bind(
            org,
            aid,
            body.source.type === "ticket" ? body.source.id : null,
            body.source.type === "case" ? body.source.id : null,
          ),
      );
    }
  }
  let state = a?.state || "draft",
    publishedId = a?.published_id || null,
    reason = "";
  if (!["create", "revise"].includes(action)) reason = text(body.reason, 1000);
  if (action === "revise" || action === "reviewer") state = "draft";
  if (action === "submit") {
    if (state !== "draft" || u.id !== a.created_by)
      throw knowledgeError("INVALID_TRANSITION", 409);
    state = "review";
  }
  if (action === "approve" || action === "reject") {
    if (state !== "review" || u.id !== a.reviewer_id || u.id === r.author_id)
      throw knowledgeError("INDEPENDENT_REVIEW_REQUIRED", 403);
    state = action === "approve" ? "approved" : "draft";
  }
  if (action === "publish") {
    if (state !== "approved") throw knowledgeError("REVIEW_REQUIRED", 409);
    await caseActor(env, org, { id: a.reviewer_id }, true);
    state = "published";
    publishedId = rid;
  }
  if (action === "withdraw") {
    if (!publishedId) throw knowledgeError("INVALID_TRANSITION", 409);
    publishedId = null;
    state = "withdrawn";
  }
  if (a)
    statements.push(
      db
        .prepare(
          "UPDATE ticket_knowledge_articles SET candidate_id=?,published_id=?,reviewer_id=?,state=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=?",
        )
        .bind(rid, publishedId, reviewerId, state, at, aid, org, a.version),
      guard(db, "changes()"),
    );
  const result = { id: aid };
  statements.push(
    db
      .prepare("INSERT INTO ticket_knowledge_events VALUES(?,?,?,?,?,?,?,?)")
      .bind(eventId, org, aid, rid, u.id, action, reason, at),
  );
  try {
    await db.batch([
      fence(db, g),
      ...grants,
      db
        .prepare("INSERT INTO ticket_knowledge_commands VALUES(?,?,?,?,?,?)")
        .bind(commandId, org, u.id, hash, JSON.stringify(result), at),
      ...statements,
      db.prepare("DELETE FROM ticket_knowledge_guard"),
    ]);
  } catch (e) {
    const winner = await db
      .prepare("SELECT * FROM ticket_knowledge_commands WHERE id=?")
      .bind(commandId)
      .first();
    if (winner) {
      if (winner.request_hash !== hash) throw knowledgeError("KEY_REUSED", 409);
      await readKnowledge(env, org, u, JSON.parse(winner.result_json).id);
      return { ...JSON.parse(winner.result_json), replayed: true };
    }
    if (/constraint|CC14_/i.test(e.message))
      throw knowledgeError("CONFLICT", 409);
    throw e;
  }
  return { ...result, replayed: false };
}

// A durable selection is a draft, never an instruction to send. Only organization-published content may be reused.
export async function selectKnowledge(env, org, actor, id, body) {
  await knowledgeReady(env, org);
  if (
    !object(body) ||
    Object.keys(body).some(
      (k) => !["revisionId", "ticketId", "kind", "idempotencyKey"].includes(k),
    )
  )
    throw knowledgeError("INVALID_BODY");
  const db = getDb(env),
    g = await epoch(db),
    grants = await knowledgeGrantFence(db, org, actor.id, id),
    u = await caseActor(env, org, actor),
    a = await article(db, org, id),
    r = await readable(env, org, u, a);
  if (!r || r.id !== body.revisionId || r.audience !== "organization")
    throw knowledgeError("PUBLICATION_CHANGED", 409);
  const ticket = integer(body.ticketId);
  await requireTicketAccess(env, org, ticket, u, "ticket.view");
  const context = await resolveTicketConversationContext(env, org, ticket, u);
  if (
    !["response", "internal"].includes(body.kind) ||
    !canWriteConversation(
      context,
      body.kind === "internal" ? "internal" : "ticket",
    )
  )
    throw knowledgeError("NOT_FOUND", 404);
  const useId = await sha256([org, u.id, key(body.idempotencyKey)]),
    old = await db
      .prepare("SELECT * FROM ticket_knowledge_uses WHERE id=?")
      .bind(useId)
      .first();
  if (
    old &&
    (old.article_id !== id ||
      old.revision_id !== r.id ||
      old.ticket_id !== ticket ||
      old.kind !== body.kind)
  )
    throw knowledgeError("KEY_REUSED", 409);
  if (!old)
    try {
      await db.batch([
        fence(db, g),
        ...grants,
        db
          .prepare(
            "INSERT INTO ticket_knowledge_uses(id,organization_id,article_id,revision_id,actor_id,ticket_id,kind,created_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .bind(useId, org, id, r.id, u.id, ticket, body.kind, stamp()),
        db.prepare("DELETE FROM ticket_knowledge_guard"),
      ]);
    } catch (e) {
      throw knowledgeError("CONFLICT", 409);
    }
  else await stable(db, g);
  return {
    selectionId: useId,
    revision: publicRevision(r),
    body: r.body,
    kind: body.kind,
  };
}
export async function sendKnowledge(env, org, actor, id, body, request) {
  await knowledgeReady(env, org);
  if (
    !object(body) ||
    Object.keys(body).some(
      (k) => !["selectionId", "body", "reviewed"].includes(k),
    ) ||
    body.reviewed !== true
  )
    throw knowledgeError("HUMAN_REVIEW_REQUIRED", 422);
  const db = getDb(env),
    g = await epoch(db),
    grants = await knowledgeGrantFence(db, org, actor.id, id),
    u = await caseActor(env, org, actor),
    use = await db
      .prepare(
        "SELECT * FROM ticket_knowledge_uses WHERE id=? AND organization_id=? AND actor_id=? AND article_id=?",
      )
      .bind(identifier(body.selectionId), org, u.id, identifier(id))
      .first();
  if (!use) throw knowledgeError("NOT_FOUND", 404);
  await requireTicketAccess(env, org, use.ticket_id, u, "ticket.view");
  const context = await resolveTicketConversationContext(
      env,
      org,
      use.ticket_id,
      u,
    ),
    a = await article(db, org, id),
    r = await revision(db, org, use.revision_id);
  // Replays after a successful send preserve their receipt. Unsent withdrawn selections are rejected.
  if (
    !use.message_id &&
    (a.published_id !== r.id || r.audience !== "organization")
  )
    throw knowledgeError("PUBLICATION_CHANGED", 409);
  const headers = new Headers(request.headers);
  headers.set("Idempotency-Key", "knowledge:" + use.id);
  const response = await createTicketMessage(
    env,
    context,
    { kind: use.kind, body: text(body.body, 12000), attachmentIds: [] },
    new Request(request.url, { headers }),
    {
      fingerprintContext: { knowledgeSelection: use.id },
      beforeWrite: [
        fence(db, g),
        ...grants,
        guard(
          db,
          "EXISTS(SELECT 1 FROM ticket_knowledge_articles WHERE id=? AND organization_id=? AND published_id=?)",
          id,
          org,
          r.id,
        ),
      ],
      afterWrite: [
        db
          .prepare(
            `UPDATE ticket_knowledge_uses SET message_id=(SELECT json_extract(result_json,'$.messageId') FROM ticket_commands WHERE organization_id=? AND actor_user_id=? AND operation='ticket.message.created' AND idempotency_key=?),reviewed_at=? WHERE id=? AND message_id IS NULL`,
          )
          .bind(org, u.id, "knowledge:" + use.id, stamp(), use.id),
        guard(db, "changes()"),
        db.prepare("DELETE FROM ticket_knowledge_guard"),
      ],
    },
  );
  return response;
}
