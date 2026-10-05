import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createTicketCommandDb,
  COMMAND_ACTORS,
} from "./helpers/ticket-command-db.mjs";
import {
  executeChangeCommand,
  listTicketChanges,
  authorizeChangeRecord,
  changesReady,
} from "../functions/_lib/ticket-changes.js";
import { transitionRequestLifecycle } from "../functions/_lib/project-change-request-lifecycle.js";
import { resolveChangeProjectContext } from "../functions/_lib/change-project-context.js";
import {
  bindApplyArtifact,
  readApplyArtifact,
} from "../functions/_lib/project-change-request-apply-artifact.js";
import { onRequest } from "../functions/api/organizations/[id]/tickets/[ticketId]/changes.js";
const sql = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const admin = { id: 1, role: "super_admin", activeOrganizationId: 1 };
async function fixture(t) {
  const db = await createTicketCommandDb(t);
  for (const f of [
    "0027_ticket_selective_access.sql",
    "0028_ticket_conversations.sql",
    "0030_ticket_notifications.sql",
    "0031_ticket_change_reconciliation.sql",
  ])
    db.sqlite.exec(sql("migrations/" + f));
  Object.assign(db.env, {
    MAONO_TICKET_CHANGES_ENABLED: "true",
    MAONO_RUNTIME_ENV: "local",
    MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: "true",
  });
  db.sqlite
    .exec(`INSERT INTO organization_tickets(id,organization_id,code,subject,description,created_by) VALUES(1,1,'CC08-A','Chamado','Teste',1),(2,2,'CC08-B','Outro','Teste',4),(3,1,'CC08-C','Segundo','Teste',1);
 INSERT INTO projects(id,organization_id,name,slug,dropbox_root_path)VALUES(1,1,'Mapa','mapa','/mapa'),(2,2,'Outro','outro','/outro');
 INSERT INTO user_projects(project_id,user_id,access_level)VALUES(1,1,'owner'),(1,2,'viewer'),(2,1,'owner');
 INSERT INTO project_change_requests(id,organization_id,project_id,requested_by_user_id,ticket_id,base_revision,status,reason,idempotency_key,submission_hash)
 VALUES('cr-a',1,1,2,1,1,'submitted','Proposta','a','a');`);
  return db;
}
const create = {
  action: "create",
  domain: "platform",
  title: "Alteração externa",
  proposal: "Proposta justificada",
};
const command = (db, input, key = "key", user = admin, ticket = 1) =>
  executeChangeCommand(db.env, 1, ticket, user, input, key);
test("CC08 fresh schema and upgrade preserve integrity and never close Ticket", async (t) => {
  const db = await fixture(t);
  assert.equal(db.rows("change_records").length, 1);
  assert.equal(db.row(1).status, "new");
  assert.equal(db.sqlite.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.deepEqual(db.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  const fresh = new DatabaseSync(":memory:");
  t.after(() => fresh.close());
  fresh.exec(sql("schema.sql"));
  assert.equal(
    fresh.prepare("SELECT version FROM cc08_schema").get().version,
    1,
  );
});
test("CC08 OFF and Preview fail closed", async (t) => {
  assert.equal(await changesReady({}), false);
  const db = await fixture(t);
  db.env.MAONO_RUNTIME_ENV = "preview";
  await assert.rejects(
    () => changesReady(db.env),
    (e) => e.code === "CHANGE_RUNTIME_DENIED",
  );
});
test("CT27 generic create is idempotent and divergent key is denied", async (t) => {
  const db = await fixture(t);
  const a = await command(db, create);
  const b = await command(db, create);
  assert.equal(a.recordId, b.recordId);
  assert.equal(b.replayed, true);
  await assert.rejects(
    () => command(db, { ...create, title: "Diferente" }),
    (e) => e.code === "CHANGE_IDEMPOTENCY_CONFLICT",
  );
});
test("CT27 platform/database requires superadmin and never runs external evidence", async (t) => {
  const db = await fixture(t);
  await assert.rejects(
    () => command(db, create, "key", COMMAND_ACTORS.owner),
    (e) => e.status === 403,
  );
});
test("CT27 request information, versioned resubmit, planning, approval and delivery are distinct", async (t) => {
  const db = await fixture(t);
  const { recordId } = await command(db, create);
  let version = 1;
  for (const action of [
    "request_information",
    "resubmit",
    "plan",
    "approve",
    "deliver",
  ]) {
    const result = await command(
      db,
      {
        action,
        recordId,
        version,
        feedback: "Decisão explícita",
        proposal: "Proposta revisada",
        evidenceUrl: "https://github.com/example/pull/1",
      },
      action,
    );
    version++;
    assert.equal(result.version, version);
  }
  assert.equal(
    db.rows("change_record_events").filter((x) => x.record_id === recordId)
      .length,
    6,
  );
  assert.equal(db.row(1).status, "new");
});
test("generic stale CAS rolls back command and history", async (t) => {
  const db = await fixture(t);
  const { recordId } = await command(db, create);
  const snapshot = db.snapshot();
  await assert.rejects(
    () =>
      command(
        db,
        { action: "approve", recordId, version: 5, feedback: "Aprovar" },
        "stale",
      ),
    (e) => e.code === "CHANGE_VERSION_CONFLICT",
  );
  assert.deepEqual(db.snapshot(), snapshot);
});
test("generic batch failure rolls back record/link/history/idempotency", async (t) => {
  const db = await fixture(t);
  const snapshot = db.snapshot();
  db.failNextBatchAt(2);
  await assert.rejects(() => command(db, create));
  assert.deepEqual(db.snapshot(), snapshot);
});
test("CT26 link grants no Review/Apply; owner of request has project view only", async (t) => {
  const db = await fixture(t);
  const record = db.rows("change_records")[0];
  const access = await authorizeChangeRecord(
    db.env,
    record,
    COMMAND_ACTORS.peer,
  );
  assert.equal(access.canReview, false);
  assert.equal(access.canApply, false);
});
test("CT26 explicit project context requires real membership and never changes session object", async (t) => {
  const db = await fixture(t);
  const user = { ...COMMAND_ACTORS.owner };
  const before = { ...user };
  const result = await resolveChangeProjectContext(db.env, user, "outro");
  assert.equal(result.project?.id, 2);
  assert.deepEqual(user, before);
  db.sqlite.exec(
    "DELETE FROM organization_users WHERE user_id=1 AND organization_id=2",
  );
  assert.equal(
    (await resolveChangeProjectContext(db.env, user, "outro")).project,
    null,
  );
});
test("cross organization link denied before mutation", async (t) => {
  const db = await fixture(t);
  await assert.rejects(
    () =>
      executeChangeCommand(
        db.env,
        2,
        2,
        admin,
        { action: "link", recordId: "cr:cr-a" },
        "x",
      ),
    (e) => e.status === 404,
  );
});
test("link unlink history and stale link CAS", async (t) => {
  const db = await fixture(t);
  await command(
    db,
    { action: "unlink", recordId: "cr:cr-a", linkVersion: 1 },
    "unlink",
  );
  assert.equal(db.rows("ticket_change_links")[0].active, 0);
  await assert.rejects(
    () =>
      command(
        db,
        { action: "link", recordId: "cr:cr-a", linkVersion: 1 },
        "stale",
      ),
    (e) => e.code === "CHANGE_VERSION_CONFLICT",
  );
  await command(
    db,
    { action: "link", recordId: "cr:cr-a", linkVersion: 2 },
    "restore",
  );
  assert.equal(db.rows("ticket_change_link_events").length, 3);
});
test("CT28 reconciliation repeated converges and notification intent is once", async (t) => {
  const db = await fixture(t);
  await command(db, { action: "reconcile", recordId: "cr:cr-a" }, "r1");
  await command(db, { action: "reconcile", recordId: "cr:cr-a" }, "r2");
  assert.equal(db.rows("ticket_command_outbox").length, 1);
  assert.equal(db.row(1).status, "new");
});
test("CT28 divergence is recorded, not overwritten", async (t) => {
  const db = await fixture(t);
  db.sqlite.exec("UPDATE ticket_change_links SET source_version=99");
  await assert.rejects(
    () => command(db, { action: "reconcile", recordId: "cr:cr-a" }),
    (e) => e.code === "CHANGE_SOURCE_DIVERGENCE",
  );
  assert.equal(
    db.rows("ticket_change_links")[0].divergence,
    "SOURCE_VERSION_DIVERGENCE",
  );
});
test("CT29 CR applied preserves ticket and canonical revision immutable", async (t) => {
  const db = await fixture(t);
  let row = db.rows("project_change_requests")[0];
  for (const next of ["under_review", "approved", "applying", "applied"])
    row = await transitionRequestLifecycle(db.env.DB, row, row.status, next, {
      actor: admin,
      appliedRevision: 2,
    });
  assert.equal(db.row(1).status, "new");
  assert.equal(db.rows("project_change_requests")[0].applied_revision, 2);
  assert.throws(() =>
    db.sqlite.exec("UPDATE project_change_requests SET applied_revision=7"),
  );
  assert.equal(db.rows("project_change_request_events").length, 5);
});
test("CR stale transition produces no journal event", async (t) => {
  const db = await fixture(t);
  const row = db.rows("project_change_requests")[0];
  await transitionRequestLifecycle(
    db.env.DB,
    row,
    "submitted",
    "under_review",
    { actor: admin },
  );
  assert.equal(
    await transitionRequestLifecycle(
      db.env.DB,
      row,
      "submitted",
      "under_review",
      { actor: admin },
    ),
    null,
  );
  assert.equal(db.rows("project_change_request_events").length, 2);
});
test("approved artifact identity bound and body manifest cannot swap", async (t) => {
  const db = await fixture(t);
  const context = {
    db: db.env.DB,
    user: admin,
    row: db.rows("project_change_requests")[0],
  };
  const input = {
    checksum: "a".repeat(64),
    sizeBytes: 90 * 1024 * 1024,
    baseRevision: 1,
    version: 0,
  };
  await bindApplyArtifact(context, input);
  await assert.rejects(
    () => bindApplyArtifact(context, { ...input, checksum: "b".repeat(64) }),
    (e) => e.code === "CHANGE_REQUEST_APPLY_ARTIFACT_CONFLICT",
  );
  await assert.rejects(
    () => readApplyArtifact(context, new Request("https://local/apply")),
    (e) => e.code === "CHANGE_REQUEST_APPLY_ARTIFACT_CONFLICT",
  );
});
test("HTTP cross-origin denied without DB access", async () => {
  const response = await onRequest({
    env: {},
    params: { id: "1", ticketId: "1" },
    request: new Request("https://maono.test/api", {
      method: "POST",
      headers: {
        Origin: "https://other.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  });
  assert.equal(response.status, 403);
});
test("private ticket hides all linked content after revocation", async (t) => {
  const db = await fixture(t);
  db.sqlite.exec(
    "UPDATE organization_tickets SET visibility='private' WHERE id=1",
  );
  await assert.rejects(
    () => listTicketChanges(db.env, 1, 1, COMMAND_ACTORS.peer),
    (e) => e.status === 404,
  );
});

test("idempotency key cannot silently target a different ticket", async (t) => {
  const db = await fixture(t);
  await command(db, create);
  await assert.rejects(
    () => command(db, create, "key", admin, 3),
    (e) => e.code === "CHANGE_IDEMPOTENCY_CONFLICT",
  );
});
test("CT29 closing with active linked general change requires explicit acknowledgement", async (t) => {
  const db = await fixture(t);
  await command(db, create);
  assert.throws(
    () =>
      db.sqlite.exec(
        "UPDATE organization_tickets SET status='closed' WHERE id=1",
      ),
    /TICKET_PENDING_CHANGE_ACK_REQUIRED/,
  );
  db.sqlite.exec(
    `UPDATE organization_tickets SET status='closed',closure_json='{"pendingChangeAcknowledged":true}' WHERE id=1`,
  );
  assert.equal(db.row(1).status, "closed");
});
test("CR feedback blocks approval and authorized resubmission preserves lineage atomically", async (t) => {
  const { requestChangeInformation, resubmissionStatements } = await import(
    "../functions/_lib/project-change-request-feedback.js"
  );
  const db = await fixture(t);
  let row = db.rows("project_change_requests")[0];
  await requestChangeInformation(
    { db: db.env.DB, row, user: admin },
    "Explique melhor",
  );
  // Even transitioning to under_review cannot bypass the request for information.
  row = await transitionRequestLifecycle(
    db.env.DB,
    row,
    "submitted",
    "under_review",
    { actor: admin },
  );
  assert.throws(() =>
    db.sqlite.exec(
      "UPDATE project_change_requests SET status='approved',decision='approved',lifecycle_version=lifecycle_version+1 WHERE id='cr-a'",
    ),
  );
  // An authorized new proposal is immutable; supersession and linkage are a batch.
  await requestChangeInformation(
    { db: db.env.DB, row, user: admin },
    "Explique melhor",
  );
  const createNext = db.env.DB.prepare(
    `INSERT INTO project_change_requests(id,organization_id,project_id,requested_by_user_id,base_revision,status,reason,idempotency_key,submission_hash) VALUES('cr-next',1,1,2,1,'submitted','Complemento','next','next')`,
  );
  const statements = await resubmissionStatements(
    db.env,
    COMMAND_ACTORS.peer,
    { id: 1, organization_id: 1 },
    { supersedes: "cr-a" },
    "cr-next",
  );
  await db.env.DB.batch([createNext, ...statements]);
  assert.equal(db.rows("project_change_requests")[0].status, "superseded");
  assert.equal(db.rows("project_change_request_lineage")[0].next_id, "cr-next");
  assert.equal(db.row(1).status, "new");
});
test("CT52 streamed90MiB publishes an approved artifact through durable receipt and lineage",async t=>{
 const {persistenceFixture}=await import('./helpers/project-persistence-fixture.mjs');
 const {config,create,request,parse}=await import('./helpers/durable-project-http.mjs');
 const {dropboxContentHashHex}=await import('../functions/_lib/dropbox-content-hash.js');
 const {onRequest:apply}=await import('../functions/api/projects/[slug]/change-requests/[id]/apply.js');
 const f=persistenceFixture(t);
 assert.equal((await create(f)).status,200);
 f.env.MAONO_TICKET_CHANGES_ENABLED='true';
 const map={...config('approved90MiB'),padding:'x'.repeat(90*1024*1024)};
 const bytes=new TextEncoder().encode(JSON.stringify(map)),checksum=await dropboxContentHashHex(bytes);
 f.db.prepare(`INSERT INTO project_change_requests(id,organization_id,project_id,requested_by_user_id,base_revision,status,reason,idempotency_key,submission_hash,decision,lifecycle_version,decided_by_user_id)
 VALUES('ct52-large',1,1,1,1,'approved','Synthetic90MiB','ct52-large','ct52-large','approved',1,1)`).run();
 f.db.prepare('INSERT INTO project_change_request_apply_artifacts(change_request_id,checksum,size_bytes,base_revision,approved_by) VALUES(?,?,?,?,?)').run('ct52-large',checksum,bytes.length,1,1);
 let offset=0;
 const stream=new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}const end=Math.min(offset+65536,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end;}});
 const response=await parse(await apply({env:f.env,params:{slug:f.project().slug,id:'ct52-large'},request:request(f,'/api/projects/'+f.project().slug+'/change-requests/ct52-large/apply',{method:'POST',body:stream,headers:{
   'Content-Type':'application/vnd.maono.map-config+json','X-Maono-Large-Config':'1','X-Maono-Expected-Revision':'1','X-Maono-Config-Size':String(bytes.length),'X-Maono-Config-Checksum':checksum,'X-Maono-Config-Version':String(map.version),'X-Maono-Dataset-Count':String(map.datasets.length),
 }})}));
 assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.appliedRevision,2);
 assert.equal(response.data.operation.state,'PUBLISHED');
 assert.equal(f.ledger(1,2).transition_id,'cc08:ct52-large');assert.ok(f.ledger(1,2).save_operation_id);
 assert.equal(f.ledger(1,2).checksum,checksum);assert.ok(f.ledger(1,2).published_at);
 const chunks=f.calls.filter(x=>x.op.startsWith('upload_session/'));
 assert.ok(chunks.length>20);assert.ok(chunks.every(x=>x.size<=4*1024*1024));
});

test("consumer OFF does no DB work; scope and runtime mandatory", async (t) => {
  const { consumeChangeReconciliations } = await import(
    "../functions/_lib/ticket-changes.js"
  );
  assert.deepEqual(await consumeChangeReconciliations({}), {
    enabled: false,
    processed: 0,
  });
  const db = await fixture(t);
  db.env.MAONO_CHANGE_RECONCILIATION_ENABLED = "true";
  await assert.rejects(
    () => consumeChangeReconciliations(db.env),
    (e) => e.code === "CHANGE_RECONCILIATION_SCOPE_REQUIRED",
  );
});
test("consumer batches new progress once and requires an active operator", async (t) => {
  const { consumeChangeReconciliations } = await import(
    "../functions/_lib/ticket-changes.js"
  );
  const db = await fixture(t);
  db.sqlite.exec("UPDATE users SET role='super_admin' WHERE id=1");
  Object.assign(db.env, {
    MAONO_CHANGE_RECONCILIATION_ENABLED: "true",
    MAONO_CHANGE_RECONCILIATION_ORGANIZATION_IDS: "1",
    MAONO_CHANGE_RECONCILIATION_ACTOR_ID: "1",
  });
  assert.equal((await consumeChangeReconciliations(db.env)).processed, 1);
  assert.equal((await consumeChangeReconciliations(db.env)).processed, 0);
  assert.equal(db.rows("ticket_command_outbox").length, 1);
});
test("reconciliation failure is retained with bounded retry and privileged reprocess", async (t) => {
  const { consumeChangeReconciliations } = await import(
    "../functions/_lib/ticket-changes.js"
  );
  const db = await fixture(t);
  db.sqlite.exec("UPDATE users SET role='super_admin' WHERE id=1");
  Object.assign(db.env, {
    MAONO_CHANGE_RECONCILIATION_ENABLED: "true",
    MAONO_CHANGE_RECONCILIATION_ORGANIZATION_IDS: "1",
    MAONO_CHANGE_RECONCILIATION_ACTOR_ID: "1",
  });
  db.failNextBatchAt(3);
  assert.equal((await consumeChangeReconciliations(db.env)).failed, 1);
  assert.equal(db.rows("ticket_command_outbox").length, 0);
  assert.equal(db.rows("ticket_change_links")[0].reconcile_attempts, 1);
  assert.equal((await consumeChangeReconciliations(db.env)).processed, 0);
  await command(
    db,
    { action: "retry_reconcile", recordId: "cr:cr-a" },
    "retry",
  );
  assert.equal((await consumeChangeReconciliations(db.env)).processed, 1);
});
test("published canonical artifact recovery uses original revision even after later head", async (t) => {
  const { recoverAppliedArtifact } = await import(
    "../functions/_lib/project-change-request-apply-artifact.js"
  );
  const db = await fixture(t);
  let row = db.rows("project_change_requests")[0];
  for (const next of ["under_review", "approved", "applying"])
    row = await transitionRequestLifecycle(db.env.DB, row, row.status, next, {
      actor: admin,
    });
  await db.env.DB.prepare(
    "INSERT INTO project_change_request_apply_artifacts(change_request_id,checksum,size_bytes,base_revision,approved_by)VALUES(?,?,?,?,?)",
  )
    .bind(row.id, "a".repeat(64), 90, 1, 1)
    .run();
  const query = async (sql) => {
    if (sql.includes("project_config_revisions"))
      return {
        status: "READY",
        checksum: "a".repeat(64),
        size_bytes: 90,
        published_at: "2026-01-01",
        transition_id: "cc08:cr-a",
      };
    return null;
  };
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          first() {
            return query(sql);
          },
        };
      },
    },
  };
  assert.deepEqual(
    await recoverAppliedArtifact(env, {
      db: db.env.DB,
      row,
      project: { id: 1, config_revision: 8 },
    }),
    { revision: 2 },
  );
});

test("production0031 preflight blocks pending0020 and historical lifecycle expansion", async () => {
  const { evaluateCC08Schema } = await import(
    "../scripts/migrations/cc08-schema-preflight.mjs"
  );
  const empty = evaluateCC08Schema([], []);
  assert.equal(empty.compatible, false);
  assert.ok(empty.missingLedger.includes("0020_project_change_requests.sql"));
  const legacy = evaluateCC08Schema(
    [
      {
        name: "project_change_requests",
        sql: "CREATE TABLE project_change_requests(lifecycle_version INTEGER,applied_revision INTEGER)",
      },
    ],
    [],
  );
  assert.equal(legacy.hasLegacyExpansion, true);
  assert.equal(legacy.compatible, false);
});


test("production0031 query inventories the complete0020 schema without false missing operations", async () => {
  const { CC08_SCHEMA_QUERY, evaluateCC08Schema } = await import("../scripts/migrations/cc08-schema-preflight.mjs");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(sql("migrations/0020_project_change_requests.sql"));
    const objects = db.prepare(CC08_SCHEMA_QUERY).all();
    for (const name of ["project_change_operations", "idx_project_change_operations_request", "trg_project_change_operations_no_update", "trg_project_change_operations_no_direct_delete"]) {
      assert.ok(objects.some(row => row.name === name), name);
    }
    const ledger = ["0020_project_change_requests.sql", "0026_ticket_command_lifecycle.sql", "0027_ticket_selective_access.sql", "0028_ticket_conversations.sql", "0030_ticket_notifications.sql"].map(name => ({name}));
    const ready = evaluateCC08Schema(objects, ledger);
    assert.equal(ready.compatible, true);
    assert.deepEqual(ready.missingObjects, []);
    assert.deepEqual(ready.missingColumns, []);
    const pending = evaluateCC08Schema(objects, ledger.slice(1));
    assert.equal(pending.compatible, false);
    assert.deepEqual(pending.missingLedger, ["0020_project_change_requests.sql"]);
    assert.deepEqual(pending.missingObjects, []);
    db.exec("DROP TRIGGER trg_project_change_operations_no_update");
    const missing = evaluateCC08Schema(db.prepare(CC08_SCHEMA_QUERY).all(), ledger);
    assert.equal(missing.compatible, false);
    assert.deepEqual(missing.missingObjects, ["trg_project_change_operations_no_update"]);
    assert.notEqual(missing.digest, ready.digest);
  } finally { db.close(); }
});
