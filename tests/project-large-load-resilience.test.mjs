import assert from "node:assert/strict";
import test from "node:test";

import {
  MapConfigStreamError,
  loadProjectConfigStream,
} from "../src/pages/Kepler/map-url-loader/project-config-stream-client.ts";

const encoder = new TextEncoder();

function streamResponse(text, {
  revision = 17,
  truncateAt = null,
  correlationId = "corr-load-01h2-1234",
} = {}) {
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
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(bytes.byteLength),
        "X-Correlation-Id": correlationId,
        "X-Maono-Config-Transport": "stream",
        "X-Maono-Project-Id": "42",
        "X-Maono-Config-Revision": String(revision),
        "X-Maono-Config-Size": String(bytes.byteLength),
        "X-Maono-Config-Schema": "kepler",
        "X-Maono-Config-Schema-Version": "3",
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
        "X-Correlation-Id": "corr-load-01h2-1234",
      },
    },
  );
}

const noWait = async () => undefined;

test("body completo e JSON válido faz uma única transferência", async () => {
  const calls = [];
  const attempts = [];
  const configText = JSON.stringify({ datasets: [], config: { version: "v1" } });

  const result = await loadProjectConfigStream(
    "projeto-grande",
    new AbortController().signal,
    {
      correlationId: "corr-logical-open-1234",
      fetchImpl: async (_url, init) => {
        calls.push(init);
        return streamResponse(configText);
      },
      sleep: noWait,
      random: () => 0,
      onAttempt: (attempt) => attempts.push(attempt),
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(result.attemptCount, 1);
  assert.equal(result.revision, 17);
  assert.equal(result.sizeBytes, encoder.encode(configText).byteLength);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].outcome, "success");
  assert.equal(calls[0].headers["X-Correlation-Id"], "corr-logical-open-1234");
});

test("EOF prematuro é detectado antes do parse e dispara exatamente um retry pinado", async () => {
  const calls = [];
  const attempts = [];
  const configText = JSON.stringify({ datasets: [{ id: "large" }], config: {} });
  let call = 0;

  const result = await loadProjectConfigStream(
    "projeto-grande",
    new AbortController().signal,
    {
      correlationId: "corr-logical-open-5678",
      fetchImpl: async (_url, init) => {
        calls.push(init);
        call += 1;
        return call === 1
          ? streamResponse(configText, { truncateAt: 12, revision: 23 })
          : streamResponse(configText, { revision: 23 });
      },
      sleep: noWait,
      random: () => 0,
      onAttempt: (attempt) => attempts.push(attempt),
    },
  );

  assert.equal(result.attemptCount, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers["X-Maono-Expected-Config-Revision"], undefined);
  assert.equal(calls[1].headers["X-Maono-Expected-Config-Revision"], "23");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].code, "MAP_CONFIG_STREAM_INTERRUPTED");
  assert.equal(attempts[0].failureClass, "body");
  assert.equal(attempts[0].retryScheduled, true);
  assert.equal(attempts[1].outcome, "success");
  assert.ok(attempts[0].receivedBytes < attempts[0].expectedSizeBytes);
});

test("retry pinado rejeita mudança de HEAD como REVISION_CHANGED", async () => {
  const configText = JSON.stringify({ datasets: [{ id: "large" }], config: {} });
  let call = 0;

  await assert.rejects(
    loadProjectConfigStream(
      "projeto-grande",
      new AbortController().signal,
      {
        fetchImpl: async (_url, init) => {
          call += 1;
          if (call === 1) return streamResponse(configText, { truncateAt: 8, revision: 31 });
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
  assert.equal(call, 2);
});

test("JSON completo sintaticamente inválido é STORED_JSON_INVALID e não recebe retry", async () => {
  let calls = 0;
  const invalid = "{\"datasets\":[}";

  await assert.rejects(
    loadProjectConfigStream(
      "json-invalido",
      new AbortController().signal,
      {
        fetchImpl: async () => {
          calls += 1;
          return streamResponse(invalid, { revision: 9 });
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
  assert.equal(calls, 1);
});

test("trace de produção 62.888.490/90.018.649 é classificado como truncamento, não JSON inválido", async () => {
  const advertisedBytes = 90_018_649;
  const receivedFixture = encoder.encode("{\"partial\":true}");
  let calls = 0;

  await assert.rejects(
    loadProjectConfigStream(
      "trace-producao",
      new AbortController().signal,
      {
        fetchImpl: async () => {
          calls += 1;
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(receivedFixture);
                controller.close();
              },
            }),
            {
              status: 200,
              headers: {
                "X-Maono-Config-Transport": "stream",
                "X-Maono-Config-Revision": "44",
                "X-Maono-Config-Size": String(advertisedBytes),
              },
            },
          );
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
  assert.equal(calls, 2, "truncamento transitório deve fazer no máximo uma repetição");
});

test("abort antes da abertura não inicia download nem agenda retry", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("navigation", "AbortError"));
  let calls = 0;

  await assert.rejects(
    loadProjectConfigStream("abortado", controller.signal, {
      fetchImpl: async () => {
        calls += 1;
        return streamResponse("{}");
      },
      sleep: noWait,
    }),
    /navigation|abort/i,
  );
  assert.equal(calls, 0);
});
