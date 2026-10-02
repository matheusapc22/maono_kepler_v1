import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import {
  fallbackSource, fallbackCss, previousCss, legacySelector, scopedSelector,
} from './helpers/projects-fallback-fixture.mjs';

const runtime = fallbackSource.replace(/export\s*\{\s*\}\s*;?\s*$/, '');

function mockDocument(existing = false) {
  const nodes = existing ? [{ id: 'maono-ui-fallback-styles', textContent: 'existing' }] : [];
  return {
    nodes,
    getElementById(id) { return nodes.find(node => node.id === id); },
    createElement(tag) { assert.equal(tag, 'style'); return { id: '', textContent: '' }; },
    head: { appendChild(node) { nodes.push(node); } },
  };
}

test('all 57 presentation selector occurrences exclude Projects, including media and pseudo-states', () => {
  assert.equal(fallbackCss.split(scopedSelector).length - 1, 57);
  assert.equal(fallbackCss.includes(legacySelector), false);
  const remaining = fallbackCss.replaceAll(scopedSelector, '');
  assert.doesNotMatch(remaining, /#root\s*>\s*main/);
});

test('legacy declarations, neutral resets and media queries remain byte-identical to baseline 42a97e9', () => {
  // SHA-256 of the original CSS literal in blob 4775211773223c57399c16ababd6ab077c575c2d.
  assert.equal(createHash('sha256').update(previousCss).digest('hex'),
    '58e619119b0386ae99814c1664c983ee1053a959a54cc34cc76a793fe95676f8');
});

test('boundary is shell identity, not route/pathname, DOM removal or feature flags', () => {
  assert.doesNotMatch(runtime, /location\.|pathname|MAONO_|removeChild|\.remove\(/);
  assert.ok(scopedSelector.includes(':not(.maono-login-page, .mm-projects-page)'));
});

test('module evaluation is safe without document', () => {
  assert.doesNotThrow(() => runInNewContext(runtime, {}));
});

test('injects the stylesheet with its existing stable ID', () => {
  const document = mockDocument();
  runInNewContext(runtime, { document });
  assert.equal(document.nodes.length, 1);
  assert.equal(document.nodes[0].id, 'maono-ui-fallback-styles');
  assert.equal(document.nodes[0].textContent, fallbackCss);
});

test('repeated injection does not duplicate the stylesheet', () => {
  const document = mockDocument();
  runInNewContext(`${runtime}\ninjectFallbackStyles();\ninjectFallbackStyles();`, { document });
  assert.equal(document.nodes.length, 1);
});

test('an existing fallback style is preserved', () => {
  const document = mockDocument(true);
  document.createElement = () => { throw new Error('must not create a duplicate'); };
  runInNewContext(runtime, { document });
  assert.deepEqual(document.nodes, [{ id: 'maono-ui-fallback-styles', textContent: 'existing' }]);
});
