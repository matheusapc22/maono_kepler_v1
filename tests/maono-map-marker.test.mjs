import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  markerOriginToScreen,
  normalizeLongitude,
  screenToMarkerOrigin,
} from "../src/pages/Kepler/components/map-overlay/marker-projection.ts";

const [overlay, markerHook] = await Promise.all([
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

test("overlay visual não conhece mais WebMercatorViewport nem pointer state interno", () => {
  assert.doesNotMatch(overlay, /WebMercatorViewport/);
  assert.doesNotMatch(overlay, /draggingPointerRef/);
  assert.doesNotMatch(overlay, /markerMovedRef/);
  assert.match(overlay, /useMapMarker/);
  assert.match(markerHook, /ResizeObserver/);
  assert.match(markerHook, /MutationObserver/);
  assert.match(markerHook, /Escape/);
  assert.match(markerHook, /ArrowLeft/);
  assert.match(markerHook, /setPointerCapture/);
});
