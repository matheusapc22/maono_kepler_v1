import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildFilterGroups, NEUTRAL_FILTER_ACCENT } from '../src/pages/Kepler/components/maono-layer-panel/filters/filter-groups.ts';

const dataset = (id, label = id) => ({ id, label, fields: [] });
const layer = (id, dataIds, color = [12, 120, 210]) => ({ id, label: `Camada ${id}`, dataIds, color });
const filter = (id, dataIds) => ({ id, dataIds, index: Number(id), value: ['A'], enabled: true });

test('single layer identity uses exactly its live color and keeps original filter objects', () => {
  const conditions = [filter('1', ['a']), filter('2', ['a'])];
  const layers = [layer('one', ['a'], [3, 90, 220])];
  const before = structuredClone({ conditions, layers });
  const [group] = buildFilterGroups(conditions, [dataset('a')], layers);
  assert.equal(group.label, 'Camada one');
  assert.equal(group.layerId, 'one');
  assert.equal(group.accent, 'rgb(3,90,220)');
  assert.equal(group.filters[0], conditions[0]);
  assert.deepEqual({ conditions, layers }, before);
});

test('shared dataset never claims the first layer or invents its color', () => {
  const group = buildFilterGroups([filter('1', ['a'])], [dataset('a', 'Base compartilhada')], [layer('one', ['a']), layer('two', ['a'], [220, 0, 0])])[0];
  assert.equal(group.label, 'Base compartilhada');
  assert.equal(group.layerId, null);
  assert.equal(group.accent, NEUTRAL_FILTER_ACCENT);
});

test('detached, missing and synchronized groups retain native conditions without fictitious colors', () => {
  const conditions = [filter('1', ['a']), filter('2', ['missing']), filter('3', ['a', 'b']), filter('4', [])];
  const groups = buildFilterGroups(conditions, [dataset('a')], []);
  assert.equal(groups.length, 4);
  assert.deepEqual(groups.flatMap(group => group.filters).map(item => item.id).sort(), ['1', '2', '3', '4']);
  assert.ok(groups.every(group => group.layerId === null && group.accent === NEUTRAL_FILTER_ACCENT));
  assert.equal(groups.find(group => group.key === '__incompatible__').label, 'Filtros sincronizados');
  assert.equal(groups.find(group => group.key === '__orphan__').label, 'Dados sem camada');
});

test('group order follows live layer order and color changes rather than example content', () => {
  const conditions = [filter('1', ['a']), filter('2', ['b'])];
  const datasets = [dataset('a'), dataset('b')];
  const groups = buildFilterGroups(conditions, datasets, [layer('two', ['b']), layer('one', ['a'], [240, 100, 70])]);
  assert.deepEqual(groups.map(group => group.key), ['b', 'a']);
  assert.equal(groups[1].accent, 'rgb(240,100,70)');
  assert.deepEqual(buildFilterGroups([], datasets, []), []);
});

const root = '../src/pages/Kepler/components/maono-layer-panel/';
const read = name => readFile(new URL(root + name, import.meta.url), 'utf8');
const [panel, filters, rows, minimal, save, detail] = await Promise.all([
  read('MaonoLayerPanel.tsx'), read('FilterPanel.tsx'), read('LayerListItem.tsx'),
  read('map-panel-minimal.css'), read('PanelSaveAction.tsx'), read('FilterDetailView.tsx'),
]);
test('header and toolbar remove redundant regions structurally without altering native commands', () => {
  assert.doesNotMatch(panel, /modeLabel|maono-layer-panel__mode|showSearch/);
  assert.match(panel, /const count = layers.length/);
  assert.match(panel, /placeholder="Buscar camada\.\.\."/);
  assert.match(panel, /controller\.reorderLayers\(order\)/);
  assert.match(panel, /controller\.toggleLayerVisibility\(layer, visible\)/);
  assert.doesNotMatch(filters, /maono-collection-heading|<strong>Filtros<|condições"/);
  assert.match(filters, /Adicionar Filtro/);
  assert.match(filters, /<FilterDetailView[\s\S]*?inline/);
  assert.match(detail, /<FilterValueEditor/);
  assert.match(detail, /onChangeValue\(filter.index, value\)/);
});
test('layer row follows grip visibility color identity menu and keeps accessible reordering', () => {
  const grip = rows.indexOf('className="maono-layer-row__grip"');
  const eye = rows.indexOf('className="maono-layer-row__visibility"');
  const color = rows.indexOf('className="maono-layer-row__swatch"');
  const main = rows.indexOf('className="maono-layer-row__main"');
  const menu = rows.indexOf('className="maono-layer-row__controls"');
  assert.ok(grip < eye && eye < color && color < main && main < menu);
  assert.match(rows, /onDrop=\{\(event\) => onDrop\(layer.id, event\)\}/);
  assert.match(rows, /Mover para o início/);
});
test('shared minimal surface is scoped and preserves save bridge and quota domain', () => {
  assert.match(minimal, /\.maono-map-panel-row \{[^}]*border: 0;[^}]*border-bottom: 1px[^}]*border-radius: 0;[^}]*background: transparent;[^}]*box-shadow: none;/s);
  assert.match(minimal, /\.maono-filter-list-region\) \{[^}]*min-height: 0;[^}]*overflow-y: auto;/s);
  assert.match(minimal, /data-active-panel="layers"/);
  assert.match(minimal, /width: 28px;\s*height: 52px/);
  assert.match(minimal, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(minimal, /\.maono-map-runtime__map\s*\{|\.maono-map-data-sidebar\s*\{|\.mm-sidebar/);
  assert.match(save, /onClick=\{\(\) => invokeAction\("primary"\)\}/);
  assert.match(save, /disabled=\{!state.primary \|\| state.primary.disabled\}/);
  assert.doesNotMatch(save, /progress|quota|maxLayers/);
});

test('nested layer menus and detail rename consume Escape before the shell collapse handler', async () => {
  for (const file of ['PanelActionMenu.tsx', 'AddLayerMenu.tsx', 'LayerDetailView.tsx']) {
    const source = await read(file);
    assert.match(source, /event.key === "Escape"\) \{\s*event.preventDefault\(\);\s*event.stopPropagation\(\);/);
    if (file !== 'LayerDetailView.tsx') assert.match(source, /document.addEventListener\("keydown", handleKeyDown\)/);
  }
});

test('all layer range controls and the inline filter switch retain explicit accessible names', async () => {
  assert.match(await read('LayerStyleEditor.tsx'), /type="range"\s*aria-label=\{label\}/);
  assert.match(await read('FilterDetailView.tsx'), /role="switch"\s*aria-label=\{`Filtro \$\{title\}`\}/);
});

test('hidden switch focus is contained by its label rather than scrolling fixed panel chrome', async () => {
  const source = await read('map-panel-detail-minimal.css');
  assert.match(source, /\.maono-point-spatial-grouping__switch \{\s*position: relative;/);
  assert.match(source, /\.maono-point-spatial-grouping__switch input \{\s*top: 50%;\s*left: 0;\s*width: 32px;\s*height: 18px;/);
  assert.match(source, /\.maono-filter-category__options label \{\s*position: relative;/);
});

test('detail disclosures use a persistent centered SVG instead of an off-axis text glyph', async () => {
  const [styleEditor, panelCss, icon] = await Promise.all([
    read('LayerStyleEditor.tsx'), read('maono-layer-panel.css'), read('LayerPanelIcon.tsx'),
  ]);
  assert.equal((styleEditor.match(/<LayerPanelIcon name="chevron-down" className="maono-detail-section__chevron" \/>/g) ?? []).length, 3);
  assert.doesNotMatch(styleEditor, /⌄/);
  assert.match(icon, /viewBox="0 0 24 24"/);
  assert.match(panelCss, /\.maono-detail-section__chevron \{ width: 16px; height: 16px;/);
  assert.match(panelCss, /transform-box: view-box;\s*transform-origin: center;/);
  assert.match(panelCss, /\.maono-add-layer__trigger\[aria-expanded="true"\] > svg:last-child/);
  assert.match(panelCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none !important;/);
});

test('early panel diagnostics keep the complete compiled suite running after a focused failure', async () => {
  const workflow = await readFile(new URL('../.github/workflows/project-pages.yml', import.meta.url), 'utf8');
  assert.match(workflow, /name: map-panel-focused-evidence-\$\{\{ github.sha \}\}/);
  assert.match(workflow, /Actual compiled React route[^\n]*\n[^\n]*\n\s*if: \$\{\{ !cancelled\(\) && steps.build.outcome == 'success' && steps.browsers.outcome == 'success' \}\}/);
  assert.match(workflow, /run: xvfb-run[^\n]*playwright test --config=playwright.project-pages.config.ts --reporter=list,json/);
  assert.doesNotMatch(workflow, /continue-on-error/);
});
