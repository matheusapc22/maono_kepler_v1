import assert from "node:assert/strict";
import test from "node:test";
import { readPublishedProjectConfig } from "../functions/_lib/project-config-service.js";
import { reconcileProjectSaveOperations, failProjectSaveUpload } from "../functions/_lib/project-save-operations.js";
import { persistenceFixture, interruption, deferred, waitForPause } from "./helpers/project-persistence-fixture.mjs";
import {config,largeConfig,reserve,register,upload,status,create,update,assertReopened,seedLegacy,readyForRetry} from "./helpers/durable-project-http.mjs";

for(const large of [false,true]) test(`${large?'large':'small'} HTTP creation atomically activates initial revision, owner, file and quota`,async t=>{
  const f=persistenceFixture(t),map=large?largeConfig("created"):config("created");
  const reserved=await reserve(f,map);
  assert.equal(reserved.status,202);
  assert.equal(f.project().active,0);
  assert.equal(f.project().config_revision,0);
  assert.equal(f.project().lifecycle_state,"PREPARING_STORAGE");
  assert.equal(f.objects.size,0,"reservation never writes map bytes");
  assert.equal(f.db.prepare("SELECT status FROM organization_resource_reservations").get().status,"PROCESSING");
  const registered=await register(f,map,{key:"offline-create-0001"});
  assert.equal(registered.data.operation.state,"AWAITING_UPLOAD");
  const saved=await upload(f,registered,{key:"offline-create-0001"});
  assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.equal(saved.data.operation.state,"PUBLISHED");
  await assertReopened(f,map,1);
  assert.equal(f.db.prepare("SELECT access_level FROM user_projects").get().access_level,"owner");
  assert.equal(f.db.prepare("SELECT status FROM organization_files").get().status,"ACTIVE");
  assert.equal(f.db.prepare("SELECT status FROM organization_resource_reservations").get().status,"COMMITTED");
  assert.ok(f.primaryReads>0,"HTTP status and commits select the primary D1 session");
});

test("lost creation response and reload-like status recover the historical receipt after a later save",async t=>{
  const f=persistenceFixture(t),created=await create(f);
  const originalReceipt=created.data.operation.receipt;
  await update(f,config("newer"));
  const recovered=await status(f,created.registered.input.operationId,{key:created.key});
  assert.equal(recovered.status,200);
  assert.deepEqual(recovered.data.operation.receipt,originalReceipt);
  assert.equal(recovered.data.operation.receipt.publishedRevision,1);
  assert.equal(recovered.data.currentRevision,2);
  const providerCalls=f.calls.length;
  const replay=await upload(f,created.registered,{key:created.key});
  assert.equal(replay.data.operation.state,"PUBLISHED");
  assert.equal(f.calls.length,providerCalls,"published retry never sends bytes again");
  const reservation=await reserve(f);
  assert.equal(reservation.status,200);
  assert.equal(reservation.data.idempotent,true);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM organization_resource_reservations").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_config_revisions").get().n,2);
  await assertReopened(f,config("newer"),2);
});

for(const mode of ["versioned","legacy"]) {
  test(`${mode} bounded HTTP stream round-trips without overwriting historical source`,async t=>{
    const f=persistenceFixture(t);
    if(mode==="legacy") await seedLegacy(f); else await create(f);
    const old=f.project(), legacyPath="/offline/a/map/config.kepler.json";
    const legacyBytes=mode==="legacy"?f.objects.get(legacyPath).bytes.slice():null;
    const map=largeConfig(mode),saved=await update(f,map,{chunkSize:4*1024*1024+37});
    assert.equal(saved.data.operation.state,"PUBLISHED",JSON.stringify(saved.data));
    await assertReopened(f,map,old.config_revision+1);
    const finishes=f.calls.filter(call=>call.op==="upload_session/finish").length;
    const replay=await upload(f,saved.registered);
    assert.equal(replay.data.operation.receipt.publishedRevision,old.config_revision+1);
    assert.equal(f.calls.filter(call=>call.op==="upload_session/finish").length,finishes);
    if(legacyBytes) assert.deepEqual(f.objects.get(legacyPath).bytes,legacyBytes);
  });
  test(`${mode} interrupted upload stays unpublished, worker requests missing bytes, same ID can resume`,async t=>{
    const f=persistenceFixture(t);
    if(mode==="legacy") await seedLegacy(f); else await create(f);
    const before=f.project(), original=(await readPublishedProjectConfig(f.env,before)).config;
    const registered=await register(f,largeConfig("retry"),{kind:"update",expected:before.config_revision,operationId:"offline-stream-retry"});
    const failed=await upload(f,registered,{abortAfter:2});
    assert.ok(failed.status>=400);
    assert.equal(f.project().config_revision,before.config_revision);
    assert.equal(f.ledger(1,before.config_revision+1),undefined);
    assert.deepEqual((await readPublishedProjectConfig(f.env,f.project())).config,original);
    readyForRetry(f);
    await reconcileProjectSaveOperations(f.env);
    const waiting=await status(f,registered.input.operationId);
    assert.equal(waiting.data.operation.state,"AWAITING_UPLOAD");
    assert.equal(waiting.data.operation.nextAction,"UPLOAD");
    const saved=await upload(f,registered);
    assert.equal(saved.data.operation.state,"PUBLISHED");
    await assertReopened(f,largeConfig("retry"),before.config_revision+1);
  });
  test(`${mode} malformed or truncated body is never published`,async t=>{
    const f=persistenceFixture(t);
    if(mode==="legacy") await seedLegacy(f); else await create(f);
    const before=f.project(),registered=await register(f,largeConfig("truncated"),{kind:"update",expected:before.config_revision,operationId:"offline-stream-truncated"});
    const failed=await upload(f,registered,{truncate:17});
    assert.ok(failed.status>=400);
    assert.equal(f.project().config_revision,before.config_revision);
    assert.equal(f.ledger(1,before.config_revision+1),undefined);
    const receipt=await status(f,registered.input.operationId);
    assert.equal(receipt.data.operation.receipt,null);
    assert.notEqual(receipt.data.operation.state,"PUBLISHED");
  });
}

test("different concurrent saves publish only one candidate and keep losing bytes for review",async t=>{
  const entered=deferred(),release=deferred();let pause=false,paused=false;
  const f=persistenceFixture(t,{async beforeProvider({op}){if(pause&&!paused&&op==="upload_session/finish"){paused=true;entered.resolve();await release.promise;}}});
  await create(f);pause=true;
  const first=update(f,config("first"),{operationId:"offline-concurrent-first"}).then(value=>({value}),error=>({error}));
  await waitForPause(entered,first);
  const second=await update(f,config("second"),{operationId:"offline-concurrent-second"});
  release.resolve();
  const resumed=await first;
  assert.equal(resumed.error,undefined);
  assert.equal(second.data.operation.state,"PUBLISHED");
  assert.equal(resumed.value.data.operation.state,"CONFLICT");
  assert.equal(resumed.value.data.operation.receipt,null);
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_config_revisions").get().n,2);
  await assertReopened(f,config("second"),2);
});

for(const failedSql of ["INSERT INTO project_config_revisions","UPDATE organization_files","UPDATE organization_resource_reservations","INSERT INTO user_projects"]) {
  test(`creation rollback on ${failedSql} leaves no partial activation; outbox finishes without browser`,async t=>{
    let fail=true;
    const f=persistenceFixture(t,{beforeSql({sql,kind}){if(fail&&kind==="batch"&&sql.includes(failedSql))throw interruption();}});
    const result=await create(f);
    assert.equal(result.status,202,JSON.stringify(result.data));
    assert.equal(result.data.operation.state,"RETRY_WAIT");
    assert.equal(f.project().active,0);assert.equal(f.project().config_revision,0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM project_config_revisions").get().n,0);
    assert.equal(f.db.prepare("SELECT active FROM organization_files").get().active,0);
    assert.equal(f.db.prepare("SELECT status FROM organization_resource_reservations").get().status,"PROCESSING");
    assert.equal(f.db.prepare("SELECT count(*) n FROM user_projects").get().n,0);
    const uploads=f.calls.filter(call=>call.op==="upload_session/finish").length;
    fail=false;readyForRetry(f);await reconcileProjectSaveOperations(f.env);
    const recovered=await status(f,result.registered.input.operationId,{key:result.key});
    assert.equal(recovered.data.operation.state,"PUBLISHED");
    assert.equal(f.calls.filter(call=>call.op==="upload_session/finish").length,uploads);
    await assertReopened(f,config("initial"),1);
  });
}

test("storage succeeds but D1 acknowledgement is lost: reconciliation recovers exact object and publishes once",async t=>{
  let fail=true;
  const f=persistenceFixture(t,{beforeSql({sql}){if(fail&&/SET state = 'PAYLOAD_STORED'/.test(sql))throw interruption();}});
  const result=await create(f);
  assert.ok(result.status>=400);assert.equal(f.project().config_revision,0);
  assert.equal(f.db.prepare("SELECT state FROM project_save_operations").get().state,"RECEIVING");
  const uploads=f.calls.filter(call=>call.op==="upload_session/finish").length;
  fail=false;readyForRetry(f);await reconcileProjectSaveOperations(f.env);
  const recovered=await status(f,result.registered.input.operationId,{key:result.key});
  assert.equal(recovered.data.operation.state,"PUBLISHED");
  assert.equal(f.calls.filter(call=>call.op==="upload_session/finish").length,uploads);
  await assertReopened(f,config("initial"),1);
});

test("late upload failure cannot invalidate a published creation or release its quota",async t=>{
  const f=persistenceFixture(t),created=await create(f);
  const operation=f.db.prepare("SELECT * FROM project_save_operations").get();
  await failProjectSaveUpload(f.env,{operation,error:interruption()});
  assert.equal(f.db.prepare("SELECT status FROM organization_resource_reservations").get().status,"COMMITTED");
  assert.equal(f.db.prepare("SELECT active FROM organization_files").get().active,1);
  assert.deepEqual((await status(f,operation.operation_id,{key:created.key})).data.operation.receipt,created.data.operation.receipt);
  await assertReopened(f,config("initial"),1);
});

for(const lostOperation of ["upload_session/append_v2","upload_session/finish"]) test(`large create reconciles a lost ${lostOperation} response without duplicate bytes or revision`,async t=>{
  let lost=false;
  const f=persistenceFixture(t,{afterProvider({op}){if(!lost&&op===lostOperation){lost=true;throw Object.assign(new Error("Lost provider acknowledgement"),{code:"DROPBOX_TIMEOUT",status:504,retryable:true});}}});
  const map=largeConfig("lost provider ack"),created=await create(f,map);
  assert.equal(lost,true);assert.equal(created.data.operation.state,"PUBLISHED",JSON.stringify(created.data));
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_config_revisions").get().n,1);
  if(lostOperation==="upload_session/finish")assert.equal(f.calls.filter(call=>call.op===lostOperation).length,1,"ambiguous finish is inspected before any replay");
  await assertReopened(f,map,1);
});
