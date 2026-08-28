import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  markerOriginToScreen,
  normalizeLongitude,
  screenToMarkerOrigin,
} from "../src/pages/Kepler/components/map-overlay/marker-projection.ts";

const [overlay, markerHook, controller] = await Promise.all([
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

const viewport = {
  longitude: -46.63,
  latitude: -23.55,
  zoom: 8,
  bearing: 0,
  pitch: 0,
  width: 1000,
  height: 700,
};
const canvas = {
  left: 100,
  top: 50,
  width: 1000,
  height: 700,
};

test("normalização de longitude usa o intervalo -180/180", () => {
  assert.equal(normalizeLongitude(181), -179);
  assert.equal(normalizeLongitude(-181), 179);
  assert.equal(normalizeLongitude(540), 180);
});

test("projeção do marcador faz round-trip entre mapa e tela", () => {
  const origin = { latitude: -23.55, longitude: -46.63 };
  const screen = markerOriginToScreen(origin, canvas, viewport);
  assert.ok(screen);

  const restored = screenToMarkerOrigin(
    screen.left,
    screen.top,
    canvas,
    viewport,
  );
  assert.ok(restored);
  assert.ok(Math.abs(restored.latitude - origin.latitude) < 1e-6);
  assert.ok(Math.abs(restored.longitude - origin.longitude) < 1e-6);
});

test("marcador não observa mais todas as mutações do document.body", () => {
  assert.doesNotMatch(markerHook, /new MutationObserver/);
  assert.doesNotMatch(markerHook, /observe\(document\.body/);
  assert.match(markerHook, /ResizeObserver/);
  assert.match(markerHook, /maono:map-runtime/);
  assert.match(markerHook, /sameCanvasRect/);
});

test("descoberta da superfície aceita MapLibre, Mapbox e fallback do shell Maõno", () => {
  assert.match(markerHook, /\.maplibregl-canvas/);
  assert.match(markerHook, /\.mapboxgl-canvas/);
  assert.match(markerHook, /\.maono-kepler-viewport canvas/);
  assert.match(markerHook, /\.maono-kepler-viewport/);
  assert.match(markerHook, /getBoundingClientRect/);
});

test("modo de colocação parametriza cursor por ferramenta", () => {
  assert.match(markerHook, /PLACEMENT_CURSORS/);
  assert.match(markerHook, /marker:/);
  assert.match(markerHook, /buffer:/);
  assert.match(markerHook, /isochrone:/);
  assert.match(markerHook, /fill='%23C5A059'/);
  assert.match(markerHook, /\.maono-marker-placement/);
  assert.match(markerHook, /const placementSurface = mapSurface\(\)/);
  assert.match(markerHook, /PLACEMENT_CURSORS\[placementKind \?\? "marker"\]/);
  assert.match(markerHook, /kind: MarkerPlacementKind = "marker"/);
  assert.match(overlay, /marker\.placing && marker\.canvasRect/);
  assert.match(overlay, /marker\.placeAt\(event\.clientX, event\.clientY\)/);
});

test("placement preserva interação nativa de zoom/pan e só aceita clique sem arrasto", () => {
  assert.match(markerHook, /visualOverlay\.style\.pointerEvents = "none"/);
  assert.match(markerHook, /window\.addEventListener\("pointerdown"/);
  assert.match(markerHook, /window\.addEventListener\("pointermove"/);
  assert.match(markerHook, /window\.addEventListener\("pointerup"/);
  assert.match(markerHook, /Math\.hypot/);
  assert.match(markerHook, /> 6/);
  assert.match(markerHook, /current\.moved/);
  assert.match(markerHook, /MAONO_MAP_PLACEMENT_POINT_EVENT/);
  assert.match(controller, /MAONO_MAP_PLACEMENT_POINT_EVENT/);
  assert.match(controller, /pointPlaced\(point\)/);
});

test("placeAt não abre menu e Escape do placement pertence ao controller", () => {
  const placeAtBlock =
    markerHook.match(/const placeAt = useCallback\([\s\S]*?\n  \);/)?.[0] || "";
  assert.match(placeAtBlock, /setMenuOpen\(false\)/);
  assert.doesNotMatch(placeAtBlock, /setMenuOpen\(true\)/);
  assert.doesNotMatch(markerHook, /event\.key === "Escape"/);
  assert.match(controller, /handlePlacementEscape/);
  assert.match(controller, /event\.key !== "Escape"/);
});

test("overlay visual mantém projeção e pointer state fora do componente", () => {
  assert.doesNotMatch(overlay, /WebMercatorViewport/);
  assert.doesNotMatch(overlay, /draggingPointerRef/);
  assert.doesNotMatch(overlay, /markerMovedRef/);
  assert.match(overlay, /useMapMarker/);
  assert.match(markerHook, /ArrowLeft/);
  assert.match(markerHook, /setPointerCapture/);
});
