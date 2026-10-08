import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { layerDropPosition, reorderLayerIdsAtTarget } from '../src/pages/Kepler/components/maono-layer-panel/layer-drop-order.ts';
import { normalizeKeplerLayers } from '../src/pages/Kepler/engine-adapter/selectors.ts';

const ids = Object.freeze(['a', 'b', 'c', 'd']);

test('pointer midpoint selects before/after in viewport coordinates without direction bias', () => {
  for (const top of [-75, 0, 243.5]) {
    const row = { top, height: 66 };
    for (const offset of [0, 18, 32.99]) assert.equal(layerDropPosition(top + offset, row), 'before');
    for (const offset of [33, 50, 66]) assert.equal(layerDropPosition(top + offset, row), 'after');
  }
});

test('all source/target positions and both edges preserve order, uniqueness and native selector order', () => {
  const raw = ids.map(id => ({ id, type: 'point', config: { label: id, dataId: 'data' } }));
  for (const source of ids) for (const target of ids) for (const side of ['before', 'after']) {
    const expected = source === target ? [...ids] : ids.flatMap(id => id === source ? []
      : id !== target ? [id] : side === 'before' ? [source, target] : [target, source]);
    const result = reorderLayerIdsAtTarget(ids, source, target, side);
    assert.deepEqual(result, expected.join() === ids.join() ? null : expected, `${source} ${side} ${target}`);
    const order = result ?? ids;
    assert.equal(new Set(order).size, ids.length);
    assert.deepEqual(normalizeKeplerLayers(raw, order).map(layer => layer.id), expected);
  }
  assert.deepEqual(ids, ['a', 'b', 'c', 'd'], 'input is never mutated');
});

test('penultimate to last and reverse are exact; adjacent equivalent boundaries are no-ops', () => {
  assert.deepEqual(reorderLayerIdsAtTarget(ids, 'c', 'd', 'after'), ['a', 'b', 'd', 'c']);
  assert.deepEqual(reorderLayerIdsAtTarget(ids, 'd', 'c', 'before'), ['a', 'b', 'd', 'c']);
  assert.equal(reorderLayerIdsAtTarget(ids, 'c', 'd', 'before'), null);
  assert.equal(reorderLayerIdsAtTarget(ids, 'd', 'c', 'after'), null);
  assert.deepEqual(reorderLayerIdsAtTarget(ids, 'd', 'a', 'before'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(reorderLayerIdsAtTarget(ids, 'a', 'd', 'after'), ['b', 'c', 'd', 'a']);
});

test('unknown layers, empty and single-layer lists cannot produce a reorder command', () => {
  for (const side of ['before', 'after']) {
    for (const [source, target] of [['missing', 'a'], ['a', 'missing'], ['a', 'a']]) {
      assert.equal(reorderLayerIdsAtTarget(ids, source, target, side), null);
    }
    assert.equal(reorderLayerIdsAtTarget([], 'a', 'b', side), null);
    assert.equal(reorderLayerIdsAtTarget(['a'], 'a', 'a', side), null);
  }
});

test('one explicit insertion edge reaches the existing controller; indicator does not change hit geometry', async () => {
  const root = new URL('../src/pages/Kepler/components/maono-layer-panel/', import.meta.url);
  const [list, panel, css, minimal] = await Promise.all(['LayerList.tsx', 'MaonoLayerPanel.tsx', 'maono-layer-panel.css', 'map-panel-minimal.css'].map(name => readFile(new URL(name, root), 'utf8')));
  assert.match(list, /onReorder\(sourceLayerId, targetLayerId, position\)/);
  assert.doesNotMatch(list, /dataTransfer.getData/);
  const reorder = panel.slice(panel.indexOf('  function reorderLayer('), panel.indexOf('  function renameLayer'));
  assert.match(reorder, /reorderLayerIdsAtTarget\(layers.map\(\(layer\) => layer.id\), draggedLayerId, targetLayerId, position\)/);
  assert.match(reorder, /if \(!order\) return;[\s\S]*controller.reorderLayers\(order\)/);
  assert.match(css, /\.maono-layer-row.is-drag-target::after\s*\{[^}]*position: absolute;[^}]*pointer-events: none;/s);
  assert.match(css, /\.maono-layer-row.is-drop-before::after \{ top: 0; \}/);
  assert.match(css, /\.maono-layer-row.is-drop-after::after \{ bottom: 0; \}/);
  assert.doesNotMatch(minimal, /is-drag-target\s*\{[^}]*border-top:/s);
});
