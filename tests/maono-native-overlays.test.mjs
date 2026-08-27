import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateMaonoLegendInitialPosition,
  MAONO_LEGEND_HORIZONTAL_RATIO,
  MAONO_LEGEND_VERTICAL_RATIO,
} from "../src/pages/Kepler/factories/maono-map-legend-position.ts";

const [legendFactory, popoverFactory, shellRuntime, keplerIndex] = await Promise.all([
  readFile(
    new URL(
      "../src/pages/Kepler/factories/maono-map-legend-panel.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/factories/maono-map-popover.tsx",
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
  readFile(
    new URL("../src/pages/Kepler/index.tsx", import.meta.url),
    "utf8",
  ),
]);

const legacyOverlayFiles = [
  "../src/pages/Kepler/components/native-overlays/NativeMapOverlaysRuntime.tsx",
  "../src/pages/Kepler/components/native-overlays/maono-native-overlays.css",
  "../src/pages/Kepler/components/native-overlays/native-overlay-placement.ts",
];

test("legenda nasce em 60% / 12% usando somente o viewport React", () => {
  assert.equal(MAONO_LEGEND_HORIZONTAL_RATIO, 0.6);
  assert.equal(MAONO_LEGEND_VERTICAL_RATIO, 0.12);

  const position = calculateMaonoLegendInitialPosition({
    width: 1343,
    height: 915,
  });

  assert.ok(position);
  assert.ok(Math.abs(position.x - 805.8) < 0.1);
  assert.ok(Math.abs(position.y - 109.8) < 0.1);
  assert.equal(position.anchorX, "left");
  assert.equal(position.anchorY, "top");
});

test("posição inicial é limitada ao canvas sem medir pixels no DOM", () => {
  const position = calculateMaonoLegendInitialPosition({
    width: 320,
    height: 420,
  });

  assert.ok(position);
  assert.equal(position.x, 16);
  assert.ok(position.y >= 16);
  assert.ok(position.y <= 272);
});

test("legenda Maono substitui o factory oficial e preserva estado nativo", () => {
  assert.match(legendFactory, /MapLegendPanelFactory/);
  assert.match(legendFactory, /MapLegendPanelFactory\.deps/);
  assert.match(legendFactory, /MapLegendPanelFactory\(/);
  assert.match(legendFactory, /MapLegend/);
  assert.match(legendFactory, /setMapControlSettings/);
  assert.match(legendFactory, /uiState\?\.mapControls\?\.mapLegend\?\.active/);
  assert.match(legendFactory, /header="maono\.legend\.title"/);
  assert.match(legendFactory, /data-maono-kepler-factory="map-legend-panel"/);
  assert.match(legendFactory, /replaceMapLegendPanel/);
});

test("popup Maono mantém o MapPopover oficial e seus props reais", () => {
  assert.match(popoverFactory, /MapPopoverFactory/);
  assert.match(popoverFactory, /MapPopoverFactory\.deps/);
  assert.match(popoverFactory, /MapPopoverFactory\(MapPopoverContent\)/);
  assert.match(popoverFactory, /<NativeMapPopover \{\.\.\.props\} \/>/);
  assert.match(popoverFactory, /ThemeProvider/);
  assert.match(popoverFactory, /\.map-popover/);
  assert.match(popoverFactory, /replaceMapPopover/);
});

test("injeção oficial registra legenda e popup no Kepler", () => {
  assert.match(keplerIndex, /replaceMapLegendPanel/);
  assert.match(keplerIndex, /replaceMapPopover/);
  assert.match(keplerIndex, /replaceMapLegendPanel\(\)/);
  assert.match(keplerIndex, /replaceMapPopover\(\)/);
});

test("novo fluxo não depende de MutationObserver, matching de texto ou seletores frágeis", () => {
  const implementation = `${legendFactory}\n${popoverFactory}`;

  assert.doesNotMatch(implementation, /MutationObserver/);
  assert.doesNotMatch(implementation, /querySelector/);
  assert.doesNotMatch(implementation, /textContent/);
  assert.doesNotMatch(implementation, /\[class\*=/);
  assert.doesNotMatch(implementation, /!important/);
  assert.doesNotMatch(shellRuntime, /NativeMapOverlaysRuntime/);
});

test("runtime e CSS legados de overlays foram removidos", async () => {
  for (const relativePath of legacyOverlayFiles) {
    await assert.rejects(
      access(new URL(relativePath, import.meta.url)),
      /ENOENT/,
    );
  }
});
