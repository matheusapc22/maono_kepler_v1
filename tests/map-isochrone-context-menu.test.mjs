import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [previewHook, contextMenu, overlay, markerHook, controller] = await Promise.all([
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/useIsochronePreview.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/MarkerContextMenu.tsx",
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
    new URL(
      "../src/pages/Kepler/components/map-overlay/useMapMarker.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/analysis-tools/useMapToolController.ts",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("S05.01 isócrona recebe pendingPoint do novo controller", () => {
  assert.match(previewHook, /pendingPoint:\s*MapToolPoint \| null/);
  assert.match(previewHook, /origin:\s*pendingPoint/);
  assert.doesNotMatch(previewHook, /MarkerOrigin/);
  assert.match(overlay, /const analysisPendingPoint = toolController\.pendingPoint/);
  assert.match(overlay, /useIsochronePreview\(\{[\s\S]*pendingPoint:\s*analysisPendingPoint/);
  assert.match(controller, /configurationTarget:\s*mapToolConfigurationTarget\(state\)/);
  assert.match(controller, /pendingPoint:/);
});

test("S05.02 preserva request, abort, preview, telemetry, persistência e descarte", () => {
  assert.match(previewHook, /requestIsochrone/);
  assert.match(previewHook, /new AbortController\(\)/);
  assert.match(previewHook, /requestRef\.current\?\.abort\(\)/);
  assert.match(previewHook, /setPreview\(\{/);
  assert.match(previewHook, /map_isochrone_requested/);
  assert.match(previewHook, /map_isochrone_previewed/);
  assert.match(previewHook, /map_isochrone_failed/);
  assert.match(previewHook, /markLayerPersistent\(preview\.dataId,\s*"isochrone"\)/);
  assert.match(previewHook, /removeTransientLayer\(preview\.dataId,\s*"isochrone"\)/);
  assert.match(previewHook, /map_isochrone_kept/);
  assert.match(previewHook, /map_isochrone_discarded/);
});

test("S05.03 MarkerContextMenu é um componente acessível e isolado", () => {
  assert.match(contextMenu, /export default function MarkerContextMenu/);
  assert.match(contextMenu, /role="menu"/);
  assert.match(contextMenu, /role="menuitem"/);
  assert.match(contextMenu, /Remover marcador/);
  assert.match(contextMenu, /event\.key !== "Escape"/);
  assert.match(contextMenu, /onClose\(\)/);
  assert.match(overlay, /<MarkerContextMenu/);
  assert.match(overlay, /open=\{marker\.menuOpen\}/);
  assert.match(overlay, /onRemove=\{marker\.reset\}/);
});

test("S05.04 menu de marcador existente não cria Buffer nem Isócrona", () => {
  assert.doesNotMatch(contextMenu, /Buffer|buffer|Isócrona|isochrone/);
  assert.doesNotMatch(contextMenu, /AnalysisToolMenu|useMapToolController/);
  assert.doesNotMatch(contextMenu, /useBufferPreview|useIsochronePreview/);
  assert.doesNotMatch(contextMenu, /requestBuffer|requestIsochrone/);
  assert.match(overlay, /<AnalysisToolMenu/);
  assert.match(overlay, /<MarkerContextMenu/);
});

test("S05.05 drag existente permanece no marker hook", () => {
  assert.match(markerHook, /const beginDrag = useCallback/);
  assert.match(markerHook, /setPointerCapture\(event\.pointerId\)/);
  assert.match(markerHook, /const moveDrag = useCallback/);
  assert.match(markerHook, /screenToMarkerOrigin/);
  assert.match(markerHook, /const endDrag = useCallback/);
  assert.match(markerHook, /releasePointerCapture/);
  assert.match(overlay, /onPointerDown=\{marker\.beginDrag\}/);
  assert.match(overlay, /onPointerMove=\{marker\.moveDrag\}/);
  assert.match(overlay, /onPointerUp=\{marker\.endDrag\}/);
});

test("S05.05 keyboard nudge e remoção por teclado permanecem no marker hook", () => {
  assert.match(markerHook, /const nudge = useCallback/);
  assert.match(markerHook, /nudgeMarkerOrigin/);
  assert.match(markerHook, /const step = event\.shiftKey \? 30 : 10/);
  assert.match(markerHook, /ArrowLeft/);
  assert.match(markerHook, /ArrowRight/);
  assert.match(markerHook, /ArrowUp/);
  assert.match(markerHook, /ArrowDown/);
  assert.match(markerHook, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
  assert.match(overlay, /onKeyDown=\{marker\.handleMarkerKeyDown\}/);
});

test("Gate S05: marcador existente e ferramenta de criação têm responsabilidades distintas", () => {
  const markerContextResponsibilities = [
    /Remover marcador/,
    /onClose/,
    /onRemove/,
  ];
  markerContextResponsibilities.forEach((pattern) => assert.match(contextMenu, pattern));

  const creationResponsibilities = [
    /selectTool/,
    /startSelectedPlacement/,
    /pointPlaced/,
    /submitConfiguration/,
    /analysisCreated/,
  ];
  creationResponsibilities.forEach((pattern) => assert.match(controller, pattern));

  assert.doesNotMatch(contextMenu, /selectTool|startSelectedPlacement|pointPlaced|submitConfiguration|analysisCreated/);
  assert.doesNotMatch(contextMenu, /previewBuffer|previewIsochrone|persistBuffer|persistIsochrone/);
});
