import assert from "node:assert/strict";
import test from "node:test";
import { getAuthorizedProject } from "../functions/_lib/projects.js";
import { persistenceFixture, interruption } from "./helpers/project-persistence-fixture.mjs";
import { config,largeConfig,reserve,create,register,upload,update,assertReopened } from "./helpers/durable-project-http.mjs";

for(const [label,map] of [["small",config("small")],["large",largeConfig("large")]]) test(`${label} creation shares the durable protocol and cannot be listed before activation`,async t=>{
  const f=persistenceFixture(t),reserved=await reserve(f,map);
  assert.equal(reserved.status,202);assert.equal(reserved.data.creation.transport,"durable-operation");
  assert.equal(await getAuthorizedProject(f.env,f.user,f.project().slug),null);
  const registered=await register(f,map,{key:"offline-create-0001"});
  assert.equal(registered.data.operation.payloadStored,false);
  assert.equal(await getAuthorizedProject(f.env,f.user,f.project().slug),null);
  const saved=await upload(f,registered,{key:"offline-create-0001"});
  assert.equal(saved.data.operation.state,"PUBLISHED");
  assert.ok(await getAuthorizedProject(f.env,f.user,f.project().slug));
  await assertReopened(f,map,1);
});

test("small and large updates advance expected revision through the same operation receipt",async t=>{
  const f=persistenceFixture(t);await create(f);
  const small=await update(f,config("edited-small"));assert.equal(small.data.operation.receipt.publishedRevision,2);
  const large=await update(f,largeConfig("edited-large"),{operationId:"offline-update-large"});
  assert.equal(large.data.operation.receipt.publishedRevision,3);
  await assertReopened(f,largeConfig("edited-large"),3);
});

for(const failure of ["project-record","draft-initialized"]) test(`reservation interruption at ${failure} resumes the same project and slug`,async t=>{
  let armed=true;
  const f=persistenceFixture(t,{afterSql({sql}){
    if(!armed)return;
    if((failure==="project-record"&&/INSERT INTO projects/.test(sql))||(failure==="draft-initialized"&&/SET lifecycle_state = 'DRAFT'/.test(sql))){armed=false;throw interruption();}
  }});
  const failed=await reserve(f);assert.equal(armed,false,"injected a real SQL interruption");assert.ok(failed.status>=400 || failed.status===202);
  const first=f.project();assert.ok(first);
  const recovered=await reserve(f);assert.equal(recovered.status,202,JSON.stringify(recovered.data));
  assert.equal(recovered.data.project.id,first.id);assert.equal(recovered.data.project.slug,first.slug);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,1);
  assert.equal(f.db.prepare("SELECT project_id FROM organization_files").get().project_id,first.id);
  const saved=await create(f);assert.equal(saved.data.operation.state,"PUBLISHED");
});

test("concurrent reservation requests with one key converge on one project, slug and quota",async t=>{
  const f=persistenceFixture(t),results=await Promise.all([reserve(f),reserve(f)]);
  for(const result of results)assert.equal(result.status,202,JSON.stringify(result.data));
  assert.equal(results[0].data.project.id,results[1].data.project.id);
  assert.equal(results[0].data.project.slug,results[1].data.project.slug);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM organization_files").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM organization_resource_reservations").get().n,1);
});
