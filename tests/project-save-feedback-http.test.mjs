import assert from "node:assert/strict";
import test from "node:test";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";
import { config, create, request, update, assertReopened } from "./helpers/durable-project-http.mjs";
import { routeProjectSaveRequest } from "./helpers/project-save-pages-router.mjs";
import { memoryStore } from "./helpers/durable-save-browser-fixtures.mjs";
import { beginClientSaveAttempt } from "../src/pages/Kepler/save-observability.ts";
import { canAdvanceOwnSaveBase, confirmationMatchesEditor, DurableSaveError, executePreparedProjectUpdate, prepareProjectUpdateSnapshot, receiptRevision } from "../src/pages/Kepler/durable-save-controller.ts";
import { runProjectSaveRecovery } from "../workers/project-save-operations.js";

// Use the production HTTP handlers, authorization, SQLite, payload processing and
// receipts. Only the external provider and browser's persistence are simulated.
async function setup(t, label) {
  const f = persistenceFixture(t);
  assert.equal((await create(f, config("initial"))).status, 200);
  const project = f.project(), map = config(label), store = memoryStore();
  const snapshot = await prepareProjectUpdateSnapshot({
    attempt: beginClientSaveAttempt("update"),
    scope: { actorId: "1", organizationId: "1", projectKey: project.slug, projectId: String(project.id) },
    projectSlug: project.slug, config: map, expectedConfigRevision: project.config_revision,
    editorSessionId: "feedback-http", editGeneration: 1,
  });
  const calls = [];
  async function dispatch(path, init = {}) {
    const response = await routeProjectSaveRequest({ env: f.env, request: request(f, path, init) });
    const body = await response.clone().json();
    calls.push({ method: init.method || "GET", path, status: response.status,
      code: body.error?.code ?? null, state: body.operation?.state ?? null });
    return response;
  }
  const execute = (fetchImpl = dispatch, options = {}) => executePreparedProjectUpdate({
    snapshot, store, fetchImpl, pollIntervalMs: 1, ...options,
  });
  const operation = () => f.db.prepare("SELECT * FROM project_save_operations WHERE operation_id=?")
    .get(snapshot.manifest.operationId);
  return { f, project, map, store, snapshot, calls, dispatch, execute, operation };
}

async function assertRetainedBytes(store, snapshot, state) {
  const retained = await store.get(snapshot.key);
  assert.equal(retained.localState, state);
  assert.deepEqual(retained.manifest, snapshot.manifest);
  assert.equal(retained.expectedConfigRevision, snapshot.expectedConfigRevision);
  assert.deepEqual(new Uint8Array(await retained.serialized.body.arrayBuffer()),
    new Uint8Array(await snapshot.serialized.body.arrayBuffer()));
}

test("real admission503 followed by status404 retains its original status/code and exact unsent snapshot", async t => {
  const x = await setup(t, "paused admission");
  x.f.env.PROJECT_DURABLE_SAVE_V1 = "false";
  x.f.env.PROJECT_DURABLE_SAVE_INLINE_ENABLED = "true";
  await assert.rejects(x.execute(), error => {
    assert.ok(error instanceof DurableSaveError);
    assert.equal(error.response.status, 503);
    assert.equal(error.data.error.code, "PROJECT_DURABLE_SAVE_PAUSED");
    return true;
  });
  assert.deepEqual(x.calls.map(row => [row.method, row.status, row.code]), [
    ["GET", 404, "SAVE_OPERATION_NOT_FOUND"],
    ["POST", 503, "PROJECT_DURABLE_SAVE_PAUSED"],
    ["GET", 404, "SAVE_OPERATION_NOT_FOUND"],
  ]);
  assert.equal(x.operation(), undefined);
  assert.equal(x.f.project().config_revision, 1);
  await assertRetainedBytes(x.store, x.snapshot, "pending");
});

test("offline registration and a lost published response recover the same ID with one durable upload", async t => {
  const x = await setup(t, "offline then lost acknowledgement");
  const offline = new TypeError("Synthetic offline connection");
  let offlineOnce = true, lostAcknowledgement = true, attemptedPost = 0, uploads = 0;
  const fetchImpl = async (path, init = {}) => {
    if (init.method === "POST") {
      attemptedPost++;
      assert.equal(JSON.parse(init.body).operationId, x.snapshot.manifest.operationId);
      if (offlineOnce) { offlineOnce = false; throw offline; }
    }
    const response = await x.dispatch(path, init);
    if (init.method === "PUT") {
      uploads++;
      if (lostAcknowledgement) {
        lostAcknowledgement = false;
        assert.equal(x.operation().state, "PUBLISHED");
        throw new TypeError("Synthetic loss after the real server commit");
      }
    }
    return response;
  };
  await assert.rejects(x.execute(fetchImpl), error => error === offline);
  assert.equal(x.operation(), undefined);
  await assertRetainedBytes(x.store, x.snapshot, "pending");
  const result = await x.execute(fetchImpl);
  assert.equal(result.data.operation.receipt.operationId, x.snapshot.manifest.operationId);
  assert.equal(result.data.operation.receipt.publishedRevision, 2);
  assert.equal(attemptedPost, 2); // One offline send, then one real registration.
  assert.equal(x.calls.filter(row => row.method === "POST").length, 1);
  assert.equal(uploads, 1);
  assert.equal(x.f.db.prepare("SELECT COUNT(*) AS n FROM project_save_operations WHERE operation_id=?")
    .get(x.snapshot.manifest.operationId).n, 1);
  await assertReopened(x.f, x.map, 2);
  const beforeReplay = x.calls.length;
  const replay = await x.execute(fetchImpl);
  assert.deepEqual(replay.data.operation.receipt, result.data.operation.receipt);
  assert.deepEqual(x.calls.slice(beforeReplay).map(row => row.method), ["GET"]);
  assert.equal(uploads, 1);
});

test("real delayed Worker publication remains unconfirmed until the same receipt is polled", async t => {
  const x = await setup(t, "delayed worker receipt");
  x.f.env.PROJECT_DURABLE_SAVE_INLINE_ENABLED = "false";
  x.f.env.PROJECT_DURABLE_SAVE_WORKER_ENABLED = "true";
  let pendingReads = 0, workerRuns = 0;
  const phases = [];
  const fetchImpl = async (path, init = {}) => {
    if ((init.method || "GET") === "GET" && x.operation()?.state === "PAYLOAD_STORED") {
      pendingReads++;
      assert.equal(x.f.project().config_revision, 1);
      assert.equal(phases.includes("CONFIRMED"), false);
      await assertRetainedBytes(x.store, x.snapshot, "pending");
      if (pendingReads === 3) {
        workerRuns++;
        assert.equal((await runProjectSaveRecovery(x.f.env)).published, 1);
      }
    }
    return x.dispatch(path, init);
  };
  const result = await x.execute(fetchImpl, { onPhase: phase => phases.push(phase) });
  assert.equal(pendingReads, 3);
  assert.equal(workerRuns, 1);
  assert.equal(x.calls.find(row => row.method === "PUT").status, 202);
  assert.equal(x.calls.filter(row => row.method === "PUT").length, 1);
  assert.equal(phases.filter(phase => phase === "CONFIRMED").length, 1);
  assert.equal(phases.at(-1), "CONFIRMED");
  assert.equal(result.data.operation.receipt.operationId, x.snapshot.manifest.operationId);
  assert.equal((await x.store.get(x.snapshot.key)).localState, "confirmed");
  await assertReopened(x.f, x.map, 2);
});

test("real revision conflict retains exact bytes/base and a retry cannot create or publish another operation", async t => {
  const x = await setup(t, "draft that loses the revision race");
  const competing = config("other published change");
  assert.equal((await update(x.f, competing, { operationId: "competing-feedback-save-0001" })).status, 200);
  assert.equal(x.f.project().config_revision, 2);
  const conflict = error => {
    assert.ok(error instanceof DurableSaveError);
    assert.equal(error.code, "SAVE_OPERATION_CONFLICT");
    assert.equal(error.data.operation.state, "CONFLICT");
    assert.equal(error.data.operation.receipt, null);
    return true;
  };
  await assert.rejects(x.execute(), conflict);
  assert.equal(x.operation().state, "CONFLICT");
  await assertRetainedBytes(x.store, x.snapshot, "conflict");
  const storedOperation = { ...x.operation() }, beforeRetry = x.calls.length, providerCalls = x.f.calls.length;
  await assert.rejects(x.execute(), conflict);
  assert.deepEqual(x.calls.slice(beforeRetry).map(row => row.method), ["GET"]);
  assert.deepEqual({ ...x.operation() }, storedOperation);
  assert.equal(x.f.calls.length, providerCalls);
  await assertRetainedBytes(x.store, x.snapshot, "conflict");
  await assertReopened(x.f, competing, 2);
});

test("a verified own commit advances the next explicit save base without marking newer edits as saved", async t => {
  const x = await setup(t, "first clicked version");
  const nextMap = config("new edits made while first version was saving"), newerGeneration = 2;
  let currentBase = x.snapshot.expectedConfigRevision;
  const first = await x.execute();
  assert.equal(receiptRevision(first.data), 2);
  assert.equal(confirmationMatchesEditor(x.snapshot, "feedback-http", newerGeneration), false);
  assert.equal(canAdvanceOwnSaveBase(x.snapshot, "feedback-http", currentBase, first.data), true);
  assert.equal(canAdvanceOwnSaveBase(x.snapshot, "different-editor-session", currentBase, first.data), false);
  currentBase = receiptRevision(first.data);
  const next = await prepareProjectUpdateSnapshot({
    attempt: beginClientSaveAttempt("update"), scope: x.snapshot.scope,
    projectSlug: x.project.slug, config: nextMap, expectedConfigRevision: currentBase,
    editorSessionId: "feedback-http", editGeneration: newerGeneration,
  });
  const second = await executePreparedProjectUpdate({ snapshot: next, store: x.store, fetchImpl: x.dispatch, pollIntervalMs: 1 });
  assert.notEqual(next.manifest.operationId, x.snapshot.manifest.operationId);
  assert.equal(second.data.operation.receipt.baseRevision, 2);
  assert.equal(second.data.operation.receipt.publishedRevision, 3);
  assert.equal(confirmationMatchesEditor(next, "feedback-http", newerGeneration), true);
  assert.equal(canAdvanceOwnSaveBase(next, "feedback-http", currentBase, second.data), true);
  currentBase = receiptRevision(second.data);
  assert.equal(canAdvanceOwnSaveBase(x.snapshot, "feedback-http", currentBase, first.data), false);
  assert.equal(currentBase, 3, "A late older callback cannot roll back the local base");
  await assertReopened(x.f, nextMap, 3);
});

test("a historical own receipt never advances onto a foreign head or permits overwriting it", async t => {
  const x = await setup(t, "our earlier save");
  const first = await x.execute();
  assert.equal(first.data.operation.receipt.publishedRevision, 2);
  const foreign = config("a later independent edit");
  assert.equal((await update(x.f, foreign, { operationId: "foreign-feedback-head-0001" })).status, 200);
  const historical = await x.execute();
  assert.equal(historical.data.operation.receipt.publishedRevision, 2);
  assert.equal(historical.data.operation.currentRevision, 3);
  const unchangedBase = x.snapshot.expectedConfigRevision;
  assert.equal(canAdvanceOwnSaveBase(x.snapshot, "feedback-http", unchangedBase, historical.data), false);
  assert.equal(canAdvanceOwnSaveBase(x.snapshot, "feedback-http", 3, first.data), false);
  const next = await prepareProjectUpdateSnapshot({
    attempt: beginClientSaveAttempt("update"), scope: x.snapshot.scope,
    projectSlug: x.project.slug, config: config("unsaved local changes after our earlier click"),
    expectedConfigRevision: unchangedBase, editorSessionId: "feedback-http", editGeneration: 2,
  });
  await assert.rejects(executePreparedProjectUpdate({ snapshot: next, store: x.store, fetchImpl: x.dispatch, pollIntervalMs: 1 }), error => {
    assert.ok(error instanceof DurableSaveError);
    assert.equal(error.code, "SAVE_OPERATION_CONFLICT");
    assert.equal(error.data.operation.receipt, null);
    return true;
  });
  await assertRetainedBytes(x.store, next, "conflict");
  await assertReopened(x.f, foreign, 3);
});
