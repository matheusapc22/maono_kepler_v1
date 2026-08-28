import assert from "node:assert/strict";
import test from "node:test";

import { onRequest as handleBufferRequest } from "../functions/api/maps/buffers.js";

function fakeDb() {
  return {
    prepare(sql) {
      let parameters = [];
      return {
        bind(...values) {
          parameters = values;
          return this;
        },
        async first() {
          if (/FROM sessions/i.test(sql) && /INNER JOIN users/i.test(sql)) {
            return {
              id: 10,
              email: "qa@maono.test",
              name: "QA",
              role: "super_admin",
              active: 1,
              session_active_organization_id: 7,
              expires_at: "2099-01-01T00:00:00.000Z",
            };
          }
          return null;
        },
        async run() {
          return { success: true, meta: { changes: 1 }, parameters };
        },
        async all() {
          return { results: [] };
        },
      };
    },
  };
}

async function call({
  method = "POST",
  body = "{}",
  headers = {},
  env = {},
} = {}) {
  const request = new Request("https://maps.maono.test/api/maps/buffers", {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
  const response = await handleBufferRequest({ request, env });
  const text = await response.text();
  return {
    response,
    data: text ? JSON.parse(text) : null,
  };
}

test("endpoint aceita somente POST", async () => {
  const { response } = await call({ method: "GET" });
  assert.equal(response.status, 405);
});

test("endpoint rejeita mídia não suportada", async () => {
  const { response, data } = await call({
    body: "{}",
    headers: { "Content-Type": "text/plain" },
  });
  assert.equal(response.status, 415);
  assert.equal(data.error.code, "BUFFER_CONTENT_TYPE_INVALID");
});

test("endpoint rejeita origem cross-origin", async () => {
  const { response, data } = await call({
    body: "{}",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.test",
    },
  });
  assert.equal(response.status, 403);
  assert.equal(data.error.code, "BUFFER_CROSS_ORIGIN_FORBIDDEN");
});

test("endpoint rejeita JSON inválido e corpo excessivo", async () => {
  const invalid = await call({
    body: "{",
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.data.error.code, "INVALID_JSON_BODY");

  const oversized = await call({
    body: JSON.stringify({ value: "x".repeat(17_000) }),
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.data.error.code, "BUFFER_REQUEST_TOO_LARGE");
  assert.equal(oversized.response.headers.get("cache-control"), "no-store");
});

test("endpoint retorna 200 e GeoJSON Polygon para request autorizado", async () => {
  const { response, data } = await call({
    body: JSON.stringify({
      origin: { latitude: -21.764, longitude: -43.35 },
      unit: "m",
      ranges: [375, 850],
    }),
    headers: {
      "Content-Type": "application/json",
      Cookie: "maono_session=test-session-token",
    },
    env: {
      DB: fakeDb(),
      GEOPROCESSING_BUFFER_V1: "true",
      MAONO_RUNTIME_ENV: "production",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(data.ok, true);
  assert.equal(data.geojson.type, "FeatureCollection");
  assert.equal(data.geojson.features.length, 2);
  assert.equal(data.geojson.features[0].geometry.type, "Polygon");
  assert.deepEqual(data.metadata.rangesMeters, [375, 850]);
});
