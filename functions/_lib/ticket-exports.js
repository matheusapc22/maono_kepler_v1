import { getDb } from "./organizations.js";
import { can } from "./permissions.js";
import {
  buildTicketAccessPredicate,
  assertTicketSelectiveAccessReady,
} from "./ticket-access.js";
import {
  projectMetricTicket,
  METRIC_DICTIONARY,
} from "./ticket-metrics-domain.js";
import {
  SOURCE_TABLES,
  CSV_HEADERS,
  TERMINAL,
  enabled,
  exportsEnabled,
  exportConfig,
  exportError,
  normalizeExportInput,
  sha256,
  csvLine,
  ticketCsvRow,
} from "./ticket-export-domain.js";
import { exportStorage } from "./ticket-export-storage.js";
import {
  casesEnabled,
  casesReady,
  casePredicate,
  caseFactsForTicket,
  authorizeCaseSnapshot,
} from "./ticket-cases.js";

const iso = (ms) => new Date(ms).toISOString();
const scope = (organizationId) => ({
  organizationId,
  scopeType: "organization",
  resourceType: "ticket",
});
const stamp = () => new Date().toISOString();
const gone = () => exportError("NOT_FOUND", 404);
const rows = (result) => result?.results || [];
const epoch = async (db) =>
  (
    await db
      .prepare("SELECT version FROM ticket_export_generation WHERE id=1")
      .first()
  )?.version;
const audit = (db, job, action) =>
  db
    .prepare(
      "INSERT INTO ticket_export_audit(job_id,organization_id,actor_id,action,created_at) VALUES(?,?,?,?,?)",
    )
    .bind(job.id, job.organization_id, job.actor_id, action, stamp());

export async function exportReady(env, org) {
  if (!exportsEnabled(env, org)) throw exportError("DISABLED", 503);
  const config = exportConfig(env);
  if (!enabled(env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED))
    throw exportError("ACCESS_REQUIRED", 503);
  await assertTicketSelectiveAccessReady(env);
  const names = rows(
    await getDb(env)
      .prepare(
        "SELECT name FROM sqlite_master WHERE name LIKE 'ticket_export_%' AND type IN ('table','trigger')",
      )
      .all(),
  ).map((x) => x.name);
  const required = [
    "ticket_export_generation",
    "ticket_export_jobs",
    "ticket_export_items",
    "ticket_export_parts",
    "ticket_export_audit",
    "ticket_export_gc",
    "ticket_export_items_immutable",
    "ticket_export_parts_immutable",
    ...SOURCE_TABLES.flatMap((t) =>
      ["insert", "update", "delete"].map(
        (e) => `ticket_export_epoch_${t}_${e}`,
      ),
    ),
  ];
  if (required.some((n) => !names.includes(n)))
    throw exportError("SCHEMA_REQUIRED", 503);
  return config;
}
async function actorAllowed(env, org, actorId, permissions) {
  const user = await getDb(env)
    .prepare(
      `SELECT u.id,u.role FROM users u JOIN organization_users ou ON ou.user_id=u.id
    JOIN organizations o ON o.id=ou.organization_id WHERE u.id=? AND u.active=1 AND o.active=1 AND o.id=?`,
    )
    .bind(actorId, org)
    .first();
  if (!user) throw gone();
  user.activeOrganizationId = org;
  for (const permission of ["ticket.view", ...permissions])
    if (!(await can(env, user, permission, scope(org))).allowed) throw gone();
  return user;
}
function cohort(input, access, actor) {
  const clauses = [
    "t.organization_id=?",
    "t.active=1",
    `(${access.sql})`,
    "julianday(t.created_at)<=julianday(?)",
  ];
  const values = [...access.values, input.asOf];
  if (input.domain) {
    clauses.push("t.category=?");
    values.push(input.domain);
  }
  if (input.nature) {
    clauses.push("COALESCE(t.demand_nature,'unknown')=?");
    values.push(input.nature);
  }
  if (input.report === "backlog") {
    clauses.push(`(EXISTS(SELECT 1 FROM ticket_cycles c WHERE c.ticket_id=t.id AND c.organization_id=t.organization_id
      AND julianday(c.opened_at)<=julianday(?) AND (c.closed_at IS NULL OR julianday(c.closed_at)>julianday(?)))
      OR (NOT EXISTS(SELECT 1 FROM ticket_cycles c WHERE c.ticket_id=t.id AND c.organization_id=t.organization_id) AND t.status<>'closed'))`);
    values.push(input.asOf, input.asOf);
  }
  if (input.report === "cycles") {
    clauses.push(`EXISTS(SELECT 1 FROM ticket_cycles c WHERE c.ticket_id=t.id AND c.organization_id=t.organization_id
      AND julianday(c.closed_at)>=julianday(?) AND julianday(c.closed_at)<julianday(?))`);
    values.push(input.from, input.to);
  }
  if (["incidents", "causes"].includes(input.report)) {
    const acl = casePredicate(actor);
    clauses.push(
      `EXISTS(SELECT 1 FROM ticket_case_links l JOIN ticket_cases c ON c.id=l.case_id AND c.organization_id=l.organization_id WHERE l.ticket_id=t.id AND l.organization_id=t.organization_id AND ${acl.sql} AND (?='causes' OR c.kind='incident'))`,
    );
    values.push(...acl.values, input.report);
  }
  return { sql: clauses.join(" AND "), values };
}
async function owned(env, org, actor, id, permissions = ["export.view"]) {
  await exportReady(env, org);
  const user = await actorAllowed(env, org, actor.id, permissions);
  const job = await getDb(env)
    .prepare(
      "SELECT * FROM ticket_export_jobs WHERE id=? AND organization_id=? AND actor_id=?",
    )
    .bind(id, org, user.id)
    .first();
  if (!job) throw gone();
  if (job.expires_at <= stamp()) throw exportError("EXPIRED", 410);
  return job;
}
function summary(job) {
  return {
    id: job.id,
    state: job.state,
    createdAt: job.created_at,
    expiresAt: job.expires_at,
    capturedRows: job.captured_rows,
    expectedRows: job.expected_rows,
    errorCode: job.error_code,
    report: JSON.parse(job.input_json).report,
    bytes: job.state === "ready" ? job.bytes : null,
  };
}
// Every response/download rechecks all captured rows, not just the current page.
export async function authorizeExportSnapshot(
  env,
  job,
  permissions = ["export.view"],
) {
  await exportReady(env, job.organization_id);
  const user = await actorAllowed(
    env,
    job.organization_id,
    job.actor_id,
    permissions,
  );
  const db = getDb(env),
    before = await epoch(db),
    access = await buildTicketAccessPredicate(env, job.organization_id, user);
  const check = await db
    .prepare(
      `SELECT COUNT(*) total, SUM(CASE WHEN t.id IS NOT NULL AND t.active=1 AND (${access.sql}) THEN 1 ELSE 0 END) allowed
    FROM ticket_export_items i LEFT JOIN organization_tickets t ON t.id=i.ticket_id AND t.organization_id=i.organization_id WHERE i.job_id=?`,
    )
    .bind(...access.values, job.id)
    .first();
  if (["incidents", "causes"].includes(JSON.parse(job.input_json).report))
    await authorizeCaseSnapshot(env, job.organization_id, user, db, job.id);
  if (before !== (await epoch(db))) throw exportError("ACCESS_CHANGED", 409);
  if (
    Number(check.total) !== Number(check.allowed || 0) ||
    Number(check.total) !== job.captured_rows
  )
    throw gone();
  // Read current role/capabilities again: time-based grants can expire without a D1 write.
  await actorAllowed(env, job.organization_id, job.actor_id, permissions);
  const current = await db
    .prepare("SELECT state,expires_at FROM ticket_export_jobs WHERE id=?")
    .bind(job.id)
    .first();
  if (!current || ["cancelled", "revoked", "expired"].includes(current.state))
    throw gone();
  if (current.expires_at <= stamp()) throw exportError("EXPIRED", 410);
}
export async function createTicketExport(env, org, actor, body) {
  const config = await exportReady(env, org),
    user = await actorAllowed(env, org, actor.id, [
      "export.create",
      "export.view",
      "export.download",
    ]);
  const input = normalizeExportInput(body, { cases: casesEnabled(env, org) }),
    requestHash = await sha256(input),
    db = getDb(env);
  const replay = async () =>
    db
      .prepare(
        "SELECT * FROM ticket_export_jobs WHERE organization_id=? AND actor_id=? AND request_id=?",
      )
      .bind(org, user.id, body.idempotencyKey)
      .first();
  const respond = async (job) => {
    if (job.request_hash !== requestHash)
      throw exportError("IDEMPOTENCY_CONFLICT", 409);
    await authorizeExportSnapshot(env, job, [
      "export.create",
      "export.view",
      "export.download",
    ]);
    return { job: summary(job), replayed: true };
  };
  if (["incidents", "causes"].includes(input.report))
    await casesReady(env, org);
  const prior = await replay();
  if (prior) return respond(prior);
  const generation = await epoch(db),
    access = await buildTicketAccessPredicate(env, org, user),
    filter = cohort(input, access, user);
  const [count, definitions] = await db.batch([
    db
      .prepare(
        `SELECT COUNT(*) n FROM organization_tickets t WHERE ${filter.sql}`,
      )
      .bind(org, ...filter.values),
    input.definitionVersion === 0
      ? db.prepare("SELECT 0 version,NULL reopen_hours")
      : db
          .prepare(
            `SELECT version,reopen_hours FROM ticket_metric_definitions WHERE organization_id=? ${input.definitionVersion == null ? "" : "AND version=?"} ORDER BY version DESC LIMIT 1`,
          )
          .bind(
            org,
            ...(input.definitionVersion == null
              ? []
              : [input.definitionVersion]),
          ),
  ]);
  const expected = rows(count)[0].n,
    def = rows(definitions)[0] || { version: 0, reopen_hours: null };
  if (input.definitionVersion > 0 && def.version === 0)
    throw exportError("DEFINITION_NOT_FOUND", 404);
  if (expected > config.maxRows)
    throw exportError(
      "ROW_LIMIT",
      422,
      "O recorte excede o limite aprovado. Reduza os filtros; nenhum arquivo parcial foi gerado.",
    );
  if (generation !== (await epoch(db)))
    throw exportError("SOURCE_CHANGED", 409);
  const now = stamp(),
    job = { id: crypto.randomUUID(), organization_id: org, actor_id: user.id };
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO ticket_export_jobs(id,organization_id,actor_id,request_id,request_hash,input_json,definition_json,config_json,state,generation,expected_rows,created_at,updated_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,'queued',?,?,?,?,? WHERE (SELECT version FROM ticket_export_generation WHERE id=1)=?
      AND (SELECT COUNT(*) FROM ticket_export_jobs WHERE organization_id=? AND expires_at>? AND state IN ('queued','capturing','running','ready'))<?
      ON CONFLICT(organization_id,actor_id,request_id) DO NOTHING`,
      )
      .bind(
        job.id,
        org,
        user.id,
        body.idempotencyKey,
        requestHash,
        JSON.stringify(input),
        JSON.stringify(def),
        JSON.stringify(config),
        generation,
        expected,
        now,
        now,
        iso(Date.now() + config.ttl * 1000),
        generation,
        org,
        now,
        config.maxJobs,
      ),
    db
      .prepare(
        `INSERT INTO ticket_export_audit(job_id,organization_id,actor_id,action,created_at)
      SELECT id,organization_id,actor_id,'created',? FROM ticket_export_jobs WHERE id=?`,
      )
      .bind(now, job.id),
  ]);
  const saved = await replay();
  if (!saved)
    throw exportError(
      generation !== (await epoch(db)) ? "SOURCE_CHANGED" : "QUOTA",
      409,
    );
  if (!result[0].meta.changes) return respond(saved);
  return { job: summary(saved), replayed: false };
}
export async function listTicketExports(env, org, actor, before = null) {
  if (!exportsEnabled(env, org)) return { enabled: false, jobs: [] };
  await exportReady(env, org);
  await actorAllowed(env, org, actor.id, ["export.view"]);
  if (before && !/^[\w-]{36}$/.test(before))
    throw exportError("INVALID_CURSOR");
  const db = getDb(env),
    cursor = before
      ? await db
          .prepare(
            "SELECT created_at,id FROM ticket_export_jobs WHERE id=? AND organization_id=? AND actor_id=?",
          )
          .bind(before, org, actor.id)
          .first()
      : null;
  if (before && !cursor) throw gone();
  const jobs = rows(
    await db
      .prepare(
        `SELECT * FROM ticket_export_jobs WHERE organization_id=? AND actor_id=? AND expires_at>?
    ${cursor ? "AND (created_at<? OR (created_at=? AND id<?))" : ""} ORDER BY created_at DESC,id DESC LIMIT 6`,
      )
      .bind(
        org,
        actor.id,
        stamp(),
        ...(cursor ? [cursor.created_at, cursor.created_at, cursor.id] : []),
      )
      .all(),
  );
  const visible = [];
  for (const job of jobs.slice(0, 5)) {
    try {
      await authorizeExportSnapshot(env, job);
      visible.push(summary(job));
    } catch (error) {
      if (error.status !== 404 && error.status !== 410) throw error;
    }
  }
  return {
    enabled: true,
    jobs: visible,
    nextCursor: jobs.length > 5 ? jobs[4].id : null,
  };
}
export async function readTicketExport(env, org, actor, id) {
  const job = await owned(env, org, actor, id);
  await authorizeExportSnapshot(env, job);
  return {
    job: summary(job),
    manifest: job.state === "ready" ? JSON.parse(job.manifest_json) : null,
  };
}
export async function cancelTicketExport(env, org, actor, id) {
  const job = await owned(env, org, actor, id, ["export.create"]);
  await getDb(env).batch([
    getDb(env)
      .prepare(
        "UPDATE ticket_export_jobs SET state='cancelled',token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state IN ('queued','capturing','running','ready','failed')",
      )
      .bind(stamp(), id),
    audit(getDb(env), job, "cancel_requested"),
  ]);
  return { id, state: "cancelled" };
}
export async function retryTicketExport(env, org, actor, id, idempotencyKey) {
  const job = await owned(env, org, actor, id, [
    "export.create",
    "export.view",
  ]);
  if (!["failed", "revoked"].includes(job.state))
    throw exportError("RETRY_CONFLICT", 409);
  // A retry is a new immutable snapshot/job; the previous terminal job is never resurrected.
  return createTicketExport(env, org, actor, {
    ...JSON.parse(job.input_json),
    idempotencyKey,
  });
}

async function sourceTicket(db, org, ticketId) {
  const query = (sql) => db.prepare(sql).bind(org, ticketId);
  const policyBudget = `(SELECT COALESCE(SUM(length(CAST(p.policy_json AS BLOB))),0) FROM ticket_sla_assignments a JOIN ticket_sla_policies p ON p.organization_id=a.organization_id AND p.version=a.policy_version WHERE a.organization_id=? AND a.ticket_id=?)`;
  const data = (
    await db.batch([
      query(
        "SELECT id,code,subject,category,status,version,created_by,created_at,demand_nature,assigned_to FROM organization_tickets WHERE organization_id=? AND id=?",
      ),
      query(
        "SELECT * FROM ticket_cycles WHERE organization_id=? AND ticket_id=? ORDER BY cycle_number LIMIT 501",
      ),
      query(
        "SELECT id,created_at,event_type,command_id,entity_version,corrects_event_id,json_object('to',json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,'$.to')) metadata FROM ticket_events WHERE organization_id=? AND ticket_id=? AND COALESCE(audience,'ticket')='ticket' ORDER BY id LIMIT 501",
      ),
      query(
        "SELECT * FROM ticket_wait_intervals WHERE organization_id=? AND ticket_id=? ORDER BY id LIMIT 501",
      ),
      query(`SELECT m.id,m.ticket_id,m.author_user_id,m.created_at,m.kind,m.audience FROM ticket_messages m
      JOIN ticket_commands c ON c.id=m.command_id AND c.actor_user_id=m.author_user_id AND c.organization_id=m.organization_id AND c.operation='ticket.message.created'
      JOIN ticket_message_revisions r ON r.message_id=m.id AND r.version=1 AND length(trim(r.body))>0
      WHERE m.organization_id=? AND m.ticket_id=? AND m.kind='response' AND m.audience='ticket'
      AND EXISTS(SELECT 1 FROM ticket_events e WHERE e.ticket_id=m.ticket_id AND e.organization_id=m.organization_id AND e.message_id=m.id AND e.command_id=m.command_id AND e.actor_user_id=m.author_user_id AND e.event_type='ticket.message.created') ORDER BY m.id LIMIT 501`),
      query(
        "SELECT * FROM ticket_sla_assignments WHERE organization_id=? AND ticket_id=? ORDER BY cycle_number,sequence LIMIT 501",
      ),
      db
        .prepare(
          `SELECT DISTINCT p.version,p.policy_json FROM ticket_sla_assignments a JOIN ticket_sla_policies p ON p.organization_id=a.organization_id AND p.version=a.policy_version WHERE a.organization_id=? AND a.ticket_id=? AND ${policyBudget}<=1048576 ORDER BY p.version LIMIT 501`,
        )
        .bind(org, ticketId, org, ticketId),
      query(`SELECT ${policyBudget} size`),
    ])
  ).map(rows);
  if (data[7][0].size > 1048576) throw exportError("SOURCE_BYTES_LIMIT", 422);
  if (!data[0][0] || data.slice(1).some((a) => a.length > 500))
    throw exportError("SOURCE_LIMIT", 422);
  if (new TextEncoder().encode(JSON.stringify(data)).length > 1024 * 1024)
    throw exportError("SOURCE_BYTES_LIMIT", 422);
  return {
    ticket: data[0][0],
    cycles: data[1],
    events: data[2],
    waits: data[3],
    messages: data[4],
    assignments: data[5],
    policies: data[6],
  };
}
const fence =
  "id=? AND token=? AND lease_until>? AND expires_at>? AND state IN ('capturing','running')";
async function captureStep(env, job) {
  const db = getDb(env),
    input = JSON.parse(job.input_json),
    def = JSON.parse(job.definition_json),
    config = JSON.parse(job.config_json);
  if (job.generation !== (await epoch(db)))
    throw exportError("SOURCE_CHANGED", 409);
  const actor = await actorAllowed(env, job.organization_id, job.actor_id, [
    "export.create",
    "export.view",
    "export.download",
  ]);
  const access = await buildTicketAccessPredicate(
      env,
      job.organization_id,
      actor,
    ),
    filter = cohort(input, access, actor);
  const tickets = rows(
    await db
      .prepare(
        `SELECT t.id FROM organization_tickets t WHERE ${filter.sql} AND t.id>? ORDER BY t.id LIMIT 5`,
      )
      .bind(job.organization_id, ...filter.values, job.cursor)
      .all(),
  );
  const caseReport = ["incidents", "causes"].includes(input.report);
  let csv =
      job.part_count === 0
        ? csvLine(caseReport ? [...CSV_HEADERS, "cases_json"] : CSV_HEADERS)
        : "",
    statements = [];
  for (const { id } of tickets) {
    const source = await sourceTicket(db, job.organization_id, id);
    if (caseReport)
      source.cases = await caseFactsForTicket(
        env,
        job.organization_id,
        actor,
        id,
      );
    const hash = await sha256(source),
      fact = projectMetricTicket(source, input, def),
      policies = source.policies.map((p) => p.version);
    // Additional source intervals retain provenance without exporting messages or internal notes.
    fact.cycles = source.cycles.map((c) => ({
      cycle: c.cycle_number,
      origin: c.origin,
      openedAt: c.opened_at,
      closedAt: c.closed_at,
    }));
    fact.waitIntervals = source.waits.map((w) => ({
      reason: w.reason,
      startedAt: w.started_at,
      endedAt: w.ended_at,
    }));
    fact.policyDefinitions = source.policies.map((p) => {
      const value = JSON.parse(p.policy_json);
      const { intervals, coverage, ...calendar } = value.calendar || {};
      return { version: p.version, ...value, calendar };
    });
    if (caseReport) fact.cases = source.cases;
    csv += ticketCsvRow(source.ticket, fact, def, policies, hash);
    statements.push(
      db
        .prepare(
          `INSERT INTO ticket_export_items(job_id,organization_id,ticket_id,fact_json,source_hash,domain,nature,policy_versions)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ticket_export_jobs WHERE ${fence}) AND (SELECT version FROM ticket_export_generation WHERE id=1)=?`,
        )
        .bind(
          job.id,
          job.organization_id,
          id,
          JSON.stringify(fact),
          hash,
          source.ticket.category,
          fact.nature,
          JSON.stringify(policies),
          job.id,
          job.token,
          stamp(),
          stamp(),
          job.generation,
        ),
    );
  }
  if (job.generation !== (await epoch(db)))
    throw exportError("SOURCE_CHANGED", 409);
  const bytes = new TextEncoder().encode(csv).length;
  if (bytes > 1048576 || job.bytes + bytes > config.maxBytes)
    throw exportError("BYTE_LIMIT", 422);
  const now = stamp(),
    addPart = csv.length > 0;
  if (addPart)
    statements.push(
      db
        .prepare(
          `INSERT INTO ticket_export_parts(id,job_id,organization_id,ordinal,csv,bytes,sha256)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ticket_export_jobs WHERE ${fence}) AND (SELECT version FROM ticket_export_generation WHERE id=1)=?`,
        )
        .bind(
          crypto.randomUUID(),
          job.id,
          job.organization_id,
          job.part_count,
          csv,
          bytes,
          await sha256(csv),
          job.id,
          job.token,
          now,
          now,
          job.generation,
        ),
    );
  statements.push(
    db
      .prepare(
        `UPDATE ticket_export_jobs SET cursor=?,captured_rows=captured_rows+?,part_count=part_count+?,bytes=bytes+?,state=?,updated_at=?,token=NULL,lease_until=NULL,attempts=0
    WHERE ${fence} AND (SELECT version FROM ticket_export_generation WHERE id=1)=?`,
      )
      .bind(
        tickets.at(-1)?.id || job.cursor,
        tickets.length,
        addPart ? 1 : 0,
        bytes,
        tickets.length < 5 ? "running" : "capturing",
        now,
        job.id,
        job.token,
        now,
        now,
        job.generation,
      ),
  );
  const result = await db.batch(statements);
  if (!result.at(-1).meta.changes)
    throw exportError("SOURCE_OR_LEASE_CHANGED", 409);
}

async function distribution(
  db,
  id,
  expression,
  from = "ticket_export_items i",
  condition = "1=1",
) {
  // Exact nearest-rank percentiles in SQLite: no in-memory global sort and no median-of-medians.
  return db
    .prepare(
      `WITH samples AS (SELECT ${expression} v FROM ${from} WHERE i.job_id=? AND (${condition})),
    ranked AS (SELECT v,ROW_NUMBER() OVER(ORDER BY v) r,COUNT(*) OVER() n FROM samples WHERE v IS NOT NULL AND v>=0)
    SELECT (SELECT COUNT(*) FROM samples) population,COUNT(*) observed,
      (SELECT COUNT(*) FROM samples WHERE v IS NULL) unknown,
      MAX(CASE WHEN r=CAST((n*50+99)/100 AS INTEGER) THEN v END) p50,
      MAX(CASE WHEN r=CAST((n*90+99)/100 AS INTEGER) THEN v END) p90,
      MAX(CASE WHEN r=CAST((n*95+99)/100 AS INTEGER) THEN v END) p95 FROM ranked`,
    )
    .bind(id)
    .first();
}
async function manifest(db, job) {
  const distributions = {};
  for (const key of [
    "response",
    "responseUseful",
    "age",
    "cycleAge",
    "wait",
    "total",
  ])
    distributions[key] = await distribution(
      db,
      job.id,
      `json_extract(i.fact_json,'$.${key}')`,
      "ticket_export_items i",
      key.startsWith("response") || key === "total"
        ? "json_extract(i.fact_json,'$.responseCohort')=1"
        : key === "age" || key === "cycleAge"
          ? "json_extract(i.fact_json,'$.open')=1"
          : "1=1",
    );
  for (const key of ["raw", "useful"])
    distributions["resolution_" + key] = await distribution(
      db,
      job.id,
      `json_extract(r.value,'$.${key}')`,
      "ticket_export_items i,json_each(i.fact_json,'$.resolution') r",
    );
  distributions.cycleTime = await distribution(
    db,
    job.id,
    "r.value",
    "ticket_export_items i,json_each(i.fact_json,'$.cycleTimes') r",
  );
  const totals = await db
    .prepare(
      `SELECT COUNT(*) tickets,COALESCE(SUM(json_extract(fact_json,'$.open')),0) backlog,
    COALESCE(SUM(json_extract(fact_json,'$.waiting')),0) waiting,COALESCE(SUM(json_extract(fact_json,'$.wip')),0) wip,
    COALESCE(SUM(json_array_length(fact_json,'$.resolution')),0) resolvedCycles,
    COALESCE(SUM(CASE WHEN json_extract(fact_json,'$.responseCohort')=1 THEN json_extract(fact_json,'$.responseCensored') ELSE 0 END),0) responseCensored,
    COALESCE(SUM(json_extract(fact_json,'$.reopening.numerator')),0) reopenNumerator,
    COALESCE(SUM(json_extract(fact_json,'$.reopening.denominator')),0) reopenDenominator,
    COALESCE(SUM(json_extract(fact_json,'$.reopening.unknown')),0) reopenUnknown,
    COALESCE(SUM(json_extract(fact_json,'$.reopening.immature')),0) reopenImmature,
    COALESCE(SUM(json_extract(fact_json,'$.quality.legacy')),0) legacy,
    COALESCE(SUM(json_extract(fact_json,'$.quality.correction') OR json_extract(fact_json,'$.quality.conflict')),0) corrections,
    COALESCE(MAX(json_extract(fact_json,'$.watermark')),0) watermark FROM ticket_export_items WHERE job_id=?`,
    )
    .bind(job.id)
    .first();
  const groups = rows(
    await db
      .prepare(
        "SELECT domain,nature,COUNT(*) tickets FROM ticket_export_items WHERE job_id=? GROUP BY domain,nature ORDER BY domain,nature",
      )
      .bind(job.id)
      .all(),
  );
  const policies = rows(
    await db
      .prepare(
        "SELECT DISTINCT p.value version FROM ticket_export_items i,json_each(i.policy_versions) p WHERE i.job_id=? ORDER BY p.value",
      )
      .bind(job.id)
      .all(),
  ).map((p) => p.version);
  // Bound deserialization before collecting distinct policy definitions into memory.
  const policyBudget = await db
    .prepare(
      "SELECT COALESCE(SUM(length(CAST(value AS BLOB))),0) bytes FROM (SELECT DISTINCT p.value value FROM ticket_export_items i,json_each(i.fact_json,'$.policyDefinitions') p WHERE i.job_id=?)",
    )
    .bind(job.id)
    .first();
  if (policyBudget.bytes > 512 * 1024) throw exportError("MANIFEST_LIMIT", 413);
  const policyDefinitions = rows(
    await db
      .prepare(
        "SELECT DISTINCT p.value value FROM ticket_export_items i,json_each(i.fact_json,'$.policyDefinitions') p WHERE i.job_id=? ORDER BY json_extract(p.value,'$.version')",
      )
      .bind(job.id)
      .all(),
  ).map((p) => JSON.parse(p.value));
  const parts = rows(
    await db
      .prepare(
        "SELECT ordinal,bytes,sha256 FROM ticket_export_parts WHERE job_id=? ORDER BY ordinal",
      )
      .bind(job.id)
      .all(),
  );
  const caseReport = ["incidents", "causes"].includes(
    JSON.parse(job.input_json).report,
  );
  const caseTotals = caseReport
    ? await db
        .prepare(
          `SELECT COUNT(DISTINCT json_extract(x.value,'$.id')) records, COUNT(*) relations, COUNT(DISTINCT CASE WHEN json_extract(x.value,'$.causeStatus')='unknown' THEN json_extract(x.value,'$.id') END) unknownCauses FROM ticket_export_items i,json_each(i.fact_json,'$.cases') x WHERE i.job_id=?`,
        )
        .bind(job.id)
        .first()
    : null;
  return {
    version: caseReport ? 2 : 1,
    snapshotId: job.id,
    capturedAt: job.created_at,
    sourceGeneration: job.generation,
    request: JSON.parse(job.input_json),
    definition: JSON.parse(job.definition_json),
    dictionary: METRIC_DICTIONARY,
    timeZone: "UTC",
    policyVersions: policies,
    policyDefinitions,
    dimensions: {
      domain: "current_category",
      nature: "current",
      assignee: "current",
    },
    consistency:
      "stable-source-generation; asOf projects captured history, not a historical database snapshot",
    csv: {
      encoding: "UTF-8",
      delimiter: ",",
      lineEnding: "CRLF",
      profile: "text-v1",
      strings:
        "remove one leading text: to decode strings; never evaluate decoded text as formulas",
      columns: caseReport ? [...CSV_HEADERS, "cases_json"] : CSV_HEADERS,
    },
    totals,
    distributions,
    groups,
    parts,
    expiresAt: job.expires_at,
    causes: caseReport
      ? {
          available: true,
          version: 1,
          grain:
            "one ticket per row; distinct authorized records in cases_json",
          population:
            "current authorized linked records captured consistently; historical asOf applies to ticket metrics only",
          ...caseTotals,
        }
      : {
          available: false,
          dependency: "select incidents or causes report with CC13 enabled",
        },
  };
}

export async function processExportStep(
  env,
  org,
  { storage = exportStorage(env), now = Date.now } = {},
) {
  await exportReady(env, org);
  const db = getDb(env),
    at = iso(now()),
    token = crypto.randomUUID();
  const job = await db
    .prepare(
      `UPDATE ticket_export_jobs SET token=?,lease_until=?,attempts=attempts+1,state=CASE WHEN state='queued' THEN 'capturing' ELSE state END
    WHERE id=(SELECT id FROM ticket_export_jobs WHERE organization_id=? AND state IN ('queued','capturing','running')
      AND expires_at>? AND (token IS NULL OR lease_until<=?) AND (next_at IS NULL OR next_at<=?) ORDER BY created_at,id LIMIT 1)
    RETURNING *`,
    )
    .bind(token, iso(now() + 60000), org, at, at, at)
    .first();
  if (!job) return { claimed: false };
  try {
    const config = JSON.parse(job.config_json);
    if (job.attempts > config.attempts)
      throw exportError("ATTEMPTS_EXHAUSTED", 422);
    await authorizeExportSnapshot(env, job, [
      "export.create",
      "export.view",
      "export.download",
    ]);
    if (job.state === "capturing") await captureStep(env, job);
    else {
      if (job.captured_rows !== job.expected_rows)
        throw exportError("INCOMPLETE", 422);
      const part = await db
        .prepare(
          "SELECT * FROM ticket_export_parts WHERE job_id=? AND state='pending' ORDER BY ordinal LIMIT 1",
        )
        .bind(job.id)
        .first();
      if (part) {
        const claim = await db
          .prepare(
            `UPDATE ticket_export_parts SET attempts=attempts+1,last_attempt_at=? WHERE id=? AND EXISTS(SELECT 1 FROM ticket_export_jobs WHERE ${fence}) RETURNING *`,
          )
          .bind(stamp(), part.id, job.id, job.token, stamp(), stamp())
          .first();
        if (!claim) throw exportError("LEASE_LOST", 409);
        await storage.put(part, new TextEncoder().encode(part.csv));
        await authorizeExportSnapshot(env, job, [
          "export.create",
          "export.view",
          "export.download",
        ]);
        const completed = stamp();
        await db.batch([
          db
            .prepare(
              `UPDATE ticket_export_parts SET state='ready' WHERE id=? AND EXISTS(SELECT 1 FROM ticket_export_jobs WHERE ${fence})`,
            )
            .bind(part.id, job.id, job.token, completed, completed),
          db
            .prepare(
              `UPDATE ticket_export_jobs SET token=NULL,lease_until=NULL,attempts=0,next_at=NULL,updated_at=? WHERE ${fence}`,
            )
            .bind(completed, job.id, job.token, completed, completed),
        ]);
      } else {
        const value = await manifest(db, job);
        value.manifestSha256 = await sha256(value);
        if (new TextEncoder().encode(JSON.stringify(value)).length > 1048576)
          throw exportError("MANIFEST_LIMIT", 422);
        await authorizeExportSnapshot(env, job, [
          "export.create",
          "export.view",
          "export.download",
        ]);
        const completed = stamp();
        await db.batch([
          db
            .prepare(
              `UPDATE ticket_export_jobs SET state='ready',manifest_json=?,token=NULL,lease_until=NULL,updated_at=? WHERE ${fence}`,
            )
            .bind(
              JSON.stringify(value),
              completed,
              job.id,
              job.token,
              completed,
              completed,
            ),
          db
            .prepare(
              "INSERT INTO ticket_export_audit(job_id,organization_id,actor_id,action,created_at) SELECT id,organization_id,actor_id,'ready',? FROM ticket_export_jobs WHERE id=? AND state='ready'",
            )
            .bind(completed, job.id),
        ]);
      }
    }
    return { claimed: true };
  } catch (error) {
    const fatal =
      String(error.code || "").startsWith("TICKET_EXPORT_") &&
      !["TICKET_EXPORT_ACCESS_CHANGED", "TICKET_EXPORT_LEASE_LOST"].includes(
        error.code,
      );
    const revoked = error.status === 404 || error.status === 403;
    const failed =
      fatal || revoked || job.attempts >= JSON.parse(job.config_json).attempts;
    const retryMs = Math.max(
      1000,
      Number(error.details?.retryAfterMs) || 0,
      Math.min(60000, 1000 * 2 ** job.attempts),
    );
    const completed = stamp();
    await db
      .prepare(
        `UPDATE ticket_export_jobs SET state=?,error_code=?,token=NULL,lease_until=NULL,next_at=?,updated_at=? WHERE ${fence}`,
      )
      .bind(
        revoked ? "revoked" : failed ? "failed" : job.state,
        revoked
          ? "ACCESS_REVOKED"
          : String(error.code || "WORKER_RETRY").replace(/^TICKET_EXPORT_/, ""),
        iso(Date.now() + retryMs),
        completed,
        job.id,
        job.token,
        completed,
        completed,
      )
      .run();
    return { claimed: true, failed, revoked };
  }
}

export async function cleanupTicketExports(
  env,
  org,
  { storage = exportStorage(env) } = {},
) {
  const db = getDb(env),
    now = stamp();
  await db
    .prepare(
      "UPDATE ticket_export_jobs SET state='expired',token=NULL WHERE organization_id=? AND expires_at<=? AND state NOT IN ('expired','cancelled','revoked')",
    )
    .bind(org, now)
    .run();
  // Wait beyond the maximum lease/provider request before deleting an attempted part.
  // Repeating removal is safe after crashes; keep the durable intent until confirmed.
  const candidates = rows(
    await db
      .prepare(
        `SELECT p.* FROM ticket_export_parts p JOIN ticket_export_jobs j ON j.id=p.job_id
    WHERE j.organization_id=? AND j.state IN ('expired','cancelled','revoked','failed') AND (p.last_attempt_at IS NULL OR p.last_attempt_at<?)
    ORDER BY j.created_at,p.ordinal LIMIT 10`,
      )
      .bind(org, iso(Date.now() - 300000))
      .all(),
  );
  let removed = 0;
  for (const part of candidates) {
    try {
      await storage.remove(part);
      // Keep a metadata-only tombstone: a suspended stale worker can finish after
      // cleanup. Periodic deletion of the deterministic path reconciles such orphans.
      await db.batch([
        db
          .prepare(
            "INSERT OR IGNORE INTO ticket_export_gc(id,job_id,organization_id,next_at) VALUES(?,?,?,?)",
          )
          .bind(
            part.id,
            part.job_id,
            part.organization_id,
            iso(Date.now() + 86400000),
          ),
        db.prepare("DELETE FROM ticket_export_parts WHERE id=?").bind(part.id),
      ]);
      removed++;
    } catch {
      /* Durable part remains for next scheduled cleanup; no provider payload in logs. */
    }
  }
  const tombstones = rows(
    await db
      .prepare(
        "SELECT * FROM ticket_export_gc WHERE organization_id=? AND next_at<=? ORDER BY next_at,id LIMIT 10",
      )
      .bind(org, now)
      .all(),
  );
  for (const part of tombstones) {
    try {
      await storage.remove(part);
      await db
        .prepare("UPDATE ticket_export_gc SET next_at=? WHERE id=?")
        .bind(iso(Date.now() + 86400000), part.id)
        .run();
    } catch {
      /* Retry the retained intent. */
    }
  }
  const jobs = rows(
    await db
      .prepare(
        `SELECT id FROM ticket_export_jobs j WHERE organization_id=?
    AND ((expires_at<=? AND input_json<>'{}') OR (state IN ('cancelled','revoked') AND EXISTS(SELECT 1 FROM ticket_export_items i WHERE i.job_id=j.id)))
    ORDER BY created_at LIMIT 20`,
      )
      .bind(org, now)
      .all(),
  );
  for (const job of jobs)
    await db.batch([
      db
        .prepare(
          "DELETE FROM ticket_export_items WHERE job_id=? AND EXISTS(SELECT 1 FROM ticket_export_jobs WHERE id=? AND (expires_at<=? OR state IN ('cancelled','revoked')))",
        )
        .bind(job.id, job.id, now),
      db
        .prepare(
          "UPDATE ticket_export_jobs SET input_json='{}',definition_json='{}',manifest_json=NULL WHERE id=? AND expires_at<=?",
        )
        .bind(job.id, now),
    ]);
  return { removed };
}

async function boundedBytes(response, maxBytes) {
  if (!response.ok || !response.body) throw exportError("STORAGE_READ", 503);
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw exportError("STORAGE_INTEGRITY", 503);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
export async function downloadTicketExport(
  env,
  org,
  actor,
  id,
  { storage = exportStorage(env), reauthenticate = async () => {} } = {},
) {
  const job = await owned(env, org, actor, id, [
    "export.view",
    "export.download",
  ]);
  if (job.state !== "ready") throw exportError("NOT_READY", 409);
  await authorizeExportSnapshot(env, job, ["export.view", "export.download"]);
  const db = getDb(env),
    parts = rows(
      await db
        .prepare(
          "SELECT id,job_id,organization_id,ordinal,bytes,sha256 FROM ticket_export_parts WHERE job_id=? AND state='ready' ORDER BY ordinal",
        )
        .bind(id)
        .all(),
    );
  if (
    parts.length !== job.part_count ||
    parts.reduce((n, p) => n + p.bytes, 0) !== job.bytes
  )
    throw exportError("INCOMPLETE", 503);
  let index = 0,
    cancelled = false;
  const stream = new ReadableStream(
    {
      async pull(controller) {
        try {
          if (cancelled) return;
          await reauthenticate();
          await authorizeExportSnapshot(env, job, [
            "export.view",
            "export.download",
          ]);
          if (index === parts.length) {
            await audit(db, job, "download_completed").run();
            controller.close();
            return;
          }
          const part = parts[index++],
            bytes = await boundedBytes(await storage.get(part), part.bytes);
          if (
            bytes.length !== part.bytes ||
            (await sha256(bytes)) !== part.sha256
          )
            throw exportError("STORAGE_INTEGRITY", 503);
          await reauthenticate();
          await authorizeExportSnapshot(env, job, [
            "export.view",
            "export.download",
          ]);
          if (!cancelled) controller.enqueue(bytes);
        } catch (error) {
          if (!cancelled) controller.error(error);
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  await audit(db, job, "download_started").run();
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chamados-${job.id}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(job.bytes),
    },
  });
}
