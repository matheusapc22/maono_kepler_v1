import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEVICE_CLASSES,
  REQUIRED_BYTE_TARGETS_MIB,
  REQUIRED_FEATURE_COUNTS,
  REQUIRED_GEOMETRY_PROFILES,
  REQUIRED_LAYER_COUNTS,
  REQUIRED_MAX_FEATURE_POSITIONS,
  REQUIRED_POSITION_COUNTS,
  S08_CORPUS,
} from "../benchmarks/s08/corpus-spec.mjs";
import {
  generateFixture,
  geometryJson,
} from "../benchmarks/s08/generator/generate-corpus.mjs";
import { normalizeBenchmarkResult } from "../benchmarks/s08/lib/result-schema.mjs";

function countPositions(geometry) {
  if (!geometry || typeof geometry !== "object") return 0;
  if (geometry.type === "GeometryCollection") {
    return (geometry.geometries || []).reduce((sum, item) => sum + countPositions(item), 0);
  }

  function walk(value) {
    if (!Array.isArray(value)) return 0;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) return 1;
    return value.reduce((sum, item) => sum + walk(item), 0);
  }

  return walk(geometry.coordinates);
}

test("corpus S08 cobre dimensões exigidas sem threshold operacional", () => {
  assert.deepEqual(REQUIRED_BYTE_TARGETS_MIB, [2, 5, 10, 20, 40]);
  assert.deepEqual(REQUIRED_LAYER_COUNTS, [1, 3, 5, 10, 20]);
  assert.equal(REQUIRED_FEATURE_COUNTS.at(0), 10_000);
  assert.equal(REQUIRED_FEATURE_COUNTS.at(-1), 1_000_000);
  assert.equal(REQUIRED_POSITION_COUNTS.at(0), 100_000);
  assert.equal(REQUIRED_POSITION_COUNTS.at(-1), 5_000_000);
  assert.equal(REQUIRED_MAX_FEATURE_POSITIONS.at(-1), 500_000);
  for (const profile of [
    "Point",
    "LineString",
    "Polygon",
    "MultiPolygon",
    "PolygonHoles",
    "GeometryCollection",
  ]) {
    assert.ok(REQUIRED_GEOMETRY_PROFILES.includes(profile), profile);
    assert.ok(S08_CORPUS.some((fixture) => fixture.geometryProfile === profile), profile);
  }
  assert.deepEqual(DEVICE_CLASSES, [
    "ENTRY_NOTEBOOK",
    "STANDARD_NOTEBOOK",
    "HIGH_END_DESKTOP",
    "SUPPORTED_MOBILE",
  ]);
  for (const fixture of S08_CORPUS) {
    assert.equal("safe" in fixture, false);
    assert.equal("warn" in fixture, false);
    assert.equal("block" in fixture, false);
    assert.equal("riskScore" in fixture, false);
  }
});

test("geometrias sintéticas preservam o número declarado de posições", () => {
  const cases = [
    ["Point", 1],
    ["LineString", 25],
    ["Polygon", 25],
    ["PolygonHoles", 40],
    ["MultiPolygon", 40],
    ["GeometryCollection", 40],
  ];
  for (const [profile, positions] of cases) {
    const geometry = JSON.parse(geometryJson(profile, positions, 3, 8017));
    assert.equal(countPositions(geometry), positions, profile);
  }
});

test("gerador é determinístico, replica o shape do MapConfig e atinge target exato", async () => {
  const rootA = await mkdtemp(path.join(os.tmpdir(), "maono-s08-a-"));
  const rootB = await mkdtemp(path.join(os.tmpdir(), "maono-s08-b-"));
  const spec = {
    fixtureId: "test-byte-target",
    family: "test",
    geometryProfile: "LineString",
    featureCount: 10,
    coordinatePositionCount: 1_000,
    layerCount: 3,
    targetSizeBytes: 256 * 1024,
    maxFeaturePositionCount: null,
    seed: 8017,
  };

  try {
    const first = await generateFixture(spec, rootA);
    const second = await generateFixture(spec, rootB);
    assert.equal(first.sizeBytes, spec.targetSizeBytes);
    assert.equal(second.sizeBytes, spec.targetSizeBytes);
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.coordinatePositionCount, 1_000);
    assert.equal(first.layerCount, 3);

    const parsed = JSON.parse(
      await readFile(path.join(rootA, "fixtures", first.fileName), "utf8"),
    );
    assert.equal(parsed.version, "v1");
    assert.equal(parsed.datasets.length, 1);
    assert.equal(parsed.datasets[0].data.allData.length, 10);
    assert.equal(parsed.config.visState.layers.length, 3);
    assert.equal(parsed.config.config, undefined);
  } finally {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  }
});

test("resultado S08 contém apenas métricas e metadados coarse permitidos", () => {
  const normalized = normalizeBenchmarkResult({
    runId: "run-1",
    fixtureId: "positions-0100000",
    deviceClass: "STANDARD_NOTEBOOK",
    browserClass: "Chrome/151",
    viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
    cacheMode: "COLD",
    input: {
      sizeBytes: 2_000_000,
      featureCount: 1_000,
      coordinatePositionCount: 100_000,
      maxFeaturePositionCount: 100,
      geometryProfile: "LineString",
      visibleLayerCount: 1,
    },
    metrics: {
      downloadTotalMs: 50,
      browserJsonParseMs: 12,
      schemaLoadMs: 20,
      addDataToMapDispatchMs: 5,
      engineHydrationToReadyMs: 300,
      mapReadyMs: 400,
      longTaskCount: 2,
      averageFps: 58,
      webglAvailable: true,
    },
    outcome: "SUCCESS",
  });
  assert.equal(normalized.input.coordinatePositionCount, 100_000);
  assert.equal(normalized.metrics.averageFps, 58);
  assert.equal(normalized.outcome, "SUCCESS");

  assert.throws(
    () => normalizeBenchmarkResult({
      ...normalized,
      datasets: [{ secret: "raw" }],
    }),
    /Campo proibido/,
  );
});

test("harness mede os estágios exigidos e não contém política de bloqueio", async () => {
  const source = await readFile(
    new URL("../src/benchmarks/s08/harness.tsx", import.meta.url),
    "utf8",
  );
  for (const token of [
    "downloadTotalMs",
    "browserJsonParseMs",
    "schemaLoadMs",
    "addDataToMapDispatchMs",
    "engineHydrationToReadyMs",
    "longTaskCount",
    "averageFps",
    "webglAvailable",
    "RELOAD",
  ]) {
    assert.match(source, new RegExp(token));
  }
  assert.doesNotMatch(source, /SAFE_THRESHOLD|WARN_THRESHOLD|BLOCK_THRESHOLD|riskScore/);
});

test("serve S08 separa build Vite pesado do servidor que permanece durante a medição", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const serverSource = await readFile(
    new URL("../benchmarks/s08/runner/dev-server.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    packageJson.scripts["benchmark:s08:serve"],
    /benchmark:s08:build\s*&&\s*node benchmarks\/s08\/runner\/dev-server\.mjs/,
  );
  assert.doesNotMatch(serverSource, /from\s+["']vite["']/);
  assert.doesNotMatch(serverSource, /viteBuild\s*\(/);
  assert.match(serverSource, /assertHarnessBuildExists/);
});
