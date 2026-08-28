import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [hook, overlay, api, analysisAdapter] = await Promise.all([
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
  readFile(
    new URL(
      "../src/pages/Kepler/engine-adapter/analysis-layer-commands.ts",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("cliente usa somente endpoint Maõno e não calcula geometria no navegador", () => {
  assert.match(api, /\/api\/maps\/buffers/);
  assert.doesNotMatch(api, /turf|ST_Buffer|geoapify/i);
});

test("preview usa Engine Adapter como camada GeoJSON transitória tipada", () => {
  assert.match(hook, /requestBuffer/);
  assert.match(hook, /commands\.addGeoJsonLayer/);
  assert.match(hook, /transient:\s*true/);
  assert.match(hook, /analysisKind:\s*"buffer"/);
  assert.match(hook, /removeTransientLayer\(current\.dataId,\s*"buffer"\)/);
  assert.match(hook, /centerMap:\s*true/);
});

test("descartar buffer remove somente a prévia e preserva o Pin", () => {
  const discardBlock = hook.match(/const discard = useCallback\([\s\S]*?return true;\n  },/s)?.[0] || "";
  assert.match(discardBlock, /removeTransientLayer\(preview\.dataId,\s*"buffer"\)/);
  assert.match(discardBlock, /setPreview\(null\)/);
  assert.doesNotMatch(discardBlock, /onMarkerReset|resetMarkerRef/);
  assert.doesNotMatch(discardBlock, /saveRequestId/);
});

test("Manter promove Buffer localmente sem disparar salvamento do projeto", () => {
  const keepBlock = hook.match(/const keep = useCallback\([\s\S]*?return true;\n  },/s)?.[0] || "";
  assert.match(keepBlock, /markLayerPersistent\(preview\.dataId,\s*"buffer"\)/);
  assert.match(keepBlock, /capabilities\?\.persistBuffer/);
  assert.match(keepBlock, /map_buffer_kept/);
  assert.match(keepBlock, /Salve o projeto para gravar as alterações/);
  assert.match(keepBlock, /setPreview\(null\)/);
  assert.match(keepBlock, /resetMarkerRef\.current\(\)/);
  assert.doesNotMatch(hook, /dispatchMapSaveRequest/);
  assert.doesNotMatch(hook, /MAONO_MAP_SAVE_RESULT_EVENT/);
  assert.doesNotMatch(hook, /saveRequestId/);
  assert.doesNotMatch(hook, /canPersist/);
});

test("overlay integra Manter e Descartar sem linguagem de salvamento individual", () => {
  assert.match(overlay, /useBufferPreview/);
  assert.match(overlay, /BufferDialog/);
  assert.match(overlay, /Criar buffers/);
  assert.match(overlay, /buffer\.preview/);
  assert.match(overlay, /buffer\.keep/);
  assert.match(overlay, /buffer\.discard/);
  assert.match(overlay, /capabilities\?\.persistBuffer/);
  assert.match(overlay, />\s*Manter\s*</);
  assert.doesNotMatch(overlay, /buffer\.persist/);
  assert.doesNotMatch(overlay, /Salvar no projeto/);
  assert.doesNotMatch(overlay, /Salvando…/);
});

test("Buffer usa tooltip e legenda nativos do Kepler em vez de overlays paralelos", () => {
  assert.match(hook, /tooltipFields:\s*\["analysis_label",\s*"radius_label"\]/);
  assert.match(hook, /legendField:\s*"radius_label"/);
  assert.match(analysisAdapter, /interactionConfigChange/);
  assert.match(analysisAdapter, /fieldsToShow/);
  assert.match(analysisAdapter, /layerVisualChannelConfigChange/);
  assert.match(analysisAdapter, /colorScale:\s*"ordinal"/);
  assert.doesNotMatch(hook, /MapPopoverFactory|MapLegendPanelFactory/);
});

test("Pin é controlado por capability genérica de análise", () => {
  assert.match(overlay, /placeAnalysisMarker/);
  assert.match(overlay, /analysisMarkerCapabilityEnabled/);
  assert.doesNotMatch(overlay, /disabled=\{!isochroneCapabilityEnabled\}/);
  assert.match(overlay, /Origem da análise/);
});
