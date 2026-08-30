import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../src/pages/Kepler/", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

const [index, legendRow, legendPanel, legendPosition] = await Promise.all([
  source("index.tsx"),
  source("factories/maono-legend-row.tsx"),
  source("factories/maono-map-legend-panel.tsx"),
  source("factories/maono-map-legend-position.ts"),
]);

test("legenda Maõno localiza o separador de intervalos sem alterar palavras", () => {
  assert.match(legendRow, /label\.replace\(\/\\s\+to\\s\+\/gi, " a "\)/);
  assert.match(legendRow, /typeof label !== "string"/);
  assert.match(legendRow, /LegendRowFactory\.deps/);
  assert.match(index, /replaceLegendRow/);
  assert.match(index, /replaceLegendRow\(\)/);
});

test("legenda Maõno preserva o fluxo nativo de abertura, drag e resize", () => {
  assert.doesNotMatch(legendPanel, /\bwithState\b/);
  assert.doesNotMatch(legendPanel, /\buiStateLens\b/);
  assert.doesNotMatch(legendPanel, /useLayoutEffect/);
  assert.doesNotMatch(legendPanel, /updateMapControlSettings\("mapLegend"/);
  assert.match(legendPanel, /const mapLegend = props\.mapControls\?\.mapLegend/);
  assert.match(
    legendPanel,
    /<NativeMapLegendPanel \{\.\.\.props\} mapControls=\{mapControls\} \/>/,
  );
});

test("posição inicial da legenda é projetada sem disparar Redux ao abrir", () => {
  assert.match(legendPanel, /mapControlsWithInitialLegendPosition/);
  assert.match(legendPanel, /hasStoredLegendPosition\(storedPosition\)/);
  assert.match(
    legendPanel,
    /calculateMaonoLegendInitialPosition\(\{ width, height \}\)/,
  );
  assert.match(legendPosition, /MAONO_LEGEND_HORIZONTAL_RATIO = 0\.63/);
  assert.match(
    legendPosition,
    /desiredX = width \* MAONO_LEGEND_HORIZONTAL_RATIO/,
  );
  assert.match(legendPosition, /MAONO_LEGEND_EDGE_MARGIN = 16/);
});
