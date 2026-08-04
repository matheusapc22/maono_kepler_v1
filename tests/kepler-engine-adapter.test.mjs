import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateKeplerBounds,
  createKeplerEngineSelector,
  mapLegendVisible,
  normalizeKeplerBasemap,
  normalizeKeplerDatasets,
  normalizeKeplerFilters,
  normalizeKeplerInteraction,
  normalizeKeplerLayers,
  normalizeKeplerTooltip,
  normalizeKeplerViewport,
  selectDatasetFields,
  selectEngineSnapshot,
  selectLayerById,
} from "../src/pages/Kepler/engine-adapter/selectors.ts";
import {
  createKeplerRevisionPayload,
  hashKeplerRevision,
  stableStringify,
} from "../src/pages/Kepler/engine-adapter/serialization.ts";
import { createKeplerEngineCommands } from "../src/pages/Kepler/engine-adapter/commands.ts";
import {
  migrateLayerConfigurationForTypeChange,
  planLayerColumnUpdate,
  planLayerDatasetAssociation,
  replacementLayerIdAfterRemoval,
} from "../src/pages/Kepler/engine-adapter/layer-management.ts";
import { normalizeKeplerLayers as normalizeLegacyLayers } from "../src/pages/Kepler/integration/keplerBridge.ts";

const pointDataset = {
  id: "points",
  label: "Pontos",
  fields: [
    { name: "latitude", type: "real" },
    { name: "longitude", type: "real" },
    { name: "categoria", type: "string" },
  ],
  allIndexes: [0, 1],
  filteredIndex: [1],
  allData: [
    [-15.79, -47.88, "A"],
    [-23.55, -46.63, "B"],
  ],
};

const layer = {
  id: "layer-points",
  type: "point",
  config: {
    label: "Pontos comerciais",
    dataId: "points",
    isVisible: true,
    color: [197, 160, 89],
    columns: {
      lat: "latitude",
      lng: "longitude",
    },
    colorScale: "quantile",
    strokeColorScale: "ordinal",
    visConfig: {
      filled: true,
      opacity: 0.65,
      radius: 12,
      outline: true,
      strokeColor: [183, 121, 31],
      strokeColorRange: {
        colors: ["#5C4795", "#FCFBFD"],
      },
      strokeOpacity: 0.9,
      thickness: 1.5,
      colorRange: {
        colors: ["#B7791F", "#FFF8E7"],
      },
    },
  },
};

const map = {
  visState: {
    layers: [layer],
    layerOrder: ["layer-points"],
    datasets: new Map([["points", pointDataset]]),
    filters: [
      {
        id: "filter-1",
        dataId: "points",
        name: "categoria",
        type: "multiSelect",
        fieldType: "string",
        domain: ["A", "B"],
        value: ["B"],
        enabled: true,
      },
    ],
    interactionConfig: {
      tooltip: {
        enabled: true,
        config: {
          fieldsToShow: {
            points: [{ name: "categoria", format: null }],
          },
        },
      },
    },
  },
  mapState: {
    longitude: -47.88,
    latitude: -15.79,
    zoom: 5,
    bearing: 0,
    pitch: 0,
    width: 1200,
    height: 800,
  },
  mapStyle: {
    styleType: "dark",
  },
  uiState: {
    mapControls: {
      mapLegend: {
        active: true,
      },
    },
  },
};

const rootState = {
  demo: {
    app: {
      isMapLoading: false,
      error: null,
    },
    keplerGl: {
      map,
    },
  },
};

test("normaliza camadas, estilos, datasets, filtros, tooltip e viewport sem raw", () => {
  const layers = normalizeKeplerLayers(
    map.visState.layers,
    map.visState.layerOrder,
  );
  const datasets = normalizeKeplerDatasets(map.visState.datasets, ["points"]);
  const filters = normalizeKeplerFilters(map.visState.filters);
  const tooltip = normalizeKeplerTooltip(map.visState.interactionConfig);
  const viewport = normalizeKeplerViewport(map.mapState);

  assert.equal(layers[0].id, "layer-points");
  assert.equal(layers[0].type, "point");
  assert.equal(layers[0].label, "Pontos comerciais");
  assert.equal(layers[0].order, 0);
  assert.equal(layers[0].selected, false);
  assert.equal(layers[0].isVisible, true);
  assert.deepEqual(layers[0].dataIds, ["points"]);
  assert.deepEqual(layers[0].columns, {
    latitude: "latitude",
    longitude: "longitude",
    geojson: null,
    altitude: null,
  });
  assert.deepEqual(layers[0].style, {
    fillEnabled: true,
    opacity: 0.65,
    color: [197, 160, 89],
    colorField: null,
    colorScale: "quantile",
    colorPalette: ["#B7791F", "#FFF8E7"],
    colorPaletteId: null,
    strokeEnabled: true,
    strokeColor: [183, 121, 31],
    strokeColorField: null,
    strokeColorScale: "ordinal",
    strokeColorPalette: ["#5C4795", "#FCFBFD"],
    strokeColorPaletteId: null,
    strokeOpacity: 0.9,
    strokeWidth: 1.5,
    pointRadius: 12,
    radiusField: null,
    radiusScale: null,
    radiusRange: null,
    clusterRadius: null,
    heatmapRadius: null,
    compatibility: {
      supported: true,
      fixedColor: true,
      colorField: true,
      colorScale: true,
      palette: true,
      opacity: true,
      fill: true,
      stroke: true,
      strokeField: true,
      radius: true,
      radiusField: true,
      radiusRange: true,
      clusterRadius: false,
      heatmapRadius: false,
    },
  });
  assert.deepEqual(layers[0].visualChannels.color, {
    field: null,
    scale: "quantile",
  });
  assert.equal(layers[0].compatibility.supportsClustering, true);
  assert.equal(datasets[0].rowCount, 2);
  assert.equal(datasets[0].filteredRowCount, 1);
  assert.equal(datasets[0].isVisible, true);
  assert.equal(datasets[0].status, "ready");
  assert.equal(datasets[0].isTransient, false);
  assert.deepEqual(datasets[0].dependentLayerIds, []);
  assert.equal(Object.hasOwn(datasets[0], "allData"), false);
  assert.equal(Object.hasOwn(datasets[0], "dataContainer"), false);
  assert.deepEqual(
    datasets[0].fields.map(({ name, filterType }) => ({
      name,
      filterType,
    })),
    [
      { name: "latitude", filterType: "range" },
      { name: "longitude", filterType: "range" },
      { name: "categoria", filterType: "multiSelect" },
    ],
  );
  assert.deepEqual(filters[0].fieldNames, ["categoria"]);
  assert.equal(filters[0].dataId, "points");
  assert.equal(filters[0].fieldName, "categoria");
  assert.equal(filters[0].label, "categoria");
  assert.equal(filters[0].type, "multiSelect");
  assert.deepEqual(filters[0].domain, ["A", "B"]);
  assert.equal(filters[0].domainTruncated, false);
  assert.equal(filters[0].compatible, true);
  assert.deepEqual(tooltip.fieldsByDataset.points, [
    { name: "categoria", format: null },
  ]);
  assert.equal(viewport?.zoom, 5);

  for (const value of [layers[0], datasets[0], filters[0]]) {
    assert.equal(Object.hasOwn(value, "raw"), false);
  }
});

test("normaliza filtros avançados sem reexpor polígonos ou domínios ilimitados", () => {
  const largeDomain = Array.from({ length: 5_002 }, (_, index) => `C${index}`);
  const bins = Array.from({ length: 100 }, (_, index) => ({
    x0: index,
    x1: index + 1,
    count: index + 1,
  }));
  const filters = normalizeKeplerFilters([
    {
      id: "range",
      dataId: "points",
      name: "longitude",
      type: "range",
      fieldType: "real",
      domain: [0, 100],
      value: [10, 90],
      step: 1,
      bins: { points: bins },
    },
    {
      id: "categories",
      dataId: "points",
      name: "categoria",
      type: "multiSelect",
      domain: largeDomain,
      value: ["C1"],
    },
    {
      id: "spatial",
      dataId: "points",
      name: "geometry",
      type: "polygon",
      value: [{ coordinates: [[-47, -15]] }],
    },
  ]);

  assert.deepEqual(filters[0].domain, [0, 100]);
  assert.deepEqual(filters[0].value, [10, 90]);
  assert.equal(filters[0].step, 1);
  assert.equal(filters[0].histogram.length <= 80, true);
  assert.equal(filters[0].histogram.at(-1).end, 100);

  assert.equal(filters[1].domain.length, 5_000);
  assert.equal(filters[1].domainSize, 5_002);
  assert.equal(filters[1].domainTruncated, true);

  assert.equal(filters[2].compatible, false);
  assert.match(filters[2].compatibilityReason, /painel nativo/);
  assert.equal(filters[2].value, null);
  assert.equal(JSON.stringify(filters[2]).includes("coordinates"), false);
});

test("calcula extensões visível e filtrada com o mesmo contrato", () => {
  const visible = calculateKeplerBounds(rootState);
  const filtered = calculateKeplerBounds(rootState, {
    filteredOnly: true,
  });

  assert.deepEqual(visible, {
    minLongitude: -47.88,
    minLatitude: -23.55,
    maxLongitude: -46.63,
    maxLatitude: -15.79,
    sampled: false,
  });
  assert.deepEqual(filtered, {
    minLongitude: -46.65,
    minLatitude: -23.57,
    maxLongitude: -46.61,
    maxLatitude: -23.53,
    sampled: false,
  });
});

test("filtro sem resultados produz extensão vazia", () => {
  const emptyFilteredState = {
    ...rootState,
    demo: {
      ...rootState.demo,
      keplerGl: {
        map: {
          ...map,
          visState: {
            ...map.visState,
            datasets: new Map([
              [
                "points",
                {
                  ...pointDataset,
                  filteredIndex: [],
                },
              ],
            ]),
          },
        },
      },
    },
  };

  assert.equal(
    calculateKeplerBounds(emptyFilteredState, {
      filteredOnly: true,
    }),
    null,
  );
});

test("selector memoizado mantém identidade até uma referência relevante mudar", () => {
  const selector = createKeplerEngineSelector();
  const first = selector(rootState);
  const second = selector(rootState);

  assert.strictEqual(second, first);
  assert.equal(first.layers.length, 1);
  assert.equal(first.datasets.length, 1);
  assert.equal(first.filters.length, 1);
  assert.equal(first.hasData, true);
  assert.equal(first.legendVisible, true);
  assert.equal(mapLegendVisible(map), true);

  const loadingState = {
    ...rootState,
    demo: {
      ...rootState.demo,
      app: {
        ...rootState.demo.app,
        isMapLoading: true,
      },
    },
  };
  const loading = selector(loadingState);

  assert.notStrictEqual(loading, first);
  assert.equal(loading.isLoading, true);
  assert.equal(loading.ready, false);
});

test("serialização é estável e muda quando a configuração muda", () => {
  assert.equal(
    stableStringify({ b: 2, a: 1 }),
    stableStringify({ a: 1, b: 2 }),
  );

  const originalHash = hashKeplerRevision(map);
  const changedMap = {
    ...map,
    visState: {
      ...map.visState,
      layers: [
        {
          ...layer,
          config: {
            ...layer.config,
            visConfig: {
              ...layer.config.visConfig,
              opacity: 0.25,
            },
          },
        },
      ],
    },
  };

  assert.notEqual(hashKeplerRevision(changedMap), originalHash);
});

test("facade legado preserva campos planos sem reexpor internals", () => {
  const legacy = normalizeLegacyLayers([layer]);

  assert.deepEqual(legacy[0].color, [197, 160, 89]);
  assert.equal(legacy[0].opacity, 0.65);
  assert.equal(legacy[0].dataId, "points");
  assert.equal(Object.hasOwn(legacy[0], "raw"), false);
});

test("comandos mutáveis passam pelo gate e pelo wrapTo", async () => {
  const commands = await readFile(
    new URL("../src/pages/Kepler/engine-adapter/commands.ts", import.meta.url),
    "utf8",
  );

  assert.match(commands, /authorizeMapPanelCommand/);
  assert.match(commands, /dispatch\(wrapTo\(KEPLER_MAP_ID,\s*action\)\)/);
  assert.match(commands, /map_panel_command_denied/);
  assert.doesNotMatch(commands, /user\?\.role|checkAdminUser/);
  assert.doesNotMatch(commands, /api\.geoapify\.com|apiKey=/i);

  for (const command of [
    "setLayerVisibility",
    "renameLayer",
    "duplicateLayer",
    "removeLayer",
    "reorderLayer",
    "createLayerFromDataset",
    "setLayerType",
    "setColorField",
    "setStrokeColorField",
    "setStrokeColorScale",
    "setStrokeColorPalette",
    "setClusterOptions",
    "setHeatmapOptions",
    "addFilter",
    "bindFilterField",
    "setTooltipFields",
    "fitVisibleData",
    "addGeoJsonLayer",
    "removeTransientLayer",
    "markLayerPersistent",
    "markLayerTransient",
  ]) {
    assert.match(commands, new RegExp(`${command}\\(`));
  }
});

test("comandos reais negam, validam e despacham somente quando autorizados", () => {
  const telemetryEvents = [];
  const previousWindow = globalThis.window;

  globalThis.window = {
    dispatchEvent(event) {
      telemetryEvents.push(event);
      return true;
    },
  };

  const createCommands = (capabilities, dispatched, state = rootState) =>
    createKeplerEngineCommands({
      dispatch(action) {
        dispatched.push(action);
      },
      getState() {
        return state;
      },
      capabilities,
      context: null,
      setSelectedLayerId() {},
      isTransientDataset() {
        return false;
      },
      markTransientDataset() {},
      markPersistentDataset() {},
      now() {
        return 1_700_000_000_000;
      },
      random() {
        return 0.5;
      },
    });

  try {
    const deniedDispatches = [];
    const denied = createCommands({}, deniedDispatches).renameLayer(
      "layer-points",
      "Novo nome",
    );

    assert.equal(denied.ok, false);
    assert.equal(denied.code, "CAPABILITY_DENIED");
    assert.equal(deniedDispatches.length, 0);

    const styleDispatches = [];
    const styleCommands = createCommands(
      { editLayerStyle: true },
      styleDispatches,
    );
    const invalid = styleCommands.setLayerOpacity("layer-points", 2);

    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, "COMMAND_INVALID");
    assert.equal(styleDispatches.length, 0);

    const styled = styleCommands.setLayerOpacity("layer-points", 0.45);

    assert.equal(styled.ok, true);
    assert.equal(styleDispatches.length, 1);
    assert.equal(styleDispatches[0].meta?._forward_, "@redux-forward/FORWARD");
    assert.equal(styleDispatches[0].meta?._addr_, "@@KG_MAP");
    assert.equal(styleDispatches[0].payload?.meta?._id_, "map");

    const invalidScale = styleCommands.setColorScale(
      "layer-points",
      "rainbow",
    );
    assert.equal(invalidScale.ok, false);
    assert.equal(invalidScale.code, "COMMAND_INVALID");
    assert.equal(styleDispatches.length, 1);

    const fillField = styleCommands.setColorField(
      "layer-points",
      "categoria",
    );
    assert.equal(fillField.ok, true);
    assert.equal(styleDispatches.length, 2);

    const strokeField = styleCommands.setStrokeColorField(
      "layer-points",
      "categoria",
    );
    assert.equal(strokeField.ok, true);
    assert.equal(styleDispatches.length, 3);

    const outline = styleCommands.setStrokeEnabled("layer-points", true);
    assert.deepEqual(outline, {ok: true, changed: false});
    assert.equal(styleDispatches.length, 3);

    const fullPalette = Array.from(
      { length: 20 },
      (_, index) => (index % 2 ? "#FFF8E7" : "#B7791F"),
    );
    const palette = styleCommands.setColorPalette(
      "layer-points",
      fullPalette,
    );
    assert.equal(palette.ok, true);
    assert.equal(styleDispatches.length, 4);

    const unsupportedType = styleCommands.setLayerType(
      "layer-points",
      "geojson",
    );
    assert.equal(unsupportedType.ok, false);
    assert.equal(unsupportedType.code, "UNSUPPORTED");
    assert.equal(styleDispatches.length, 4);

    const clusterType = styleCommands.setLayerType(
      "layer-points",
      "cluster",
    );
    assert.equal(clusterType.ok, true);
    assert.equal(styleDispatches.length, 5);

    const clusterState = {
      ...rootState,
      demo: {
        ...rootState.demo,
        keplerGl: {
          map: {
            ...map,
            visState: {
              ...map.visState,
              layers: [{ ...layer, type: "cluster" }],
            },
          },
        },
      },
    };
    const clusterDispatches = [];
    const clusterCommands = createCommands(
      { editLayerStyle: true },
      clusterDispatches,
      clusterState,
    );
    assert.equal(
      clusterCommands.setClusterOptions("layer-points", {
        radius: 500,
      }).ok,
      true,
    );
    assert.equal(
      clusterCommands.setClusterOptions("layer-points", {
        radius: 501,
      }).ok,
      false,
    );
    assert.equal(clusterDispatches.length, 1);

    const heatmapState = {
      ...clusterState,
      demo: {
        ...clusterState.demo,
        keplerGl: {
          map: {
            ...map,
            visState: {
              ...map.visState,
              layers: [{ ...layer, type: "heatmap" }],
            },
          },
        },
      },
    };
    const heatmapDispatches = [];
    const heatmapCommands = createCommands(
      { editLayerStyle: true },
      heatmapDispatches,
      heatmapState,
    );
    assert.equal(
      heatmapCommands.setHeatmapOptions("layer-points", {
        radius: 100,
      }).ok,
      true,
    );
    assert.equal(
      heatmapCommands.setHeatmapOptions("layer-points", {
        radius: 101,
      }).ok,
      false,
    );
    assert.equal(heatmapDispatches.length, 1);

    const renameDispatches = [];
    const renamed = createCommands(
      { editLayers: true },
      renameDispatches,
    ).renameLayer("layer-points", "Pontos prioritários");

    assert.equal(renamed.ok, true);
    assert.equal(renameDispatches.length, 1);

    const createLayerDispatches = [];
    const created = createCommands(
      { createLayer: true },
      createLayerDispatches,
    ).createLayerFromDataset({
      datasetId: "points",
      label: "Pontos comerciais",
    });

    assert.equal(created.ok, true);
    assert.match(created.value.layerId, /^maono_layer_/);
    assert.equal(createLayerDispatches.length, 1);

    const invalidDatasetState = {
      ...rootState,
      demo: {
        ...rootState.demo,
        keplerGl: {
          map: {
            ...map,
            visState: {
              ...map.visState,
              datasets: new Map([
                [
                  "table",
                  {
                    id: "table",
                    label: "Tabela sem geometria",
                    fields: [{ name: "categoria", type: "string" }],
                    allData: [],
                  },
                ],
              ]),
            },
          },
        },
      },
    };
    const invalidLayerDispatches = [];
    const invalidLayer = createCommands(
      { createLayer: true },
      invalidLayerDispatches,
      invalidDatasetState,
    ).createLayerFromDataset({
      datasetId: "table",
    });

    assert.equal(invalidLayer.ok, false);
    assert.equal(invalidLayer.code, "COMMAND_INVALID");
    assert.equal(invalidLayerDispatches.length, 0);

    const filterDispatches = [];
    const filtered = createCommands(
      { editFilters: true },
      filterDispatches,
    ).addFilter("points");

    assert.equal(filtered.ok, true);
    assert.equal(filterDispatches.length, 3);

    const valueDispatches = [];
    const filterCommands = createCommands(
      { editFilters: true },
      valueDispatches,
    );
    const validCategory = filterCommands.setFilterValue(0, ["A"]);
    const invalidCategory = filterCommands.setFilterValue(0, ["fora"]);

    assert.equal(validCategory.ok, true);
    assert.equal(invalidCategory.ok, false);
    assert.equal(invalidCategory.code, "COMMAND_INVALID");
    assert.equal(valueDispatches.length, 1);

    const rangeState = {
      ...rootState,
      demo: {
        ...rootState.demo,
        keplerGl: {
          map: {
            ...map,
            visState: {
              ...map.visState,
              filters: [
                {
                  id: "range",
                  dataId: "points",
                  name: "longitude",
                  type: "range",
                  domain: [0, 10],
                  value: [0, 10],
                },
              ],
            },
          },
        },
      },
    };
    const rangeDispatches = [];
    const rangeCommands = createCommands(
      { editFilters: true },
      rangeDispatches,
      rangeState,
    );

    assert.equal(rangeCommands.setFilterValue(0, [2, 8]).ok, true);
    assert.equal(rangeCommands.setFilterValue(0, [-1, 8]).ok, false);
    assert.equal(rangeCommands.setFilterValue(0, [8, 2]).ok, false);
    assert.equal(rangeDispatches.length, 1);

    const bindDispatches = [];
    const bound = createCommands(
      { editFilters: true },
      bindDispatches,
    ).bindFilterField(0, "points", "categoria");

    assert.equal(bound.ok, true);
    assert.equal(bindDispatches.length, 2);
    assert.equal(telemetryEvents.length >= 4, true);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test("ciclo temporário promove, restaura e descarta sem contornar capabilities", () => {
  const previousWindow = globalThis.window;
  const transientIds = new Set(["points"]);
  const dispatched = [];

  globalThis.window = {
    dispatchEvent() {
      return true;
    },
  };

  try {
    const commands = createKeplerEngineCommands({
      dispatch(action) {
        dispatched.push(action);
      },
      getState() {
        return rootState;
      },
      capabilities: {
        previewIsochrone: true,
        persistIsochrone: true,
      },
      context: null,
      setSelectedLayerId() {},
      isTransientDataset(dataId) {
        return transientIds.has(dataId);
      },
      markTransientDataset(dataId) {
        transientIds.add(dataId);
      },
      markPersistentDataset(dataId) {
        transientIds.delete(dataId);
      },
    });

    const collision = commands.addGeoJsonLayer({
      dataId: "points",
      label: "Dataset duplicado",
      geoJson: {
        type: "FeatureCollection",
        features: [],
      },
      transient: true,
    });
    assert.equal(collision.ok, false);
    assert.equal(collision.code, "COMMAND_INVALID");
    assert.equal(dispatched.length, 0);

    assert.equal(commands.markLayerPersistent("points").ok, true);
    assert.equal(transientIds.has("points"), false);
    assert.equal(commands.markLayerTransient("points").ok, true);
    assert.equal(transientIds.has("points"), true);
    assert.equal(commands.removeTransientLayer("points").ok, true);
    assert.equal(transientIds.has("points"), false);
    assert.equal(dispatched.length, 1);

    const denied = createKeplerEngineCommands({
      dispatch() {
        throw new Error("não deveria despachar");
      },
      getState() {
        return rootState;
      },
      capabilities: {},
      context: null,
      setSelectedLayerId() {},
      isTransientDataset() {
        return true;
      },
      markTransientDataset() {},
      markPersistentDataset() {},
    }).removeTransientLayer("points");

    assert.equal(denied.ok, false);
    assert.equal(denied.code, "CAPABILITY_DENIED");

    const viewerCannotPromoteArbitraryDataset =
      createKeplerEngineCommands({
        dispatch() {},
        getState() {
          return rootState;
        },
        capabilities: { previewIsochrone: true },
        context: null,
        setSelectedLayerId() {},
        isTransientDataset() {
          return false;
        },
        markTransientDataset() {
          throw new Error("viewer não deveria marcar datasets existentes");
        },
        markPersistentDataset() {},
      }).markLayerTransient("points");

    assert.equal(viewerCannotPromoteArbitraryDataset.ok, false);
    assert.equal(
      viewerCannotPromoteArbitraryDataset.code,
      "CAPABILITY_DENIED",
    );
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});


test("snapshot vazio e seleção inexistente retornam fallbacks previsíveis", () => {
  const empty = selectEngineSnapshot({});

  assert.equal(empty.ready, false);
  assert.equal(empty.selectedLayerId, null);
  assert.deepEqual(empty.layers, []);
  assert.deepEqual(empty.datasets, []);
  assert.deepEqual(empty.filters, []);
  assert.equal(empty.viewport, null);
  assert.equal(empty.bounds, null);
  assert.equal(empty.basemap.styleType, null);
  assert.equal(empty.interaction.tooltip.enabled, false);
  assert.equal(empty.save.status, "read-only");

  const selector = createKeplerEngineSelector();
  const missingSelection = selector(rootState, "layer-inexistente");
  assert.equal(missingSelection.selectedLayerId, "layer-points");
  assert.equal(missingSelection.layers[0].selected, true);
  assert.equal(selectLayerById(rootState, "layer-inexistente"), null);
  assert.deepEqual(
    selectDatasetFields(rootState, "points").map((field) => field.name),
    ["latitude", "longitude", "categoria"],
  );
});

test("normaliza interação, basemap e blending sem consultar o DOM", () => {
  const interaction = normalizeKeplerInteraction(
    {
      ...map.visState,
      interactionConfig: {
        ...map.visState.interactionConfig,
        hover: { enabled: true },
        click: { enabled: false },
        highlight: { enabled: true },
      },
    },
    map,
  );
  const basemap = normalizeKeplerBasemap(
    {
      ...map,
      mapStyle: {
        styleType: "satellite",
        visible: true,
        visibleLayerGroups: {
          label: false,
          road: true,
          border: true,
          building: false,
        },
        enable3dBuilding: true,
        overlayBlending: "additive",
      },
    },
    {
      layerBlending: "normal",
    },
  );

  assert.equal(interaction.tooltip.enabled, true);
  assert.equal(interaction.legendVisible, true);
  assert.equal(interaction.hoverEnabled, true);
  assert.equal(interaction.clickEnabled, false);
  assert.equal(interaction.highlightEnabled, true);
  assert.deepEqual(interaction.availableControls, ["mapLegend"]);
  assert.deepEqual(basemap, {
    styleType: "satellite",
    visible: true,
    labelsVisible: false,
    roadsVisible: true,
    bordersVisible: true,
    buildingsVisible: false,
    threeDBuildingsVisible: true,
    blending: {
      layers: "normal",
      overlays: "additive",
    },
  });
});

test("snapshot resume datasets sem copiar registros integrais", () => {
  const largeRows = Array.from({ length: 20_000 }, (_, index) => [index]);
  const dataset = {
    id: "large",
    label: "Grande",
    fields: [{ name: "valor", type: "integer" }],
    allData: largeRows,
  };
  const datasets = normalizeKeplerDatasets(new Map([["large", dataset]]));

  assert.equal(datasets[0].rowCount, 20_000);
  assert.equal(Object.hasOwn(datasets[0], "allData"), false);
  assert.equal(Object.hasOwn(datasets[0], "filteredIndex"), false);
  assert.equal(JSON.stringify(datasets[0]).includes("19999"), false);
});

test("payload de revisão inclui configuração e exclui linhas e estado transitório", () => {
  const payload = createKeplerRevisionPayload({
    ...map,
    visState: {
      ...map.visState,
      layerBlending: "normal",
      overlayBlending: "additive",
      datasets: new Map([
        [
          "points",
          {
            ...pointDataset,
            dataContainer: { numRows: 2, rows: ["segredo"] },
            transient: true,
          },
        ],
      ]),
    },
    mapStyle: {
      ...map.mapStyle,
      visibleLayerGroups: { label: true },
    },
  });
  const serialized = stableStringify(payload);

  assert.equal(serialized.includes("segredo"), false);
  assert.equal(serialized.includes("allData"), false);
  assert.equal(serialized.includes("dataContainer"), false);
  assert.equal(serialized.includes("filteredIndex"), false);
  assert.equal(payload.layerBlending, "normal");
  assert.equal(payload.overlayBlending, "additive");
  assert.deepEqual(payload.datasets[0].fields[0], {
    name: "latitude",
    type: "real",
    format: null,
  });
});

test("comandos distinguem no-op, mapa ausente, conflito e operação não suportada", () => {
  const previousWindow = globalThis.window;
  const dispatched = [];
  let selectedLayerId = "layer-points";

  globalThis.window = {
    dispatchEvent() {
      return true;
    },
  };

  try {
    const commands = createKeplerEngineCommands({
      dispatch(action) {
        dispatched.push(action);
      },
      getState() {
        return rootState;
      },
      capabilities: {
        inspectLayer: true,
        toggleLayerVisibility: true,
        editLayerStyle: true,
        editLayers: true,
        configureTooltips: true,
        removeLayer: true,
      },
      context: null,
      setSelectedLayerId(layerId) {
        selectedLayerId = layerId;
      },
      getSelectedLayerId() {
        return selectedLayerId;
      },
      isTransientDataset() {
        return false;
      },
      markTransientDataset() {},
      markPersistentDataset() {},
    });

    assert.deepEqual(commands.selectLayer("layer-points"), {
      ok: true,
      changed: false,
    });
    assert.deepEqual(commands.setLayerVisibility("layer-points", true), {
      ok: true,
      changed: false,
    });
    assert.deepEqual(commands.setLayerType("layer-points", "point"), {
      ok: true,
      changed: false,
    });
    assert.equal(dispatched.length, 0);

    const tooltipResult = commands.setTooltipEnabled(false);
    assert.deepEqual(tooltipResult, { ok: true, changed: true });
    assert.equal(dispatched.length, 1);

    const wrappedTooltipAction = dispatched[0];
    const forwardedTooltipAction =
      wrappedTooltipAction?.payload?.action ??
      (wrappedTooltipAction?.payload?.type
        ? wrappedTooltipAction.payload
        : wrappedTooltipAction?.action ?? wrappedTooltipAction);
    const tooltipPayload =
      forwardedTooltipAction?.config &&
      typeof forwardedTooltipAction.config === "object"
        ? forwardedTooltipAction.config
        : forwardedTooltipAction?.payload &&
            typeof forwardedTooltipAction.payload === "object"
          ? forwardedTooltipAction.payload
          : forwardedTooltipAction;

    assert.equal(tooltipPayload.id, "tooltip");
    assert.equal(tooltipPayload.enabled, false);
    assert.equal("tooltip" in tooltipPayload, false);
    dispatched.length = 0;

    const conflict = commands.removeDataset("points");
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, "CONFLICT");
    assert.equal(dispatched.length, 0);

    const unsupported = commands.renameDataset("points", "Renomeado");
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.code, "UNSUPPORTED");
    assert.equal(dispatched.length, 0);

    const missingMapDispatches = [];
    const missingMap = createKeplerEngineCommands({
      dispatch(action) {
        missingMapDispatches.push(action);
      },
      getState() {
        return {};
      },
      capabilities: { editLayers: true },
      context: null,
      setSelectedLayerId() {},
      isTransientDataset() {
        return false;
      },
      markTransientDataset() {},
      markPersistentDataset() {},
    }).renameLayer("layer-points", "Novo nome");

    assert.equal(missingMap.ok, false);
    assert.equal(missingMap.code, "MAP_UNAVAILABLE");
    assert.equal(missingMapDispatches.length, 0);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});



test("commands de estilo validam canais, no-op, paleta, radius e blending", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {dispatchEvent() { return true; }};
  const dispatched = [];
  const styleLayer = {
    ...layer,
    config: {
      ...layer.config,
      colorField: pointDataset.fields[0],
      colorScale: "quantile",
      strokeColorField: pointDataset.fields[2],
      strokeColorScale: "ordinal",
      visConfig: {
        ...layer.config.visConfig,
        opacity: 0.65,
        radiusRange: [0, 50],
      },
    },
  };
  const styleState = {
    demo: {
      app: {isMapLoading: false, error: null},
      keplerGl: {
        map: {
          ...map,
          visState: {
            ...map.visState,
            layers: [styleLayer],
            layerOrder: [styleLayer.id],
            layerBlending: "normal",
            overlayBlending: "normal",
          },
        },
      },
    },
  };

  const commands = createKeplerEngineCommands({
    dispatch(action) {
      dispatched.push(action);
    },
    getState() {
      return styleState;
    },
    capabilities: {editLayerStyle: true},
    context: null,
    setSelectedLayerId() {},
    isTransientDataset() { return false; },
    markTransientDataset() {},
    markPersistentDataset() {},
  });
  const unwrap = (action) => action?.payload?.type ? action.payload : action;

  assert.deepEqual(commands.setLayerOpacity(styleLayer.id, 0.65), {
    ok: true,
    changed: false,
  });
  assert.equal(dispatched.length, 0);

  assert.deepEqual(commands.setColorScale(styleLayer.id, "linear"), {
    ok: true,
    changed: true,
  });
  assert.deepEqual(unwrap(dispatched.pop()).newConfig, {colorScale: "linear"});

  const invalidScale = commands.setColorScale(styleLayer.id, "ordinal");
  assert.equal(invalidScale.ok, false);
  assert.equal(invalidScale.code, "COMMAND_INVALID");
  assert.equal(dispatched.length, 0);

  assert.deepEqual(
    commands.setColorPalette(styleLayer.id, {
      id: "balance",
      label: "Maõno Equilíbrio",
      kind: "divergent",
      colors: ["#315E7D", "#F7E7B2", "#8A4F12"],
    }),
    {ok: true, changed: true},
  );
  const paletteAction = unwrap(dispatched.pop());
  assert.equal(paletteAction.newVisConfig.colorRange.name, "maono:balance");
  assert.equal(paletteAction.newVisConfig.colorRange.type, "diverging");

  assert.deepEqual(commands.setLayerRadiusRange(styleLayer.id, [5, 80]), {
    ok: true,
    changed: true,
  });
  assert.deepEqual(unwrap(dispatched.pop()).newVisConfig.radiusRange, [5, 80]);

  assert.deepEqual(commands.setLayerBlending("normal"), {
    ok: true,
    changed: false,
  });
  assert.deepEqual(commands.setLayerBlending("additive"), {
    ok: true,
    changed: true,
  });
  assert.equal(unwrap(dispatched.pop()).mode, "additive");

  assert.deepEqual(commands.setOverlayBlending("screen"), {
    ok: true,
    changed: true,
  });
  assert.equal(unwrap(dispatched.pop()).mode, "screen");

  const clusterLayer = {
    ...styleLayer,
    id: "cluster-1",
    type: "cluster",
    config: {
      ...styleLayer.config,
      label: "Clusters",
      colorField: null,
      colorScale: "quantile",
      visConfig: {
        ...styleLayer.config.visConfig,
        clusterRadius: 40,
        radiusRange: [1, 40],
      },
    },
  };
  const clusterState = {
    demo: {
      app: {isMapLoading: false, error: null},
      keplerGl: {
        map: {
          ...map,
          visState: {
            ...map.visState,
            layers: [clusterLayer],
            layerOrder: [clusterLayer.id],
          },
        },
      },
    },
  };
  const clusterDispatches = [];
  const clusterCommands = createKeplerEngineCommands({
    dispatch(action) { clusterDispatches.push(action); },
    getState() { return clusterState; },
    capabilities: {editLayerStyle: true},
    context: null,
    setSelectedLayerId() {},
    isTransientDataset() { return false; },
    markTransientDataset() {},
    markPersistentDataset() {},
  });

  assert.deepEqual(clusterCommands.setColorField(clusterLayer.id, "categoria"), {
    ok: true,
    changed: true,
  });
  assert.equal(unwrap(clusterDispatches[0]).newConfig.colorScale, "ordinal");
  assert.deepEqual(clusterCommands.setLayerRadiusRange(clusterLayer.id, [2, 60]), {
    ok: true,
    changed: true,
  });
  assert.deepEqual(unwrap(clusterDispatches[1]).newVisConfig.radiusRange, [2, 60]);
  const invalidClusterRange = clusterCommands.setLayerRadiusRange(clusterLayer.id, [0, 151]);
  assert.equal(invalidClusterRange.ok, false);
  assert.equal(invalidClusterRange.code, "COMMAND_INVALID");

  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

test("gestão estrutural usa planos puros e seleção determinística", () => {
  const normalizedLayer = normalizeKeplerLayers([layer], [layer.id])[0];
  const normalizedDataset = normalizeKeplerDatasets(
    new Map([[pointDataset.id, pointDataset]]),
  )[0];

  const typePlan = migrateLayerConfigurationForTypeChange(
    normalizedLayer,
    "cluster",
    normalizedDataset,
  );
  assert.equal(typePlan.valid, true);
  assert.equal(typePlan.datasetId, "points");
  assert.deepEqual(typePlan.columns, normalizedLayer.columns);

  const datasetPlan = planLayerDatasetAssociation(
    normalizedLayer,
    normalizedDataset,
  );
  assert.equal(datasetPlan.valid, true);
  assert.equal(datasetPlan.changed, false);

  const columnPlan = planLayerColumnUpdate(
    normalizedLayer,
    normalizedDataset,
    { altitude: null },
  );
  assert.equal(columnPlan.valid, true);

  assert.equal(
    replacementLayerIdAfterRemoval(["a", "b", "c"], "b", "b"),
    "c",
  );
});

test("fronteira arquitetural restringe Redux e actions aos arquivos autorizados", async () => {
  const visualFiles = [
    "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/LayerList.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/LayerListItem.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/LayerInspector.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/LayerStyleEditor.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/AddLayerMenu.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/FilterPanel.tsx",
    "../src/pages/Kepler/components/map-overlay/MapOverlayControls.tsx",
    "../src/pages/Kepler/hooks/useKeplerController.ts",
    "../src/pages/Kepler/hooks/useKeplerState.ts",
  ];

  let checkedVisualFiles = 0;
  for (const relativePath of visualFiles) {
    let source;
    try {
      source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    checkedVisualFiles += 1;
    assert.doesNotMatch(source, /from\s+["']@kepler\.gl\/actions["']/);
    assert.doesNotMatch(source, /state\.demo\.keplerGl/);
  }
  assert.equal(checkedVisualFiles > 0, true);

  const bridge = await readFile(
    new URL("../src/pages/Kepler/integration/keplerBridge.ts", import.meta.url),
    "utf8",
  );
  assert.match(bridge, /@deprecated/);
  assert.match(bridge, /normalizeKeplerLayers/);
  assert.doesNotMatch(bridge, /@kepler\.gl\/actions/);
});

test("instrumentação do engine registra apenas metadados seguros", async () => {
  const debug = await readFile(
    new URL(
      "../src/pages/Kepler/engine-adapter/engine-state-debug.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(debug, /maonoEngineDebug/);
  assert.match(debug, /layerIds/);
  assert.match(debug, /datasetIds/);
  assert.doesNotMatch(debug, /allData|dataContainer|filteredIndex/);
  assert.doesNotMatch(debug, /token|credential|password/i);
});

test("provider fecha fallback legado e o runtime monta o adaptador", async () => {
  const [provider, index, controller] = await Promise.all([
    readFile(
      new URL(
        "../src/pages/Kepler/map-panel/MapPanelProvider.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src/pages/Kepler/index.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../src/pages/Kepler/hooks/useKeplerController.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  const legacySection = provider.slice(
    provider.indexOf("function legacyReadOnlyContext"),
    provider.indexOf("export function MapPanelProvider"),
  );

  assert.match(legacySection, /mode:\s*"viewer"/);
  assert.match(legacySection, /editLayers:\s*false/);
  assert.match(legacySection, /saveMap:\s*false/);
  assert.match(provider, /MAP_CONTEXT_REQUIRED/);
  assert.match(
    index,
    /<KeplerEngineAdapterProvider>[\s\S]*<ConnectedApp \/>[\s\S]*<\/KeplerEngineAdapterProvider>/,
  );
  assert.doesNotMatch(controller, /@kepler\.gl\/actions/);
  assert.doesNotMatch(controller, /useDispatch|authorizeMapPanelCommand/);
});
