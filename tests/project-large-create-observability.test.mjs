import assert from "node:assert/strict";
import test from "node:test";
import { reconcileProjectSaveOperations } from "../functions/_lib/project-save-operations.js";
import { persistenceFixture, interruption } from "./helpers/project-persistence-fixture.mjs";
import { config,create,readyForRetry,status } from "./helpers/durable-project-http.mjs";

test("creation audit records operational identifiers and receipt without map bytes or session secrets",async t=>{
  const f=persistenceFixture(t),map={...config("PRIVATE_MAP_DATA_DO_NOT_LOG"),privateNotes:"PRIVATE_EXTRA_SENTINEL"};
  const created=await create(f,map);
  await reconcileProjectSaveOperations(f.env);
  const rows=f.db.prepare("SELECT action,details FROM audit_logs").all();
  assert.ok(rows.some(row=>row.action==="project_create_reserved"));
  const commit=rows.find(row=>row.action==="project.save.durable");assert.ok(commit);
  const audit=JSON.parse(commit.details);
  assert.equal(audit.metadata.operationId,created.registered.input.operationId);
  assert.equal(audit.metadata.revision,1);
  const serialized=JSON.stringify(rows);
  for(const sensitive of ["PRIVATE_MAP_DATA_DO_NOT_LOG","PRIVATE_EXTRA_SENTINEL","offline-session-1","offline-provider-fixture-only"])
    assert.equal(serialized.includes(sensitive),false,`audit must omit ${sensitive}`);
});

test("audit failure stays in its own outbox and cannot undo a published receipt",async t=>{
  let fail=true;
  const f=persistenceFixture(t,{beforeSql({sql}){if(fail&&sql.includes("INSERT INTO audit_logs")&&sql.includes("project.save.durable"))throw interruption();}});
  const created=await create(f);
  await reconcileProjectSaveOperations(f.env);
  const audit=f.db.prepare("SELECT * FROM project_save_outbox WHERE effect='AUDIT'").get();
  assert.equal(audit.state,"PENDING");assert.equal(audit.attempts,1);
  assert.equal(f.project().config_revision,1);
  assert.deepEqual((await status(f,created.registered.input.operationId)).data.operation.receipt,created.data.operation.receipt);
  fail=false;readyForRetry(f);await reconcileProjectSaveOperations(f.env);
  assert.equal(f.db.prepare("SELECT state FROM project_save_outbox WHERE effect='AUDIT'").get().state,"DONE");
  await reconcileProjectSaveOperations(f.env);
  assert.equal(f.db.prepare("SELECT count(*) n FROM audit_logs WHERE action='project.save.durable'").get().n,1);
});
