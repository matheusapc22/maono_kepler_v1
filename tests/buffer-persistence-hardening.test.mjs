import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMapCapabilities,
} from "../functions/_lib/map-panel-service.js";
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

test("contrato de save aceita isócrona e Buffer e preserva tipo da análise", () => {
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

test("save event falha fechado para source desconhecido", () => {
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

test("MaonoSaveButton promove e faz rollback usando o analysisKind do source", () => {
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
  assert.match(analysisAdapter, /kind === "buffer"/);
  assert.match(analysisAdapter, /"persistBuffer"/);
  assert.match(analysisAdapter, /"previewBuffer"/);
  assert.match(analysisAdapter, /"persistIsochrone"/);
  assert.match(analysisAdapter, /"previewIsochrone"/);
  assert.doesNotMatch(
    analysisAdapter,
    /kind === "buffer"[^]*return phase === "persist" \? "persistIsochrone"/,
  );
});

test("tooltip de análise é merge-safe e descarte remove somente a entrada do dataset", () => {
  assert.match(
    analysisAdapter,
    /fieldsToShow:\s*\{\s*\.\.\.fieldsToShow,\s*\[dataId\]/,
  );
  assert.match(analysisAdapter, /delete fieldsToShow\[dataId\]/);
  assert.match(bufferHook, /tooltipFields/);
  assert.match(bufferHook, /legendField/);
});

test("persistência de Buffer não cria endpoint de save paralelo", () => {
  assert.match(bufferHook, /dispatchMapSaveRequest/);
  assert.doesNotMatch(bufferHook, /buffers\/save|buffer\/save/);
  assert.match(saveButton, /serializeProjectConfig/);
  assert.match(saveButton, /\/api\/projects\/\$\{encodeURIComponent\(projectSlug\)\}\/config/);
});
