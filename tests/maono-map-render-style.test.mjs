import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {
  basemapRuntimeFailures,
  isLayoutGeometryInvariant,
} from "../src/pages/Kepler/components/maono-map-shell/map-layout-debug.ts";
import {
  defaultScaleForDatasetField,
  layerBlendingMode,
  layerStyleCompatibilityForType,
  normalizeColorScale,
  normalizePalette,
  numericRange,
  overlayBlendingMode,
  scaleSupportsField,
} from "../src/pages/Kepler/engine-adapter/layer-style-management.ts";

test("correção do mapa importa os estilos oficiais das bibliotecas", async () => {
  const source = await readFile(
    new URL("../src/pages/Kepler/index.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /maplibre-gl\/dist\/maplibre-gl\.css/);
  assert.match(source, /mapbox-gl\/dist\/mapbox-gl\.css/);
  assert.doesNotMatch(source, /background-image\s*:/i);
});

test("instrumentação sanitiza erros e expõe somente metadados do state", async () => {
  const entry = await readFile(
    new URL("../src/pages/Kepler/index.tsx", import.meta.url),
    "utf8",
  );
  const shell = await readFile(
    new URL("../src/pages/Kepler/components/maono-map-shell/MaonoMapShell.tsx", import.meta.url),
    "utf8",
  );
  assert.match(entry, /safeMapErrorMessage/);
  assert.match(entry, /\[url omitida\]/);
  assert.match(entry, /\[redigido\]/);
  assert.match(shell, /data-engine-state-keys/);
  assert.match(shell, /data-map-state-present/);
  assert.match(shell, /data-map-style-present/);
  assert.doesNotMatch(shell, /access[_-]?token|api[_-]?key/i);
});

test("diagnóstico do mapa diferencia montagem, geometria, canvas, WebGL e style", () => {
  assert.deepEqual(
    basemapRuntimeFailures({
      keplerMounted: false,
      mapWidth: 0,
      mapHeight: 0,
      canvasCount: 0,
      validCanvasCount: 0,
      mapLibraryMounted: false,
      styleLoaded: false,
      contextAvailable: false,
      coveredByBlockingElement: true,
    }),
    [
      "KEPLER_NOT_MOUNTED",
      "MAP_COLLAPSED",
      "CANVAS_MISSING",
      "CANVAS_INVALID_SIZE",
      "MAP_LIBRARY_MISSING",
      "STYLE_NOT_LOADED",
      "WEBGL_UNAVAILABLE",
      "CANVAS_COVERED",
    ],
  );
  assert.deepEqual(
    basemapRuntimeFailures({
      keplerMounted: true,
      mapWidth: 1200,
      mapHeight: 700,
      canvasCount: 2,
      validCanvasCount: 2,
      mapLibraryMounted: true,
      styleLoaded: true,
      contextAvailable: true,
      coveredByBlockingElement: false,
    }),
    [],
  );
});

test("geometria do mapa permanece invariável dentro da tolerância", () => {
  assert.equal(
    isLayoutGeometryInvariant(
      {width: 1200, height: 700, x: 80, y: 0},
      {width: 1199.5, height: 700, x: 80.5, y: 0},
      1,
    ),
    true,
  );
  assert.equal(
    isLayoutGeometryInvariant(
      {width: 1200, height: 700, x: 80, y: 0},
      {width: 900, height: 700, x: 80, y: 0},
      1,
    ),
    false,
  );
});

test("matriz visual expõe somente controles confirmados por tipo", () => {
  const point = layerStyleCompatibilityForType("point");
  const cluster = layerStyleCompatibilityForType("cluster");
  const heatmap = layerStyleCompatibilityForType("heatmap");
  const geojson = layerStyleCompatibilityForType("geojson");

  assert.equal(point.fixedColor, true);
  assert.equal(point.radiusRange, true);
  assert.equal(point.stroke, true);
  assert.equal(cluster.clusterRadius, true);
  assert.equal(cluster.radiusRange, true);
  assert.equal(cluster.colorField, true);
  assert.equal(cluster.colorScale, true);
  assert.equal(heatmap.heatmapRadius, true);
  assert.equal(heatmap.stroke, false);
  assert.equal(geojson.fill, true);
  assert.equal(geojson.strokeField, true);
  assert.equal(layerStyleCompatibilityForType("arc").supported, false);
});

test("escalas respeitam campos numéricos e categóricos", () => {
  const numeric = {type: "real"};
  const categorical = {type: "string"};
  assert.equal(defaultScaleForDatasetField(numeric), "quantile");
  assert.equal(defaultScaleForDatasetField(categorical), "ordinal");
  assert.equal(scaleSupportsField("sqrt", numeric), true);
  assert.equal(scaleSupportsField("ordinal", numeric), false);
  assert.equal(scaleSupportsField("ordinal", categorical), true);
  assert.equal(scaleSupportsField("log", categorical), false);
  assert.equal(normalizeColorScale("log"), "log");
  assert.equal(normalizeColorScale("inventada"), null);
});

test("paleta, ranges e blending são validados sem dispatch", () => {
  assert.deepEqual(normalizePalette(["#b7791f", "#fff8e7"]), ["#B7791F", "#FFF8E7"]);
  assert.equal(normalizePalette(["red"]), null);
  assert.deepEqual(numericRange([2, 80], 0, 100), [2, 80]);
  assert.equal(numericRange([80, 2], 0, 100), null);
  assert.equal(layerBlendingMode("additive"), "additive");
  assert.equal(layerBlendingMode("screen"), null);
  assert.equal(overlayBlendingMode("screen"), "screen");
  assert.equal(overlayBlendingMode("additive"), null);
});

test("commands usam canais e escalas no nível correto do config", async () => {
  const source = await readFile(
    new URL("../src/pages/Kepler/engine-adapter/commands.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /visualChannelPatch\(\{colorField: field, colorScale: scale\}\)/,
  );
  assert.match(
    source,
    /visualChannelPatch\(\{\s*strokeColorField: field,\s*strokeColorScale: scale,?\s*\}\)/,
  );
  assert.match(source, /visualChannelPatch\(\{colorScale: nextScale\}\)/);
  assert.match(
    source,
    /visualChannelPatch\(\{strokeColorScale: nextScale\}\)/,
  );
  assert.doesNotMatch(source, /updateVisConfig\(layerId, \{ colorScale:/);
  assert.doesNotMatch(source, /updateVisConfig\(layerId, \{ strokeColorScale:/);
});

test("componentes visuais continuam sem Redux e actions", async () => {
  const paths = [
    "../src/pages/Kepler/components/maono-layer-panel/LayerStyleEditor.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/LayerInspector.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /@kepler\.gl\/actions|react-redux|state\.demo\.keplerGl/);
  }
});
