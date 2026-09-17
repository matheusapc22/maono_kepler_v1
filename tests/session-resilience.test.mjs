import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SessionRequestTimeoutError,
  classifySessionResponse,
  fetchSessionResponseWithRetry,
} from "../src/auth/session-resilience.ts";

const noWait = async () => {};

const [
  sessionSource,
  projectsApiSource,
  loginSource,
  metadataPanelSource,
  transportSource,
  catalogSource,
  loginEndpointSource,
] = await Promise.all([
  readFile(new URL("../src/auth/session.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../src/pages/Projects/projects-api.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/pages/Login.tsx", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../src/pages/Projects/components/ProjectMetadataPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(new URL("../src/lib/api-transport.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/user-error-catalog.ts", import.meta.url), "utf8"),
  readFile(new URL("../functions/api/auth/login.js", import.meta.url), "utf8"),
]);

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

test("404 e 409 são reproduzidos sem retry e preservam sessão conhecida", async () => {
  for (const status of [404, 409]) {
    let calls = 0;
    const result = await fetchSessionResponseWithRetry({
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(status, {
          error: {
            code: status === 404 ? "ORGANIZATION_NOT_FOUND" : "ORGANIZATION_INACTIVE",
            message: "REMOTE_BODY_MUST_NOT_REACH_UI",
          },
        });
      },
      retryDelaysMs: [0, 0],
      waitImpl: noWait,
    });

    assert.equal(result.response.status, status);
    assert.equal(result.attempts, 1);
    assert.equal(calls, 1);
    assert.deepEqual(classifySessionResponse(status, true), {
      disposition: "preserve",
      health: "degraded",
    });
  }
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
        const abortFailure = new Error("aborted");
        abortFailure.name = "AbortError";
        reject(abortFailure);
        return;
      }

      signal?.addEventListener(
        "abort",
        () => {
          const abortFailure = new Error("aborted");
          abortFailure.name = "AbortError";
          reject(abortFailure);
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
    (requestFailure) => requestFailure instanceof SessionRequestTimeoutError,
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

test("refreshSession só limpa estado conhecido em 401 ou logout explícito", () => {
  assert.match(
    sessionSource,
    /policy\.disposition === "unauthenticated"[\s\S]*?applySession\(EMPTY_SESSION\)/,
  );
  assert.match(
    sessionSource,
    /finally \{[\s\S]*?applySession\(EMPTY_SESSION\);[\s\S]*?setHealth\("unauthenticated"\)/,
  );

  const refreshBlock = sessionSource.match(
    /const refreshSession = useCallback\([\s\S]*?const clearOrganizationSwitchError/,
  )?.[0];

  assert.ok(refreshBlock, "refreshSession deve permanecer identificável no provider.");
  assert.doesNotMatch(
    refreshBlock,
    /catch \([^)]*\)[\s\S]*?applySession\(EMPTY_SESSION\)/,
  );
  assert.match(refreshBlock, /setHealth\("degraded"\)/);
});

test("PRH-02A elimina raw body e mensagens remotas de Auth e Projects", () => {
  for (const [name, source] of [
    ["session", sessionSource],
    ["projects-api", projectsApiSource],
  ]) {
    assert.doesNotMatch(
      source,
      /(?:response|res)\.text\s*\(/,
      `${name} não pode ler raw response body como texto.`,
    );
    assert.doesNotMatch(
      source,
      /data\.error\.message|payload\.error\.message|errorMessage\s*\(/,
      `${name} não pode promover mensagem remota para a UI.`,
    );
  }

  assert.match(sessionSource, /requestJson\("\/api\/auth\/login"/);
  assert.match(sessionSource, /fetchWithNetworkGuard/);
  assert.match(sessionSource, /buildApiError/);
  assert.match(sessionSource, /normalizeUserError\(requestFailure\)\.message/);
  assert.match(projectsApiSource, /requestJson/);
  assert.match(projectsApiSource, /class ProjectMetadataApiError extends ApiError/);
  assert.match(transportSource, /response\.json\(\)/);
  assert.doesNotMatch(transportSource, /response\.text\s*\(/);
});

test("catálogo central cobre 401/403/404/409 sem usar mensagem remota", () => {
  assert.match(catalogSource, /status === 401/);
  assert.match(catalogSource, /status === 403/);
  assert.match(catalogSource, /status === 404/);
  assert.match(catalogSource, /status === 409/);
  assert.match(catalogSource, /AUTH_SESSION_EXPIRED/);
  assert.match(catalogSource, /ORGANIZATION_ACCESS_DENIED/);
  assert.match(catalogSource, /ORGANIZATION_NOT_FOUND/);
  assert.match(catalogSource, /ORGANIZATION_INACTIVE/);
  assert.doesNotMatch(catalogSource, /contract\.message|diagnostic\.message/);
});

test("HTML ou texto inesperado não possui caminho para copy pública", () => {
  assert.match(transportSource, /response\.json\(\)/);
  assert.match(transportSource, /return \{ valid: false, data: null \}/);
  assert.doesNotMatch(transportSource, /response\.text\s*\(/);
  assert.doesNotMatch(sessionSource, /response\.text\s*\(/);
  assert.doesNotMatch(projectsApiSource, /response\.text\s*\(/);
});

test("Login, Projects e metadata apresentam somente catálogo central", () => {
  assert.match(loginSource, /normalizeUserError\(loginFailure\)\.message/);
  assert.doesNotMatch(loginSource, /\b(?:error|err)\.message\b/);

  assert.match(metadataPanelSource, /normalizeUserError\(requestFailure\)\.message/);
  assert.doesNotMatch(metadataPanelSource, /\b(?:error|err)\.message\b/);
});

test("metadata 409 preserva currentProject e recuperação explícita", () => {
  assert.match(catalogSource, /PROJECT_METADATA_VERSION_CONFLICT/);
  assert.match(projectsApiSource, /apiError\.status !== 409/);
  assert.match(projectsApiSource, /currentProject/);
  assert.match(metadataPanelSource, /requestFailure\.status === 409/);
  assert.match(metadataPanelSource, /setConflictProject\(requestFailure\.currentProject\)/);
  assert.match(metadataPanelSource, />\s*Carregar versão atual\s*</);
});

test("login usa código canônico e mantém alias de deploy skew no catálogo", () => {
  assert.match(loginEndpointSource, /AUTH_INVALID_CREDENTIALS/);
  assert.doesNotMatch(loginEndpointSource, /"INVALID_CREDENTIALS"/);
  assert.match(catalogSource, /AUTH_INVALID_CREDENTIALS/);
  assert.match(catalogSource, /INVALID_CREDENTIALS:\s*INVALID_CREDENTIALS_PRESENTATION/);
});
