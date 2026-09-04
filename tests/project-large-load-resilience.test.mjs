import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MapConfigStreamError,
  loadProjectConfigStream,
} from "../src/pages/Kepler/map-url-loader/project-config-stream-client.ts";

const encoder = new TextEncoder();
const configStreamSource = readFileSync(
  new URL("../functions/api/projects/[slug]/config-stream.js", import.meta.url),
  "utf8",
);

function descriptorResponse({
  revision = 17,
  sizeBytes,
  correlationId = "corr-load-01h4-1234",
  downloadUrl = "https://dl.dropboxusercontent.com/apitl/1/direct-config",
} = {}) {
  return new Response(
    JSON.stringify({
      ok: true,
      transport: "direct",
      downloadUrl,
      projectId: 42,
      revision,
      sizeBytes,
      schemaName: "kepler",
      schemaVersion: 3,
      correlationId,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
        "X-Maono-Config-Transport": "direct",
        "X-Maono-Config-Revision": String(revision),
        "X-Maono-Config-Size": String(sizeBytes),
      },
    },
  );
}

function directDownloadResponse(text, { truncateAt = null, status = 200 } = {}) {
  const bytes = encoder.encode(text);
  const sent = truncateAt === null ? bytes : bytes.slice(0, truncateAt);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(sent);
        controller.close();
      },
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(bytes.byteLength),
      },
    },
  );
}

function revisionChangedResponse() {
  return new Response(
    JSON.stringify({
      error: {
        code: "PROJECT_CONFIG_STREAM_REVISION_CHANGED",
        category: "PROJECT_CONFIG",
        retryable: false,
        message: "A revisão publicada mudou.",
      },
    }),
    {
      status: 409,
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-Id": "corr-load-01h4-1234",
      },
    },
  );
}

function worker1102Response() {
  return new Response(
    JSON.stringify({
      type: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1102/",
      title: "Error 1102: Worker exceeded resource limits",
      status: 503,
      detail: "A Worker script exceeded its resource limits.",
      error_code: 1102,
      error_name: "worker_exceeded_resources",
      cloudflare_error: true,
      retryable: false,
      owner_action_required: true,
    }),
    {
      status: 503,
      headers: { "Content-Type": "application/json" },
    },
  );
}

const noWait = async () => undefined;
const isDescriptorRequest = (url) => String(url).includes("/config-stream?delivery=direct");

test("LOAD-01H4 mantém Worker fora do data plane no modo direct", () => {
  assert.match(configStreamSource, /files\.get_temporary_link/);
  assert.match(configStreamSource, /directDeliveryRequested\(request\)/);
  assert.match(configStreamSource, /"X-Maono-Config-Transport": "direct"/);

  const start = configStreamSource.indexOf("if (directDeliveryRequested(request))");
  const end = configStreamSource.indexOf("const {\n      upstream,", start);
  assert.ok(start >= 0 && end > start, "bloco direct deve existir antes do proxy legado");
  const directBlock = configStreamSource.slice(start, end);
  assert.doesNotMatch(directBlock, /downloadDropboxBinaryFile/);
  assert.doesNotMatch(directBlock, /temporary\.downloadUrl[^,\n]*console/);
});

test("descriptor + download direto completo fazem uma única tentativa lógica", async () => {
  const calls = [];
  const attempts = [];
  const configText = JSON.stringify({ datasets: [], config: { version: "v1" } });
  const sizeBytes = encoder.encode(configText).byteLength;

  const result = await loadProjectConfigStream(
    "projeto-grande",
    new AbortController().signal,
    {
      correlationId: "corr-logical-open-1234",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return isDescriptorRequest(url)
          ? descriptorResponse({ sizeBytes })
          : directDownloadResponse(configText);
      },
      sleep: noWait,
      random: () => 0,
      onAttempt: (attempt) => attempts.push(attempt),
    },
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /config-stream\?delivery=direct$/);
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(calls[0].init.headers["X-Correlation-Id"], "corr-logical-open-1234");
  assert.match(calls[1].url, /^https:\/\//);
  assert.equal(calls[1].init.credentials, "omit");
  assert.equal(calls[1].init.referrerPolicy, "no-referrer");
  assert.equal(result.attemptCount, 1);
  assert.equal(result.revision, 17);
  assert.equal(result.sizeBytes, sizeBytes);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].outcome, "success");
});

test("EOF direto prematuro faz exatamente um retry com novo descriptor pinado", async () => {
  const attempts = [];
  const calls = [];
  const configText = JSON.stringify({ datasets: [{ id: "large" }], config: {} });
  const sizeBytes = encoder.encode(configText).byteLength;
  let descriptorCalls = 0;
  let downloadCalls = 0;

  const result = await loadProjectConfigStream(
    "projeto-grande",
    new AbortController().signal,
    {
      correlationId: "corr-logical-open-5678",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (isDescriptorRequest(url)) {
          descriptorCalls += 1;
          if (descriptorCalls === 2) {
            assert.equal(init.headers["X-Maono-Expected-Config-Revision"], "23");
          }
          return descriptorResponse({
            revision: 23,
            sizeBytes,
            downloadUrl: `https://dl.dropboxusercontent.com/direct-${descriptorCalls}`,
          });
        }
        downloadCalls += 1;
        return downloadCalls === 1
          ? directDownloadResponse(configText, { truncateAt: 12 })
          : directDownloadResponse(configText);
      },
      sleep: noWait,
      random: () => 0,
      onAttempt: (attempt) => attempts.push(attempt),
    },
  );

  assert.equal(result.attemptCount, 2);
  assert.equal(descriptorCalls, 2);
  assert.equal(downloadCalls, 2);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].init.headers["X-Maono-Expected-Config-Revision"], undefined);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].code, "MAP_CONFIG_STREAM_INTERRUPTED");
  assert.equal(attempts[0].failureClass, "body");
  assert.equal(attempts[0].retryScheduled, true);
  assert.equal(attempts[1].outcome, "success");
  assert.ok(attempts[0].receivedBytes < attempts[0].expectedSizeBytes);
});

test("retry pinado rejeita mudança de HEAD antes de gerar novo download", async () => {
  const configText = JSON.stringify({ datasets: [{ id: "large" }], config: {} });
  const sizeBytes = encoder.encode(configText).byteLength;
  let calls = 0;

  await assert.rejects(
    loadProjectConfigStream(
      "projeto-grande",
      new AbortController().signal,
      {
        fetchImpl: async (url, init) => {
          calls += 1;
          if (calls === 1) return descriptorResponse({ revision: 31, sizeBytes });
          if (calls === 2) return directDownloadResponse(configText, { truncateAt: 8 });
          assert.ok(isDescriptorRequest(url));
          assert.equal(init.headers["X-Maono-Expected-Config-Revision"], "31");
          return revisionChangedResponse();
        },
        sleep: noWait,
        random: () => 0,
      },
    ),
    (error) => {
      assert.ok(error instanceof MapConfigStreamError);
      assert.equal(error.code, "MAP_CONFIG_STREAM_REVISION_CHANGED");
      assert.equal(error.retryable, false);
      assert.equal(error.failureClass, "revision_changed");
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("JSON direto completo e inválido não recebe retry", async () => {
  const invalid = "{\"datasets\":[}";
  const sizeBytes = encoder.encode(invalid).byteLength;
  let calls = 0;

  await assert.rejects(
    loadProjectConfigStream(
      "json-invalido",
      new AbortController().signal,
      {
        fetchImpl: async (url) => {
          calls += 1;
          return isDescriptorRequest(url)
            ? descriptorResponse({ revision: 9, sizeBytes })
            : directDownloadResponse(invalid);
        },
        sleep: noWait,
      },
    ),
    (error) => {
      assert.equal(error.code, "MAP_CONFIG_STORED_JSON_INVALID");
      assert.equal(error.retryable, false);
      assert.equal(error.failureClass, "parse");
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("trace 62.888.490/90.018.649 continua truncamento, agora fora do Worker", async () => {
  const advertisedBytes = 90_018_649;
  const receivedFixture = "{\"partial\":true}";
  let calls = 0;

  await assert.rejects(
    loadProjectConfigStream(
      "trace-producao",
      new AbortController().signal,
      {
        fetchImpl: async (url) => {
          calls += 1;
          if (isDescriptorRequest(url)) {
            return descriptorResponse({
              revision: 44,
              sizeBytes: advertisedBytes,
              downloadUrl: `https://dl.dropboxusercontent.com/trace-${calls}`,
            });
          }
          return directDownloadResponse(receivedFixture);
        },
        sleep: noWait,
        random: () => 0,
      },
    ),
    (error) => {
      assert.equal(error.code, "MAP_CONFIG_STREAM_INTERRUPTED");
      assert.notEqual(error.code, "MAP_CONFIG_STORED_JSON_INVALID");
      assert.equal(error.expectedSizeBytes, advertisedBytes);
      return true;
    },
  );
  assert.equal(calls, 4, "duas tentativas lógicas = dois descriptors + dois downloads");
});

test("Cloudflare 1102 é terminal e não dispara novo download ou retry", async () => {
  let calls = 0;
  await assert.rejects(
    loadProjectConfigStream(
      "worker-limit",
      new AbortController().signal,
      {
        fetchImpl: async () => {
          calls += 1;
          return worker1102Response();
        },
        sleep: noWait,
      },
    ),
    (error) => {
      assert.equal(error.code, "MAP_CONFIG_WORKER_RESOURCE_LIMIT");
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("deploy drift não consome proxy legado como fallback", async () => {
  let calls = 0;
  await assert.rejects(
    loadProjectConfigStream(
      "backend-antigo",
      new AbortController().signal,
      {
        fetchImpl: async () => {
          calls += 1;
          return new Response("{\"large\":true}", {
            status: 200,
            headers: {
              "X-Maono-Config-Transport": "stream",
              "X-Maono-Config-Revision": "12",
              "X-Maono-Config-Size": "99999999",
            },
          });
        },
        sleep: noWait,
      },
    ),
    (error) => {
      assert.equal(error.code, "MAP_CONFIG_DIRECT_DELIVERY_UNAVAILABLE");
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("abort antes da abertura não inicia descriptor nem download", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("navigation", "AbortError"));
  let calls = 0;

  await assert.rejects(
    loadProjectConfigStream("abortado", controller.signal, {
      fetchImpl: async () => {
        calls += 1;
        return descriptorResponse({ sizeBytes: 2 });
      },
      sleep: noWait,
    }),
    /navigation|abort/i,
  );
  assert.equal(calls, 0);
});
