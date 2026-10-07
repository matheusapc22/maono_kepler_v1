import assert from "node:assert/strict";
import test from "node:test";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";
import { config, reserve, manifest, request, operationHeaders, parse, assertReopened } from "./helpers/durable-project-http.mjs";
import { routeProjectSaveRequest } from "./helpers/project-save-pages-router.mjs";
import { runProjectSaveRecovery } from "../workers/project-save-operations.js";

const operationId = "qa-durable:local-routing:small:create";
async function setup(t) {
  const f = persistenceFixture(t), map = config("encoded-route");
  f.env.PROJECT_DURABLE_SAVE_INLINE_ENABLED = "false";
  f.env.PROJECT_DURABLE_SAVE_WORKER_ENABLED = "true";
  assert.equal((await reserve(f, map, { key: operationId })).status, 202);
  const prepared = await manifest(map, { operationId });
  // Percent-encode a legal slug character too: both route params belong to
  // the HTTP boundary, whereas body/header identifiers are already decoded.
  const slug = f.project().slug.replace(/^./, character => `%${character.charCodeAt(0).toString(16)}`);
  const base = `/api/projects/${slug}/save-operations`;
  const send = (path, options = {}) => routeProjectSaveRequest({ env: f.env, request: request(f, path, {
    ...options, headers: operationHeaders(f, { key: operationId, headers: options.headers }),
  }) }).then(parse);
  const registered = await send(base, { method: "POST", body: JSON.stringify(prepared.input) });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  return { f, map, prepared, base, send };
}

test("Pages raw params preserve encoded IDs through durable upload, worker publication and historical receipt", async t => {
  const { f, map, prepared, base, send } = await setup(t);
  const path = `${base}/${encodeURIComponent(operationId)}`;
  let result = await send(path);
  assert.equal(result.status, 200); assert.equal(result.data.operation.operationId, operationId);
  result = await send(`${path}/payload`, { method: "PUT", body: prepared.bytes, headers: { "Content-Type": "application/json" } });
  assert.equal(result.status, 202); assert.equal(result.data.operation.state, "PAYLOAD_STORED");
  assert.equal(result.data.operation.receipt, null);
  assert.equal((await runProjectSaveRecovery(f.env)).published, 1);
  await assertReopened(f, map, 1);
  const receipt = (await send(path)).data.operation.receipt;
  assert.equal(receipt.operationId, operationId); assert.equal(receipt.publishedRevision, 1);
  const writes = f.calls.length;
  for (const id of [operationId, encodeURIComponent(operationId), encodeURIComponent(operationId).replaceAll("%3A", "%3a")]) {
    const repeated = await send(`${base}/${id}/payload`, { method: "PUT", body: prepared.bytes, headers: { "Content-Type": "application/json" } });
    assert.equal(repeated.status, 200); assert.deepEqual(repeated.data.operation.receipt, receipt);
  }
  assert.equal(f.calls.length, writes);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM project_save_operations").get().n, 1);
});

test("malformed, double-encoded and out-of-grammar route IDs never upload or select an existing operation", async t => {
  const { f, prepared, base, send } = await setup(t);
  const writes = f.calls.length;
  for (const id of ["%", "%GG", "%E0%A4%A", encodeURIComponent(encodeURIComponent(operationId)), "operation%2Foutside", "operation%5Coutside", "operation%00outside", "operation%20outside", "x".repeat(129), "short"]) {
    for (const method of ["GET", "PUT"]) {
      const result = await send(`${base}/${id}${method === "PUT" ? "/payload" : ""}`, {
        method, ...(method === "PUT" ? { body: prepared.bytes, headers: { "Content-Type": "application/json" } } : {}),
      });
      assert.equal(result.status, 400, `${method} ${id}: ${JSON.stringify(result.data)}`);
      assert.equal(result.data.error.code, "PROJECT_SAVE_OPERATION_ID_INVALID");
    }
  }
  assert.equal(f.calls.length, writes);
  assert.equal(f.db.prepare("SELECT state FROM project_save_operations").get().state, "AWAITING_UPLOAD");
});

test("decoded route identifiers retain origin, project identity, organization and actor guards", async t => {
  const { f, prepared, base, send } = await setup(t);
  const path = `${base}/${encodeURIComponent(operationId)}`;
  const writes = f.calls.length;
  for (const [headers, code] of [
    [{ Origin: "https://other.invalid" }, "PROJECT_SAVE_ORIGIN_DENIED"],
    [{ "X-Maono-Project-Id": "999" }, "PROJECT_IDENTITY_CHANGED"],
    [{ "X-Maono-Project-Id": "" }, "PROJECT_IDENTITY_REQUIRED"],
  ]) {
    const result = await send(`${path}/payload`, { method: "PUT", body: prepared.bytes, headers });
    assert.equal(result.data.error.code, code);
  }
  const foreign = await send(path, { userId: 2 });
  assert.equal(foreign.status, 404);
  assert.equal(f.calls.length, writes);
  assert.equal((await send(`${path}/payload`, { method: "PUT", body: prepared.bytes, headers: { "Content-Type": "application/json" } })).status, 202);
  assert.equal((await runProjectSaveRecovery(f.env)).published, 1);
  // Give a different actor valid project-view access in the same organization.
  f.db.exec("UPDATE sessions SET active_organization_id=1 WHERE user_id=2; INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(1,2,'owner'); INSERT INTO user_projects(user_id,project_id,access_level) SELECT 2,id,'owner' FROM projects");
  const afterPublication = f.calls.length;
  const scoped = await send(path, { userId: 2, headers: { "X-Maono-Creation-Key": null } });
  assert.equal(scoped.status, 404);
  assert.equal(scoped.data.error.code, "SAVE_OPERATION_NOT_FOUND");
  assert.equal(f.calls.length, afterPublication);
});

test("slug escapes are decoded once and malformed slugs produce a controlled error", async t => {
  const { f, base, send } = await setup(t);
  const writes = f.calls.length;
  for (const slug of ["%", "%GG", "%E0%A4%A"]) {
    const result = await send(`/api/projects/${slug}/save-operations/${encodeURIComponent(operationId)}`);
    assert.equal(result.status, 400); assert.equal(result.data.error.code, "PROJECT_SLUG_INVALID");
  }
  const doubled = base.replace("%6f", "%256f");
  assert.notEqual(doubled, base);
  assert.equal((await send(`${doubled}/${encodeURIComponent(operationId)}`)).status, 404);
  assert.equal(f.calls.length, writes);
});
