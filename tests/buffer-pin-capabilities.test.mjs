import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [navigation, panelService, types] = await Promise.all([
  readFile(
    new URL("../functions/_lib/project-map-navigation-service.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../functions/_lib/map-panel-service.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/map-panel/types.ts", import.meta.url),
    "utf8",
  ),
]);

test("contexto publica Buffer a partir da flag centralizada de geoprocessamento", () => {
  assert.match(panelService, /GEOPROCESSING_BUFFER_V1/);
  assert.match(panelService, /maonoBuffer/);
  assert.match(panelService, /previewBufferAllowed/);
  assert.match(panelService, /persistBufferAllowed/);
  assert.match(navigation, /features\.maonoBuffer/);
  assert.match(navigation, /previewBufferAllowed/);
  assert.match(navigation, /persistBufferAllowed/);
});

test("Pin fica disponível quando isócrona ou Buffer estiver disponível", () => {
  assert.match(
    panelService,
    /capabilities\.previewIsochrone \|\| capabilities\.previewBuffer/,
  );
  assert.match(panelService, /capabilities\.placeAnalysisMarker/);
});

test("contrato frontend normaliza capabilities de Buffer fail-closed", () => {
  assert.match(types, /placeAnalysisMarker: boolean/);
  assert.match(types, /previewBuffer: boolean/);
  assert.match(types, /persistBuffer: boolean/);
  assert.match(types, /maonoBuffer: boolean/);
  assert.match(types, /placeAnalysisMarker: false/);
  assert.match(types, /previewBuffer: false/);
  assert.match(types, /persistBuffer: false/);
  assert.match(types, /maonoBuffer: false/);
});
