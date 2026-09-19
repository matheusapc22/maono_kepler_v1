import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_LOGIN_REQUEST_TIMEOUT_MS,
  fetchAuthLoginWithDeadline,
  isAuthRequestAbort,
} from "../src/auth/login-resilience.ts";
import { normalizeUserError } from "../src/lib/user-error-catalog.ts";

function hangingFetch(_input, init = {}) {
  return new Promise((_resolve, reject) => {
    if (init.signal?.aborted) {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
      return;
    }

    init.signal?.addEventListener(
      "abort",
      () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      },
      { once: true },
    );
  });
}

test("deadline de Auth é opt-in e limitado ao login", async () => {
  assert.equal(AUTH_LOGIN_REQUEST_TIMEOUT_MS, 15_000);

  await assert.rejects(
    fetchAuthLoginWithDeadline({
      init: { method: "POST" },
      fetchImpl: hangingFetch,
      timeoutMs: 5,
    }),
    (error) => {
      assert.equal(error.code, "AUTH_LOGIN_TIMEOUT");
      assert.equal(error.status, 408);
      assert.equal(error.category, "AUTH");
      assert.equal(error.retryable, true);
      assert.equal(
        normalizeUserError(error).message,
        "A conexão demorou mais que o esperado. Tente entrar novamente.",
      );
      return true;
    },
  );
});

test("abort externo prevalece sobre deadline", async () => {
  const controller = new AbortController();
  const pending = fetchAuthLoginWithDeadline({
    init: { method: "POST" },
    fetchImpl: hangingFetch,
    signal: controller.signal,
    timeoutMs: 100,
  });

  controller.abort();

  await assert.rejects(pending, (error) => {
    assert.equal(isAuthRequestAbort(error), true);
    return true;
  });
});

test("signal já abortado não inicia request", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    fetchAuthLoginWithDeadline({
      init: { method: "POST" },
      signal: controller.signal,
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 204 });
      },
    }),
    (error) => isAuthRequestAbort(error),
  );

  assert.equal(calls, 0);
});

test("sucesso antes do deadline preserva resposta", async () => {
  const response = await fetchAuthLoginWithDeadline({
    init: { method: "POST" },
    timeoutMs: 100,
    fetchImpl: async (_input, init) => {
      assert.ok(init.signal);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal(response.status, 200);
});
