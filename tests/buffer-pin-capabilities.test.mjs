import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [navigation, types] = await Promise.all([
  readFile(
    new URL("../functions/_lib/project-map-navigation-service.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/map-panel/types.ts", import.meta.url),
    "utf8",
  ),
]);

test("contexto publica Buffer a partir da flag de geoprocessamento", () => {
  assert.match(navigation, /GEOPROCESSING_BUFFER_V1/);
  assert.match(navigation, /maonoBuffer/);
  assert.match(navigation, /previewBuffer/);
});

test("Pin fica disponível quando isócrona ou Buffer estiver disponível", () => {
  assert.match(
    navigation,
    /capabilities\.previewIsochrone \|\| capabilities\.previewBuffer/,
  );
  assert.match(navigation, /capabilities\.placeAnalysisMarker/);
});

test("contrato frontend normaliza novas capabilities fail-closed", () => {
  assert.match(types, /placeAnalysisMarker\?: boolean/);
  assert.match(types, /previewBuffer\?: boolean/);
  assert.match(types, /maonoBuffer\?: boolean/);
  assert.match(types, /placeAnalysisMarker: false/);
  assert.match(types, /previewBuffer: false/);
  assert.match(types, /maonoBuffer: false/);
});
