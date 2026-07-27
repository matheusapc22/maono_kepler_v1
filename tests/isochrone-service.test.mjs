import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  consumeIsochroneRateLimit,
  normalizeIsochroneInput,
  sanitizeIsochroneGeoJson,
} from "../functions/_lib/isochrone-service.js";

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
