import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import postcss from 'postcss';

const shellRoot = new URL('../src/pages/Kepler/components/maono-map-shell/', import.meta.url);
const read = name => readFileSync(new URL(name, shellRoot), 'utf8');
const sidebar = read('MapSidebar.tsx');
const runtime = read('MaonoMapRuntime.tsx');
const css = postcss.parse(read('maono-map-shell.css'));
const tokenCss = read('maono-map-tokens.css');
const accentCss = read('maono-map-accent.css');
const directory = mkdtempSync(new URL('../.map-sidebar-test-', import.meta.url).pathname);
let render;
try {
  const bundle = await build({
    stdin: {
      contents: `import { renderToStaticMarkup } from 'react-dom/server';
        import { StaticRouter } from 'react-router';
        import MapSidebar from './MapSidebar';
        export const render = props => renderToStaticMarkup(<StaticRouter location="/projects/map/edit"><MapSidebar {...props}/></StaticRouter>);`,
      resolveDir: shellRoot.pathname, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', write: false,
    loader: { '.png': 'dataurl' },
    external: ['react', 'react-dom/server', 'react/jsx-runtime'],
  });
  const path = join(directory, 'render.mjs');
  writeFileSync(path, bundle.outputFiles[0].text);
  ({ render } = await import(path));
} finally {
  rmSync(directory, { recursive: true });
}
const noop = () => {};
const defaults = {
  context: { capabilities: { openLayerPanel: true, viewLayers: true, viewMap: true, importData: true } },
  activePanel: 'layers', panelOpen: true, layerPanelAvailable: true, basemapAvailable: true,
  mapLoading: false, loggingOut: false,
  onPanelTabSelect: noop, onOpenBasemap: noop, onOpenData: noop, onLogout: noop, onNavigateHome: noop,
};
const nav = html => html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)[1];
const tags = html => [...nav(html).matchAll(/<(?:button|a)\b[^>]*>/g)].map(match => match[0]);
const labels = html => tags(html).map(tag => tag.match(/aria-label="([^"]+)"/)[1]);

test('runtime rail renders exact final order with a truthful disabled saved-search placeholder', () => {
  const html = render(defaults);
  assert.deepEqual(labels(html), ['Camadas', 'Mapa base', 'Pesquisas salvas', 'Adicionar dados', 'Voltar ao início']);
  assert.match(tags(html)[2], /disabled=""/);
  assert.match(tags(html)[2], /title="Pesquisas salvas — em breve"/);
  assert.doesNotMatch(tags(html)[2], /href=|aria-controls=|aria-expanded=|is-active/);
  assert.match(tags(html)[4], /href="\/projects"/);
  assert.match(sidebar, /<MapShellIcon name="home"\s*\/>/);
  assert.doesNotMatch(sidebar, /SavedSearchesPanel|fetch\(|localStorage|navigate\(/);
});

test('the single connection follows the open tool and is absent when collapsed', () => {
  for (const [panel, label] of [['layers', 'Camadas'], ['basemap', 'Mapa base'], ['data', 'Adicionar dados']]) {
    const html = render({ ...defaults, activePanel: panel });
    assert.equal((html.match(/class="maono-map-sidebar__connector"/g) || []).length, 1);
    const active = tags(html).filter(tag => tag.includes('class="is-active"'));
    assert.equal(active.length, 1);
    assert.match(active[0], new RegExp(`aria-label="${label}"`));
    assert.match(active[0], /aria-expanded="true"/);
    assert.match(active[0], /aria-pressed="true"/);
    assert.match(active[0], /aria-controls="[^"]+"/);
    const collapsed = render({ ...defaults, activePanel: panel, panelOpen: false });
    assert.doesNotMatch(collapsed, /class="is-active"|class="maono-map-sidebar__connector"/);
    assert.doesNotMatch(nav(collapsed), /aria-expanded="true"|aria-pressed="true"/);
  }
});

test('capabilities and loading gate real tools while preserving Home, brand and logout', () => {
  const restricted = render({ ...defaults, context: { capabilities: { viewMap: true } } });
  assert.deepEqual(labels(restricted), ['Mapa base', 'Pesquisas salvas', 'Voltar ao início']);
  const loading = render({ ...defaults, mapLoading: true, panelOpen: false });
  for (const label of ['Camadas', 'Mapa base', 'Adicionar dados']) {
    assert.match(tags(loading).find(tag => tag.includes(`aria-label="${label}"`)), /disabled=""/);
  }
  assert.match(loading, /aria-label="Maõno Maps — Projetos"/);
  assert.match(loading, /aria-label="Sair da Maõno"/);
  assert.match(tags(loading).at(-1), /href="\/projects"/);
});

test('Home and logo share the engine dirty-state confirmation without another save model', () => {
  assert.equal((sidebar.match(/onClick=\{onNavigateHome\}/g) || []).length, 2);
  const guard = runtime.slice(runtime.indexOf('const handleNavigateHome'), runtime.indexOf('const handleLogout'));
  assert.match(guard, /engineState\.hasUnsavedChanges\s*&&\s*!window\.confirm/);
  assert.match(guard, /event\.preventDefault\(\)/);
  assert.match(guard, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey/);
  assert.doesNotMatch(guard, /markClean|dispatch|localStorage|setState|saveMap/);
  assert.match(runtime, /onNavigateHome=\{handleNavigateHome\}/);
});

test('neutral connector reuses the exact old divider with a single non-interactive stroke', () => {
  assert.match(tokenCss, /--maono-map-rail-border:\s*#161f30;/);
  const decls = selector => Object.fromEntries(css.nodes.find(node => node.type === 'rule' && node.selector === selector).nodes.map(node => [node.prop, node.value]));
  assert.equal(decls('.maono-map-sidebar::before').background, 'var(--maono-map-rail-border)');
  const edge = decls('.maono-map-sidebar__connector-edge');
  assert.equal(edge.stroke, 'var(--maono-map-rail-border)');
  assert.equal(edge['vector-effect'], 'non-scaling-stroke');
  assert.equal(decls('.maono-map-sidebar__connector-fill').stroke, 'none');
  assert.equal(decls('.maono-map-sidebar__connector')['pointer-events'], 'none');
  assert.match(accentCss, /\.maono-map-sidebar__nav \.is-active\s*\{[^}]*border-color: transparent;[^}]*box-shadow: none;/);
  for (const rule of css.nodes.filter(node => node.type === 'rule' && node.selector.includes('.maono-map-sidebar__nav') && !node.selector.includes('__tooltip'))) {
    assert.ok(!rule.nodes.some(node => node.prop === 'transform'), `${rule.selector} must not move the button`);
  }
  assert.match(read('maono-map-shell.css'), /@media \(min-width: 821px\) and \(max-height: 540px\)[\s\S]*overflow-y: auto/);
  assert.match(read('maono-map-shell.css'), /\.maono-map-sidebar::before,\s*\.maono-map-sidebar__connector\s*\{\s*display: none;/);
});
