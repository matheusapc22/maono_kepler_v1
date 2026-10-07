import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dragHistogramRange, translateHistogramRange, keyboardHistogramRange } from '../src/pages/Kepler/components/maono-layer-panel/filters/histogram-range.ts';
import { histogramValueToRatio, histogramRatioToValue } from '../src/pages/Kepler/engine-adapter/histogram-strategies.ts';

function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);
}
function ratios(range, domain, scale) {
  return range.map(value => histogramValueToRatio(value, domain, scale));
}

for (const [scale, domain] of [['linear', [-100, 100]], ['log-shifted', [1474, 540756]], ['log-shifted', [-50, 1e9]], ['time', [1700000000000, 1700001000000]]]) {
  test(`${scale} ${domain}: band translation preserves visual width at every boundary`, () => {
    const range = [0.2, 0.6].map(ratio => histogramRatioToValue(ratio, domain, scale));
    const start = ratios(range, domain, scale);
    for (const delta of [-20, -1, -0.2, -0.1, 0, 0.05, 0.3, 0.4, 1, 20]) {
      const moved = translateHistogramRange(range, delta, domain, scale);
      const actual = ratios(moved, domain, scale);
      assert.ok(moved[0] >= domain[0] && moved[1] <= domain[1]);
      near(actual[1] - actual[0], start[1] - start[0]);
      near(actual[0], start[0] + Math.max(-start[0], Math.min(1 - start[1], delta)));
    }
  });
}

test('LOG translation fixes transformed distance, not numeric amplitude, and is reversible', () => {
  const domain = [1474, 540756];
  const range = [22353, 492230];
  const moved = translateHistogramRange(range, -0.2, domain, 'log-shifted');
  assert.notEqual(moved[1] - moved[0], range[1] - range[0]);
  near(Math.log1p(moved[1] - domain[0]) - Math.log1p(moved[0] - domain[0]), Math.log1p(range[1] - domain[0]) - Math.log1p(range[0] - domain[0]));
  const restored = translateHistogramRange(moved, 0.2, domain, 'log-shifted');
  near(restored[0], range[0], 1e-7);
  near(restored[1], range[1], 1e-7);
});

test('handles independently resize, never cross, snap locally and reach exact endpoints', () => {
  const domain = [0, 100];
  assert.deepEqual(dragHistogramRange([20, 60], 'minimum', 0.1, domain, 'linear', 1), [30, 60]);
  assert.deepEqual(dragHistogramRange([20, 60], 'maximum', -0.1, domain, 'linear', 1), [20, 50]);
  assert.deepEqual(dragHistogramRange([20, 60], 'minimum', 2, domain, 'linear', 3), [60, 60]);
  assert.deepEqual(dragHistogramRange([20, 60], 'maximum', -2, domain, 'linear', 3), [20, 20]);
  assert.deepEqual(dragHistogramRange([20, 60], 'maximum', 2, domain, 'linear', 3), [20, 100]);
  for (const mode of ['minimum', 'maximum']) {
    const range = [50, 500];
    const next = dragHistogramRange(range, mode, 0.1, [1, 10000], 'log-shifted', 1);
    assert.equal(next[mode === 'minimum' ? 1 : 0], range[mode === 'minimum' ? 1 : 0]);
  }
});

test('no-motion, full-domain, collapsed and degenerate selections remain stable', () => {
  for (const scale of ['linear', 'log-shifted', 'time']) {
    for (const mode of ['minimum', 'maximum', 'window']) {
      assert.deepEqual(dragHistogramRange([10.123, 80.456], mode, 0, [0, 100], scale, 1), [10.123, 80.456]);
    }
    assert.deepEqual(translateHistogramRange([0, 100], 0.2, [0, 100], scale), [0, 100]);
    assert.deepEqual(translateHistogramRange([5, 5], 0.2, [5, 5], scale), [5, 5]);
    const collapsed = translateHistogramRange([10, 10], 0.2, [0, 100], scale);
    assert.equal(collapsed[0], collapsed[1]);
  }
});

test('keyboard moves the band in display space and handles independently without leaving domain', () => {
  const domain = [0, 100];
  assert.deepEqual(keyboardHistogramRange([20, 60], 'minimum', 'ArrowUp', domain, 'linear', 2), [22, 60]);
  assert.deepEqual(keyboardHistogramRange([20, 60], 'maximum', 'ArrowDown', domain, 'linear', 2), [20, 58]);
  assert.deepEqual(keyboardHistogramRange([20, 60], 'minimum', 'End', domain, 'linear', 2), [60, 60]);
  assert.deepEqual(keyboardHistogramRange([20, 60], 'maximum', 'Home', domain, 'linear', 2), [20, 20]);
  assert.deepEqual(keyboardHistogramRange([20, 60], 'window', 'Home', domain, 'linear', 2), [0, 40]);
  const atEnd = keyboardHistogramRange([20, 60], 'window', 'End', domain, 'linear', 2);
  near(atEnd[0], 60);
  assert.equal(atEnd[1], 100);
  assert.equal(keyboardHistogramRange([20, 60], 'window', 'Enter', domain, 'linear', 2), null);
  const initial = [10, 1000];
  const moved = keyboardHistogramRange(initial, 'window', 'PageUp', [0, 10000], 'log-shifted', 1);
  const start = ratios(initial, [0, 10000], 'log-shifted');
  const end = ratios(moved, [0, 10000], 'log-shifted');
  near(end[1] - end[0], start[1] - start[0]);
  near(end[0] - start[0], 0.1);
});

test('numeric and time editors publish live values; capture cancellation preserves latest live range', async () => {
  const editor = await readFile(new URL('../src/pages/Kepler/components/maono-layer-panel/filters/FilterValueEditor.tsx', import.meta.url), 'utf8');
  const histogram = await readFile(new URL('../src/pages/Kepler/components/maono-layer-panel/filters/FilterHistogram.tsx', import.meta.url), 'utf8');
  assert.equal((editor.match(/onRangeChange=\{updateBrush\}/g) ?? []).length, 2);
  assert.equal((editor.match(/appliedRangeRef\.current = next;\s*onChange\(next\)/g) ?? []).length, 2);
  assert.equal((editor.match(/selectedRange=\{currentDraft\}/g) ?? []).length, 2);
  assert.match(histogram, /setPointerCapture\(event\.pointerId\)/);
  assert.match(histogram, /onPointerCancel=\{finishDrag\}/);
  assert.match(histogram, /onLostPointerCapture=\{finishDrag\}/);
  assert.match(histogram, /if \(event\.type === "pointerup"\) updateDrag\(event\)/);
  assert.match(histogram, /event\.isPrimary === false \|\| dragRef\.current/);
  assert.match(histogram, /drag\.pointerId !== event\.pointerId/);
});
