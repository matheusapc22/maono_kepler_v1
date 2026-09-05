import assert from "node:assert/strict";
import test from "node:test";

import {
  diffViewerLayerStyle,
  hasViewerLayerStyleChanges,
  snapshotViewerLayerStyle,
} from "../src/pages/Kepler/change-requests/viewer-layer-style.ts";

function style(overrides = {}) {
  return {
    fillEnabled: true,
    opacity: 0.8,
    color: [232, 197, 95],
    colorField: null,
    colorScale: null,
    colorPalette: [],
    colorPaletteId: null,
    strokeEnabled: true,
    strokeColor: [197, 160, 89],
    strokeColorField: null,
    strokeColorScale: null,
    strokeColorPalette: [],
    strokeColorPaletteId: null,
    strokeOpacity: 1,
    strokeWidth: 1,
    pointRadius: null,
    radiusField: null,
    radiusScale: null,
    radiusRange: null,
    clusterRadius: null,
    heatmapRadius: null,
    compatibility: {
      supported: true,
      fixedColor: true,
      colorField: false,
      colorScale: false,
      palette: true,
      opacity: true,
      fill: true,
      stroke: true,
      strokeField: false,
      radius: false,
      radiusField: false,
      radiusRange: false,
      clusterRadius: false,
      heatmapRadius: false,
    },
    ...overrides,
  };
}

test("Buffer amarelo → vermelho produz somente fixedColor no diff", () => {
  const base = snapshotViewerLayerStyle(style());
  const current = style({ color: [220, 20, 20] });
  const changes = diffViewerLayerStyle(base, current);
  assert.deepEqual(changes, { fixedColor: [220, 20, 20] });
  assert.equal(hasViewerLayerStyleChanges(changes), true);
});

test("voltar ao estilo base elimina o diff", () => {
  const current = style();
  const base = snapshotViewerLayerStyle(current);
  assert.deepEqual(diffViewerLayerStyle(base, current), {});
  assert.equal(hasViewerLayerStyleChanges(diffViewerLayerStyle(base, current)), false);
});

test("opacidade, fill e stroke são capturados sem serializar estado Redux", () => {
  const base = snapshotViewerLayerStyle(style());
  const changes = diffViewerLayerStyle(
    base,
    style({
      opacity: 0.45,
      fillEnabled: false,
      strokeEnabled: false,
      strokeWidth: 4,
    }),
  );
  assert.deepEqual(changes, {
    opacity: 0.45,
    fillEnabled: false,
    strokeEnabled: false,
    strokeWidth: 4,
  });
});
