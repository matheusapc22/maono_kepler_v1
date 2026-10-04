import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/platform-density.css');
const css = postcss.parse(source);
const rules = selector => {
  const result = [];
  css.walkRules(rule => { if (rule.selector.includes(selector)) result.push(rule); });
  return result;
};

test('compact layout is a shared, readable geometry policy loaded by the real app', () => {
  assert.match(read('src/main.tsx'), /import "\.\/platform-density\.css"/);
  assert.match(read('src/platform-layout.css'), /--maono-app-font-size:\s*16px/);
  assert.match(source, /--maono-density-sidebar:\s*15rem/);
  assert.match(source, /--maono-density-control:\s*2\.5rem/);
  assert.match(source, /--maono-density-control-small:\s*2\.25rem/);
  css.walkDecls(decl => {
    assert.notEqual(decl.prop, 'zoom', 'compactness cannot emulate browser zoom');
    assert.ok(!(decl.prop === 'transform' && /scale/.test(decl.value)), 'no scaled canvas or text');
    assert.ok(!['html', 'body', '#root'].includes(decl.parent.selector) || decl.prop !== 'font-size', 'root/browser font scale stays user-controlled');
  });
});

test('all route families and body portals receive explicit density scopes', () => {
  for (const selector of ['.mm-project-pages__filters', '.mm-project-card', '.mm-docs', '.ticket-center-header', '.roadmap-header', '.people-toolbar', '.projects-management-card', '.maono-admin-page', '.maono-login-page', '.maono-editor-inbox', '.maono-review-panel', '.maono-map-management', '.maono-map-runtime', '.mm-docs-dialog', '.mm-docs-action-menu', '.admin-user-dialog']) {
    assert.ok(rules(selector).length, `missing compact surface: ${selector}`);
  }
  for (const rule of rules('.mm-project-pages__grid')) {
    assert.match(rule.selector, /body \.mm-projects-page/, 'density survives later lazy route styles');
  }
});

test('coarse pointers and narrow layouts retain 44px primary and small controls', () => {
  let coarse;
  css.walkAtRules('media', rule => { if (rule.params === '(pointer: coarse), (max-width: 760px)') coarse = rule; });
  assert.ok(coarse);
  const values = new Map();
  coarse.walkDecls(decl => values.set(decl.prop, decl.value));
  assert.equal(values.get('--maono-density-control'), '2.75rem');
  assert.equal(values.get('--maono-density-control-small'), '2.75rem');
});

test('map compactness preserves coordinate, histogram and native positioning owners', () => {
  for (const selector of ['.maono-map-runtime__map', '.maono-kepler-viewport', '.maono-map-marker', '.maono-smart-histogram', '.maono-panel-menu__popover', '.maono-map-popover']) {
    assert.equal(rules(selector).length, 0, `must not override geometry owner ${selector}`);
  }
  assert.match(source, /@media \(min-width: 821px\)/);
  assert.match(source, /--maono-map-panel-width: min\(var\(--maono-density-map-panel\), calc\(100vw - var\(--maono-density-map-rail\) - 32px\)\)/);
  assert.match(read('src/pages/Kepler/components/maono-map-shell/maono-map-shell.css'), /padding-bottom:\s*64px/);
  assert.match(read('src/pages/Kepler/index.tsx'), /ResizeObserver/);
  assert.match(read('src/pages/Kepler/components/maono-map-shell/maono-map-panel-readability.css'), /--maono-panel-font-14:\s*17\.5px/);
});


test('project creation CTA has an 8px desktop inset and keeps full-width mobile fit', () => {
  const ctaRules = rules('.mm-project-pages__new');
  const styles = ctaRules.map(rule => ({
    selector: rule.selector,
    media: rule.parent.type === 'atrule' ? rule.parent.params : null,
    declarations: Object.fromEntries(rule.nodes.map(decl => [decl.prop, decl.value])),
  }));
  assert.deepEqual(styles, [
    { selector: 'body .mm-projects-page .mm-project-pages__new', media: null, declarations: { 'min-width': '140px', 'margin-inline-end': '8px' } },
    { selector: 'body .mm-projects-page .mm-project-pages__new', media: '(max-width: 760px)', declarations: { width: '100%', 'margin-inline-end': '0' } },
  ]);
});
