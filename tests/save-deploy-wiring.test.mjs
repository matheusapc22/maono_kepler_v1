import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {onRequest as oldSave} from "../functions/api/projects/[slug]/save.js";
import {onRequest as oldConfig} from "../functions/api/projects/[slug]/config.js";
const source=p=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
test("client/API 2 retain schema19 plus additive capability",async()=>{
  assert.match(await source("src/pages/Kepler/save-observability.ts"),/MAONO_SAVE_CLIENT_CONTRACT\s*=\s*2/);
  const server=await source("functions/_lib/save-deploy-contract.js");
  assert.match(server,/SAVE_EXPECTED_DB_SCHEMA_VERSION = 19/);
  assert.match(server,/project_save_operation_schema/);
});
test("registration and creation validate deployment before any admission",async()=>{
  for(const [file,write] of [["functions/_lib/project-save-operation-http.js","operation=await registerProjectSaveOperation"],["functions/api/projects/index.js","const reserved = await reserveProjectCreation"]]){
    const code=await source(file);const check=code.indexOf("assertSaveDeployCompatibility(env,request)");
    assert.ok(check>=0 && code.indexOf(write)>check,file);
  }
});
test("retired writers reject old tabs before consuming request bytes or touching infrastructure",async()=>{
  for(const [handler,method] of [[oldSave,"POST"],[oldConfig,"PUT"]]){
    let read=false;
    const request={method,json(){read=true;throw new Error("must not read")},headers:new Headers()};
    const response=await handler({request,env:new Proxy({}, {get(){throw new Error("must not touch env")}})});
    assert.equal(response.status,412);assert.equal(read,false);
    assert.equal((await response.json()).error.code,"SAVE_CLIENT_CONTRACT_UNSUPPORTED");
  }
});
test("migration keeps historical schema19 contract intact",async()=>{
  assert.match(await source("migrations/0019_save_deploy_contract.sql"),/VALUES \(1, 19, CURRENT_TIMESTAMP\)/);
  assert.doesNotMatch(await source("migrations/0039_project_save_operations.sql"),/UPDATE app_schema_metadata/);
});
