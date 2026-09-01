import assert from "node:assert/strict";
import test from "node:test";

import {
  __dropboxClientTesting,
  createDropboxClient,
} from "../functions/_lib/dropbox-client.js";

const ENV = {
  DROPBOX_APP_KEY: "app-key",
  DROPBOX_APP_SECRET: "app-secret",
  DROPBOX_REFRESH_TOKEN: "refresh-secret",
};

function response(status, body = "{}", headers = {}) {
  return new Response(body, { status, headers });
}

function requestOptions(overrides = {}) {
  return {
    operation: "files.test",
    url: "https://api.dropboxapi.com/2/files/test",
    auth: false,
    timeoutMs: 1_000,
    budgetMs: 15_000,
    buildInit: () => ({ method: "POST" }),
    ...overrides,
  };
}

test("503 transitório é recuperado automaticamente", async () => {
  const statuses = [503, 200];
  const sleeps = [];
  let calls = 0;
  const client = createDropboxClient(ENV, {
    fetchFn: async () => {
      calls += 1;
      return response(statuses.shift());
    },
    sleepFn: async (ms) => sleeps.push(ms),
    randomFn: () => 0,
    metricFn: () => {},
  });

  const result = await client.request(requestOptions());
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [250]);
});

test("502 e 504 entram na mesma política de recuperação", async (t) => {
  for (const status of [502, 504]) {
    await t.test(String(status), async () => {
      let calls = 0;
      const client = createDropboxClient(ENV, {
        fetchFn: async () => {
          calls += 1;
          return response(calls === 1 ? status : 200);
        },
        sleepFn: async () => {},
        randomFn: () => 0.5,
        metricFn: () => {},
      });
      const result = await client.request(requestOptions());
      assert.equal(result.status, 200);
      assert.equal(calls, 2);
    });
  }
});

test("falha de rede faz retry e pode recuperar", async () => {
  let calls = 0;
  const client = createDropboxClient(ENV, {
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("network down");
      return response(200);
    },
    sleepFn: async () => {},
    randomFn: () => 0,
    metricFn: () => {},
  });

  const result = await client.request(requestOptions());
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
});

test("429 respeita Retry-After antes de repetir", async () => {
  let calls = 0;
  const sleeps = [];
  const client = createDropboxClient(ENV, {
    fetchFn: async () => {
      calls += 1;
      return calls === 1
        ? response(429, "{}", { "Retry-After": "2" })
        : response(200);
    },
    sleepFn: async (ms) => sleeps.push(ms),
    metricFn: () => {},
  });

  const result = await client.request(requestOptions());
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2_000]);
});

test("Retry-After maior que o budget encerra com DROPBOX_RATE_LIMITED", async () => {
  let calls = 0;
  const sleeps = [];
  const client = createDropboxClient(ENV, {
    fetchFn: async () => {
      calls += 1;
      return response(429, "{}", { "Retry-After": "30" });
    },
    sleepFn: async (ms) => sleeps.push(ms),
    metricFn: () => {},
  });

  await assert.rejects(
    () => client.request(requestOptions({ budgetMs: 2_000 })),
    (error) => {
      assert.equal(error.code, "DROPBOX_RATE_LIMITED");
      assert.equal(error.status, 429);
      assert.equal(error.retryable, true);
      assert.equal(error.details?.attempts, 1);
      assert.equal(error.details?.retryAfterMs, 30_000);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("400 e 409 não entram em retry automático", async (t) => {
  for (const status of [400, 409]) {
    await t.test(String(status), async () => {
      let calls = 0;
      const client = createDropboxClient(ENV, {
        fetchFn: async () => {
          calls += 1;
          return response(status, '{"error":"content conflict"}');
        },
        sleepFn: async () => {
          assert.fail("não deveria dormir para resposta não recuperável");
        },
        metricFn: () => {},
      });
      const result = await client.request(requestOptions());
      assert.equal(result.status, status);
      assert.equal(calls, 1);
    });
  }
});

test("401 e 403 viram DROPBOX_AUTH_FAILED sem retry", async (t) => {
  for (const status of [401, 403]) {
    await t.test(String(status), async () => {
      let calls = 0;
      const client = createDropboxClient(ENV, {
        fetchFn: async () => {
          calls += 1;
          return response(status);
        },
        sleepFn: async () => {
          assert.fail("auth não deve entrar em backoff");
        },
        metricFn: () => {},
      });
      await assert.rejects(
        () => client.request(requestOptions()),
        (error) => {
          assert.equal(error.code, "DROPBOX_AUTH_FAILED");
          assert.equal(error.retryable, false);
          assert.equal(error.providerStatus, status);
          return true;
        },
      );
      assert.equal(calls, 1);
    });
  }
});

test("timeout usa AbortController e devolve DROPBOX_TIMEOUT", async () => {
  const client = createDropboxClient(ENV, {
    fetchFn: async (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
    metricFn: () => {},
  });

  await assert.rejects(
    () => client.request(requestOptions({ timeoutMs: 50, maxRetries: 0 })),
    (error) => {
      assert.equal(error.code, "DROPBOX_TIMEOUT");
      assert.equal(error.status, 504);
      assert.equal(error.retryable, true);
      assert.equal(error.details?.attempts, 1);
      return true;
    },
  );
});

test("access token válido é reutilizado entre operações", async () => {
  let tokenCalls = 0;
  let apiCalls = 0;
  const client = createDropboxClient(ENV, {
    fetchFn: async (url) => {
      if (String(url).includes("/oauth2/token")) {
        tokenCalls += 1;
        return response(200, JSON.stringify({
          access_token: "access-secret",
          expires_in: 3600,
        }), { "Content-Type": "application/json" });
      }
      apiCalls += 1;
      return response(200);
    },
    metricFn: () => {},
  });

  const options = requestOptions({
    auth: true,
    buildInit: ({ accessToken }) => {
      assert.equal(accessToken, "access-secret");
      return { method: "POST" };
    },
  });
  await client.request(options);
  await client.request(options);
  assert.equal(tokenCalls, 1);
  assert.equal(apiCalls, 2);
});

test("refresh de token concorrente é single-flight", async () => {
  let tokenCalls = 0;
  const client = createDropboxClient(ENV, {
    fetchFn: async (url) => {
      assert.match(String(url), /oauth2\/token/);
      tokenCalls += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return response(200, JSON.stringify({
        access_token: "shared-access-secret",
        expires_in: 3600,
      }), { "Content-Type": "application/json" });
    },
    metricFn: () => {},
  });

  const [first, second] = await Promise.all([
    client.getAccessToken(),
    client.getAccessToken(),
  ]);
  assert.equal(first, "shared-access-secret");
  assert.equal(second, "shared-access-secret");
  assert.equal(tokenCalls, 1);
});

test("métricas registram tentativas e total sem credenciais", async () => {
  const metrics = [];
  let calls = 0;
  const client = createDropboxClient(ENV, {
    fetchFn: async () => {
      calls += 1;
      return calls === 1 ? response(503) : response(200);
    },
    sleepFn: async () => {},
    randomFn: () => 0,
    metricFn: (metric) => metrics.push(metric),
  });

  await client.request(requestOptions());
  assert.equal(metrics.filter((item) => item.event === "dropbox_request_attempt").length, 2);
  assert.equal(metrics.filter((item) => item.event === "dropbox_request_summary").length, 1);
  const serialized = JSON.stringify(metrics);
  assert.doesNotMatch(serialized, /refresh-secret|app-secret|access-secret|Authorization/i);
});

test("helpers preservam janelas de jitter e Retry-After HTTP-date", () => {
  const { defaultRetryDelay, parseRetryAfter } = __dropboxClientTesting;
  assert.equal(defaultRetryDelay(0, () => 0), 250);
  assert.equal(defaultRetryDelay(0, () => 1), 500);
  assert.equal(defaultRetryDelay(1, () => 0), 750);
  assert.equal(defaultRetryDelay(1, () => 1), 1_500);
  assert.equal(defaultRetryDelay(2, () => 0), 1_500);
  assert.equal(defaultRetryDelay(2, () => 1), 3_000);

  const now = Date.parse("2026-09-01T20:00:00Z");
  assert.equal(
    parseRetryAfter("Tue, 01 Sep 2026 20:00:05 GMT", now),
    5_000,
  );
});
