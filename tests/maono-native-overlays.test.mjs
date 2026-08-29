import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { GEOCODER_LAYER_ID } from "@kepler.gl/constants";

import {
  applyGeometryFilter,
  geometryFilterLayerOptions,
  geometryFilterSnapshots,
  geometryFilterTargetLayerIds,
  isPolygonGeometryFeature,
  updateGeometryFilterLayers,
} from "../src/pages/Kepler/engine-adapter/geometry-filter-command.ts";
import {
  hitTestProjectedGeometry,
} from "../src/pages/Kepler/components/map-overlay/geometry-filter-overlay-utils.ts";
import { createGeometryFilterFeature } from "../src/pages/Kepler/components/map-overlay/useGeometryFilterDrawing.ts";
import {
  calculateMaonoLegendInitialPosition,
  MAONO_LEGEND_HORIZONTAL_RATIO,
  MAONO_LEGEND_VERTICAL_RATIO,
} from "../src/pages/Kepler/factories/maono-map-legend-position.ts";

const [
  legendFactory,
  popoverFactory,
  popoverStyles,
  geometryFilter,
  geometryFilterMenu,
  geometryManagerHook,
  geometryDrawingHook,
  geometryRuntime,
  geometryRuntimeStyles,
  analysisToolMenu,
  overlayControls,
  geometryUiStyles,
  mapControlFactory,
  shellRuntime,
  keplerIndex,
] = await Promise.all([
  readFile(new URL("../src/pages/Kepler/factories/maono-map-legend-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/factories/maono-map-popover.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/factories/maono-map-popover.css", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/engine-adapter/geometry-filter-command.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/GeometryFilterMenu.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/useGeometryFilterManager.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/useGeometryFilterDrawing.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/MaonoGeometryFilterRuntime.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/geometry-filter-runtime.css", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/analysis-tools/AnalysisToolMenu.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/MapOverlayControls.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/geometry-filter-ui.css", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/factories/map-control.tsx", import.meta.url), "utf8"),
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
  return {
    id,
    type,
    config: {
      id,
      label: `Layer ${id}`,
      isVisible: visible,
      dataId: `${id}-dataset`,
    },
  };
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
            editor: {
              features: [],
              selectedFeature: null,
              visible: false,
              mode: "EDIT",
            },
          },
          mapState: { width: 1000, height: 700 },
          uiState: { mapControls: { mapDraw: { active: false } } },
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

function polygonDispatches(dispatches) {
  return dispatches.filter((action) => Boolean(nativePolygonAction(action)));
}

function createPolygonFilterReducer(state, dispatches) {
  return (action) => {
    dispatches.push(action);
    const visState = state.demo.keplerGl.map.visState;
    const native = nativePolygonAction(action);

    // O adapter envia setSelectedFeature(null) após cada mutação espacial.
    // O fake reducer só precisa refletir esse efeito para provar que o comando
    // termina sem estado visual do Editor selecionado.
    if (!native) {
      visState.editor.selectedFeature = null;
      return;
    }

    const incoming = native.feature;
    const incomingFilterId = incoming.properties?.filterId;
    const id = incomingFilterId || "polygon-filter-test";
    const selectedFeature = {
      ...incoming,
      properties: {
        ...(incoming.properties || {}),
        filterId: id,
        isClosed: true,
      },
    };
    let filter = visState.filters.find((candidate) => candidate.id === id);

    if (!filter) {
      filter = {
        id,
        type: "polygon",
        layerId: [native.layer.id],
        value: selectedFeature,
        enabled: true,
      };
      visState.filters.push(filter);
    } else if (filter.layerId.includes(native.layer.id)) {
      filter.layerId = filter.layerId.filter((layerId) => layerId !== native.layer.id);
    } else {
      filter.layerId.push(native.layer.id);
    }

    filter.value = selectedFeature;
    visState.editor.selectedFeature = selectedFeature;
  };
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

test("tooltip Maono mantém filtragem recolhida e oferece saída explícita", () => {
  assert.match(popoverFactory, /MapPopoverFactory\.deps/);
  assert.match(popoverFactory, /createPortal/);
  assert.match(popoverFactory, /className={`maono-map-tooltip/);
  assert.match(popoverFactory, /<MapPopoverContent/);
  assert.match(popoverFactory, /getSelectedFeature/);
  assert.match(popoverFactory, /GeometryFilterMenu/);
  assert.match(popoverFactory, /filterMenuOpen/);
  assert.match(popoverFactory, /Filtrar por geometria/);
  assert.match(popoverFactory, /aria-expanded={filterMenuOpen}/);
  assert.match(popoverFactory, /maono-map-tooltip__geometry-dropdown/);
  assert.match(popoverFactory, /onExit=\{\(\) => setFilterMenuOpen\(false\)\}/);
  assert.doesNotMatch(popoverFactory, /NativeMapPopover/);
  assert.doesNotMatch(popoverFactory, /select-geometry/);
  assert.match(popoverStyles, /\.maono-map-tooltip__layer-list/);
  assert.match(geometryUiStyles, /\.maono-map-tooltip__geometry-action/);
});

test("gestor Maono controla layers, saída e remoção sem importar o Editor", () => {
  assert.match(geometryFilterMenu, /geometryFilterLayerOptions/);
  assert.match(geometryFilterMenu, /updateGeometryFilterLayers/);
  assert.match(geometryFilterMenu, /removeGeometryFilter/);
  assert.match(geometryFilterMenu, /Aplicar filtro/);
  assert.match(geometryFilterMenu, /Atualizar filtro/);
  assert.match(geometryFilterMenu, /Sair do filtro por geometria/);
  assert.match(geometryFilterMenu, /Remover filtro/);
  assert.match(geometryFilterMenu, />\s*Todas\s*</);
  assert.match(geometryFilterMenu, />\s*Limpar\s*</);
  assert.doesNotMatch(geometryFilterMenu, /setSelectedFeature/);
  assert.doesNotMatch(geometryFilterMenu, /@kepler\.gl\/actions/);
});

test("catálogo Maono expõe todas as layers e marca compatibilidade", () => {
  const state = geometryRootState();
  assert.equal(isPolygonGeometryFeature(polygon), true);
  assert.equal(
    isPolygonGeometryFeature({ ...polygon, geometry: { type: "Point", coordinates: [-47.8, -15.8] } }),
    false,
  );

  const options = geometryFilterLayerOptions(state, "source-polygons");
  assert.deepEqual(
    options.map(({ id, filterable, visible, source }) => ({ id, filterable, visible, source })),
    [
      { id: "source-polygons", filterable: true, visible: true, source: true },
      { id: "clientes", filterable: true, visible: true, source: false },
      { id: "rotas", filterable: true, visible: true, source: false },
      { id: "areas", filterable: true, visible: true, source: false },
      { id: "oculta", filterable: true, visible: false, source: false },
      { id: "calor", filterable: false, visible: true, source: false },
    ],
  );
  assert.deepEqual(
    geometryFilterTargetLayerIds(state, "source-polygons"),
    ["source-polygons", "clientes", "rotas", "areas", "oculta"],
  );
});

test("adapter cria um único filtro e encerra sem seleção visual do Kepler", () => {
  const state = geometryRootState();
  const dispatches = [];
  const dispatch = createPolygonFilterReducer(state, dispatches);

  const result = applyGeometryFilter({
    dispatch,
    getState: () => state,
    feature: polygon,
    sourceLayerId: "source-polygons",
    targetLayerIds: ["source-polygons", "clientes", "oculta"],
  });

  assert.equal(result.ok, true);
  assert.equal(polygonDispatches(dispatches).length, 3);
  assert.equal(state.demo.keplerGl.map.visState.filters.length, 1);
  assert.deepEqual(
    state.demo.keplerGl.map.visState.filters[0].layerId,
    ["source-polygons", "clientes", "oculta"],
  );
  assert.equal(state.demo.keplerGl.map.visState.editor.selectedFeature, null);
  assert.equal(result.value.filterId, "polygon-filter-test");
  assert.deepEqual(
    result.value.affectedLayerIds,
    ["source-polygons", "clientes", "oculta"],
  );

  const snapshots = geometryFilterSnapshots(state);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].maonoManaged, true);
  assert.equal(snapshots[0].sourceLayerId, "source-polygons");
});

test("adapter descobre filtro pelo delta e não por editor.selectedFeature", () => {
  assert.match(geometryFilter, /newlyCreatedPolygonFilter/);
  assert.match(geometryFilter, /idsBeforeCreation/);
  assert.match(geometryFilter, /setSelectedFeature\(null\)/);
  assert.match(geometryFilter, /removeGeometryFilter/);
  assert.doesNotMatch(geometryFilter, /selectedEditorFeature/);
  assert.doesNotMatch(geometryFilter, /openSelectedGeometryFilterManager/);
});

test("tooltip atualiza associações sem reativar seleção editável", () => {
  const state = geometryRootState();
  const dispatches = [];
  const dispatch = createPolygonFilterReducer(state, dispatches);

  const created = applyGeometryFilter({
    dispatch,
    getState: () => state,
    feature: polygon,
    targetLayerIds: ["clientes", "areas"],
  });
  assert.equal(created.ok, true);

  dispatches.length = 0;
  const updated = updateGeometryFilterLayers({
    dispatch,
    getState: () => state,
    filterId: created.value.filterId,
    targetLayerIds: ["clientes", "rotas"],
  });

  assert.equal(updated.ok, true);
  assert.equal(polygonDispatches(dispatches).length, 2);
  assert.equal(state.demo.keplerGl.map.visState.editor.selectedFeature, null);
  assert.deepEqual(
    state.demo.keplerGl.map.visState.filters[0].layerId.sort(),
    ["clientes", "rotas"],
  );
  assert.deepEqual(updated.value.affectedLayerIds.sort(), ["clientes", "rotas"]);
});

test("guard elimina o Editor nativo por estado e não por corrida de eventos", () => {
  assert.match(geometryManagerHook, /toggleEditorVisibility/);
  assert.match(geometryManagerHook, /setEditorMode\(EDITOR_MODES\.EDIT\)/);
  assert.match(geometryManagerHook, /setSelectedFeature\(null\)/);
  assert.match(geometryManagerHook, /setFeatures\(\[\]\)/);
  assert.match(geometryManagerHook, /toggleMapControl\("mapDraw", 0\)/);
  assert.match(geometryManagerHook, /enforceGeometryFilterEngineIsolation/);
  assert.doesNotMatch(geometryManagerHook, /requestAnimationFrame/);
  assert.doesNotMatch(geometryManagerHook, /addEventListener\("click"/);
  assert.doesNotMatch(geometryManagerHook, /default-deckgl-overlay/);
  assert.doesNotMatch(geometryManagerHook, /rightClick:\s*true/);
  assert.doesNotMatch(geometryManagerHook, /FeatureActionPanel/);
  assert.doesNotMatch(geometryManagerHook, /@turf/i);
});

test("runtime Maono desenha e gerencia filtros sem picking do Editor", () => {
  assert.match(geometryRuntime, /geometryFilterSnapshots/);
  assert.match(geometryRuntime, /projectGeometryFilter/);
  assert.match(geometryRuntime, /hitTestProjectedGeometry/);
  assert.match(geometryRuntime, /GeometryFilterMenu/);
  assert.match(geometryRuntime, /Sair do filtro por geometria/);
  assert.match(geometryRuntime, /Gerenciar filtros geométricos/);
  assert.match(geometryRuntime, /pointerdown/);
  assert.match(geometryRuntime, /Math\.hypot/);
  assert.match(geometryRuntime, /> 6/);
  assert.doesNotMatch(geometryRuntime, /EditableGeoJsonLayer/);
  assert.doesNotMatch(geometryRuntime, /FeatureActionPanel/);
  assert.doesNotMatch(geometryRuntime, /setSelectedFeature/);
  assert.match(geometryRuntimeStyles, /\.maono-geometry-filter-overlay/);
  assert.match(geometryRuntimeStyles, /pointer-events:\s*none/);
  assert.match(shellRuntime, /MaonoGeometryFilterRuntime/);
});

test("hit-test da UI respeita interior, buracos e borda do polígono", () => {
  const projected = {
    path: "",
    polygons: [[
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      [
        { x: 40, y: 40 },
        { x: 60, y: 40 },
        { x: 60, y: 60 },
        { x: 40, y: 60 },
      ],
    ]],
  };

  assert.equal(hitTestProjectedGeometry(projected, { x: 20, y: 20 }), true);
  assert.equal(hitTestProjectedGeometry(projected, { x: 50, y: 50 }), false);
  assert.equal(hitTestProjectedGeometry(projected, { x: 102, y: 50 }, 3), true);
  assert.equal(hitTestProjectedGeometry(projected, { x: 120, y: 50 }), false);
});

test("desenho Maono cria Polygon fechado com no mínimo três vértices", () => {
  assert.equal(
    createGeometryFilterFeature([
      { longitude: -47.9, latitude: -15.9 },
      { longitude: -47.7, latitude: -15.9 },
    ]),
    null,
  );

  const feature = createGeometryFilterFeature([
    { longitude: -47.9, latitude: -15.9 },
    { longitude: -47.7, latitude: -15.9 },
    { longitude: -47.8, latitude: -15.7 },
  ]);
  assert.ok(feature);
  assert.equal(feature.geometry.type, "Polygon");
  assert.equal(feature.geometry.coordinates[0].length, 4);
  assert.deepEqual(
    feature.geometry.coordinates[0][0],
    feature.geometry.coordinates[0][3],
  );
  assert.equal(feature.properties.maonoGeometryFilter, true);
});

test("pin oferece desenho de área e usa overlay Maono sem edit handles arrastáveis", () => {
  assert.match(analysisToolMenu, /Desenhar área de filtragem/);
  assert.match(analysisToolMenu, /onStartGeometryFilterDraw/);
  assert.match(overlayControls, /useGeometryFilterDrawing/);
  assert.match(overlayControls, /Concluir polígono/);
  assert.match(overlayControls, /GeometryFilterMenu/);
  assert.match(overlayControls, /maono-geometry-draw-canvas/);
  assert.match(geometryDrawingHook, /screenToMarkerOrigin/);
  assert.match(geometryDrawingHook, /Backspace/);
  assert.match(geometryDrawingHook, /Escape/);
  assert.doesNotMatch(geometryDrawingHook, /setSelectedFeature/);
  assert.doesNotMatch(geometryDrawingHook, /EditableGeoJsonLayer/);
  assert.doesNotMatch(geometryDrawingHook, /@nebula\.gl/);
  assert.match(geometryUiStyles, /\.maono-geometry-draw-canvas circle/);
  assert.doesNotMatch(geometryUiStyles, /cursor:\s*(grab|move)/);
});

test("canto superior direito não renderiza botões nativos do Kepler", () => {
  assert.match(mapControlFactory, /data-maono-kepler-controls="hidden"/);
  assert.match(mapControlFactory, /actionComponents={MapLegendPanel \? \[MapLegendPanel\] : \[\]}/);
  assert.match(mapControlFactory, /\.map-control \.map-control-button/);
  assert.match(mapControlFactory, /display:\s*none/);
  assert.doesNotMatch(mapControlFactory, /EffectControl/);
  assert.doesNotMatch(mapControlFactory, /AiAssistantControl/);
  assert.doesNotMatch(mapControlFactory, /SqlPanelControl/);
  assert.doesNotMatch(mapControlFactory, /BannerMapPanel/);
  assert.doesNotMatch(mapControlFactory, /SampleMapPanel/);
});

test("injeção registra controles, legenda e tooltip Maono no Kepler", () => {
  assert.match(keplerIndex, /replaceMapControl/);
  assert.match(keplerIndex, /replaceMapLegendPanel/);
  assert.match(keplerIndex, /replaceMapPopover/);
  assert.match(keplerIndex, /replaceMapControl\(\)/);
  assert.match(keplerIndex, /replaceMapLegendPanel\(\)/);
  assert.match(keplerIndex, /replaceMapPopover\(\)/);
});

test("novo fluxo não depende de técnicas DOM legadas no tooltip", () => {
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
