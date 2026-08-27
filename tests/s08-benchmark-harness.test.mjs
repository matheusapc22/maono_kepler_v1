import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
  S08_GENERATOR_VERSION,
} from "../benchmarks/s08/corpus-spec.mjs";
import {
  generateFixture,
  geometryJson,
} from "../benchmarks/s08/generator/generate-corpus.mjs";
import { normalizeBenchmarkResult } from "../benchmarks/s08/lib/result-schema.mjs";

const execFileAsync = promisify(execFile);

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

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ringBounds(ring) {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

test("corpus S08 cobre dimensões exigidas sem threshold operacional", () => {
  assert.equal(S08_GENERATOR_VERSION, "s08-generator-v2");
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

test("rings poligonais v2 são simples, não reciclam ciclo curto e mantêm hole contido", () => {
  const geometry = JSON.parse(geometryJson("PolygonHoles", 10_000, 0, 8017));
  const [outer, hole] = geometry.coordinates;

  assert.equal(outer.length, 6_500);
  assert.equal(hole.length, 3_500);
  assert.deepEqual(outer[0], outer.at(-1));
  assert.deepEqual(hole[0], hole.at(-1));

  const uniqueOuter = new Set(outer.slice(0, -1).map((position) => position.join(",")));
  const uniqueHole = new Set(hole.slice(0, -1).map((position) => position.join(",")));
  assert.equal(uniqueOuter.size, outer.length - 1);
  assert.equal(uniqueHole.size, hole.length - 1);

  assert.ok(signedArea(outer) > 0, "anel externo deve ser anti-horário");
  assert.ok(signedArea(hole) < 0, "hole deve ser horário");

  const outerBounds = ringBounds(outer);
  const holeBounds = ringBounds(hole);
  assert.ok(holeBounds.minX > outerBounds.minX);
  assert.ok(holeBounds.maxX < outerBounds.maxX);
  assert.ok(holeBounds.minY > outerBounds.minY);
  assert.ok(holeBounds.maxY < outerBounds.maxY);
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
      webglObservedCanvasCount: 2,
      webglCanvasAddedDuringRunCount: 1,
      webglPrimaryCanvasChangeCount: 1,
      webglPrimaryContextLostAtEnd: false,
    },
    outcome: "SUCCESS",
  });
  assert.equal(normalized.input.coordinatePositionCount, 100_000);
  assert.equal(normalized.metrics.averageFps, 58);
  assert.equal(normalized.metrics.webglObservedCanvasCount, 2);
  assert.equal(normalized.metrics.webglCanvasAddedDuringRunCount, 1);
  assert.equal(normalized.metrics.webglPrimaryCanvasChangeCount, 1);
  assert.equal(normalized.metrics.webglPrimaryContextLostAtEnd, false);
  assert.equal(normalized.outcome, "SUCCESS");

  assert.throws(
    () => normalizeBenchmarkResult({
      ...normalized,
      datasets: [{ secret: "raw" }],
    }),
    /Campo proibido/,
  );
});

test("harness mede estágios, FPS consistente e WebGL sem fingerprint detalhado", async () => {
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
    "webglObservedCanvasCount",
    "webglCanvasAddedDuringRunCount",
    "webglPrimaryCanvasChangeCount",
    "webglPrimaryContextLostAtEnd",
    "BENCHMARK_TIMEOUT_AFTER_WEBGL_CONTEXT_LOSS",
    "DEVICE_CLASS_KEY",
    "measuredFrames",
    "RELOAD",
  ]) {
    assert.match(source, new RegExp(token));
  }
  assert.match(source, /loadSavedKeplerConfigForBenchmark/);
  assert.match(source, /savedConfig\.datasets\.map\(normalizeDatasetForKepler\)/);
  assert.match(source, /toggleModal/);
  assert.match(source, /wrapTo\(MAP_ID, toggleModal\(null\)\)/);
  assert.match(source, /measurementStartedAt/);
  assert.match(source, /querySelectorAll\("canvas"\)/);
  assert.match(source, /new MutationObserver/);
  assert.match(source, /webglObservedCanvases\.has\(canvas\)/);
  assert.match(source, /sessionStorage\.getItem\(DEVICE_CLASS_KEY\)/);
  assert.match(source, /sessionStorage\.setItem\(DEVICE_CLASS_KEY, value\)/);
  assert.match(source, /Selecione o dispositivo/);
  assert.match(source, /!selectedFixture \|\| !deviceClass \|\| activeRunRef\.current/);
  assert.match(source, /Preparando \$\{selectedFixture\.fixtureId\}/);
  assert.match(source, /run\.metrics\.jsHeapBefore = heapSize\(\)/);
  assert.match(source, /run\.observer = createLongTaskObserver\(run\.longTasks\)/);
  assert.doesNotMatch(source, /value < 1000/);
  assert.doesNotMatch(source, /WEBGL_debug_renderer_info|UNMASKED_VENDOR|UNMASKED_RENDERER/);
  assert.doesNotMatch(source, /SCHEMA_LOAD_INVALID_RESULT/);
  assert.doesNotMatch(source, /SAFE_THRESHOLD|WARN_THRESHOLD|BLOCK_THRESHOLD|riskScore/);
});

test("relatório S08 separa commits, preserva outcomes e expõe stalls de SUCCESS", async () => {
  const source = await readFile(
    new URL("../benchmarks/s08/report/generate-report.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /summarizeOutcomes/);
  assert.match(source, /successResults/);
  assert.match(source, /successWithDroppedFrames/);
  assert.match(source, /finiteMetricValue/);
  assert.match(source, /formatOutcomes/);
  assert.match(source, /formatRatio/);
  assert.match(source, /normalizeCommit\(result\.commit\)/);
  assert.match(source, /const \[commit, deviceClass, fixtureId, cacheMode\]/);
  assert.match(source, /\| Commit \| Dispositivo \|/);
  assert.match(source, /FPS mínimo SUCCESS/);
  assert.match(source, /Pior frame máximo SUCCESS/);
  assert.match(source, /SUCCESS c\/ dropped frames/);
  assert.match(source, /Maior long task p95 TODOS/);
});

test("relatório S08 ignora métricas ausentes e preserva stall sem mascarar pela mediana", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maono-s08-report-"));
  const resultsDir = path.join(root, ".benchmark-data", "s08", "results");
  const reportScript = fileURLToPath(new URL("../benchmarks/s08/report/generate-report.mjs", import.meta.url));
  const commit = "3a30b1942cd434e7ba69bc5aa12200d1f431c545";
  const base = {
    benchmarkVersion: "s08-benchmark-v1",
    commit,
    deviceClass: "ENTRY_NOTEBOOK",
    browserClass: "Chrome/151",
    viewport: { width: 1536, height: 730, devicePixelRatio: 1.25 },
    cacheMode: "COLD",
    input: {
      sizeBytes: 1_783_978,
      featureCount: 1_000,
      coordinatePositionCount: 250_000,
      maxFeaturePositionCount: 250,
      geometryProfile: "LineString",
      visibleLayerCount: 5,
    },
    errorCode: null,
    recordedAt: "2026-08-14T18:00:00.000Z",
  };
  const rows = [
    {
      ...base,
      runId: "success-fast",
      fixtureId: "layers-05",
      metrics: { mapReadyMs: 100, schemaLoadMs: 1, averageFps: 60, worstFrameMs: 17, droppedFrameCount: 0, maxLongTaskMs: 100 },
      outcome: "SUCCESS",
    },
    {
      ...base,
      runId: "success-stall",
      fixtureId: "layers-05",
      metrics: { mapReadyMs: 200, schemaLoadMs: 2, averageFps: 28, worstFrameMs: 1184.5, droppedFrameCount: 1, maxLongTaskMs: 300 },
      outcome: "SUCCESS",
    },
    {
      ...base,
      runId: "success-missing",
      fixtureId: "layers-05",
      metrics: { mapReadyMs: null, schemaLoadMs: undefined, averageFps: "", worstFrameMs: null, droppedFrameCount: null, maxLongTaskMs: null },
      outcome: "SUCCESS",
    },
    {
      ...base,
      runId: "failure-only",
      fixtureId: "layers-10",
      metrics: { maxLongTaskMs: 4046 },
      outcome: "WEBGL_CONTEXT_LOST",
      errorCode: "WEBGL_CONTEXT_LOST_DURING_BENCHMARK",
    },
  ];

  try {
    await mkdir(resultsDir, { recursive: true });
    await writeFile(
      path.join(resultsDir, "ENTRY_NOTEBOOK.jsonl"),
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      "utf8",
    );
    await execFileAsync(process.execPath, [reportScript], { cwd: root });
    const report = await readFile(
      path.join(root, ".benchmark-data", "s08", "reports", "S08-benchmark-report.md"),
      "utf8",
    );

    assert.match(report, /\| 3a30b194 \| ENTRY_NOTEBOOK \| layers-05 \| COLD \| 3 \| SUCCESS=3 \| 150\.0 \| 1\.5 \| 44\.0 \| 28\.0 \| 1184\.5 \| 1\/3 \| 300\.0 \|/);
    assert.match(report, /\| 3a30b194 \| ENTRY_NOTEBOOK \| layers-10 \| COLD \| 1 \| WEBGL_CONTEXT_LOST=1 \| — \| — \| — \| — \| — \| — \| 4046\.0 \|/);
    assert.doesNotMatch(report, /layers-05[^\n]*\| 0\.0 \|/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
