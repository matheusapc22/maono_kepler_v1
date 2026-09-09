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
  serializeMapConfigTransport,
  serializeSaveRequest,
} from "../src/pages/Kepler/save-observability.ts";
import {
  prepareProjectCreateTransport,
} from "../src/pages/Kepler/project-create-transport.ts";
import {
  executeProjectCreateFlow,
  ProjectCreateFlowError,
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

function largeConfig(extraBytes = 1024) {
  return {
    version: "v1",
    config: { visState: { layers: [] } },
    datasets: [
      {
        info: { id: "dataset-large" },
        data: {
          id: "dataset-large",
          fields: [],
          rows: [["x".repeat(8 * 1024 * 1024 + extraBytes)]],
        },
      },
    ],
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "X-Maono-Save-Id": init.saveId ?? "save_test_response",
      "X-Correlation-Id": init.correlationId ?? "corr_test_response",
      ...(init.headers || {}),
    },
  });
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

test("CREATE classifica MapConfig grande uma vez e separa metadata do corpo streaming", () => {
  const attempt = beginClientSaveAttempt("create");
  const config = largeConfig();
  const idempotencyKey = "project-create:test-large-123456";
  const prepared = prepareProjectCreateTransport(attempt, {
    name: "Projeto grande",
    description: "Teste",
    organizationId: 9,
    idempotencyKey,
    config,
    legacy: null,
  });

  assert.equal(prepared.large, true);
  assert.equal(
    prepared.configPayloadBytes,
    Buffer.byteLength(prepared.configBody, "utf8"),
  );
  assert.ok(Buffer.byteLength(prepared.requestBody, "utf8") < 4096);
  assert.doesNotMatch(prepared.requestBody, /dataset-large.{1000}/s);

  const metadata = JSON.parse(prepared.requestBody);
  assert.equal(metadata.largeConfig, true);
  assert.equal(metadata.idempotencyKey, idempotencyKey);
  assert.equal(metadata.configMetadata.sizeBytes, prepared.configPayloadBytes);
  assert.equal(metadata.configMetadata.datasetCount, 1);

  const postHeaders = buildSaveRequestHeaders(attempt, { forceJson: true });
  assert.equal(postHeaders["Content-Type"], "application/json");
  assert.equal(postHeaders["X-Maono-Large-Config"], undefined);

  const streamHeaders = buildSaveRequestHeaders(attempt);
  assert.equal(streamHeaders["X-Maono-Large-Config"], "1");
  assert.equal(streamHeaders["X-Maono-Expected-Revision"], "0");
  assert.equal(
    Number(streamHeaders["X-Maono-Config-Size"]),
    prepared.configPayloadBytes,
  );

  const direct = serializeMapConfigTransport(attempt, config, 0);
  assert.equal(direct.large, true);
});

test("CREATE inline mantém uma única request e só conclui quando ACTIVE", async () => {
  const attempt = beginClientSaveAttempt("create");
  const calls = [];
  const stages = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(
      {
        ok: true,
        status: "active",
        configRevision: 1,
        project: {
          slug: "projeto-inline",
          active: true,
          configRevision: 1,
          lifecycle: { state: "ACTIVE" },
        },
      },
      { status: 201 },
    );
  };

  const result = await executeProjectCreateFlow({
    attempt,
    name: "Projeto inline",
    description: "Pequeno",
    organizationId: 9,
    idempotencyKey: "project-create:inline-123456",
    config: { version: "v1", config: {}, datasets: [] },
    legacy: null,
    fetchImpl,
    onStage: (stage) => stages.push(stage),
  });

  assert.equal(result.transport, "inline");
  assert.equal(result.createdSlug, "projeto-inline");
  assert.equal(result.revision, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/projects");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(stages, ["creating_record", "finalizing"]);
  const postBody = JSON.parse(calls[0].init.body);
  assert.equal(postBody.config.version, "v1");
});

test("CREATE grande faz POST metadata-first e PUT do mesmo corpo/config com a mesma chave", async () => {
  const attempt = beginClientSaveAttempt("create");
  const calls = [];
  const stages = [];
  const idempotencyKey = "project-create:stream-123456";
  const config = largeConfig(2048);
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return jsonResponse(
        {
          ok: true,
          status: "pending",
          configRevision: 0,
          project: {
            slug: "projeto-stream",
            active: false,
            configRevision: 0,
            lifecycle: { state: "PREPARING_STORAGE" },
          },
        },
        { status: 202 },
      );
    }
    return jsonResponse(
      {
        ok: true,
        status: "active",
        operation: "create",
        transport: "stream",
        configRevision: 1,
        lifecycle: { state: "ACTIVE" },
        project: {
          slug: "projeto-stream",
          active: true,
          configRevision: 1,
          lifecycle: { state: "ACTIVE" },
        },
      },
      { status: 201 },
    );
  };

  const result = await executeProjectCreateFlow({
    attempt,
    name: "Projeto stream",
    description: "Grande",
    organizationId: 9,
    idempotencyKey,
    config,
    legacy: null,
    fetchImpl,
    onStage: (stage) => stages.push(stage),
  });

  assert.equal(result.transport, "stream");
  assert.equal(result.revision, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/projects");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-Maono-Large-Config"], undefined);
  const metadata = JSON.parse(calls[0].init.body);
  assert.equal(metadata.largeConfig, true);
  assert.equal(metadata.idempotencyKey, idempotencyKey);

  assert.equal(calls[1].url, "/api/projects/projeto-stream/config");
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.headers["X-Maono-Creation-Key"], idempotencyKey);
  assert.equal(calls[1].init.headers["X-Maono-Large-Config"], "1");
  assert.equal(calls[1].init.body, result.prepared.configBody);
  assert.deepEqual(stages, [
    "creating_record",
    "preparing_files",
    "finalizing",
  ]);
});

test("retry após commit perdido não reenvia o MapConfig se POST idempotente já retorna ACTIVE", async () => {
  const attempt = beginClientSaveAttempt("create");
  const calls = [];
  const config = largeConfig(3072);
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(
      {
        ok: true,
        status: "active",
        idempotent: true,
        configRevision: 1,
        project: {
          slug: "projeto-recuperado",
          active: true,
          configRevision: 1,
          lifecycle: { state: "ACTIVE" },
        },
      },
      { status: 200 },
    );
  };

  const result = await executeProjectCreateFlow({
    attempt,
    name: "Projeto recuperado",
    description: "Retry",
    organizationId: 9,
    idempotencyKey: "project-create:retry-123456",
    config,
    legacy: null,
    fetchImpl,
  });

  assert.equal(result.transport, "stream");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/projects");
});

test("falha no PUT streaming conserva estágio e contexto para retry seguro", async () => {
  const attempt = beginClientSaveAttempt("create");
  const idempotencyKey = "project-create:failure-123456";
  let call = 0;
  const fetchImpl = async (url, init) => {
    call += 1;
    if (call === 1) {
      return jsonResponse(
        {
          ok: true,
          status: "pending",
          project: {
            slug: "projeto-falha",
            active: false,
            lifecycle: { state: "PREPARING_STORAGE" },
          },
        },
        { status: 202 },
      );
    }
    assert.equal(init.headers["X-Maono-Creation-Key"], idempotencyKey);
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "MAP_CONFIG_STORAGE_UNAVAILABLE",
          category: "STORAGE",
          retryable: true,
          message: "Dropbox indisponível",
          details: { stage: "WRITE", retryable: true },
        },
      },
      { status: 503 },
    );
  };

  await assert.rejects(
    executeProjectCreateFlow({
      attempt,
      name: "Projeto falha",
      description: "Retry seguro",
      organizationId: 9,
      idempotencyKey,
      config: largeConfig(4096),
      legacy: null,
      fetchImpl,
    }),
    (error) => {
      assert.ok(error instanceof ProjectCreateFlowError);
      assert.equal(error.stage, "preparing_files");
      assert.equal(error.data.error.code, "MAP_CONFIG_STORAGE_UNAVAILABLE");
      assert.equal(error.prepared.large, true);
      return true;
    },
  );
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
