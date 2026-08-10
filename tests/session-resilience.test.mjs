import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SessionRequestTimeoutError,
  classifySessionResponse,
  fetchSessionResponseWithRetry,
} from "../src/auth/session-resilience.ts";

const noWait = async () => {};

function jsonResponse(status, payload = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("401 representa sessão expirada e não é retentado", async () => {
  let calls = 0;
  const result = await fetchSessionResponseWithRetry({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(401, { error: { code: "SESSION_EXPIRED" } });
    },
    retryDelaysMs: [0, 0],
    waitImpl: noWait,
  });

  assert.equal(result.response.status, 401);
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
  assert.deepEqual(classifySessionResponse(401, true), {
    disposition: "unauthenticated",
    health: "unauthenticated",
  });
});

test("403 preserva sessão válida e não é retentado", async () => {
  let calls = 0;
  const result = await fetchSessionResponseWithRetry({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(403, { error: { code: "FORBIDDEN" } });
    },
    retryDelaysMs: [0, 0],
    waitImpl: noWait,
  });

  assert.equal(result.response.status, 403);
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
  assert.deepEqual(classifySessionResponse(403, true), {
    disposition: "preserve",
    health: "healthy",
  });
  assert.deepEqual(classifySessionResponse(403, false), {
    disposition: "preserve",
    health: "degraded",
  });
});

test("429 executa retry e termina degradado sem invalidar sessão", async () => {
  let calls = 0;
  const result = await fetchSessionResponseWithRetry({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(429, { error: { code: "RATE_LIMITED" } });
    },
    retryDelaysMs: [0, 0],
    waitImpl: noWait,
  });

  assert.equal(calls, 3);
  assert.equal(result.attempts, 3);
  assert.equal(result.response.status, 429);
  assert.deepEqual(classifySessionResponse(429, true), {
    disposition: "preserve",
    health: "degraded",
  });
});

test("500 executa retry e termina degradado sem invalidar sessão", async () => {
  let calls = 0;
  const result = await fetchSessionResponseWithRetry({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(500, { error: { code: "SESSION_ERROR" } });
    },
    retryDelaysMs: [0, 0],
    waitImpl: noWait,
  });

  assert.equal(calls, 3);
  assert.equal(result.attempts, 3);
  assert.equal(result.response.status, 500);
  assert.deepEqual(classifySessionResponse(500, true), {
    disposition: "preserve",
    health: "degraded",
  });
});

test("timeout é retentado e reportado como degradação de infraestrutura", async () => {
  let calls = 0;
  const hangingFetch = async (_url, init = {}) => {
    calls += 1;

    return await new Promise((_resolve, reject) => {
      const signal = init.signal;

      if (signal?.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
        return;
      }

      signal?.addEventListener(
        "abort",
        () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });
  };

  await assert.rejects(
    fetchSessionResponseWithRetry({
      fetchImpl: hangingFetch,
      timeoutMs: 5,
      retryDelaysMs: [0, 0],
      waitImpl: noWait,
    }),
    (error) => error instanceof SessionRequestTimeoutError,
  );

  assert.equal(calls, 3);
});

test("offline preserva a última sessão após esgotar as tentativas", async () => {
  let calls = 0;

  await assert.rejects(
    fetchSessionResponseWithRetry({
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError("Failed to fetch");
      },
      retryDelaysMs: [0, 0],
      waitImpl: noWait,
    }),
    /Failed to fetch/,
  );

  assert.equal(calls, 3);
});

test("recuperação após falha transitória aplica a resposta saudável", async () => {
  let calls = 0;
  const result = await fetchSessionResponseWithRetry({
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        return jsonResponse(500, { error: { code: "TEMPORARY" } });
      }

      return jsonResponse(200, {
        authenticated: true,
        user: { id: 1, email: "user@example.com", role: "owner" },
        projects: [],
      });
    },
    retryDelaysMs: [0, 0],
    waitImpl: noWait,
  });

  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.response.status, 200);
  assert.deepEqual(classifySessionResponse(200, true), {
    disposition: "apply",
    health: "healthy",
  });
});

test("refreshSession só limpa estado conhecido em 401 ou logout explícito", async () => {
  const source = await readFile(
    new URL("../src/auth/session.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /policy\.disposition === "unauthenticated"[\s\S]*?applySession\(EMPTY_SESSION\)/,
  );
  assert.match(
    source,
    /finally \{[\s\S]*?applySession\(EMPTY_SESSION\);[\s\S]*?setHealth\("unauthenticated"\)/,
  );

  const refreshBlock = source.match(
    /const refreshSession = useCallback\([\s\S]*?const clearOrganizationSwitchError/,
  )?.[0];

  assert.ok(refreshBlock, "refreshSession deve permanecer identificável no provider.");
  assert.doesNotMatch(
    refreshBlock,
    /catch \(error\)[\s\S]*?applySession\(EMPTY_SESSION\)/,
  );
  assert.match(refreshBlock, /setHealth\("degraded"\)/);
});
