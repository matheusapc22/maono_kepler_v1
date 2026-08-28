import assert from "node:assert/strict";
import test from "node:test";

import {
  convertBufferDistance,
  convertBufferDistanceText,
  formatBufferEditableNumber,
  parseBufferNumber,
  requestBuffer,
} from "../src/pages/Kepler/map-panel/buffer-api.ts";

test("conversão m → km preserva a distância real", () => {
  assert.equal(convertBufferDistance(500, "m", "km"), 0.5);
  assert.equal(convertBufferDistanceText("500", "m", "km"), "0,5");
  assert.equal(convertBufferDistanceText("1250", "m", "km"), "1,25");
});

test("conversão km → m preserva a distância real", () => {
  assert.equal(convertBufferDistance(0.5, "km", "m"), 500);
  assert.equal(convertBufferDistanceText("0,5", "km", "m"), "500");
  assert.equal(convertBufferDistanceText("1.25", "km", "m"), "1250");
});

test("parser aceita ponto e vírgula decimal sem separador de milhar", () => {
  assert.equal(parseBufferNumber("0,5"), 0.5);
  assert.equal(parseBufferNumber("1.25"), 1.25);
  assert.equal(parseBufferNumber("500"), 500);
  assert.equal(parseBufferNumber("1.000,5"), null);
  assert.equal(parseBufferNumber("abc"), null);
});

test("formatter usa vírgula na edição brasileira", () => {
  assert.equal(formatBufferEditableNumber(0.5), "0,5");
  assert.equal(formatBufferEditableNumber(1.25), "1,25");
  assert.equal(formatBufferEditableNumber(500), "500");
});

test("campo vazio permanece vazio durante troca de unidade e inválido falha fechado", () => {
  assert.equal(convertBufferDistanceText("", "m", "km"), "");
  assert.equal(convertBufferDistanceText("abc", "m", "km"), null);
});

function responsePayload({
  geometry = {
    type: "Polygon",
    coordinates: [
      [
        [-46.63, -23.55],
        [-46.62, -23.55],
        [-46.62, -23.56],
        [-46.63, -23.55],
      ],
    ],
  },
  radiusMeters = 500,
  antimeridianSplitCount = 0,
} = {}) {
  return {
    ok: true,
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            maono_analysis: "radial_buffer",
            analysis_label: "Buffer radial",
            radius_m: radiusMeters,
            radius_label: `${radiusMeters} m`,
            input_unit: "m",
          },
          geometry,
        },
      ],
    },
    metadata: {
      analysis: "radial_buffer",
      ranges: [radiusMeters],
      inputUnit: "m",
      rangesMeters: [radiusMeters],
      featureCount: 1,
      engine: "maono-radial-geodesic-v2",
      segmentsPerQuadrant: 16,
      antimeridianSplitCount,
      crs: {
        source: "EPSG:4326",
        output: "EPSG:4326",
        distanceMode: "geodesic",
      },
      canPersist: true,
    },
  };
}

async function withMockFetch(payload, callback) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  try {
    return await callback();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("cliente aceita Polygon validado e metadados consistentes", async () => {
  await withMockFetch(responsePayload(), async () => {
    const result = await requestBuffer({
      origin: { latitude: -23.55, longitude: -46.63 },
      unit: "m",
      ranges: [500],
    });

    assert.equal(result.metadata.featureCount, 1);
    assert.equal(result.metadata.antimeridianSplitCount, 0);
    assert.equal(result.geojson.features[0].geometry.type, "Polygon");
  });
});

test("cliente aceita MultiPolygon de antimeridiano sem salto longitudinal", async () => {
  const geometry = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [180, 0],
          [179.8, 0.1],
          [179.8, -0.1],
          [180, 0],
        ],
      ],
      [
        [
          [-180, 0],
          [-179.8, -0.1],
          [-179.8, 0.1],
          [-180, 0],
        ],
      ],
    ],
  };

  await withMockFetch(
    responsePayload({ geometry, antimeridianSplitCount: 1 }),
    async () => {
      const result = await requestBuffer({
        origin: { latitude: 0, longitude: 179.9 },
        unit: "m",
        ranges: [500],
      });
      assert.equal(result.geojson.features[0].geometry.type, "MultiPolygon");
      assert.equal(result.metadata.antimeridianSplitCount, 1);
    },
  );
});

test("cliente rejeita anel aberto antes de entregar geometria ao Kepler", async () => {
  const payload = responsePayload();
  payload.geojson.features[0].geometry.coordinates[0][3] = [-46.64, -23.54];

  await withMockFetch(payload, async () => {
    await assert.rejects(
      () =>
        requestBuffer({
          origin: { latitude: -23.55, longitude: -46.63 },
          unit: "m",
          ranges: [500],
        }),
      (error) => error?.code === "BUFFER_GEOJSON_INVALID",
    );
  });
});

test("cliente rejeita divergência entre raios da geometria e metadata", async () => {
  const payload = responsePayload();
  payload.geojson.features[0].properties.radius_m = 600;

  await withMockFetch(payload, async () => {
    await assert.rejects(
      () =>
        requestBuffer({
          origin: { latitude: -23.55, longitude: -46.63 },
          unit: "m",
          ranges: [500],
        }),
      (error) => error?.code === "BUFFER_GEOJSON_INVALID",
    );
  });
});

test("cliente rejeita metadata de antimeridiano incompatível com geometria", async () => {
  const payload = responsePayload({ antimeridianSplitCount: 1 });

  await withMockFetch(payload, async () => {
    await assert.rejects(
      () =>
        requestBuffer({
          origin: { latitude: -23.55, longitude: -46.63 },
          unit: "m",
          ranges: [500],
        }),
      (error) => error?.code === "BUFFER_GEOJSON_INVALID",
    );
  });
});
