import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBufferInput } from "../functions/_lib/geoprocessing/buffer-contract.js";
import {
  DEFAULT_SEGMENTS_PER_QUADRANT,
  EARTH_MEAN_RADIUS_METERS,
  executeRadialBuffer,
} from "../functions/_lib/geoprocessing/radial-buffer-engine.js";

function haversineMeters(origin, position) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const latitude1 = toRadians(origin.latitude);
  const latitude2 = toRadians(position[1]);
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = toRadians(position[0] - origin.longitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

function normalized(ranges = [500], overrides = {}) {
  return normalizeBufferInput({
    origin: { latitude: -21.764, longitude: -43.35 },
    unit: "m",
    ranges,
    ...overrides,
  });
}

test("engine gera um Polygon fechado com 64 segmentos", () => {
  const input = normalized([500]);
  const result = executeRadialBuffer(input);

  assert.equal(result.geojson.type, "FeatureCollection");
  assert.equal(result.geojson.features.length, 1);
  assert.equal(result.geojson.features[0].geometry.type, "Polygon");

  const ring = result.geojson.features[0].geometry.coordinates[0];
  assert.equal(ring.length, DEFAULT_SEGMENTS_PER_QUADRANT * 4 + 1);
  assert.deepEqual(ring[0], ring.at(-1));
  assert.equal(result.engineMetadata.totalSegments, 64);
});

test("engine produz raio geodésico compatível com a distância solicitada", () => {
  const input = normalized([2500]);
  const result = executeRadialBuffer(input);
  const firstPosition = result.geojson.features[0].geometry.coordinates[0][0];
  const measured = haversineMeters(input.origin, firstPosition);

  assert.ok(Math.abs(measured - 2500) < 0.1, `distância medida: ${measured}`);
});

test("engine mantém metadados, sequência crescente e desenha maior raio primeiro", () => {
  const input = normalized([2000, 500, 1000]);
  const result = executeRadialBuffer(input);
  const features = result.geojson.features;

  assert.deepEqual(
    features.map((feature) => feature.properties.radius_m),
    [2000, 1000, 500],
  );
  assert.deepEqual(
    features.map((feature) => feature.properties.sequence),
    [3, 2, 1],
  );
  assert.equal(features.at(-1).properties.radius_label, "500 m");
  assert.equal(features.at(-1).properties.maono_analysis, "radial_buffer");
});

test("engine preserva rótulos decimais na unidade informada", () => {
  const input = normalized([0.375, 1.25], { unit: "km" });
  const result = executeRadialBuffer(input);

  assert.deepEqual(
    result.geojson.features.map((feature) => feature.properties.radius_label),
    ["1.25 km", "0.375 km"],
  );
});

test("engine é determinístico para a mesma entrada", () => {
  const input = normalized([375, 850, 1500]);
  assert.deepEqual(executeRadialBuffer(input), executeRadialBuffer(input));
});

test("engine rejeita buffers que cruzam o antimeridiano", () => {
  const input = normalizeBufferInput({
    origin: { latitude: 0, longitude: 179.9 },
    unit: "km",
    ranges: [20],
  });

  assert.throws(
    () => executeRadialBuffer(input),
    (error) =>
      error?.status === 422 &&
      error?.code === "BUFFER_ANTIMERIDIAN_UNSUPPORTED",
  );
});
