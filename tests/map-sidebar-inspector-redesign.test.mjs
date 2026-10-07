import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = '../src/pages/Kepler/components/maono-layer-panel/';
const read = name => readFile(new URL(root + name, import.meta.url), 'utf8');
const [layer, filter, inspector, style, panel, css, save] = await Promise.all([
  read('LayerDetailView.tsx'), read('FilterDetailView.tsx'), read('LayerInspector.tsx'),
  read('LayerStyleEditor.tsx'), read('MaonoLayerPanel.tsx'), read('map-panel-detail-minimal.css'), read('PanelSaveAction.tsx'),
]);

test('compact layer identity keeps name and type, with bare eye between identity and menu', () => {
  assert.match(layer, /<strong>\{layer.label\}<\/strong>/);
  assert.match(layer, /<small>\{layer.type\}<\/small>/);
  assert.doesNotMatch(layer, /Dataset não informado|datasets.find/);
  const eye = layer.indexOf('className="maono-detail-view__visibility"');
  assert.ok(eye > layer.indexOf('className="maono-detail-view__identity"'));
  assert.ok(eye < layer.lastIndexOf('<PanelActionMenu'));
  assert.match(layer, /disabled=\{!canToggle\}/);
  assert.match(layer, /onToggle\(layer, !layer.isVisible\)/);
  assert.doesNotMatch(inspector, /maono-layer-essential|>Camada<|>Registros<|>Visível</);
  assert.match(inspector, /<LayerStyleEditor\s+key=\{activeLayer.id\}/);
  // Dataset/column operations remain reachable in their existing disclosure.
  assert.match(inspector, /Dataset associado/);
  assert.match(inspector, /onColumnsChange\(activeLayer/);
});

test('filter interiors share compact eye treatment without losing enable logic or binding', () => {
  assert.match(filter, /<small>\{filterTypeLabel\(filter.type\)\}<\/small>/);
  assert.match(filter, /className="maono-detail-view__visibility"/);
  assert.match(filter, /disabled=\{!canEdit\}/);
  assert.match(filter, /onToggle\(filter.index, !filter.enabled\)/);
  assert.match(filter, /name=\{filter.enabled \? "eye" : "eye-off"\}/);
  assert.doesNotMatch(filter, /<strong>\{filter.enabled \? "Ativo" : "Inativo"\}/);
  assert.match(filter, /Base de dados/);
  assert.match(filter, /onBindField\(filter.index, datasetId/);
  assert.match(filter, /<FilterValueEditor/);
});

test('only redundant header count and four specified section subtitles are removed', () => {
  assert.doesNotMatch(panel, /const count = layers.length|<span>\{count\}/);
  assert.match(panel, /\{title\}/);
  assert.match(panel, /Camadas <span>\{layers.length\}<\/span>/);
  assert.match(panel, /Filtros <span>\{filters.length\}<\/span>/);
  for (const text of ['Formato, opacidade e cor principal', 'Paletas, escalas e contorno', 'Tamanho dos símbolos e comportamento por zoom', 'Composição global do mapa', 'Colorir por coluna']) assert.ok(!style.includes(text));
  for (const text of ['Essencial', 'Aparência', 'Dimensão e agrupamento', 'Avançado']) assert.ok(style.includes(`<strong>${text}</strong>`));
  assert.match(style, /label="Colorir por"/);
});

test('plain eyes and gold titles preserve focus, internal scrolling and existing save action', () => {
  assert.match(css, /\.maono-detail-view__visibility \{[^}]*border: 0;[^}]*background: transparent;/s);
  assert.match(css, /\.maono-detail-view__visibility\[aria-pressed="false"\] \{[^}]*opacity: .65;/s);
  assert.match(css, /grid-template-columns: auto minmax\(0, 1fr\) auto auto/);
  assert.match(css, /summary strong,[\s\S]*?color: var\(--maono-layer-gold\)/);
  assert.match(css, /:focus-visible/);
  assert.match(panel, /<PanelSaveAction \/>/);
  assert.match(save, /invokeAction\("primary"\)/);
});
