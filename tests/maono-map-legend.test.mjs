import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../src/pages/Kepler/", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

const [index, legendRow, legendPanel, legendPosition, localization] = await Promise.all([
  source("index.tsx"),
  source("factories/maono-legend-row.tsx"),
  source("factories/maono-map-legend-panel.tsx"),
  source("factories/maono-map-legend-position.ts"),
  source("constants/localization.ts"),
]);

test("catálogo Maõno completa o vocabulário pt-BR ausente no Kepler 3.2.0", () => {
  assert.match(localization, /pt:\s*\{/);
  assert.match(
    localization,
    /"mapLegend\.layers\.default\.singleColor\.color": "Cor de preenchimento"/,
  );
  assert.match(
    localization,
    /"mapLegend\.layers\.default\.singleColor\.strokeColor": "Contorno"/,
  );
  assert.match(localization, /"property\.weight": "Espessura do traço"/);
  assert.match(localization, /"property\.strokeColor": "Cor do contorno"/);
});

test("legenda Maõno localiza fallback textual sem alterar nomes de campos", () => {
  assert.match(legendRow, /"fill color": "Cor de preenchimento"/);
  assert.match(legendRow, /outline: "Contorno"/);
  assert.match(legendRow, /"stroke color": "Cor do contorno"/);
  assert.match(legendRow, /"point count": "Contagem de pontos"/);
  assert.match(legendRow, /Menor que/);
  assert.match(legendRow, /ou mais/);
  assert.match(legendRow, /return `\$\{start\} a \$\{end\}`/);
  assert.match(legendRow, /MAONO_LEGEND_TERMS_PT_BR\[label\.trim\(\)\.toLowerCase\(\)\]/);
  assert.match(index, /replaceLegendRow/);
  assert.match(index, /replaceLegendRow\(\)/);
});

test("legenda Maõno converte a notação SI do Kepler antes de formatar", () => {
  assert.match(legendRow, /k: 1_000/);
  assert.match(legendRow, /M: 1_000_000/);
  assert.match(legendRow, /new Intl\.NumberFormat\("pt-BR"/);
  assert.match(legendRow, /absolute < 10_000/);
  assert.match(legendRow, /absolute < 1_000_000/);
  assert.match(legendRow, /formatScaledNumber\(value, 1_000, "mil"\)/);
  assert.match(legendRow, /formatScaledNumber\(value, 1_000_000, "M"\)/);
  assert.match(legendRow, /integerPart\.replace\(\/,\/g, ""\)/);
});

test("conector literal 'by' do Kepler é apresentado como 'por'", () => {
  assert.match(
    legendPanel,
    /\.legend--layer_size-schema p > \.legend--layer_by \+ \.legend--layer_by/,
  );
  assert.match(legendPanel, /content: " por "/);
});

test("legenda Maõno preserva o fluxo nativo de abertura, drag e resize", () => {
  assert.doesNotMatch(
    legendPanel,
    /import\s+\{[^}]*withState[^}]*\}\s+from\s+"@kepler\.gl\/components"/,
  );
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
    /desiredLeft = width \* MAONO_LEGEND_HORIZONTAL_RATIO/,
  );
  assert.match(legendPosition, /anchorX: "right"/);
  assert.match(legendPosition, /width - left - panelWidth/);
  assert.match(legendPosition, /MAONO_LEGEND_EDGE_MARGIN = 16/);
});
