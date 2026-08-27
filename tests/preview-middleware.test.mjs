import assert from "node:assert/strict";
import test from "node:test";

import {
  extractProjectSlugFromPath,
  onRequest,
  resolvePreviewMutationOrganizationId,
} from "../functions/_middleware.js";

function projectDb(rowsBySlug = {}) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM projects/);
      return {
        bind(slug) {
          return {
            async first() {
              const organizationId = rowsBySlug[String(slug)];
              return organizationId === undefined
                ? null
                : { organization_id: organizationId };
            },
          };
        },
      };
    },
  };
}

function previewEnv(overrides = {}) {
  return {
    MAONO_RUNTIME_ENV: "preview",
    MAONO_PREVIEW_MUTATIONS_ENABLED: "true",
    MAONO_PREVIEW_QA_ORG_ID: "9001",
    DB: projectDb({
      "qa-geojson-golden": 9001,
      "projeto-real": 42,
    }),
    ...overrides,
  };
}

test("middleware extrai slug de projeto sem confundir subrotas", () => {
  assert.equal(
    extractProjectSlugFromPath(
      "/api/projects/qa-geojson-golden/config",
    ),
    "qa-geojson-golden",
  );
  assert.equal(
    extractProjectSlugFromPath(
      "/api/projects/projeto%20qa/thumbnail/upload",
    ),
    "projeto qa",
  );
  assert.equal(extractProjectSlugFromPath("/api/maps/isochrones"), null);
});

test("middleware resolve organização do projeto diretamente no D1", async () => {
  const organizationId = await resolvePreviewMutationOrganizationId(
    previewEnv(),
    new Request(
      "https://preview.example/api/projects/qa-geojson-golden/config",
      { method: "PUT", body: "{}" },
    ),
    "/api/projects/qa-geojson-golden/config",
  );

  assert.equal(organizationId, 9001);
});

test("GET de preview segue para a Function e recebe diagnóstico", async () => {
  let nextCalls = 0;
  const response = await onRequest({
    request: new Request("https://preview.example/api/projects"),
    env: previewEnv(),
    async next() {
      nextCalls += 1;
      return new Response("ok", { status: 200 });
    },
  });

  assert.equal(nextCalls, 1);
  assert.equal(await response.text(), "ok");
  assert.equal(response.headers.get("X-Maono-Runtime-Env"), "preview");
  assert.equal(response.headers.get("X-Maono-Preview-Write"), "READ_ONLY_REQUEST");
});

test("mutação no Golden QA passa pela barreira", async () => {
  let nextCalls = 0;
  const response = await onRequest({
    request: new Request(
      "https://preview.example/api/projects/qa-geojson-golden/config",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: {} }),
      },
    ),
    env: previewEnv(),
    async next() {
      nextCalls += 1;
      return new Response("saved", { status: 200 });
    },
  });

  assert.equal(nextCalls, 1);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("X-Maono-Preview-Write"),
    "PREVIEW_QA_WRITE_ALLOWED",
  );
});

test("mutação em projeto real é bloqueada antes do endpoint", async () => {
  let nextCalls = 0;
  const response = await onRequest({
    request: new Request(
      "https://preview.example/api/projects/projeto-real/config",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: {} }),
      },
    ),
    env: previewEnv(),
    async next() {
      nextCalls += 1;
      return new Response("should-not-run");
    },
  });
  const body = await response.json();

  assert.equal(nextCalls, 0);
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "PREVIEW_WRITE_OUTSIDE_QA_ORG");
});

test("mutação administrativa é bloqueada mesmo com kill switch liberado", async () => {
  let nextCalls = 0;
  const response = await onRequest({
    request: new Request("https://preview.example/api/admin/users/1", {
      method: "DELETE",
    }),
    env: previewEnv(),
    async next() {
      nextCalls += 1;
      return new Response("should-not-run");
    },
  });
  const body = await response.json();

  assert.equal(nextCalls, 0);
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "PREVIEW_GLOBAL_MUTATION_DENIED");
});

test("kill switch bloqueia escrita QA sem impedir login/session", async () => {
  const env = previewEnv({ MAONO_PREVIEW_MUTATIONS_ENABLED: "false" });
  let projectNext = 0;
  const projectResponse = await onRequest({
    request: new Request(
      "https://preview.example/api/projects/qa-geojson-golden/config",
      { method: "PUT", body: "{}" },
    ),
    env,
    async next() {
      projectNext += 1;
      return new Response("should-not-run");
    },
  });

  let sessionNext = 0;
  const sessionResponse = await onRequest({
    request: new Request("https://preview.example/api/session/active-organization", {
      method: "POST",
      body: "{}",
    }),
    env,
    async next() {
      sessionNext += 1;
      return new Response("session-ok");
    },
  });

  assert.equal(projectNext, 0);
  assert.equal(projectResponse.status, 403);
  assert.equal(sessionNext, 1);
  assert.equal(sessionResponse.status, 200);
});
