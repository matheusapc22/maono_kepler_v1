import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
let bundle = '';
test.beforeAll(async () => {
  const result = await build({ entryPoints: ['tests/browser/fixtures/point-cluster-capture.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'clusterCapture', define: { 'import.meta.env.VITE_POINT_CLUSTERING_V1': '"true"', 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'serializer-isolation', setup(plugin) {
    plugin.onResolve({ filter: /^assert$/ }, () => ({ path: 'assert', namespace: 'assert-fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'assert-fixture' }, () => ({ contents: 'export default function assert(value, message) { if (!value) throw new Error(message || "Assertion failed"); }', loader: 'js' }));
    plugin.onResolve({ filter: /^@kepler.gl\/schemas$/ }, () => ({ path: 'schema', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const KeplerGlSchema = {save: value => structuredClone(value)}', loader: 'js' }));
  } }] });
  bundle = result.outputFiles[0].text;
});
for (const kind of ['point', 'geojson']) test(`${kind}: real Deck holds a new-policy capture until construction, aggregation and drawing`, async ({ page }, testInfo) => {
  await page.route('**/*', route => route.request().url().startsWith('blob:') ? route.continue() : route.abort());
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (kind) => {
    const api = (window as any).clusterCapture, env = await api.setup(kind);
    const before = await api.pixels((await env.capture()).blob);
    const unchangedRefs = [env.state.visState.layers, env.state.visState.layerData, env.state.visState.datasets, env.state.mapState];
    const stages = [];
    let after;
    for (const patch of [{ enabled: true, clusterSize: 120 }, { showCount: true }, { clusterSize: 40 }, { enabled: false }]) {
      env.update(patch); let settled = false;
      const pending = env.capture().then((value: any) => { settled = true; return value; });
      env.deck.redraw(true); await new Promise(resolve => setTimeout(resolve, 35));
      const staleAccepted = settled || env.acknowledged();
      env.commit(); const captured = await pending;
      after = await api.pixels(captured.blob);
      stages.push({ staleAccepted, quality: captured.quality, diagnostics: captured.diagnostics, changed: after.filter((v: number, i: number) => v !== before[i]).length, frames: env.frames });
    }
    const nativeRefsUnchanged = unchangedRefs.every((v, i) => v === [env.state.visState.layers, env.state.visState.layerData, env.state.visState.datasets, env.state.mapState][i]);
    env.remove(); const cleared = await env.capture();
    const errors = [...env.errors]; env.cleanup();
    return { stages, nativeRefsUnchanged, cleared: cleared.quality, errors };
  }, kind);
  await testInfo.attach(`${kind}-consumed-policy.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.errors).toEqual([]); expect(result.nativeRefsUnchanged).toBe(true);
  expect(result.stages.every(stage => !stage.staleAccepted && stage.quality === 'faithful'), JSON.stringify(result)).toBe(true);
  expect(result.stages[0].changed).toBeGreaterThan(0); expect(result.cleared).toBe('faithful');
});
