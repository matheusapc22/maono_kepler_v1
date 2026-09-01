import assert from "node:assert/strict";
import test from "node:test";

import {
  SAVE_STAGE_SEQUENCE,
  createSaveTrace,
  getOrCreateSaveId,
  measureUtf8Bytes,
  readSaveJsonBody,
} from "../functions/_lib/save-observability.js";
import {
  beginClientSaveAttempt,
  buildSaveRequestHeaders,
  measureUtf8PayloadBytes,
  serializeSaveRequest,
} from "../src/pages/Kepler/save-observability.ts";

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

test("cada tentativa lógica recebe saveId e correlationId estáveis na request", () => {
  const first = beginClientSaveAttempt("update");
  const second = beginClientSaveAttempt("update");

  assert.match(first.saveId, /^save_/);
  assert.match(first.correlationId, /^corr_/);
  assert.notEqual(first.saveId, second.saveId);
  assert.notEqual(first.correlationId, second.correlationId);

  const headersA = buildSaveRequestHeaders(first);
  const headersB = buildSaveRequestHeaders(first);
  assert.equal(headersA["X-Maono-Save-Id"], first.saveId);
  assert.equal(headersA["X-Correlation-Id"], first.correlationId);
  assert.deepEqual(headersA, headersB);

  const request = new Request("https://maono.test/api/projects/demo/config", {
    headers: { "X-Maono-Save-Id": first.saveId },
  });
  assert.equal(getOrCreateSaveId(request), first.saveId);
});

test("payloadBytes mede bytes UTF-8 reais e o mesmo body é enviado", async () => {
  const attempt = beginClientSaveAttempt("update");
  const payload = {
    title: "Maõno — João — Ação 🚀",
    config: { version: "v1", config: {}, datasets: [] },
  };
  const serialized = serializeSaveRequest(attempt, payload);

  assert.equal(
    serialized.payloadBytes,
    Buffer.byteLength(serialized.body, "utf8"),
  );
  assert.equal(
    measureUtf8PayloadBytes(serialized.body),
    Buffer.byteLength(serialized.body, "utf8"),
  );
  assert.equal(
    measureUtf8Bytes(serialized.body),
    Buffer.byteLength(serialized.body, "utf8"),
  );
  assert.notEqual(serialized.payloadBytes, serialized.body.length);

  const trace = createSaveTrace({
    saveId: attempt.saveId,
    correlationId: attempt.correlationId,
    operation: "update",
  });
  const request = new Request("https://maono.test/api/projects/demo/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: serialized.body,
  });
  const parsed = await readSaveJsonBody(request, trace);
  assert.deepEqual(parsed, payload);
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
