import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMapCapabilities,
} from "../functions/_lib/map-panel-service.js";
import { createAnalysisLayerCommands } from "../src/pages/Kepler/engine-adapter/analysis-layer-commands.ts";
import {
  mapSaveRequestFromEvent,
  mapSaveResultFromEvent,
  mapSaveSourceAnalysisKind,
} from "../src/pages/Kepler/map-panel/map-save-events.ts";

const [saveButton, provider, analysisAdapter, bufferHook] = await Promise.all([
  readFile(
    new URL(
      "../src/pages/Kepler/components/maono-save-button.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/engine-adapter/KeplerEngineAdapterProvider.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/engine-adapter/analysis-layer-commands.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/useBufferPreview.ts",
      import.meta.url,
    ),
    "utf8",
  ),
]);

function createAnalysisRootState({ dataId = null } = {}) {
  const datasets = new Map();
  const layers = [];

  if (dataId) {
    datasets.set(dataId, {
      id: dataId,
      fields: [
        { name: "_geojson", type: "geojson" },
        { name: "analysis_label", type: "string" },
        { name: "radius_label", type: "string" },
      ],
    });
    layers.push({
      id: `layer_${dataId}`,
      type: "geojson",
      config: {
        dataId,
        label: "Buffer radial",
        color: [197, 160, 89],
        columns: { geojson: "_geojson" },
        isVisible: true,
        visConfig: {
          opacity: 0.2,
          filled: true,
          stroked: true,
          strokeColor: [183, 121, 31],
          strokeOpacity: 0.95,
          thickness: 1.5,
        },
      },
    });
  }

  return {
    demo: {
      keplerGl: {
        map: {
          visState: {
            layers,
            datasets,
            interactionConfig: {
              tooltip: {
                id: "tooltip",
                enabled: true,
                config: { fieldsToShow: {} },
              },
            },
          },
          mapState: {},
          mapStyle: {},
          uiState: {},
        },
      },
    },
  };
}

function bufferAnalysisInput(dataId) {
  return {
    dataId,
    label: "Buffer radial · 500 m",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            analysis_label: "Buffer radial",
            radius_label: "500 m",
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-47, -15],
                [-47, -14.9],
                [-46.9, -14.9],
                [-47, -15],
              ],
            ],
          },
        },
      ],
    },
    color: [197, 160, 89],
    strokeColor: [183, 121, 31],
    opacity: 0.2,
    transient: true,
    analysisKind: "buffer",
    presentation: {
      tooltipFields: ["analysis_label", "radius_label"],
      legendField: "radius_label",
      legendPalette: ["#FFF8E7", "#F1D28A"],
    },
    centerMap: false,
  };
}

function installTelemetryGlobals() {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;

  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.window = {
    dispatchEvent() {
      return true;
    },
  };

  return () => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;

    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  };
}

test("capabilities permitem Buffer independente de isócrona", () => {
  const capabilities = buildMapCapabilities({
    viewerAllowed: true,
    editorAllowed: true,
    previewIsochroneAllowed: false,
    previewBufferAllowed: true,
    persistIsochroneAllowed: false,
    persistBufferAllowed: true,
  });

  assert.equal(capabilities.previewIsochrone, false);
  assert.equal(capabilities.persistIsochrone, false);
  assert.equal(capabilities.previewBuffer, true);
  assert.equal(capabilities.persistBuffer, true);
  assert.equal(capabilities.placeAnalysisMarker, true);
});

test("viewer consegue gerar e descartar Buffer sem ganhar persistência", () => {
  const capabilities = buildMapCapabilities({
    viewerAllowed: true,
    editorAllowed: false,
    previewIsochroneAllowed: false,
    previewBufferAllowed: true,
    persistBufferAllowed: true,
  });

  assert.equal(capabilities.previewBuffer, true);
  assert.equal(capabilities.persistBuffer, false);
  assert.equal(capabilities.saveMap, false);
});

test("contrato legado de save aceita isócrona e Buffer e preserva tipo da análise", () => {
  const bufferRequest = mapSaveRequestFromEvent({
    detail: {
      requestId: "map-save:buffer-1",
      source: "buffer-preview",
      dataId: "buffer-data",
    },
  });
  const isochroneRequest = mapSaveRequestFromEvent({
    detail: {
      requestId: "map-save:iso-1",
      source: "isochrone-preview",
      dataId: "iso-data",
    },
  });

  assert.equal(bufferRequest?.source, "buffer-preview");
  assert.equal(isochroneRequest?.source, "isochrone-preview");
  assert.equal(mapSaveSourceAnalysisKind("buffer-preview"), "buffer");
  assert.equal(mapSaveSourceAnalysisKind("isochrone-preview"), "isochrone");
});

test("save event legado falha fechado para source desconhecido", () => {
  assert.equal(
    mapSaveRequestFromEvent({
      detail: {
        requestId: "map-save:evil",
        source: "arbitrary-analysis",
        dataId: "dataset",
      },
    }),
    null,
  );
  assert.equal(
    mapSaveResultFromEvent({
      detail: {
        requestId: "map-save:evil",
        source: "arbitrary-analysis",
        dataId: "dataset",
        status: "success",
      },
    }),
    null,
  );
});

test("MaonoSaveButton mantém compatibilidade com o contrato legado de save", () => {
  assert.match(saveButton, /mapSaveSourceAnalysisKind\(request\.source\)/);
  assert.match(
    saveButton,
    /markLayerPersistent\(\s*request\.dataId,\s*analysisKind/,
  );
  assert.match(
    saveButton,
    /markLayerTransient\(\s*request\.dataId,\s*analysisKind/,
  );
  assert.match(saveButton, /finishPendingMapSave\("success"\)/);
});

test("provider roteia transient para adapter de análise sem alterar camada normal", () => {
  assert.match(provider, /createAnalysisLayerCommands/);
  assert.match(provider, /input\.transient/);
  assert.match(provider, /analysisCommands\.addGeoJsonLayer\(input\)/);
  assert.match(provider, /baseCommands\.addGeoJsonLayer\(input\)/);
});

test("adapter separa gates de preview e persist por tipo", () => {
  assert.match(
    analysisAdapter,
    /if \(kind === "buffer"\) \{\s*return phase === "persist" \? "persistBuffer" : "previewBuffer";\s*\}\s*return phase === "persist" \? "persistIsochrone" : "previewIsochrone";/,
  );
});

test("tooltip de análise é merge-safe e descarte remove somente a entrada do dataset", () => {
  assert.match(
    analysisAdapter,
    /fieldsToShow:\s*\{\s*\.\.\.fieldsToShow,\s*\[dataId\]/,
  );
  assert.match(analysisAdapter, /delete fieldsToShow\[dataId\]/);
  assert.match(analysisAdapter, /configurePresentationBestEffort/);
  assert.match(bufferHook, /tooltipFields/);
  assert.match(bufferHook, /legendField/);
});

test("Manter Buffer promove a camada sem acionar o save global", () => {
  assert.match(
    bufferHook,
    /commands\.markLayerPersistent\(preview\.dataId,\s*"buffer"\)/,
  );
  assert.doesNotMatch(bufferHook, /dispatchMapSaveRequest/);
  assert.doesNotMatch(bufferHook, /MAONO_MAP_SAVE_REQUEST_EVENT/);
  assert.doesNotMatch(bufferHook, /saveRequestId/);
  assert.match(bufferHook, /Salve o projeto para gravar as alterações/);
  assert.match(saveButton, /serializeProjectConfig/);
  assert.match(
    saveButton,
    /\/api\/projects\/\$\{encodeURIComponent\(projectSlug\)\}\/config/,
  );
});

test("Buffer permanece preview válido quando presentation ainda não encontra o dataset", () => {
  const restoreGlobals = installTelemetryGlobals();
  const dataId = "buffer-runtime-regression";
  const state = createAnalysisRootState();
  const dispatched = [];
  const transient = new Set();
  const persistentCalls = [];

  try {
    const commands = createAnalysisLayerCommands({
      dispatch(action) {
        dispatched.push(action);
      },
      getState() {
        return state;
      },
      capabilities: {
        previewBuffer: true,
        persistBuffer: true,
      },
      context: null,
      isTransientDataset(id) {
        return transient.has(id);
      },
      markTransientDataset(id) {
        transient.add(id);
      },
      markPersistentDataset(id) {
        persistentCalls.push(id);
        transient.delete(id);
      },
      now: () => 1,
      random: () => 0.1,
    });

    const result = commands.addGeoJsonLayer(bufferAnalysisInput(dataId));

    assert.equal(result.ok, true);
    assert.equal(result.value?.dataId, dataId);
    assert.equal(transient.has(dataId), true);
    assert.deepEqual(persistentCalls, []);
    assert.equal(dispatched.length, 1);
  } finally {
    restoreGlobals();
  }
});

test("presentation continua aplicada quando dataset já está observável", () => {
  const restoreGlobals = installTelemetryGlobals();
  const dataId = "buffer-runtime-ready";
  let state = createAnalysisRootState();
  const dispatched = [];
  const transient = new Set();

  try {
    const commands = createAnalysisLayerCommands({
      dispatch(action) {
        dispatched.push(action);
        if (dispatched.length === 1) {
          state = createAnalysisRootState({ dataId });
        }
      },
      getState() {
        return state;
      },
      capabilities: {
        previewBuffer: true,
        persistBuffer: true,
      },
      context: null,
      isTransientDataset(id) {
        return transient.has(id);
      },
      markTransientDataset(id) {
        transient.add(id);
      },
      markPersistentDataset(id) {
        transient.delete(id);
      },
      now: () => 1,
      random: () => 0.1,
    });

    const result = commands.addGeoJsonLayer(bufferAnalysisInput(dataId));

    assert.equal(result.ok, true);
    assert.equal(result.value?.dataId, dataId);
    assert.equal(transient.has(dataId), true);
    assert.equal(dispatched.length >= 4, true);
  } finally {
    restoreGlobals();
  }
});

test("falha de presentation nunca promove nem remove o dataset recém-criado", () => {
  const restoreGlobals = installTelemetryGlobals();
  const dataId = "buffer-no-rollback";
  const state = createAnalysisRootState();
  const dispatched = [];
  const transient = new Set();
  let promoted = false;

  try {
    const commands = createAnalysisLayerCommands({
      dispatch(action) {
        dispatched.push(action);
      },
      getState() {
        return state;
      },
      capabilities: { previewBuffer: true },
      context: null,
      isTransientDataset(id) {
        return transient.has(id);
      },
      markTransientDataset(id) {
        transient.add(id);
      },
      markPersistentDataset() {
        promoted = true;
      },
      now: () => 1,
      random: () => 0.1,
    });

    const result = commands.addGeoJsonLayer(bufferAnalysisInput(dataId));

    assert.equal(result.ok, true);
    assert.equal(transient.has(dataId), true);
    assert.equal(promoted, false);
    assert.equal(dispatched.length, 1);
  } finally {
    restoreGlobals();
  }
});
