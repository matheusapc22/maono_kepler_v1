import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [hook, overlay, api] = await Promise.all([
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/useBufferPreview.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/MapOverlayControls.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/map-panel/buffer-api.ts", import.meta.url),
    "utf8",
  ),
]);

test("cliente usa somente endpoint Maõno e não calcula geometria no navegador", () => {
  assert.match(api, /\/api\/maps\/buffers/);
  assert.doesNotMatch(api, /turf|ST_Buffer|geoapify/i);
});

test("preview usa Engine Adapter como camada GeoJSON transitória", () => {
  assert.match(hook, /requestBuffer/);
  assert.match(hook, /commands\.addGeoJsonLayer/);
  assert.match(hook, /transient:\s*true/);
  assert.match(hook, /commands\.removeTransientLayer/);
  assert.match(hook, /centerMap:\s*true/);
});

test("descartar buffer preserva o Pin para nova análise", () => {
  const discardBlock = hook.match(/const discard = useCallback\([\s\S]*?return true;\n  },/s)?.[0] || "";
  assert.match(discardBlock, /setPreview\(null\)/);
  assert.doesNotMatch(discardBlock, /onMarkerReset|resetMarkerRef/);
});

test("overlay integra menu, dialog e preview do Buffer", () => {
  assert.match(overlay, /useBufferPreview/);
  assert.match(overlay, /BufferDialog/);
  assert.match(overlay, /Criar buffers/);
  assert.match(overlay, /buffer\.preview/);
  assert.match(overlay, /buffer\.discard/);
});

test("Pin é controlado por capability genérica de análise", () => {
  assert.match(overlay, /placeAnalysisMarker/);
  assert.match(overlay, /analysisMarkerCapabilityEnabled/);
  assert.doesNotMatch(overlay, /disabled=\{!isochroneCapabilityEnabled\}/);
  assert.match(overlay, /Origem da análise/);
});
