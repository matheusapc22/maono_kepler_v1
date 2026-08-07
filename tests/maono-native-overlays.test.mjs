import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateNativeLegendPlacement,
  MAONO_LEGEND_HORIZONTAL_RATIO,
  MAONO_LEGEND_VERTICAL_RATIO,
} from "../src/pages/Kepler/components/native-overlays/native-overlay-placement.ts";

const [runtime, css, shellRuntime] = await Promise.all([
  readFile(
    new URL(
      "../src/pages/Kepler/components/native-overlays/NativeMapOverlaysRuntime.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/native-overlays/maono-native-overlays.css",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/maono-map-shell/MaonoMapRuntime.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("legenda nasce na posição Maõno da referência visual", () => {
  assert.equal(MAONO_LEGEND_HORIZONTAL_RATIO, 0.6);
  assert.equal(MAONO_LEGEND_VERTICAL_RATIO, 0.12);

  const placement = calculateNativeLegendPlacement(
    {
      left: 574,
      top: 16,
      width: 1343,
      height: 915,
    },
    {
      width: 300,
      height: 170,
    },
  );

  assert.ok(Math.abs(placement.left - 1379.8) < 0.1);
  assert.ok(Math.abs(placement.top - 125.8) < 0.1);
});

test("posição é limitada ao canvas em viewports estreitos", () => {
  const placement = calculateNativeLegendPlacement(
    { left: 80, top: 40, width: 320, height: 420 },
    { width: 280, height: 180 },
  );

  assert.equal(placement.left, 104);
  assert.ok(placement.top >= 56);
  assert.ok(placement.top <= 264);
});

test("runtime posiciona somente ao abrir e preserva arraste posterior", () => {
  assert.match(runtime, /positionedForCurrentOpenRef/);
  assert.match(runtime, /legendVisible/);
  assert.match(runtime, /MutationObserver/);
  assert.match(runtime, /translate3d\(0px, 0px, 0px\)/);
  assert.match(runtime, /data.*maonoNativeLegend/i);
  assert.match(runtime, /\.react-draggable/);
  assert.match(runtime, /mapboxgl-canvas/);
  assert.match(shellRuntime, /<NativeMapOverlaysRuntime legendVisible=\{engineState\.legendVisible\} \/>/);
});

test("skin Maõno fica isolada e cobre legenda e popup nativos", () => {
  assert.match(css, /data-maono-native-overlays="active"/);
  assert.match(css, /data-maono-native-legend="true"/);
  assert.match(css, /\.map-popover/);
  assert.match(css, /\.layer-hover-info/);
  assert.match(css, /#c5a059/i);
  assert.match(css, /backdrop-filter/);
  assert.match(css, /@media \(max-width: 820px\)/);
});
