import assert from "node:assert/strict";
import test from "node:test";

import {
  BUFFER_LIMITS,
  normalizeBufferInput,
} from "../functions/_lib/geoprocessing/buffer-contract.js";

const origin = { latitude: -21.764, longitude: -43.35 };

function input(overrides = {}) {
  return {
    projectSlug: "demo-maono",
    origin,
    unit: "m",
    ranges: [500],
    ...overrides,
  };
}

test("contrato aceita um raio manual em metros", () => {
  const normalized = normalizeBufferInput(input({ ranges: [375.25] }));
  assert.deepEqual(normalized.ranges, [375.25]);
  assert.deepEqual(normalized.rangesMeters, [375.25]);
  assert.equal(normalized.inputUnit, "m");
  assert.equal(normalized.crs.source, "EPSG:4326");
  assert.equal(normalized.crs.output, "EPSG:4326");
  assert.equal(normalized.crs.distanceMode, "geodesic_meters");
});

test("contrato aceita quatro raios, decimais em km e ordena pela distância", () => {
  const normalized = normalizeBufferInput(
    input({
      unit: "km",
      ranges: [2.5, 0.375, 1.25, 0.85],
    }),
  );

  assert.deepEqual(normalized.ranges, [0.375, 0.85, 1.25, 2.5]);
  assert.deepEqual(normalized.rangesMeters, [375, 850, 1250, 2500]);
  assert.equal(normalized.inputUnit, "km");
});

test("contrato rejeita quantidade de raios fora de 1..4", () => {
  for (const ranges of [[], [1, 2, 3, 4, 5]]) {
    assert.throws(
      () => normalizeBufferInput(input({ ranges })),
      (error) => error?.code === "BUFFER_RANGES_INVALID",
    );
  }
});

test("contrato rejeita unidade ausente ou inválida", () => {
  assert.throws(
    () => normalizeBufferInput(input({ unit: "" })),
    (error) => error?.code === "BUFFER_UNIT_REQUIRED",
  );
  assert.throws(
    () => normalizeBufferInput(input({ unit: "mi" })),
    (error) => error?.code === "BUFFER_UNIT_INVALID",
  );
});

test("contrato rejeita raios zero, negativos, não numéricos e infinitos", () => {
  for (const value of [0, -1, "abc", Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => normalizeBufferInput(input({ ranges: [value] })),
      (error) => error?.code === "BUFFER_RADIUS_INVALID",
    );
  }
});

test("contrato respeita limites métricos inclusive após conversão", () => {
  assert.equal(
    normalizeBufferInput(input({ ranges: [BUFFER_LIMITS.MIN_RADIUS_METERS] }))
      .rangesMeters[0],
    1,
  );
  assert.equal(
    normalizeBufferInput(
      input({ unit: "km", ranges: [BUFFER_LIMITS.MAX_RADIUS_METERS / 1000] }),
    ).rangesMeters[0],
    200_000,
  );

  for (const value of [0.5, 200_001]) {
    assert.throws(
      () => normalizeBufferInput(input({ ranges: [value] })),
      (error) => error?.code === "BUFFER_RADIUS_OUT_OF_RANGE",
    );
  }
});

test("contrato rejeita raios duplicados após normalização", () => {
  assert.throws(
    () => normalizeBufferInput(input({ unit: "km", ranges: [1, 1.0] })),
    (error) =>
      error?.code === "BUFFER_RADIUS_DUPLICATED" &&
      error?.details?.radiusMeters === 1000,
  );
});

test("contrato rejeita origem inválida", () => {
  assert.throws(
    () => normalizeBufferInput(input({ origin: { latitude: 91, longitude: 0 } })),
    (error) => error?.code === "BUFFER_LATITUDE_INVALID",
  );
  assert.throws(
    () => normalizeBufferInput(input({ origin: { latitude: 0, longitude: 181 } })),
    (error) => error?.code === "BUFFER_LONGITUDE_INVALID",
  );
});
