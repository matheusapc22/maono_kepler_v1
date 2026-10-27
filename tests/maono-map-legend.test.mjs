import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import ts from "typescript";

const ROOT = new URL("../src/pages/Kepler/", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

const [index, legendRow, legendFormat, legendPanel, legendPosition, localization] = await Promise.all([
  source("index.tsx"),
  source("factories/maono-legend-row.tsx"),
  source("factories/maono-legend-format.ts"),
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
  assert.match(legendFormat, /"fill color": "Cor de preenchimento"/);
  assert.match(legendFormat, /outline: "Contorno"/);
  assert.match(legendFormat, /"stroke color": "Cor do contorno"/);
  assert.match(legendFormat, /"point count": "Contagem de pontos"/);
  assert.match(legendFormat, /Menor que/);
  assert.match(legendFormat, /ou mais/);
  assert.match(legendFormat, /return `\$\{start\} a \$\{end\}`/);
  assert.match(legendFormat, /MAONO_LEGEND_TERMS_PT_BR\[label\.trim\(\)\.toLowerCase\(\)\]/);
  assert.match(legendRow, /import \{ formatMaonoLegendLabel \} from "\.\/maono-legend-format"/);
  assert.match(legendRow, /formatMaonoLegendLabel\(props\.label\)/);
  assert.match(index, /replaceLegendRow/);
  assert.match(index, /replaceLegendRow\(\)/);
});

test("legenda Maõno converte a notação SI do Kepler antes de formatar", () => {
  assert.match(legendFormat, /k: 1_000/);
  assert.match(legendFormat, /M: 1_000_000/);
  assert.match(legendFormat, /new Intl\.NumberFormat\("pt-BR"/);
  assert.match(legendFormat, /absolute < 10_000/);
  assert.match(legendFormat, /absolute < 1_000_000/);
  assert.match(legendFormat, /formatScaledNumber\(value, 1_000, "mil"\)/);
  assert.match(legendFormat, /formatScaledNumber\(value, 1_000_000, "M"\)/);
  assert.match(legendFormat, /integerPart\.replace\(\/,\/g, ""\)/);
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
  const emitted = ts.transpileModule(legendPanel, {fileName: "legend.tsx", compilerOptions: {jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022}}).outputText;
  const parsed = ts.createSourceFile('legend.jsx', emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nativeElements = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === 'NativeMapLegendPanel') nativeElements.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(nativeElements.length, 1);
  const attributes = nativeElements[0].attributes.properties;
  assert.equal(attributes.length, 2, 'native panel receives only the original spread and controls override');
  assert.ok(ts.isJsxSpreadAttribute(attributes[0]));
  assert.equal(attributes[0].expression.getText(parsed), 'props');
  assert.ok(ts.isJsxAttribute(attributes[1]));
  assert.equal(attributes[1].name.getText(parsed), 'mapControls');
  assert.equal(attributes[1].initializer.expression.getText(parsed), 'mapControls');
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

function evaluateModule(text, context = {}, filename = "legend.ts") {
  const exports = {};
  const compiled = ts.transpileModule(text, {fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  }}).outputText;
  vm.runInNewContext(compiled, {exports, ...context});
  return exports;
}

test("formatadores reais preservam nomes e objetos e localizam números e intervalos", () => {
  const {parseKeplerLegendNumber, formatMaonoLegendLabel: format} = evaluateModule(legendFormat);
  for (const [input, expected] of [["505.3k", 505300], ["1.027M", 1027000], ["-1,234.5", -1234.5], ["receita_total", null]]) {
    const value = parseKeplerLegendNumber(input);
    if (expected === null) assert.equal(value, null);
    else assert.ok(Math.abs(value - expected) <= 2 * Number.EPSILON * Math.max(1, Math.abs(expected)), 'SI parsing differs only by floating-point rounding');
  }
  for (const [input, expected] of [["fill color", "Cor de preenchimento"], ["point count", "Contagem de pontos"],
    ["Less than 505.3k", "Menor que 505,3 mil"], ["1.027M or more", "1,027 M ou mais"],
    ["1,000 to 10k", "1.000 a 10 mil"], ["receita_total", "receita_total"], ["Categoria Azul", "Categoria Azul"]]) {
    assert.equal(format(input), expected);
  }
  const label = {userDefined: true};
  assert.equal(format(label), label, 'nontext label identity is preserved');
});

test("wrapper real delega props e callback nativo sem persistir a projeção inicial", () => {
  const parsed = ts.createSourceFile('legend.tsx', legendPanel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['hasStoredLegendPosition', 'mapControlsWithInitialLegendPosition', 'MaonoMapLegendPanelFactory'];
  const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(functions.length, 3, 'test executes all three real wrapper declarations');
  const position = evaluateModule(legendPosition);
  const NativePanel = () => null, Tooltip = () => null, Controls = () => null, Legend = () => null;
  const factoryCalls = [], settingsCalls = [];
  const nativeBoundary = (...deps) => { factoryCalls.push(deps); return NativePanel; };
  const {MaonoMapLegendPanelFactory} = evaluateModule(functions.map(node => node.getText(parsed)).join('\n'), {
    React: {createElement}, MapLegendPanelFactory: nativeBoundary, MaonoLegendFrame: 'frame',
    ThemeProvider: 'theme', maonoLegendTheme: {}, ...position,
  }, 'legend.tsx');
  const Panel = MaonoMapLegendPanelFactory(Tooltip, Controls, Legend);
  assert.equal(factoryCalls.length, 1);
  assert.equal(factoryCalls[0][0], Tooltip);
  assert.equal(factoryCalls[0][2], Legend);
  const setMapControlSettings = (...args) => settingsCalls.push(args);
  const storedPosition = {x: 55, y: 77, anchorX: 'right', anchorY: 'top'};
  const mapControls = {mapLegend: {active: true, settings: {position: storedPosition}}, scale: {active: true}};
  const props = {mapControls, mapState: {width: 1000, height: 800}, setMapControlSettings, layers: [{id: 'layer'}]};
  const native = Panel(props).props.children;
  assert.equal(native.type, NativePanel);
  assert.equal(native.props.mapControls, mapControls, 'stored drag/resize coordinates retain the original controls');
  assert.equal(native.props.setMapControlSettings, setMapControlSettings);
  assert.equal(native.props.layers, props.layers);
  const fresh = {...mapControls, mapLegend: {active: true}};
  const projected = Panel({...props, mapControls: fresh}).props.children;
  const expected = position.calculateMaonoLegendInitialPosition(props.mapState);
  for (const key of ['x', 'y', 'anchorX', 'anchorY']) assert.equal(projected.props.mapControls.mapLegend.settings.position[key], expected[key]);
  assert.equal(projected.props.mapControls.scale, fresh.scale);
  assert.equal(Panel({...props, mapControls: fresh, isExport: true}).props.children.props.mapControls, fresh);
  assert.equal(settingsCalls.length, 0, 'rendering does not dispatch persistence');
  const settings = {position: {x: 20, y: 30, anchorX: 'right', anchorY: 'top'}};
  native.props.setMapControlSettings('mapLegend', settings);
  assert.deepEqual(settingsCalls, [['mapLegend', settings]]);
  assert.equal(settingsCalls[0][1], settings, 'native callback receives the original settings object');
});
