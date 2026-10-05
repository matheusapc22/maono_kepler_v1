import assert from "node:assert/strict";
import test from "node:test";

import {
  SAVE_STAGE_SEQUENCE,
  createSaveTrace,
  getOrCreateSaveId,
  measureUtf8Bytes,
} from "../functions/_lib/save-observability.js";
import {
  beginClientSaveAttempt,
  buildSaveRequestHeaders,
  measureUtf8PayloadBytes,
  serializeMapConfigTransport,
} from "../src/pages/Kepler/save-observability.ts";
import {
  prepareProjectCreateTransport,
} from "../src/pages/Kepler/project-create-transport.ts";
import {
  executeProjectCreateFlow,
} from "../src/pages/Kepler/project-create-flow.ts";

function captureSaveLogs() {
  const originalInfo = console.info;
  const originalError = console.error;
  const entries = [];
  console.info = (...args) => entries.push({ level: "info", args });
  console.error = (...args) => entries.push({ level: "error", args });
  return {
    entries,
    restore() {
      console.info = originalInfo;
      console.error = originalError;
    },
  };
}

import { memoryStore, response, status, receipt } from "./helpers/durable-save-browser-fixtures.mjs";

test("operation ID remains stable while serializable transport headers are reconstructed", () => {
  const attempt = beginClientSaveAttempt("update");
  const config = { version: "v1", config: {}, datasets: [], title: "Maõno — Ação 🚀" };
  const transport = serializeMapConfigTransport(attempt, config, 7);
  const restored = structuredClone(transport);
  assert.equal(restored.body, JSON.stringify(config));
  assert.deepEqual(restored.headers, transport.headers);
  assert.equal(restored.headers["X-Maono-Save-Id"], attempt.saveId);
  assert.equal(restored.headers["X-Maono-Expected-Revision"], "7");
  assert.equal(restored.headers["X-Maono-Client-Contract"], "2");
  assert.equal(restored.payloadBytes, Buffer.byteLength(restored.body));
  const envelope = transport;
  assert.equal(envelope.payloadBytes, measureUtf8PayloadBytes(envelope.body));
  assert.equal(envelope.payloadBytes, measureUtf8Bytes(envelope.body));
  assert.equal(getOrCreateSaveId(new Request("https://maono.test/api/test", { headers: buildSaveRequestHeaders(attempt) })), attempt.saveId);
});
function creationOptions(overrides = {}) {
  return { attempt: beginClientSaveAttempt("create"), name: "Projeto", description: "Criação durável", organizationId: 9, actorId: "22", idempotencyKey: "project-create:test-unique", config: { version: "v1", config: {}, datasets: [] }, editorSessionId: "editor", editGeneration: 1, ...overrides };
}
function active(snapshot) {
  return response({ ok: true, project: { id: 12, slug: "created", active: true, lifecycle: { state: "ACTIVE" } }, operation: { state: "PUBLISHED", receipt: receipt(snapshot, 1), currentRevision: 1 } });
}
for (const padding of [0, 8 * 1024 * 1024 + 17]) {
  test(`creation at ${padding} padding bytes reserves metadata and uses the exact same durable protocol`, async () => {
    const store = memoryStore(); const calls = []; const options = creationOptions({ config: { version: "v1", config: {}, datasets: [], padding: "x".repeat(padding) } });
    const prepared = prepareProjectCreateTransport(options.attempt, options);
    assert.equal(JSON.parse(prepared.requestBody).durableSave, true); assert.equal("config" in JSON.parse(prepared.requestBody), false);
    assert.equal(prepared.configBody, JSON.stringify(options.config)); assert.ok(prepared.requestBody.length < 2048);
    const result = await executeProjectCreateFlow({ ...options, store, fetchImpl: async (url, init) => {
      calls.push({ url, init }); const snapshot = (await store.listAccount("22", "9"))[0]; assert.ok(snapshot.serialized.body);
      if (url === "/api/projects") return response({ ok: true, project: { id: 12, slug: "created", active: false } }, 202);
      assert.equal(init.headers["X-Maono-Creation-Key"], options.idempotencyKey);
      if (init.method === "GET") return response({ ok: false }, 404);
      if (init.method === "POST") return status("AWAITING_UPLOAD");
      assert.equal(await init.body.text(), prepared.configBody); return active(snapshot);
    } });
    assert.deepEqual(calls.map(value => value.init.method), ["POST", "GET", "POST", "PUT"]);
    assert.equal(result.revision, 1); assert.equal(result.createdSlug, "created");
    assert.equal((await store.listAccount("22", "9"))[0].serialized.body, null);
  });
}
test("lost reservation response resumes same creation metadata, operation ID and clicked bytes", async () => {
  const store = memoryStore(); const options = creationOptions(); let originalMetadata;
  await assert.rejects(executeProjectCreateFlow({ ...options, store, fetchImpl: async (_url, init) => { originalMetadata = init.body; throw new TypeError("Failed to fetch"); } }));
  const recovery = (await store.listAccount("22", "9"))[0];
  const originalBody = await recovery.serialized.body.text(); let calls = 0;
  const result = await executeProjectCreateFlow({ ...options, attempt: beginClientSaveAttempt("create"), config: { newerDraft: true }, snapshot: recovery, store, fetchImpl: async (url, init) => {
    calls++; if (url === "/api/projects") { assert.equal(init.body, originalMetadata); return response({ ok: true, project: { id: 12, slug: "created" } }, 202); }
    const stored = (await store.listAccount("22", "9"))[0];
    if (init.method === "GET") return status("AWAITING_UPLOAD");
    assert.equal(await init.body.text(), originalBody); assert.equal(init.headers["X-Maono-Save-Id"], recovery.manifest.operationId); return active(stored);
  } });
  assert.equal(calls, 3); assert.equal(result.snapshot.manifest.operationId, recovery.manifest.operationId);
});
test("creation must not report success or purge bytes without ACTIVE lifecycle", async () => {
  const store = memoryStore(); const options = creationOptions();
  await assert.rejects(executeProjectCreateFlow({ ...options, store, fetchImpl: async (url) => {
    if (url === "/api/projects") return response({ ok: true, project: { id: 12, slug: "created" } });
    const saved = (await store.listAccount("22", "9"))[0]; return response({ ok: true, operation: { state: "PUBLISHED", receipt: receipt(saved, 1) } });
  } }), /ACTIVE/);
  assert.ok((await store.listAccount("22", "9"))[0].serialized.body);
});

test("trace registra os sete estágios oficiais em ordem e publica Server-Timing", async () => {
  const capture = captureSaveLogs();
  try {
    const trace = createSaveTrace({
      saveId: "save_trace_12345678",
      correlationId: "corr_trace_12345678",
      operation: "update",
      projectId: 84,
      expectedRevision: 16,
    });
    trace.updateContext({
      organizationId: 7,
      candidateRevision: 17,
      payloadBytes: 1234,
      provider: "dropbox",
    });

    for (const stage of SAVE_STAGE_SEQUENCE) {
      await trace.stage(stage, async () => stage);
    }
    trace.finishSuccess({ httpStatus: 200 });

    const headers = trace.responseHeaders();
    assert.equal(headers["X-Maono-Save-Id"], "save_trace_12345678");
    assert.equal(headers["X-Correlation-Id"], "corr_trace_12345678");
    for (const stage of SAVE_STAGE_SEQUENCE) {
      assert.match(headers["Server-Timing"], new RegExp(`${stage.toLowerCase()};dur=`));
    }

    const payloads = capture.entries
      .filter((entry) => entry.args[0] === "[Maono save]")
      .map((entry) => entry.args[1]);
    const stages = payloads
      .filter((payload) => payload.event === "project_save_stage")
      .map((payload) => payload.stage);
    assert.deepEqual(stages, SAVE_STAGE_SEQUENCE);
    assert.equal(payloads.at(-1).event, "project_save_completed");
  } finally {
    capture.restore();
  }
});

test("falha de estágio mantém evento do estágio e terminal normalizado separados", async () => {
  const capture = captureSaveLogs();
  try {
    const trace = createSaveTrace({
      saveId: "save_failure_12345678",
      correlationId: "corr_failure_12345678",
      operation: "update",
      projectId: 84,
    });
    trace.updateContext({ provider: "dropbox" });

    const storageError = Object.assign(new Error("storage unavailable"), {
      status: 503,
      code: "MAP_CONFIG_STORAGE_UNAVAILABLE",
      category: "STORAGE",
      retryable: true,
      details: { stage: "WRITE", provider: "dropbox", retryable: true },
    });

    await assert.rejects(
      trace.stage("WRITE", async () => {
        throw storageError;
      }),
      /storage unavailable/,
    );
    assert.equal(
      trace.fail(storageError, {
        stage: "WRITE",
        httpStatus: 503,
        category: "STORAGE",
        retryable: true,
      }),
      true,
    );

    const payloads = capture.entries
      .filter((entry) => entry.args[0] === "[Maono save]")
      .map((entry) => entry.args[1]);
    assert.deepEqual(
      payloads.map((payload) => [payload.event, payload.result]),
      [
        ["project_save_stage", "error"],
        ["project_save_failed", "error"],
      ],
    );
    assert.equal(payloads.at(-1).stage, "WRITE");
    assert.equal(payloads.at(-1).category, "STORAGE");
    assert.equal(payloads.at(-1).retryable, true);
  } finally {
    capture.restore();
  }
});

for (const missing of ["expired", "removed"]) test(`unreserved creation with ${missing} exact bytes needs action without issuing any request`, async () => {
  const { prepareProjectUpdateSnapshot } = await import("../src/pages/Kepler/durable-save-controller.ts");
  const store = memoryStore(); const options = creationOptions();
  const prepared = prepareProjectCreateTransport(options.attempt, options);
  const snapshot = await prepareProjectUpdateSnapshot({ attempt: options.attempt, scope: { actorId: "22", organizationId: "9", projectKey: `create:${options.idempotencyKey}` }, projectSlug: "", config: options.config, expectedConfigRevision: 0, editorSessionId: "editor", editGeneration: 1, creation: { requestBody: prepared.requestBody, idempotencyKey: options.idempotencyKey } });
  if (missing === "expired") snapshot.expiresAt = Date.now() - 1;
  else snapshot.serialized.body = null;
  await store.put(snapshot);
  let fetches = 0; const phases = [];
  await assert.rejects(executeProjectCreateFlow({ ...options, snapshot, store, onPhase: phase => phases.push(phase), fetchImpl: async () => { fetches++; throw new Error("No reservation should be sent"); } }), error => error.code === "LOCAL_SAVE_CREATION_PAYLOAD_UNAVAILABLE" && /Nenhuma nova reserva/.test(error.message));
  assert.equal(fetches, 0);
  assert.deepEqual(phases, ["NEEDS_ACTION"]);
  assert.equal((await store.get(snapshot.key)).localState, "expired");
});

test("bound expired creation still retrieves historical receipt and purges reservation metadata", async () => {
  const { prepareProjectUpdateSnapshot } = await import("../src/pages/Kepler/durable-save-controller.ts");
  const store = memoryStore(); const options = creationOptions();
  const prepared = prepareProjectCreateTransport(options.attempt, options);
  const snapshot = await prepareProjectUpdateSnapshot({ attempt: options.attempt, scope: { actorId: "22", organizationId: "9", projectKey: `create:${options.idempotencyKey}`, projectId: "12" }, projectSlug: "created", config: options.config, expectedConfigRevision: 0, editorSessionId: "editor", editGeneration: 1, creation: { requestBody: prepared.requestBody, idempotencyKey: options.idempotencyKey } });
  snapshot.expiresAt = Date.now() - 1; snapshot.serialized.body = null; snapshot.localState = "expired";
  await store.put(snapshot);
  const methods = [];
  const result = await executeProjectCreateFlow({ ...options, snapshot, store, fetchImpl: async (_url, init) => { methods.push(init.method); return active(snapshot); } });
  assert.deepEqual(methods, ["GET"]); assert.equal(result.revision, 1);
  const confirmed = await store.get(snapshot.key);
  assert.equal(confirmed.creation.requestBody, null);
  assert.equal(confirmed.creation.idempotencyKey, options.idempotencyKey);
  // Purged reservation metadata remains unnecessary for another historical lookup.
  await executeProjectCreateFlow({ ...options, snapshot: confirmed, store, fetchImpl: async (_url, init) => { methods.push(init.method); return active(snapshot); } });
  assert.deepEqual(methods, ["GET", "GET"]);
});
