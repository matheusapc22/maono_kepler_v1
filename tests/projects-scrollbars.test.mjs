import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const styles = read('src/pages/Projects/projects-scrollbars.css') + read('src/shared-sidebar-scrollbars.css');
const css = postcss.parse(styles);

test('desktop owns the section scroll without introducing artificial scaling', () => {
  const desktop = css.nodes.find(node => node.type === 'atrule' && node.params === '(min-width: 761px)');
  assert.ok(desktop);
  const rules = Object.fromEntries(desktop.nodes.filter(node => node.type === 'rule').map(rule => [rule.selector, Object.fromEntries(rule.nodes.map(decl => [decl.prop, decl.value]))]));
  assert.equal(rules['.mm-projects-main']['overflow-y'], 'auto');
  assert.equal(rules['.mm-projects-main']['overflow-x'], 'hidden');
  assert.equal(rules['.mm-projects-main']['overscroll-behavior-y'], 'contain');
  assert.equal(rules['.mm-projects-main'].height, 'var(--maono-app-viewport-height, 100dvh)');
  assert.equal(rules['.mm-projects-layout'].overflow, 'hidden');
  assert.doesNotMatch(styles, /\bzoom\s*:|transform\s*:/);
  css.walkDecls(/^overflow/, declaration => {
    assert.equal(declaration.parent.parent.params, '(min-width: 761px)', 'mobile flow and descendant overflow are unchanged');
  });
});

test('sidebar and all section scrollbars share styling with system accessibility fallback', () => {
  const custom = css.nodes.find(node => node.type === 'atrule' && node.params === '(forced-colors: none)');
  for (const rule of custom.nodes) {
    assert.match(rule.selector, /\.mm-sidebar-nav/);
    assert.match(rule.selector, /\.mm-projects-main/);
  }
  assert.match(styles, /scrollbar-color: var\(--mm-border-strong\) transparent/);
  assert.match(styles, /width: 5px/);
  const forced = css.nodes.find(node => node.type === 'atrule' && node.params === '(forced-colors: active)');
  assert.equal(forced.nodes[0].nodes.find(decl => decl.prop === 'scrollbar-color').value, 'auto');
  assert.equal(forced.nodes[0].nodes.find(decl => decl.prop === 'scrollbar-width').value, 'auto');
  const page = read('src/pages/Projects.tsx');
  assert.match(page, /aria-label="Conteúdo da seção"\s+tabIndex=\{0\}/);
  assert.match(styles, /\.mm-projects-main:focus-visible/);
});
