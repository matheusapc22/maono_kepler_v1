import assert from "node:assert/strict";
import test from "node:test";

import {
  isLargeProjectCreationEnabled,
  isRetryableLargeCreationError,
} from "../functions/_lib/project-large-creation.js";
import { buildLargeCreateFixture } from "../scripts/large-create/build-large-create-fixture.mjs";
import {
  beginClientSaveAttempt,
} from "../src/pages/Kepler/save-observability.ts";
import {
  executeProjectCreateFlow,
  ProjectCreateFlowError,
} from "../src/pages/Kepler/project-create-flow.ts";

function response(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function pendingProject(slug = "qa-smoke-large-client") {
  return {
    ok: true,
    status: "pending",
    project: {
      id: 991,
      slug,
      active: false,
      lifecycle: { state: "PREPARING_STORAGE" },
      configRevision: 0,
    },
    configRevision: 0,
  };
}

function activeProject(slug = "qa-smoke-large-client", idempotent = false) {
  return {
    ok: true,
    status: "active",
    idempotent,
    project: {
      id: 991,
      slug,
      active: true,
      lifecycle: { state: "ACTIVE" },
      configRevision: 1,
    },
    lifecycle: { state: "ACTIVE" },
    configRevision: 1,
    sizeBytes: 9 * 1024 * 1024,
    transport: "stream",
    operation: "create",
  };
}

function createOptions({ idempotencyKey, fetchImpl, onStage = () => {} }) {
  const fixture = buildLargeCreateFixture({ targetMiB: 9 });
  return {
    attempt: beginClientSaveAttempt("create"),
    name: "QA Smoke Large Client",
    description: "Hardening do fluxo Large CREATE",
    organizationId: 9,
    idempotencyKey,
    config: fixture.config,
    legacy: null,
    fetchImpl,
    onStage,
  };
}

test("feature flag Large CREATE é fail-closed e só aceita true explícito", () => {
  for (const value of [undefined, null, "", "false", "FALSE", "0", "yes", "on"]) {
    assert.equal(
      isLargeProjectCreationEnabled({ PROJECT_CREATE_LARGE_STREAM_V1: value }),
      false,
      `valor ${String(value)} deveria manter Large CREATE desabilitado`,
    );
  }

  for (const value of [true, "true", "TRUE", " true "]) {
    assert.equal(
      isLargeProjectCreationEnabled({ PROJECT_CREATE_LARGE_STREAM_V1: value }),
      true,
    );
  }
});

test("CREATE grande executa POST metadata-first, PUT streaming e só conclui após ACTIVE", async () => {
  const calls = [];
  const stages = [];
  const idempotencyKey = "large-create-flow-0001";
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === "/api/projects") {
      const metadata = JSON.parse(String(init.body));
      assert.equal(init.method, "POST");
      assert.equal(metadata.largeConfig, true);
      assert.equal(metadata.idempotencyKey, idempotencyKey);
      assert.equal("config" in metadata, false);
      assert.ok(Number(metadata.configMetadata.sizeBytes) > 8 * 1024 * 1024);
      return response(202, pendingProject());
    }

    assert.equal(url, "/api/projects/qa-smoke-large-client/config");
    assert.equal(init.method, "PUT");
    assert.equal(init.headers["X-Maono-Creation-Key"], idempotencyKey);
    assert.equal(init.headers["X-Maono-Expected-Revision"], "0");
    assert.ok(Buffer.byteLength(String(init.body), "utf8") > 8 * 1024 * 1024);
    return response(201, activeProject());
  };

  const result = await executeProjectCreateFlow(
    createOptions({
      idempotencyKey,
      fetchImpl,
      onStage: (stage) => stages.push(stage),
    }),
  );

  assert.equal(result.transport, "stream");
  assert.equal(result.createdSlug, "qa-smoke-large-client");
  assert.equal(result.revision, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(stages, ["creating_record", "preparing_files", "finalizing"]);
});

test("resposta perdida após commit é reconciliada pelo POST idempotente sem reupload", async () => {
  const calls = [];
  const idempotencyKey = "large-create-flow-0002";
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    assert.equal(url, "/api/projects");
    return response(200, activeProject("qa-smoke-large-client", true));
  };

  const result = await executeProjectCreateFlow(
    createOptions({ idempotencyKey, fetchImpl }),
  );

  assert.equal(result.transport, "stream");
  assert.equal(result.revision, 1);
  assert.equal(result.data.idempotent, true);
  assert.equal(calls.length, 1, "retry pós-commit não deve reenviar o MapConfig");
});

test("interrupção durante PUT mantém erro no estágio de arquivos e permite retry com a mesma chave", async () => {
  const idempotencyKey = "large-create-flow-0003";
  const firstBodies = [];
  const firstFetch = async (url, init) => {
    firstBodies.push({ url, body: String(init.body) });
    if (url === "/api/projects") return response(202, pendingProject());
    return response(503, {
      ok: false,
      error: {
        code: "DROPBOX_TIMEOUT",
        message: "Storage temporariamente indisponível.",
        retryable: true,
        details: { stage: "WRITE", provider: "dropbox", providerStatus: 504 },
      },
    });
  };

  await assert.rejects(
    executeProjectCreateFlow(createOptions({ idempotencyKey, fetchImpl: firstFetch })),
    (error) => {
      assert.ok(error instanceof ProjectCreateFlowError);
      assert.equal(error.stage, "preparing_files");
      assert.equal(error.data.error.code, "DROPBOX_TIMEOUT");
      assert.equal(error.data.error.retryable, true);
      return true;
    },
  );

  const retryCalls = [];
  const retryFetch = async (url, init) => {
    retryCalls.push({ url, body: String(init.body) });
    if (url === "/api/projects") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.idempotencyKey, idempotencyKey);
      return response(202, { ...pendingProject(), idempotent: true });
    }
    assert.equal(init.headers["X-Maono-Creation-Key"], idempotencyKey);
    return response(201, activeProject("qa-smoke-large-client", true));
  };

  const retried = await executeProjectCreateFlow(
    createOptions({ idempotencyKey, fetchImpl: retryFetch }),
  );
  assert.equal(retried.revision, 1);
  assert.equal(retried.createdSlug, "qa-smoke-large-client");
  assert.equal(retryCalls.length, 2);
});

test("duas tentativas concorrentes com a mesma chave convergem para o mesmo slug/revision", async () => {
  const idempotencyKey = "large-create-flow-0004";
  let putCount = 0;
  const fetchImpl = async (url) => {
    if (url === "/api/projects") {
      return response(202, { ...pendingProject("qa-smoke-concurrent"), idempotent: true });
    }
    putCount += 1;
    return response(
      putCount === 1 ? 201 : 200,
      activeProject("qa-smoke-concurrent", putCount > 1),
    );
  };

  const [left, right] = await Promise.all([
    executeProjectCreateFlow(createOptions({ idempotencyKey, fetchImpl })),
    executeProjectCreateFlow(createOptions({ idempotencyKey, fetchImpl })),
  ]);

  assert.equal(left.createdSlug, right.createdSlug);
  assert.equal(left.revision, 1);
  assert.equal(right.revision, 1);
  assert.equal(putCount, 2);
});

test("classificação de erros recuperáveis cobre timeout, indisponibilidade e conflitos transitórios", () => {
  assert.equal(isRetryableLargeCreationError({ status: 504, code: "DROPBOX_TIMEOUT" }), true);
  assert.equal(isRetryableLargeCreationError({ status: 503, code: "DROPBOX_UNAVAILABLE" }), true);
  assert.equal(
    isRetryableLargeCreationError({ status: 409, code: "PROJECT_CREATION_REVISION_NOT_READY" }),
    true,
  );
  assert.equal(
    isRetryableLargeCreationError({ status: 409, code: "PROJECT_CREATION_REQUEST_MISMATCH" }),
    false,
  );
});
