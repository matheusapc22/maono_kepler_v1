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

test("descartar buffer preserva o Pin e é bloqueado durante salvamento", () => {
  const discardBlock = hook.match(/const discard = useCallback\([\s\S]*?return true;\n  },/s)?.[0] || "";
  assert.match(discardBlock, /preview\.saveRequestId/);
  assert.match(discardBlock, /removeTransientLayer\(preview\.dataId,\s*"buffer"\)/);
  assert.match(discardBlock, /setPreview\(null\)/);
  assert.doesNotMatch(discardBlock, /onMarkerReset|resetMarkerRef/);
});

test("persistência do Buffer reutiliza dispatchMapSaveRequest e resultado global", () => {
  assert.match(hook, /dispatchMapSaveRequest/);
  assert.match(hook, /source:\s*"buffer-preview"/);
  assert.match(hook, /MAONO_MAP_SAVE_RESULT_EVENT/);
  assert.match(hook, /result\.source !== "buffer-preview"/);
  assert.match(hook, /capabilities\?\.persistBuffer/);
  assert.match(hook, /saveRequestId/);
  assert.match(hook, /map_buffer_persist_requested/);
  assert.match(hook, /map_buffer_persisted/);
  assert.match(hook, /map_buffer_persist_failed/);
});

test("erro ou cancelamento de save preserva a prévia para retry", () => {
  assert.match(
    hook,
    /setPreview\(\(value\) =>[\s\S]*saveRequestId:\s*null/,
  );
  assert.match(hook, /A prévia foi preservada/);
});

test("overlay integra salvar, descartar e estado de salvamento do Buffer", () => {
  assert.match(overlay, /useBufferPreview/);
  assert.match(overlay, /BufferDialog/);
  assert.match(overlay, /Criar buffers/);
  assert.match(overlay, /buffer\.preview/);
  assert.match(overlay, /buffer\.persist/);
  assert.match(overlay, /buffer\.discard/);
  assert.match(overlay, /capabilities\?\.persistBuffer/);
  assert.match(overlay, /Salvar no projeto/);
  assert.match(overlay, /Salvando…/);
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
