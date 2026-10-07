import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as importEndpoint } from "../functions/api/admin/organization-files/[id]/project.js";
import { readPublishedProjectConfig } from "../functions/_lib/project-config-service.js";
import { reconcileProjectSaveOperations } from "../functions/_lib/project-save-operations.js";
import { persistenceFixture,interruption } from "./helpers/project-persistence-fixture.mjs";
import { config,request,parse,readyForRetry } from "./helpers/durable-project-http.mjs";

async function seed(f) {
  f.db.exec(`UPDATE users SET role='super_admin' WHERE id=1;
    INSERT INTO users(id,email,name,role,password_hash) VALUES(3,'editor@offline.invalid','Editor','editor','not-a-login');
    INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(1,3,'editor');
    INSERT INTO organization_files(id,organization_id,name,original_name,file_name,dropbox_path,file_type,mime_type,status,uploaded_by,active)
      VALUES(11,1,'Imported map','source.json','source.json','/offline/a/source.json','json','application/json','ACTIVE',1,1);`);
  const bytes=new TextEncoder().encode(JSON.stringify(config("source untouched")));
  await f.store("/offline/a/source.json",bytes);
  return bytes;
}
async function convert(f,{fileId=11,userId=1,...input}={}) {
  return parse(await importEndpoint({env:f.env,params:{id:String(fileId)},request:request(f,`/api/admin/organization-files/${fileId}/project`,{
    method:"POST",body:JSON.stringify({operationId:"offline-import-0001",organizationId:1,name:"Imported durable map",...input}),userId,
  })}));
}

for(const copyOrganizationAccess of [true,false]) test(`super-admin JSON conversion preserves source and publishes atomic project access (copy members=${copyOrganizationAccess})`,async t=>{
  const f=persistenceFixture(t),source=await seed(f),saved=await convert(f,{copyOrganizationAccess});
  assert.equal(saved.status,201,JSON.stringify(saved.data));assert.equal(saved.data.operation.state,"PUBLISHED");
  assert.equal(saved.data.operation.receipt.publishedRevision,1);assert.equal(f.project().active,1);
  assert.equal(f.db.prepare("SELECT access_level FROM user_projects WHERE user_id=1").get().access_level,"owner");
  const editor=f.db.prepare("SELECT access_level FROM user_projects WHERE user_id=3").get();
  assert.equal(editor?.access_level,copyOrganizationAccess?"editor":undefined);
  assert.equal(f.db.prepare("SELECT * FROM user_projects WHERE user_id=2").get(),undefined);
  assert.equal(f.db.prepare("SELECT status FROM organization_resource_reservations").get().status,"COMMITTED");
  assert.deepEqual(f.objects.get("/offline/a/source.json").bytes,source);
  assert.equal(f.db.prepare("SELECT project_id FROM organization_files WHERE id=11").get().project_id,null);
  assert.deepEqual((await readPublishedProjectConfig(f.env,f.project())).config,config("source untouched"));
  const uploads=f.calls.filter(c=>c.op==="upload_session/finish").length;
  const retry=await convert(f,{copyOrganizationAccess});assert.equal(retry.status,200);assert.deepEqual(retry.data.operation.receipt,saved.data.operation.receipt);
  assert.equal(f.calls.filter(c=>c.op==="upload_session/finish").length,uploads);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,1);
});

test("admin conversion rejects files outside the selected organization and non-admin callers before source download",async t=>{
  const f=persistenceFixture(t);await seed(f);
  f.db.exec("INSERT INTO organization_files(id,organization_id,name,original_name,file_name,dropbox_path,active) VALUES(12,2,'Foreign map','foreign.json','foreign.json','/offline/b/foreign.json',1)");
  const foreign=await convert(f,{fileId:12});assert.equal(foreign.status,404);assert.equal(foreign.data.error.code,"ORGANIZATION_FILE_NOT_FOUND");
  const nonAdmin=await convert(f,{userId:2});assert.equal(nonAdmin.status,403);
  assert.equal(f.calls.length,0);assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,0);
});

test("conversion copies current membership only in atomic publication and worker can finish without reupload",async t=>{
  let fail=true;
  const f=persistenceFixture(t,{beforeSql({sql,kind}){if(fail&&kind==="batch"&&sql.includes("SELECT user_id,?,CASE"))throw interruption();}});
  const source=await seed(f),accepted=await convert(f);
  assert.equal(accepted.status,202,JSON.stringify(accepted.data));assert.equal(accepted.data.operation.state,"RETRY_WAIT");
  assert.equal(f.project().active,0);assert.equal(f.project().config_revision,0);assert.equal(f.db.prepare("SELECT count(*) n FROM user_projects").get().n,0);
  f.db.exec("UPDATE organization_users SET access_level='viewer' WHERE user_id=3");
  fail=false;readyForRetry(f);await reconcileProjectSaveOperations(f.env);
  assert.equal(f.project().active,1);assert.equal(f.db.prepare("SELECT access_level FROM user_projects WHERE user_id=3").get().access_level,"viewer");
  assert.deepEqual(f.objects.get("/offline/a/source.json").bytes,source);
});

test("conversion replay cannot silently change access policy, title or source file",async t=>{
  const f=persistenceFixture(t);await seed(f);const saved=await convert(f);assert.equal(saved.status,201);
  for(const input of [{copyOrganizationAccess:false},{name:"Different imported title"},{fileId:12}]) {
    const mismatch=await convert(f,input);assert.equal(mismatch.status,409);assert.equal(mismatch.data.error.code,"OPERATION_PAYLOAD_MISMATCH");
  }
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_config_revisions").get().n,1);
});

test("conversion rejects a source path outside its organization root without reading its bytes",async t=>{
  const f=persistenceFixture(t);await seed(f);
  f.db.exec("UPDATE organization_files SET dropbox_path='/offline/b/private.json' WHERE id=11");
  const denied=await convert(f);assert.equal(denied.status,403);assert.equal(denied.data.error.code,"ORGANIZATION_FILE_SCOPE_INVALID");
  assert.equal(f.calls.length,0);assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,0);
});

test("super-admin converts the explicitly selected organization without changing the session organization",async t=>{
  const f=persistenceFixture(t);await seed(f);
  f.db.exec("UPDATE sessions SET active_organization_id=2 WHERE user_id=1");
  const saved=await convert(f,{organizationId:1});assert.equal(saved.status,201,JSON.stringify(saved.data));
  assert.equal(saved.data.operation.organizationId,1);assert.equal(f.project().organization_id,1);
  assert.equal(f.db.prepare("SELECT active_organization_id FROM sessions WHERE user_id=1").get().active_organization_id,2);
  assert.equal(f.db.prepare("SELECT count(*) n FROM user_projects WHERE user_id=2").get().n,0,"selected project never gains another organization's membership");
});
