import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  consumeIsochroneRateLimit,
  normalizeIsochroneInput,
  sanitizeIsochroneGeoJson,
} from "../functions/_lib/isochrone-service.js";
import { onRequest as handleIsochroneRequest } from "../functions/api/maps/isochrones.js";

const migration = await readFile(
  new URL(
    "../migrations/0017_map_isochrone_rate_limit.sql",
    import.meta.url,
  ),
  "utf8",
);

function d1Database() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    INSERT INTO organizations (id, name) VALUES (7, 'Maono');
  `);
  database.exec(migration);

  return {
    database,
    binding: {
      prepare(sql) {
        const statement = database.prepare(sql);
        let parameters = [];

        return {
          bind(...values) {
            parameters = values;
            return this;
          },
          first() {
            return statement.get(...parameters) ?? null;
          },
          run() {
            return statement.run(...parameters);
          },
        };
      },
    },
  };
}

test("normalização aceita até quatro faixas e ordena valores", () => {
  const input = normalizeIsochroneInput({
    projectSlug: "mapa-teste",
    origin: { latitude: -23.55, longitude: -46.63 },
    type: "time",
    mode: "drive_traffic",
    ranges: [30, 10, 20, 20],
  });

  assert.deepEqual(input.ranges, [10, 20, 30]);
  assert.equal(input.projectSlug, "mapa-teste");
  assert.equal(input.mode, "drive_traffic");
});

test("normalização recusa coordenadas, modalidade e faixa inválidas", () => {
  assert.throws(
    () =>
      normalizeIsochroneInput({
        origin: { latitude: 91, longitude: 0 },
        type: "time",
        mode: "plane",
        ranges: [10],
      }),
    (error) =>
      error?.status === 400 &&
      ["ISOCHRONE_MODE_INVALID", "ISOCHRONE_PARAMETER_INVALID"].includes(
        error?.code,
      ),
  );

  assert.throws(
    () =>
      normalizeIsochroneInput({
        origin: { latitude: 0, longitude: 0 },
        type: "distance",
        mode: "walk",
        ranges: [1, 2, 3, 4, 5],
      }),
    (error) => error?.code === "ISOCHRONE_RANGES_INVALID",
  );

  assert.throws(
    () =>
      normalizeIsochroneInput({
        origin: { latitude: 0, longitude: 0 },
        type: "time",
        mode: "walk",
        ranges: [0.5],
      }),
    (error) =>
      error?.code === "ISOCHRONE_PARAMETER_INVALID" &&
      error?.details?.minimum === 1,
  );
});

test("sanitização mantém só polígonos e remove metadados do provedor", () => {
  const input = normalizeIsochroneInput({
    origin: { latitude: -23.55, longitude: -46.63 },
    type: "time",
    mode: "drive",
    ranges: [10],
  });
  const geojson = sanitizeIsochroneGeoJson(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-46.64, -23.56],
                [-46.62, -23.56],
                [-46.62, -23.54],
                [-46.64, -23.56],
              ],
            ],
          },
          properties: {
            id: "provider-private-id",
            range: 600,
            lat: -23.55,
            lon: -46.63,
          },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [],
          },
          properties: { id: "ignored" },
        },
      ],
    },
    input,
  );

  assert.equal(geojson.features.length, 2);
  assert.equal(geojson.features[0].properties.range, 10);
  assert.equal(geojson.features[0].properties.id, undefined);
  assert.equal(
    geojson.features[1].properties.maono_analysis,
    "isochrone_origin",
  );
});

test("sanitização recusa anéis abertos e coordenadas fora do globo", () => {
  const input = normalizeIsochroneInput({
    origin: { latitude: -23.55, longitude: -46.63 },
    type: "distance",
    mode: "walk",
    ranges: [2],
  });

  for (const coordinates of [
    [
      [
        [-46.64, -23.56],
        [-46.62, -23.56],
        [-46.62, -23.54],
        [-46.61, -23.53],
      ],
    ],
    [
      [
        [-46.64, -23.56],
        [181, -23.56],
        [-46.62, -23.54],
        [-46.64, -23.56],
      ],
    ],
  ]) {
    assert.throws(
      () =>
        sanitizeIsochroneGeoJson(
          {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Polygon", coordinates },
                properties: { range: 2_000 },
              },
            ],
          },
          input,
        ),
      (error) => error?.code === "ISOCHRONE_EMPTY_RESULT",
    );
  }
});

test("sanitização limita a complexidade total da geometria", () => {
  const input = normalizeIsochroneInput({
    origin: { latitude: 0, longitude: 0 },
    type: "time",
    mode: "bicycle",
    ranges: [10],
  });
  const ring = Array.from(
    { length: 50_000 },
    (_, index) => [((index % 360) - 180) / 2, 0],
  );
  ring.push(ring[0]);

  assert.throws(
    () =>
      sanitizeIsochroneGeoJson(
        {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [ring],
              },
              properties: { range: 600 },
            },
          ],
        },
        input,
      ),
    (error) =>
      error?.status === 502 &&
      error?.code === "ISOCHRONE_PROVIDER_GEOMETRY_TOO_COMPLEX",
  );
});

test("rate limit é atômico por usuário, organização e janela", async () => {
  const { binding } = d1Database();
  const env = {
    DB: binding,
    ISOCHRONE_RATE_LIMIT_MAX: "2",
    ISOCHRONE_RATE_LIMIT_WINDOW_SECONDS: "300",
  };
  const now = new Date("2026-07-27T20:00:00.000Z");

  assert.equal(
    (
      await consumeIsochroneRateLimit(env, {
        userId: 10,
        organizationId: 7,
        now,
      })
    ).count,
    1,
  );
  assert.equal(
    (
      await consumeIsochroneRateLimit(env, {
        userId: 10,
        organizationId: 7,
        now,
      })
    ).count,
    2,
  );
  await assert.rejects(
    consumeIsochroneRateLimit(env, {
      userId: 10,
      organizationId: 7,
      now,
    }),
    (error) =>
      error?.status === 429 &&
      error?.code === "ISOCHRONE_RATE_LIMITED" &&
      error?.details?.retryAfterSeconds === 300,
  );
});

test("endpoint recusa origem, mídia, JSON e corpo acima do limite", async () => {
  async function call(body, headers = {}) {
    const request = new Request(
      "https://maps.maono.test/api/maps/isochrones",
      {
        method: "POST",
        headers,
        body,
      },
    );
    const response = await handleIsochroneRequest({
      request,
      env: {},
    });

    return {
      response,
      data: await response.json(),
    };
  }

  const unsupported = await call("{}", {
    "Content-Type": "text/plain",
  });
  assert.equal(unsupported.response.status, 415);
  assert.equal(
    unsupported.data.error.code,
    "ISOCHRONE_CONTENT_TYPE_INVALID",
  );

  const crossOrigin = await call(
    "{}",
    {
      "Content-Type": "application/json",
      Origin: "https://example.test",
    },
  );
  assert.equal(crossOrigin.response.status, 403);
  assert.equal(
    crossOrigin.data.error.code,
    "ISOCHRONE_CROSS_ORIGIN_FORBIDDEN",
  );

  const invalid = await call("{", {
    "Content-Type": "application/json",
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.data.error.code, "INVALID_JSON_BODY");

  const oversized = await call(
    JSON.stringify({ value: "x".repeat(17_000) }),
    { "Content-Type": "application/json" },
  );
  assert.equal(oversized.response.status, 413);
  assert.equal(
    oversized.data.error.code,
    "ISOCHRONE_REQUEST_TOO_LARGE",
  );
  assert.equal(
    oversized.response.headers.get("cache-control"),
    "no-store",
  );
});
