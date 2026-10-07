import assert from "node:assert/strict";
import test from "node:test";
import { isProjectCreationAdmissionEnabled } from "../functions/_lib/project-creation-reservation.js";
import { reconcileProjectSaveOperations } from "../functions/_lib/project-save-operations.js";
import { persistenceFixture, interruption } from "./helpers/project-persistence-fixture.mjs";
import {config,reserve,create,register,upload,status,readyForRetry} from "./helpers/durable-project-http.mjs";

test("durable create admission is fail-closed and accepts only explicit true",()=>{
  for(const value of [undefined,null,"","false","FALSE","0","yes","on"]) assert.equal(isProjectCreationAdmissionEnabled({PROJECT_DURABLE_SAVE_V1:value}),false);
  for(const value of [true,"true","TRUE"," true "]) assert.equal(isProjectCreationAdmissionEnabled({PROJECT_DURABLE_SAVE_V1:value}),true);
});

test("reservation replay reuses the same project and rejects different title, description or organization",async t=>{
  const f=persistenceFixture(t);
  assert.equal((await reserve(f)).status,202);
  const retry=await reserve(f);assert.equal(retry.status,202);assert.equal(retry.data.idempotent,true);
  for(const body of [{name:"Different name"},{description:"Different description"}]){
    const mismatch=await reserve(f,config("initial"),{body});assert.equal(mismatch.status,409);assert.equal(mismatch.data.error.code,"PROJECT_CREATION_REQUEST_MISMATCH");
  }
  const crossOrg=await reserve(f,config("initial"),{body:{organizationId:2}});
  assert.equal(crossOrg.status,403);assert.equal(crossOrg.data.error.code,"ORGANIZATION_CONTEXT_MISMATCH");
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM organization_resource_reservations").get().n,1);
});

test("operation ID cannot be rebound to different bytes or expected revision",async t=>{
  const f=persistenceFixture(t);await reserve(f);
  assert.equal((await register(f,config("initial"),{key:"offline-create-0001"})).status,201);
  for(const [map,input] of [[config("tampered"),{}],[config("initial"),{expectedConfigRevision:1}]]) {
    const mismatch=await register(f,map,{key:"offline-create-0001",input});
    if(input.expectedConfigRevision === 1) { assert.equal(mismatch.status,400); assert.equal(mismatch.data.error.code,"PROJECT_CREATION_REVISION_INVALID"); }
    else { assert.equal(mismatch.status,409);assert.equal(mismatch.data.error.code,"OPERATION_PAYLOAD_MISMATCH"); }
  }
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_save_operations").get().n,1);
  assert.equal(f.objects.size,0);
});

test("creation key ownership, foreign account and viewer boundaries prevent upload and receipt disclosure",async t=>{
  const f=persistenceFixture(t),created=await create(f);
  const wrongKey=await upload(f,created.registered,{key:"wrong-creation-0001"});
  assert.equal(wrongKey.status,403);
  const other=await status(f,created.registered.input.operationId,{userId:2});
  assert.ok([403,404].includes(other.status));
  assert.equal(other.data.operation,undefined);
  f.db.prepare("UPDATE users SET role='viewer' WHERE id=1").run();
  const viewer=await reserve(f,config("viewer"),{key:"viewer-creation-0001"});
  assert.equal(viewer.status,403);assert.equal(viewer.data.error.code,"VIEWER_PROJECT_CREATE_FORBIDDEN");
  const write=await register(f,config("viewer"),{kind:"update",expected:1,operationId:"viewer-operation-0001"});
  assert.equal(write.status,403);
  assert.equal(f.project().config_revision,1);
});

test("paused admission denies new reservations but resumes accepted creation and serves its receipt",async t=>{
  const f=persistenceFixture(t);await reserve(f);
  const operation=await register(f,config("initial"),{key:"offline-create-0001"});
  f.env.PROJECT_DURABLE_SAVE_V1="false";
  const denied=await reserve(f,config("another"),{key:"another-create-0001",name:"Another map"});
  assert.equal(denied.status,503);assert.equal(denied.data.error.code,"PROJECT_DURABLE_SAVE_ADMISSION_PAUSED");
  const retry=await reserve(f);assert.equal(retry.status,202);
  const saved=await upload(f,operation,{key:"offline-create-0001"});assert.equal(saved.data.operation.state,"PUBLISHED");
  assert.equal((await status(f,operation.input.operationId)).data.operation.state,"PUBLISHED");
});

for(const mutation of ["DELETE FROM organization_users WHERE user_id=1", "UPDATE organizations SET active=0 WHERE id=1"]) test(`permission revocation blocks worker publication after bytes are durable: ${mutation}`,async t=>{
  let fail=true;
  const f=persistenceFixture(t,{beforeSql({sql,kind}){if(fail&&kind==="batch"&&sql.includes("UPDATE projects SET config_revision"))throw interruption();}});
  const saved=await create(f);assert.equal(saved.data.operation.state,"RETRY_WAIT");
  fail=false;f.db.exec(mutation);readyForRetry(f);await reconcileProjectSaveOperations(f.env);
  const row=f.db.prepare("SELECT * FROM project_save_operations").get();
  assert.equal(row.state,"FAILED_FINAL");assert.equal(row.receipt_json,null);
  assert.equal(f.project().active,0);assert.equal(f.project().config_revision,0);
});

test("expired browser session prevents HTTP reads but does not block authorized worker completion",async t=>{
  let fail=true;
  const f=persistenceFixture(t,{beforeSql({sql,kind}){if(fail&&kind==="batch"&&sql.includes("UPDATE projects SET config_revision"))throw interruption();}});
  const saved=await create(f);assert.equal(saved.data.operation.state,"RETRY_WAIT");
  f.db.exec("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'");
  assert.equal((await status(f,saved.registered.input.operationId,{key:saved.key})).status,401);
  fail=false;readyForRetry(f);await reconcileProjectSaveOperations(f.env);
  assert.equal(f.db.prepare("SELECT state FROM project_save_operations").get().state,"PUBLISHED");assert.equal(f.project().active,1);
});

test("reserved capacity denies another key before storage and replay consumes no extra quota",async t=>{
  const f=persistenceFixture(t);f.env.PROJECT_LIMIT_FREE="1";
  const first=await reserve(f);assert.equal(first.status,202);
  const retry=await reserve(f);assert.equal(retry.status,202);assert.equal(retry.data.project.id,first.data.project.id);
  const denied=await reserve(f,config("another"),{key:"quota-second-key-0001",name:"Another project"});
  assert.equal(denied.status,409);assert.equal(denied.data.error.code,"ORGANIZATION_PROJECT_LIMIT_REACHED");
  assert.equal(f.objects.size,0);assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,1);
  const published=await create(f);assert.equal(published.data.operation.state,"PUBLISHED");
  const deniedAfterCommit=await reserve(f,config("another"),{key:"quota-third-key-0001",name:"Third project"});
  assert.equal(deniedAfterCommit.status,409);assert.equal(deniedAfterCommit.data.error.code,"ORGANIZATION_PROJECT_LIMIT_REACHED");
  assert.equal(f.db.prepare("SELECT count(*) n FROM organization_resource_reservations").get().n,1);
});

for(const revoke of ["DELETE FROM organization_users WHERE organization_id=1 AND user_id=1","DELETE FROM user_projects WHERE project_id=1 AND user_id=1"]) test(`completed creation key cannot recover a receipt after current access is revoked: ${revoke}`,async t=>{
  const f=persistenceFixture(t),created=await create(f);
  f.db.exec(revoke);
  const denied=await status(f,created.registered.input.operationId,{key:created.key});
  assert.ok([403,404].includes(denied.status),JSON.stringify(denied.data));
  assert.equal(denied.data.operation,undefined);assert.equal(denied.data.project,undefined);
  const replayRegistration=await register(f,config("initial"),{key:created.key});
  assert.ok([403,404].includes(replayRegistration.status),JSON.stringify(replayRegistration.data));
  const replayPayload=await upload(f,created.registered,{key:created.key});
  assert.ok([403,404].includes(replayPayload.status),JSON.stringify(replayPayload.data));
  assert.equal(replayRegistration.data.operation,undefined);assert.equal(replayPayload.data.operation,undefined);
  assert.equal(f.db.prepare("SELECT state FROM project_save_operations").get().state,"PUBLISHED","revocation must not erase historical durability");
});

test("operation routes require a stable project ID before registering, reading or receiving bytes",async t=>{
  const f=persistenceFixture(t),created=await create(f);
  const headers={"X-Maono-Project-Id":null};
  const responses=[
    await register(f,config("missing identity"),{kind:"update",expected:1,operationId:"missing-project-id-0001",headers}),
    await status(f,created.registered.input.operationId,{headers}),
    await upload(f,created.registered,{headers}),
  ];
  for(const result of responses){assert.equal(result.status,409);assert.equal(result.data.error.code,"PROJECT_IDENTITY_REQUIRED");}
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_save_operations").get().n,1);
  assert.equal(f.project().config_revision,1);
});

test("same slug reused by project ID2 cannot receive a stale project ID1 snapshot or disclose its receipt",async t=>{
  const f=persistenceFixture(t);await create(f);
  const slug=f.project().slug;
  const registered=await register(f,config("pending original"),{kind:"update",expected:1,operationId:"stale-project-id-0001"});
  assert.equal(registered.status,201);
  f.db.prepare("UPDATE projects SET slug='original-map-renamed' WHERE id=1").run();
  f.db.prepare("INSERT INTO projects(id,name,slug,organization_id,dropbox_root_path,active) VALUES(2,'Replacement',?,1,'/offline/a/replacement',1)").run(slug);
  f.db.exec("INSERT INTO user_projects(user_id,project_id,access_level) VALUES(1,2,'owner')");
  const count=f.calls.length,headers={"X-Maono-Project-Id":"1"};
  const responses=[
    await register(f,config("new stale attempt"),{slug,kind:"update",expected:0,operationId:"stale-project-new-0001",headers}),
    await status(f,registered.input.operationId,{slug,headers}),
    await upload(f,registered,{slug,headers}),
  ];
  for(const result of responses){assert.equal(result.status,409,JSON.stringify(result.data));assert.equal(result.data.error.code,"PROJECT_IDENTITY_CHANGED");assert.equal(result.data.operation,undefined);}
  assert.equal(f.calls.length,count,"identity mismatch must stop before provider upload or verification");
  assert.equal(f.project(2).config_revision,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_save_operations WHERE project_id=2").get().n,0);
  assert.equal(f.db.prepare("SELECT state FROM project_save_operations WHERE operation_id='stale-project-id-0001'").get().state,"AWAITING_UPLOAD");
});
