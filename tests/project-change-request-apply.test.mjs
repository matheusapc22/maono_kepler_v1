import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectChangeProposal } from "../functions/_lib/project-change-request-operations.js";
import { buildProjectConfigArtifact } from "../functions/_lib/project-config-integrity.js";
import { createMapConfigStorageRef } from "../functions/_lib/map-config-storage-ref.js";
import { readPublishedProjectConfig } from "../functions/_lib/project-config-service.js";
import { reconcileProjectSaveOperations } from "../functions/_lib/project-save-operations.js";
import { onRequest as applyEndpoint } from "../functions/api/projects/[slug]/change-requests/[id]/apply.js";
import { onRequest as reviewEndpoint } from "../functions/api/projects/[slug]/change-requests/[id]/review.js";
import { persistenceFixture,interruption } from "./helpers/project-persistence-fixture.mjs";
import { request,parse,readyForRetry,status,update,manifest,bytesStream } from "./helpers/durable-project-http.mjs";
function revision184Config() {
  return {
    version: "v1",
    datasets: [
      {
        version: "v1",
        data: {
          id: "leads",
          label: "Leads",
          color: [232, 184, 74],
          allData: [[-46.6333, -23.5505, "Original"]],
          fields: [
            { name: "lng", type: "real", format: "", analyzerType: "FLOAT" },
            { name: "lat", type: "real", format: "", analyzerType: "FLOAT" },
            { name: "name", type: "string", format: "", analyzerType: "STRING" },
          ],
        },
      },
    ],
    config: {
      visState: {
        layers: [
          {
            id: "leads-layer",
            type: "point",
            config: {
              dataId: "leads",
              label: "Leads",
              columns: { lat: "lat", lng: "lng", altitude: null },
              isVisible: true,
              visConfig: { radius: 10, opacity: 0.8, outline: false },
            },
          },
        ],
      },
    },
  };
}

const point={id:"point-operation-0001",sequence:0,type:"point.create",version:1,createdAt:"2026-09-05T12:00:00.000Z",
  payload:{tempId:"tmp-1",latitude:-15.78,longitude:-47.92,targetLayerId:"leads-layer",targetDataId:"leads",targetLabel:"Leads",
    fieldMap:{latitude:"lat",longitude:"lng",name:"name"},properties:{name:"Novo lead"},origin:"pin"}};
async function seed(f,{enabled=false}={}) {
  f.env.MAONO_TICKET_CHANGES_ENABLED=String(enabled);
  const artifact=await buildProjectConfigArtifact(revision184Config());
  const ref=createMapConfigStorageRef(1,184);
  const metadata=await f.store("/offline/a/leads-sp/config.kepler.r000184.json",artifact.bytes);
  f.db.prepare(`INSERT INTO projects(id,name,slug,organization_id,dropbox_root_path,active,config_revision,lifecycle_state,lifecycle_version,
    config_checksum,config_checksum_algorithm,config_storage_provider,config_storage_ref,config_schema,config_schema_version,config_size_bytes,config_content_type)
    VALUES(1,'Leads','leads-sp',1,'/offline/a/leads-sp',1,184,'ACTIVE',4,?,?,'dropbox',?,?,?,?,?)`)
    .run(artifact.checksum,artifact.checksumAlgorithm,ref,artifact.schemaName,artifact.schemaVersion,artifact.sizeBytes,artifact.contentType);
  f.db.prepare(`INSERT INTO project_config_revisions(project_id,revision,status,checksum_algorithm,checksum,storage_provider,storage_ref,
    storage_provider_hash,schema_name,schema_version,size_bytes,content_type,published_at)
    VALUES(1,184,'READY',?,?,'dropbox',?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .run(artifact.checksumAlgorithm,artifact.checksum,ref,metadata.content_hash,artifact.schemaName,artifact.schemaVersion,artifact.sizeBytes,artifact.contentType);
  f.db.exec("INSERT INTO user_projects(user_id,project_id,access_level) VALUES(1,1,'owner')");
  f.db.prepare(`INSERT INTO project_change_requests(id,organization_id,project_id,requested_by_user_id,base_revision,reason,idempotency_key,submission_hash)
    VALUES('offline-change-0001',1,1,1,184,'Adicionar ponto aprovado','offline-change-key-0001',?)`).run("a".repeat(64));
  f.db.prepare("INSERT INTO project_change_operations(id,change_request_id,sequence,operation_type,operation_json) VALUES(?,'offline-change-0001',0,?,?)")
    .run(point.id,point.type,JSON.stringify(point));
}
async function review(f,{action="approve",artifact,...options}={}) {
  return parse(await reviewEndpoint({env:f.env,params:{slug:"leads-sp",id:"offline-change-0001"},
    request:request(f,"/api/projects/leads-sp/change-requests/offline-change-0001/review",{method:"POST",body:JSON.stringify({action,artifact}),...options})}));
}
async function apply(f,options={}) {
  return parse(await applyEndpoint({env:f.env,params:{slug:"leads-sp",id:"offline-change-0001"},
    request:request(f,"/api/projects/leads-sp/change-requests/offline-change-0001/apply",{method:"POST",...options})}));
}
const change=f=>f.db.prepare("SELECT * FROM project_change_requests WHERE id='offline-change-0001'").get();
const proposal=()=>buildProjectChangeProposal({baseConfig:revision184Config(),operations:[point]}).config;

async function approve(f,options={}) { const result=await review(f,options);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(change(f).status,"approved");return result; }

test("REV184 + approved point.create atomically publishes REV185 and records applied status without replacing project",async t=>{
  const f=persistenceFixture(t);await seed(f);await approve(f);
  const result=await apply(f);
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.appliedRevision,185);
  assert.equal(result.data.operation.state,"PUBLISHED");
  assert.equal(f.project().config_revision,185);assert.equal(f.project().slug,"leads-sp");assert.equal(f.project().id,1);
  assert.equal(change(f).status,"applied");assert.equal(change(f).applied_revision,185);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,1);
  const persisted=(await readPublishedProjectConfig(f.env,f.project())).config;
  assert.deepEqual(persisted,proposal());assert.equal(persisted.datasets[0].data.allData[1][2],"Novo lead");
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_change_request_events WHERE to_status='applied'").get().n,1);
  const count=f.calls.length,retry=await apply(f);assert.equal(retry.status,200);assert.equal(retry.data.appliedRevision,185);assert.equal(retry.data.idempotent,true);
  assert.equal(f.calls.slice(count).filter(c=>c.op==="upload_session/finish").length,0);
});

test("unapproved change, viewer and foreign organization cannot publish",async t=>{
  const f=persistenceFixture(t);await seed(f);
  const unapproved=await apply(f);assert.equal(unapproved.status,409);assert.equal(unapproved.data.error.code,"CHANGE_REQUEST_APPROVAL_REQUIRED");
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_save_operations").get().n,0);
  const foreign=await apply(f,{userId:2});assert.ok([403,404].includes(foreign.status));
  f.db.exec("UPDATE users SET role='viewer' WHERE id=1");
  const viewer=await apply(f);assert.equal(viewer.status,403);
  assert.equal(f.project().config_revision,184);assert.equal(change(f).status,"submitted");
});

test("D1 failure at applied status rolls back project pointer, ledger and receipt then worker completes atomically",async t=>{
  let fail=false;
  const f=persistenceFixture(t,{beforeSql({sql,kind}){if(fail&&kind==="batch"&&sql.includes("UPDATE project_change_requests SET status = 'applied'"))throw interruption();}});
  await seed(f);await approve(f);fail=true;
  const result=await apply(f);assert.equal(result.status,202,JSON.stringify(result.data));assert.equal(result.data.operation.state,"RETRY_WAIT");
  assert.equal(f.project().config_revision,184);assert.equal(f.ledger(1,185),undefined);
  assert.equal(change(f).status,"applying");assert.equal(change(f).applied_revision,null);
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_change_request_events WHERE to_status='applied'").get().n,0);
  const uploads=f.calls.filter(c=>c.op==="upload_session/finish").length;
  fail=false;readyForRetry(f);await reconcileProjectSaveOperations(f.env);
  assert.equal(f.project().config_revision,185);assert.equal(change(f).status,"applied");assert.equal(change(f).applied_revision,185);
  assert.equal(f.calls.filter(c=>c.op==="upload_session/finish").length,uploads);
  assert.equal((await status(f,"change-request-offline-change-0001")).data.operation.receipt.publishedRevision,185);
});

test("applied historical revision remains185 after head advances to186 and response is lost",async t=>{
  const f=persistenceFixture(t);await seed(f);await approve(f);assert.equal((await apply(f)).status,200);
  await update(f,{...proposal(),laterEdit:true});
  const recovered=await apply(f);assert.equal(recovered.status,200);assert.equal(recovered.data.appliedRevision,185);
  assert.equal(f.project().config_revision,186);assert.equal(change(f).applied_revision,185);
});

test("remote save after approval yields conflict without publishing the stale approved proposal",async t=>{
  const f=persistenceFixture(t);await seed(f);await approve(f);
  await update(f,{...revision184Config(),otherWriter:true});
  const result=await apply(f);assert.equal(result.status,409,JSON.stringify(result.data));assert.equal(result.data.error.code,"CHANGE_REQUEST_REVIEW_CONFLICT");
  assert.equal(f.project().config_revision,185);assert.equal(f.ledger(1,186),undefined);assert.equal(change(f).applied_revision,null);
  assert.equal(f.db.prepare("SELECT state FROM project_save_operations WHERE kind='change-request'").get().state,"CONFLICT");
});

test("CC08 enabled requires the exact approved artifact and refuses a tampered upload",async t=>{
  const f=persistenceFixture(t);await seed(f,{enabled:true});
  const prepared=await manifest(proposal(),{expected:184,kind:"update"});
  await approve(f,{artifact:{checksum:prepared.input.contentHash,checksumAlgorithm:"dropbox-content-hash",sizeBytes:prepared.bytes.length,baseRevision:184,version:change(f).lifecycle_version}});
  const noArtifact=await apply(f);assert.equal(noArtifact.status,409);assert.equal(noArtifact.data.error.code,"CHANGE_REQUEST_APPROVED_ARTIFACT_REQUIRED");
  const headers={"Content-Type":"application/vnd.maono.map-config+json","X-Maono-Large-Config":"1","X-Maono-Expected-Revision":"184",
    "X-Maono-Config-Size":String(prepared.bytes.length),"X-Maono-Config-Checksum":prepared.input.contentHash,"X-Maono-Checksum-Algorithm":"dropbox-content-hash",
    "X-Maono-Config-Version":"v1","X-Maono-Dataset-Count":"1"};
  const tampered=await apply(f,{headers:{...headers,"X-Maono-Config-Checksum":"0".repeat(64)},body:bytesStream(prepared.bytes)});
  assert.equal(tampered.status,409);assert.equal(f.project().config_revision,184);assert.equal(change(f).status,"approved");
  const result=await apply(f,{headers,body:bytesStream(prepared.bytes)});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.appliedRevision,185);
});

test("CC08 reviewer in another active organization applies and recovers using the request's verified project scope",async t=>{
  const f=persistenceFixture(t);await seed(f,{enabled:true});
  f.db.exec("INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(2,1,'owner'); UPDATE sessions SET active_organization_id=2 WHERE user_id=1");
  const absent=await apply(f,{method:"GET"});assert.equal(absent.status,404);assert.equal(absent.data.error.code,"SAVE_OPERATION_NOT_FOUND");
  const prepared=await manifest(proposal(),{expected:184,kind:"update"});
  await approve(f,{artifact:{checksum:prepared.input.contentHash,sizeBytes:prepared.bytes.length,baseRevision:184,version:change(f).lifecycle_version}});
  const headers={"Content-Type":"application/vnd.maono.map-config+json","X-Maono-Large-Config":"1","X-Maono-Expected-Revision":"184",
    "X-Maono-Config-Size":String(prepared.bytes.length),"X-Maono-Config-Checksum":prepared.input.contentHash,
    "X-Maono-Config-Version":"v1","X-Maono-Dataset-Count":"1"};
  const applied=await apply(f,{headers,body:bytesStream(prepared.bytes)});assert.equal(applied.status,200,JSON.stringify(applied.data));
  const recovered=await apply(f,{method:"GET"});assert.equal(recovered.status,200,JSON.stringify(recovered.data));
  assert.equal(recovered.data.operation.receipt.publishedRevision,185);assert.equal(recovered.data.operation.organizationId,1);
  assert.equal(f.db.prepare("SELECT active_organization_id FROM sessions WHERE user_id=1").get().active_organization_id,2,"request-local context must not change session organization");
  const wrongProject=await parse(await applyEndpoint({env:f.env,params:{slug:"missing-project",id:"offline-change-0001"},request:request(f,"/api/projects/missing-project/change-requests/offline-change-0001/apply")}));
  assert.equal(wrongProject.status,404);assert.notEqual(wrongProject.data.error.code,"SAVE_OPERATION_NOT_FOUND");
});

test("worker conflict exits applying after a competing save without emitting an applied lifecycle event",async t=>{
  let fail=false;
  const f=persistenceFixture(t,{beforeSql({sql,kind}){if(fail&&kind==="batch"&&sql.includes("UPDATE project_change_requests SET status = 'applied'"))throw interruption();}});
  await seed(f);await approve(f);fail=true;
  const accepted=await apply(f);assert.equal(accepted.status,202);assert.equal(change(f).status,"applying");
  fail=false;await update(f,{...revision184Config(),competingEditor:true});
  readyForRetry(f);await reconcileProjectSaveOperations(f.env);
  const operation=f.db.prepare("SELECT * FROM project_save_operations WHERE kind='change-request'").get();
  assert.equal(operation.state,"CONFLICT");assert.equal(change(f).status,"conflict");assert.equal(change(f).applied_revision,null);
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_change_request_events WHERE to_status='applied'").get().n,0);
  assert.equal(f.project().config_revision,185);assert.equal(f.ledger(1,186),undefined);
});
