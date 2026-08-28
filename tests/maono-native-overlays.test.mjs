import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { GEOCODER_LAYER_ID } from "@kepler.gl/constants";

import {
  applyGeometryFilter,
  geometryFilterTargetLayerIds,
  isPolygonGeometryFeature,
} from "../src/pages/Kepler/engine-adapter/geometry-filter-command.ts";
import {
  calculateMaonoLegendInitialPosition,
  MAONO_LEGEND_HORIZONTAL_RATIO,
  MAONO_LEGEND_VERTICAL_RATIO,
} from "../src/pages/Kepler/factories/maono-map-legend-position.ts";

const [legendFactory, popoverFactory, geometryFilter, shellRuntime, keplerIndex] = await Promise.all([
  readFile(new URL("../src/pages/Kepler/factories/maono-map-legend-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/factories/maono-map-popover.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/engine-adapter/geometry-filter-command.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/maono-map-shell/MaonoMapRuntime.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/index.tsx", import.meta.url), "utf8"),
]);

const legacyOverlayFiles = [
  "../src/pages/Kepler/components/native-overlays/NativeMapOverlaysRuntime.tsx",
  "../src/pages/Kepler/components/native-overlays/maono-native-overlays.css",
  "../src/pages/Kepler/components/native-overlays/native-overlay-placement.ts",
];

const polygon = {
  type: "Feature",
  id: "source-feature",
  properties: { name: "Área A", filterId: "valor-do-dataset" },
  geometry: {
    type: "Polygon",
    coordinates: [[[-47.9, -15.9], [-47.7, -15.9], [-47.7, -15.7], [-47.9, -15.7], [-47.9, -15.9]]],
  },
};

function testLayer(id, type, visible = true) {
  return { id, type, config: { id, isVisible: visible, dataId: `${id}-dataset` } };
}

function geometryRootState() {
  return {
    demo: {
      keplerGl: {
        map: {
          visState: {
            layers: [
              testLayer("source-polygons", "geojson"),
              testLayer("clientes", "point"),
              testLayer("rotas", "line"),
              testLayer("areas", "geojson"),
              testLayer("oculta", "point", false),
              testLayer(GEOCODER_LAYER_ID, "point"),
              testLayer("calor", "heatmap"),
            ],
            filters: [],
            editor: { features: [], selectedFeature: null },
          },
          mapState: { width: 1000, height: 700 },
          uiState: {},
          mapStyle: {},
        },
      },
    },
  };
}

function nativePolygonAction(action) {
  return [action, action?.payload, action?.payload?.payload].find(
    (candidate) => candidate?.layer && candidate?.feature,
  );
}

test("legenda nasce em 60% / 12% usando somente o viewport React", () => {
  assert.equal(MAONO_LEGEND_HORIZONTAL_RATIO, 0.6);
  assert.equal(MAONO_LEGEND_VERTICAL_RATIO, 0.12);
  const position = calculateMaonoLegendInitialPosition({ width: 1343, height: 915 });
  assert.ok(position);
  assert.ok(Math.abs(position.x - 805.8) < 0.1);
  assert.ok(Math.abs(position.y - 109.8) < 0.1);
  assert.equal(position.anchorX, "left");
  assert.equal(position.anchorY, "top");
});

test("posição inicial é limitada ao canvas sem medir pixels no DOM", () => {
  const position = calculateMaonoLegendInitialPosition({ width: 320, height: 420 });
  assert.ok(position);
  assert.equal(position.x, 16);
  assert.ok(position.y >= 16);
  assert.ok(position.y <= 272);
});

test("legenda Maono substitui o factory oficial e preserva estado nativo", () => {
  assert.match(legendFactory, /MapLegendPanelFactory/);
  assert.match(legendFactory, /MapLegendPanelFactory\.deps/);
  assert.match(legendFactory, /MapLegendPanelFactory\(/);
  assert.match(legendFactory, /MapLegend/);
  assert.match(legendFactory, /setMapControlSettings/);
  assert.match(legendFactory, /uiState\?\.mapControls\?\.mapLegend\?\.active/);
  assert.match(legendFactory, /header="maono\.legend\.title"/);
  assert.match(legendFactory, /data-maono-kepler-factory="map-legend-panel"/);
  assert.match(legendFactory, /replaceMapLegendPanel/);
});

test("popup Maono mantém o MapPopover oficial e injeta ação semântica no conteúdo", () => {
  assert.match(popoverFactory, /MapPopoverFactory/);
  assert.match(popoverFactory, /MapPopoverFactory\.deps/);
  assert.match(popoverFactory, /MapPopoverFactory\(MaonoMapPopoverContent\)/);
  assert.match(popoverFactory, /<MapPopoverContent \{\.\.\.props\} \/>/);
  assert.match(popoverFactory, /<NativeMapPopover \{\.\.\.props\} \/>/);
  assert.match(popoverFactory, /getSelectedFeature/);
  assert.match(popoverFactory, /applyGeometryFilter/);
  assert.match(popoverFactory, /authorizeMapPanelCommand/);
  assert.match(popoverFactory, /Filtrar por geometria/);
  assert.match(popoverFactory, /\.select-geometry/);
  assert.match(popoverFactory, /display:\s*none/);
  assert.match(popoverFactory, /ThemeProvider/);
  assert.match(popoverFactory, /\.map-popover/);
  assert.match(popoverFactory, /replaceMapPopover/);
});

test("filtro de geometria delega ao Polygon Filter oficial do Kepler", () => {
  assert.match(geometryFilter, /setPolygonFilterLayer/);
  assert.match(geometryFilter, /wrapTo/);
  assert.match(geometryFilter, /KEPLER_MAP_ID/);
  assert.match(geometryFilter, /EDITOR_AVAILABLE_LAYERS/);
  assert.match(geometryFilter, /GEOCODER_LAYER_ID/);
  assert.match(geometryFilter, /selectedFeature/);
  assert.match(geometryFilter, /filterId/);
});

test("filtro aceita somente área e escolhe layers nativas elegíveis", () => {
  const state = geometryRootState();
  assert.equal(isPolygonGeometryFeature(polygon), true);
  assert.equal(
    isPolygonGeometryFeature({ ...polygon, geometry: { type: "Point", coordinates: [-47.8, -15.8] } }),
    false,
  );
  assert.deepEqual(
    geometryFilterTargetLayerIds(state, "source-polygons"),
    ["clientes", "rotas", "areas"],
  );
});

test("uma geometria produz um único filtro Kepler compartilhado entre layers", () => {
  const state = geometryRootState();
  const dispatches = [];

  const dispatch = (action) => {
    dispatches.push(action);
    const native = nativePolygonAction(action);
    assert.ok(native, "setPolygonFilterLayer deve atravessar wrapTo");

    const visState = state.demo.keplerGl.map.visState;
    const incoming = native.feature;
    const filterId = incoming.properties?.filterId || "polygon-filter-test";
    const selectedFeature = {
      ...incoming,
      properties: { ...(incoming.properties || {}), filterId, isClosed: true },
    };
    let filter = visState.filters.find((candidate) => candidate.id === filterId);
    if (!filter) {
      filter = { id: filterId, type: "polygon", layerId: [], value: selectedFeature, enabled: true };
      visState.filters.push(filter);
    }
    if (!filter.layerId.includes(native.layer.id)) filter.layerId.push(native.layer.id);
    filter.value = selectedFeature;
    visState.editor.selectedFeature = selectedFeature;
  };

  const result = applyGeometryFilter({
    dispatch,
    getState: () => state,
    feature: polygon,
    sourceLayerId: "source-polygons",
  });

  assert.equal(result.ok, true);
  assert.equal(dispatches.length, 3);
  assert.equal(state.demo.keplerGl.map.visState.filters.length, 1);
  assert.deepEqual(state.demo.keplerGl.map.visState.filters[0].layerId, ["clientes", "rotas", "areas"]);
  assert.equal(result.value.filterId, "polygon-filter-test");
  assert.deepEqual(result.value.affectedLayerIds, ["clientes", "rotas", "areas"]);
});

test("injeção oficial registra legenda e popup no Kepler", () => {
  assert.match(keplerIndex, /replaceMapLegendPanel/);
  assert.match(keplerIndex, /replaceMapPopover/);
  assert.match(keplerIndex, /replaceMapLegendPanel\(\)/);
  assert.match(keplerIndex, /replaceMapPopover\(\)/);
});

test("novo fluxo não depende de técnicas DOM legadas", () => {
  const implementation = `${legendFactory}\n${popoverFactory}`;
  assert.equal(implementation.includes("MutationObserver"), false);
  assert.equal(implementation.includes("querySelector"), false);
  assert.equal(implementation.includes("textContent"), false);
  assert.equal(implementation.includes("[class*="), false);
  assert.equal(implementation.includes("!important"), false);
  assert.equal(shellRuntime.includes("NativeMapOverlaysRuntime"), false);
});

test("runtime e CSS legados de overlays foram removidos", async () => {
  for (const relativePath of legacyOverlayFiles) {
    await assert.rejects(access(new URL(relativePath, import.meta.url)), /ENOENT/);
  }
});
