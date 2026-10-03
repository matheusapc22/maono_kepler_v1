import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const shared = postcss.parse(read('src/shared-sidebar-scrollbars.css'));
const shell = read('src/pages/Kepler/components/maono-map-shell/maono-map-shell.css');
const roots = ['.maono-map-sidebar', '.maono-map-panel-host__panel'];

test('map shell imports the shared contract without depending on opening AddData or Projects', () => {
  assert.match(shell, /^@import "\.\.\/\.\.\/\.\.\/\.\.\/shared-sidebar-scrollbars\.css";/);
  assert.match(read('src/pages/Kepler/components/maono-map-shell/MaonoMapShell.tsx'), /import "\.\/maono-map-shell\.css"/);
  const tokens = shared.nodes.find(node => node.type === 'rule');
  assert.deepEqual(tokens.selectors, roots);
  assert.equal(tokens.nodes.length, 1);
  assert.equal(tokens.nodes[0].prop, '--mm-border-strong');
  assert.equal(tokens.nodes[0].value, 'var(--maono-sidebar-scroll-thumb)');
  assert.match(read('src/maono-design-tokens.css'), /--maono-sidebar-scroll-thumb: var\(--mm-border-strong, #333a46\)/);
});

test('every left map scroll owner uses the exact Projects rule, including nested native content', () => {
  for (const mode of ['(forced-colors: none)', '(forced-colors: active)']) {
    const media = shared.nodes.find(node => node.type === 'atrule' && node.params === mode);
    assert.ok(media);
    for (const rule of media.nodes.filter(node => node.type === 'rule')) {
      const suffix = rule.selector.match(/::-webkit-scrollbar(?:-track|-thumb)?/)?.[0] ?? '';
      for (const root of roots) {
        assert.ok(rule.selectors.includes(`${root}${suffix}`));
        assert.ok(rule.selectors.includes(`${root} *${suffix}`));
      }
      assert.ok(rule.selectors.includes(`.maono-sidebar-scroll${suffix}`));
      assert.ok(rule.selectors.includes(`.mm-projects-page .mm-sidebar-nav${suffix}`));
    }
  }
});

test('shared scrollbar retains Projects color, thin sizing, transparent track and rounded thumb', () => {
  const custom = shared.nodes.find(node => node.type === 'atrule' && node.params === '(forced-colors: none)');
  const declarations = suffix => Object.fromEntries(custom.nodes.find(node => node.type === 'rule' && node.selectors.includes(`.maono-map-panel-host__panel${suffix}`)).nodes.map(node => [node.prop, node.value]));
  assert.deepEqual(declarations(''), { 'scrollbar-width': 'thin', 'scrollbar-color': 'var(--mm-border-strong) transparent' });
  assert.deepEqual(declarations('::-webkit-scrollbar'), { width: '5px', height: '5px' });
  assert.deepEqual(declarations('::-webkit-scrollbar-track'), { background: 'transparent' });
  assert.deepEqual(declarations('::-webkit-scrollbar-thumb'), { background: 'var(--mm-border-strong)', 'border-radius': '99px' });
  // Projects has no separate hover override; map must not invent one.
  shared.walkRules(rule => assert.doesNotMatch(rule.selector, /:hover/));
});

test('forced colors restore native scrollbar colors and dimensions for every left panel', () => {
  const forced = shared.nodes.find(node => node.type === 'atrule' && node.params === '(forced-colors: active)');
  assert.equal(forced.nodes.filter(node => node.type === 'rule').length, 1);
  assert.deepEqual(Object.fromEntries(forced.nodes[0].nodes.map(node => [node.prop, node.value])), {
    'scrollbar-color': 'auto', 'scrollbar-width': 'auto',
  });
  shared.walkRules(rule => {
    if (rule.selector.includes('::-webkit-scrollbar')) assert.equal(rule.parent.params, '(forced-colors: none)');
  });
  const mobile = postcss.parse(shell).nodes.find(node => node.type === 'atrule' && node.params === '(max-width: 820px)');
  assert.ok(mobile);
  mobile.walkRules(rule => {
    if (rule.selector === '.maono-map-sidebar__nav') {
      assert.equal(rule.nodes.find(node => node.prop === 'overflow-x').value, 'auto');
      assert.equal(rule.nodes.find(node => node.prop === 'overscroll-behavior-x').value, 'contain');
      assert.ok(!rule.nodes.some(node => node.prop === 'scrollbar-width' && node.value === 'none'));
    }
    assert.notEqual(rule.selector, '.maono-map-sidebar__nav::-webkit-scrollbar');
  });
});

test('scrollbar styling cannot introduce scrollports, resize the map, or reach right-side tools', () => {
  shared.walkDecls(declaration => {
    assert.ok(['--mm-border-strong', 'scrollbar-width', 'scrollbar-color', 'width', 'height', 'background', 'border-radius'].includes(declaration.prop), declaration.toString());
    if (['width', 'height', 'background', 'border-radius'].includes(declaration.prop)) {
      assert.match(declaration.parent.selector, /::-webkit-scrollbar/);
    }
  });
  shared.walkRules(rule => {
    assert.doesNotMatch(rule.selector, /\.maono-map-runtime|\.maono-map-overlay|\.maono-kepler-viewport|\.maono-map-tooltip|html:has\(\.maono-map/);
  });
  // Both roots are actual left-side hosts; no class is attached to the map root.
  assert.match(read('src/pages/Kepler/components/maono-map-shell/MapSidebar.tsx'), /className="maono-map-sidebar"/);
  assert.match(read('src/pages/Kepler/components/maono-map-shell/MapPanelHost.tsx'), /className="maono-map-panel-host__panel"/);
});
