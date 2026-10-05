import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as projectEndpoint } from "../../functions/api/projects/index.js";
import { handleProjectSaveOperation } from "../../functions/_lib/project-save-operation-http.js";
import { dropboxContentHashHex } from "../../functions/_lib/dropbox-content-hash.js";
import { readPublishedProjectConfig } from "../../functions/_lib/project-config-service.js";
const golden = JSON.parse(readFileSync(new URL("../fixtures/maps/golden/map-point-basic.kepler.json", import.meta.url), "utf8"));
export const config = value => ({...structuredClone(golden), offlineSequence:value});
export const largeConfig = value => ({...config(value), padding:"x".repeat(8 * 1024 * 1024 + 513), unicode:"Maõno 🗺️"});
export function request(f, path, {method="GET", body, headers={}, userId=1}={}) {
  const requestHeaders=new Headers({...f.headers(userId),...headers});
  for (const [key,value] of Object.entries(headers)) if(value===null) requestHeaders.delete(key);
  const init={method,headers:requestHeaders};
  if (body !== undefined) { init.body=body; if (body instanceof ReadableStream) init.duplex="half"; }
  return new Request(`http://offline.invalid${path}`,init);
}
export async function parse(response) { return {status:response.status,data:await response.json(),headers:response.headers}; }
export async function reserve(f,map=config("initial"),{key="offline-create-0001",name="Offline map",body={},headers={},userId=1}={}) {
  const bytes=new TextEncoder().encode(JSON.stringify(map));
  const input={durableSave:true,name,description:"",organizationId:1,idempotencyKey:key,
    configMetadata:{sizeBytes:bytes.length,datasetCount:map.datasets.length,schemaName:"legacy-kepler",schemaVersion:1,configVersion:map.version},...body};
  return parse(await projectEndpoint({env:f.env,request:request(f,"/api/projects",{method:"POST",body:JSON.stringify(input),headers:{"Content-Type":"application/json",...headers},userId})}));
}
export async function manifest(map,{operationId="offline-operation-0001",expected=0,kind="create"}={}) {
  const bytes=new TextEncoder().encode(JSON.stringify(map));
  return {bytes,input:{operationId,operation:kind,expectedConfigRevision:expected,checksumAlgorithm:"dropbox-content-hash",
    contentHash:await dropboxContentHashHex(bytes),payloadBytes:bytes.length,serializationVersion:1,
    schemaName:"legacy-kepler",schemaVersion:1,configVersion:map.version,datasetCount:map.datasets.length}};
}
export function operationHeaders(f,{key=null,slug=null,projectId=null,headers={}}={}) {
  const project=slug ? f.db.prepare("SELECT id FROM projects WHERE slug=?").get(slug) : f.project();
  return {"X-Maono-Project-Id":String(projectId ?? project?.id ?? ""),
    ...(key ? {"X-Maono-Creation-Key":key,"X-Maono-Expected-Revision":"0"}:{}),...headers};
}
export async function register(f,map,options={}) {
  const prepared=await manifest(map,options),slug=options.slug || f.project().slug;
  const response=await handleProjectSaveOperation({env:f.env,params:{slug},request:request(f,`/api/projects/${slug}/save-operations`,{
    method:"POST",body:JSON.stringify({...prepared.input,...options.input}),headers:operationHeaders(f,{...options,slug}),userId:options.userId || 1,
  })},"register");
  return {...await parse(response),...prepared,projectId:options.projectId ?? f.db.prepare("SELECT id FROM projects WHERE slug=?").get(slug)?.id};
}
export function bytesStream(bytes,{chunkSize=256*1024,abortAfter=null,truncate=0}={}) {
  let offset=0,pulls=0;
  const source=bytes.subarray(0,bytes.length-truncate);
  return new ReadableStream({pull(controller){
    if(abortAfter !== null && pulls++===abortAfter) {controller.error(new DOMException("Offline interrupted upload","AbortError"));return;}
    if(offset===source.length) {controller.close();return;}
    const end=Math.min(offset+chunkSize,source.length);controller.enqueue(source.subarray(offset,end));offset=end;
  }});
}
export async function upload(f,registered,options={}) {
  const slug=options.slug || f.project().slug, operationId=registered.input.operationId;
  const req=request(f,`/api/projects/${slug}/save-operations/${operationId}/payload`,{method:"PUT",
    body:options.body || bytesStream(registered.bytes,options),headers:operationHeaders(f,{...options,slug,projectId:options.projectId ?? registered.projectId,headers:{"Content-Type":"application/json",...options.headers}}),userId:options.userId || 1});
  req.json=()=>{throw new Error("Streaming payload must never use request.json");};
  req.text=()=>{throw new Error("Streaming payload must never use request.text");};
  return parse(await handleProjectSaveOperation({env:f.env,params:{slug,operationId},request:req},"payload"));
}
export async function status(f,operationId,options={}) {
  const slug=options.slug || f.project().slug;
  return parse(await handleProjectSaveOperation({env:f.env,params:{slug,operationId},request:request(f,`/api/projects/${slug}/save-operations/${operationId}`,{headers:operationHeaders(f,{...options,slug}),userId:options.userId || 1})},"status"));
}
export async function create(f,map=config("initial"),options={}) {
  const key=options.key || "offline-create-0001";
  const reserved=await reserve(f,map,{...options,key});
  assert.ok([200,202].includes(reserved.status),JSON.stringify(reserved.data));
  const registered=await register(f,map,{...options,key});
  assert.equal(registered.status,201,JSON.stringify(registered.data));
  const saved=await upload(f,registered,{...options,key});
  return {...saved,registered,key};
}
export async function update(f,map,options={}) {
  const registered=await register(f,map,{kind:"update",expected:f.project().config_revision,operationId:"offline-update-0001",...options});
  assert.equal(registered.status,201,JSON.stringify(registered.data));
  return {...await upload(f,registered,options),registered};
}
export async function assertReopened(f,map,revision) {
  const project=f.project();
  assert.equal(project.config_revision,revision);
  assert.equal(project.lifecycle_state,"ACTIVE");
  assert.equal(f.ledger(project.id,revision).status,"READY");
  assert.ok(f.ledger(project.id,revision).published_at);
  assert.deepEqual((await readPublishedProjectConfig(f.env,project)).config,map);
}
export async function seedLegacy(f,map=config("legacy")) {
  f.db.exec(`INSERT INTO projects(id,name,slug,organization_id,dropbox_root_path,lifecycle_state,active)
    VALUES(1,'Legacy map','map',1,'/offline/a/map',NULL,1);
    INSERT INTO user_projects(user_id,project_id,access_level) VALUES(1,1,'owner');`);
  const bytes=new TextEncoder().encode(JSON.stringify(map));
  await f.store("/offline/a/map/config.kepler.json",bytes);
  return bytes;
}
export function readyForRetry(f) {
  f.db.exec("UPDATE project_save_operations SET next_attempt_at=0,lease_until=0 WHERE state NOT IN ('PUBLISHED','CONFLICT','FAILED_FINAL'); UPDATE project_save_outbox SET available_at=0 WHERE state='PENDING'");
}
