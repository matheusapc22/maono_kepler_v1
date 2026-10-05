import assert from "node:assert/strict";
import test from "node:test";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";
import { config, largeConfig, assertReopened } from "./helpers/durable-project-http.mjs";
import { memoryStore } from "./helpers/durable-save-browser-fixtures.mjs";
import { executeProjectCreateFlow } from "../src/pages/Kepler/project-create-flow.ts";
import { beginClientSaveAttempt } from "../src/pages/Kepler/save-observability.ts";
import { executePreparedProjectUpdate, prepareProjectUpdateSnapshot } from "../src/pages/Kepler/durable-save-controller.ts";
import { onRequest as projectEndpoint } from "../functions/api/projects/index.js";
import { handleProjectSaveOperation } from "../functions/_lib/project-save-operation-http.js";

// Real frontend controller -> production Request handlers -> SQLite + simulated external Dropbox HTTP.
// Only the browser's durable storage is replaced here; its real IndexedDB is covered by Playwright.
function serverFetch(f, calls, { losePublishedOnce = false } = {}) {
  return async (url, init = {}) => {
    calls.push({ method: init.method, url, headers: init.headers });
    const request = new Request(`http://offline.invalid${url}`, { ...init, headers: { ...f.headers(1), ...init.headers } });
    if (url === "/api/projects") return projectEndpoint({ env: f.env, request });
    const match = url.match(/^\/api\/projects\/([^/]+)\/save-operations(?:\/([^/]+))?(\/payload)?$/);
    assert.ok(match, url);
    const action = match[3] ? "payload" : match[2] ? "status" : "register";
    const response = await handleProjectSaveOperation({ env: f.env, request, params: { slug: decodeURIComponent(match[1]), operationId: match[2] && decodeURIComponent(match[2]) } }, action);
    if (losePublishedOnce && action === "payload" && response.ok) { losePublishedOnce = false; throw new TypeError("Lost HTTP response after server commit"); }
    return response;
  };
}
for (const [label, map] of [["small", config("frontend-small")], ["large", largeConfig("frontend-large")]]) test(`frontend ${label} create and update interoperate with real server core and historical receipts`, async t => {
  const f = persistenceFixture(t); const store = memoryStore(); const calls = []; const fetchImpl = serverFetch(f, calls, { losePublishedOnce: true });
  const created = await executeProjectCreateFlow({ attempt: beginClientSaveAttempt("create"), name: "Frontend integration", description: "", organizationId: 1, actorId: "1", idempotencyKey: `frontend-create-${label}`, config: map, editorSessionId: "frontend", editGeneration: 1, store, fetchImpl });
  assert.equal(created.revision, 1); assert.equal(created.data.project.lifecycle.state, "ACTIVE"); await assertReopened(f, map, 1);
  assert.deepEqual(calls.map(value => value.method), ["POST", "GET", "POST", "PUT", "GET"]);
  const next = await prepareProjectUpdateSnapshot({ attempt: beginClientSaveAttempt("update"), scope: { actorId: "1", organizationId: "1", projectKey: created.createdSlug, projectId: String(f.project().id) }, projectSlug: created.createdSlug, config: config("frontend-update"), expectedConfigRevision: 1, editorSessionId: "frontend", editGeneration: 2 });
  const saved = await executePreparedProjectUpdate({ snapshot: next, store, fetchImpl }); assert.equal(saved.data.operation.receipt.publishedRevision, 2);
  await assertReopened(f, config("frontend-update"), 2);
  // Old creation receipt remains correct after the head has advanced, without re-upload.
  const before = calls.length; const original = await store.get(created.snapshot.key);
  const recovered = await executeProjectCreateFlow({ attempt: original.attempt, actorId: "1", organizationId: 1, name: "ignored", description: "ignored", idempotencyKey: original.creation.idempotencyKey, config: null, editorSessionId: "reloaded", editGeneration: 0, snapshot: original, store, fetchImpl });
  assert.equal(recovered.revision, 1); assert.equal(recovered.data.operation.currentRevision, 2); assert.deepEqual(calls.slice(before).map(value => value.method), ["GET"]);
});
