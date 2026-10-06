import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
let bundle = '';
let baselineBundle = '';
let maplibreBundle = '';
test.beforeAll(async () => {
  const result = await build({ entryPoints: ['tests/browser/fixtures/project-thumbnail-capture.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'captureFixture', plugins: [{ name: 'serializer-isolation', setup(plugin) {
    // Pixel tests exercise actual capture/readiness/overlay/PNG code. Schema
    // serialization is covered separately; avoid bundling unrelated app code.
    plugin.onResolve({ filter: /^@kepler.gl\/schemas$/ }, () => ({ path: 'schema', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const KeplerGlSchema = {save: value => structuredClone(value)}', loader: 'js' }));
  } }] });
  bundle = result.outputFiles[0].text;
  let baselineSource = '';
  try { baselineSource = execFileSync('git', ['show', 'af652fe47b9f56ed8910b50aab0f1367645bd770:src/pages/Kepler/thumbnail/capture-thumbnail.ts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* A shallow CI checkout may omit the historical baseline. */ }
  const baseline = await build({ stdin: { contents: baselineSource, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'baselineCapture', plugins: [{ name: 'baseline-serializer', setup(plugin) {
    plugin.onResolve({ filter: /^@kepler.gl\/schemas$/ }, () => ({ path: 'schema', namespace: 'baseline' }));
    plugin.onLoad({ filter: /.*/, namespace: 'baseline' }, () => ({ contents: 'export const KeplerGlSchema = {save: value => structuredClone(value)}', loader: 'js' }));
  } }] });
  baselineBundle = baselineSource ? baseline.outputFiles[0].text : '';
  const maplibre = await build({ entryPoints: ['tests/browser/fixtures/project-thumbnail-maplibre.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'realMapFixture' });
  maplibreBundle = maplibre.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  // No authenticated services or remote map tiles. All pixels/data are synthetic.
  await page.route('**/*', route => route.request().url().startsWith('blob:') ? route.continue() : route.abort());
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ content: bundle });
  if (baselineBundle) await page.addScriptTag({ content: baselineBundle });
});

for (const dark of [false, true]) test(`faithful complex-layer pixels are copied exactly; dark=${dark}`, async ({ page }, testInfo) => {
  const result = await page.evaluate(async (dark) => {
    const f = (window as any).captureFixture;
    const env = f.setup({ dark, pitch: 45 });
    let encodes = 0; const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(...args: any[]) { encodes++; return original.apply(this, args as any); };
    const expected = document.createElement('canvas'); expected.width = 960; expected.height = 540;
    const ctx = expected.getContext('2d')!; ctx.drawImage(env.base, 0, 0); ctx.drawImage(env.deckCanvas, 0, 0);
    const expectedPixels = ctx.getImageData(0, 0, 960, 540).data;
    const result = await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options);
    const decoded = await f.decode(result.blob);
    const png = Array.from(new Uint8Array(await result.blob.arrayBuffer()));
    return { png, quality: result.quality, method: result.method, encodes, width: decoded.width, height: decoded.height, changed: decoded.pixels.filter((value: number, index: number) => value !== expectedPixels[index]).length, listeners: env.listeners(), diagnostics: result.diagnostics };
  }, dark);
  await testInfo.attach(`faithful-${dark ? 'dark' : 'light'}.png`, { body: Buffer.from(result.png), contentType: 'image/png' });
  expect(result).toMatchObject({ quality: 'faithful', method: 'canvas-composite', encodes: 1, width: 960, height: 540, changed: 0, listeners: 0 });
});

test('frozen frame survives immediate edit and root unmount before encoding callback', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback: any, type: string) {
      env.edit(); env.root.remove(); setTimeout(() => original.call(this, callback, type), 20);
    };
    const result = await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options);
    return { quality: result.quality, size: result.blob.size, connected: env.root.isConnected };
  });
  expect(result.quality).toBe('faithful'); expect(result.size).toBeGreaterThan(100); expect(result.connected).toBe(false);
});

test('generation changes before freeze reject instead of capturing current live map', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    const pending = f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options); env.edit();
    try { await pending; return 'unexpected-success'; } catch (error: any) { return error.name; }
  });
  expect(result).toBe('AbortError');
});

test('in-flight duplicate shares work; newer generation cancels older and releases listeners', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    const first = f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options);
    const duplicate = f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options);
    const aborted = first.catch((error: any) => error.name);
    const newer = f.captureProjectThumbnail(env.runtimeState, env.savedConfig, { ...env.options, editGeneration: 2 });
    const outcome = await newer;
    return { identical: first === duplicate, first: await aborted, quality: outcome.quality, listeners: env.listeners() };
  });
  expect(result).toEqual({ identical: true, first: 'AbortError', quality: 'faithful', listeners: 0 });
});

test('degraded overlay honors filters and rejects unsupported layer approximations', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    const capture = f.generatedTechnicalPreview();
    const filtered = await f.applyDegradedStateOverlay(capture.canvas, f.prepareThumbnailSnapshot({}, env.savedConfig), new AbortController().signal);
    env.savedConfig.config.visState.filters = []; env.savedConfig.config.visState.layers = [{ type: 'heatmap', config: { dataId: 'data' } }, { type: 'cluster', config: { dataId: 'data' } }];
    const unsupported = await f.applyDegradedStateOverlay(capture.canvas, f.prepareThumbnailSnapshot({}, env.savedConfig), new AbortController().signal);
    return { quality: capture.quality, filtered, unsupported };
  });
  expect(result.quality).toBe('degraded'); expect(result.filtered).toContain('overlaySkipped=filters-not-representable');
  expect(result.unsupported).toContain('overlayUnsupported=heatmap'); expect(result.unsupported).toContain('overlayUnsupported=cluster'); expect(result.unsupported).toContain('overlayPoints=0');
});

test('array scans stop at relevant visible-point limit while preserving later visible rows', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    env.savedConfig.config.visState.filters = []; env.savedConfig.config.visState.layers = [env.savedConfig.config.visState.layers[0]];
    const rows = Array.from({ length: 50000 }, (_, index) => index < 15000 ? [0, 170] : [0, 0]);
    env.savedConfig.datasets[0].data.rows = rows;
    const capture = f.generatedTechnicalPreview();
    return await f.applyDegradedStateOverlay(capture.canvas, f.prepareThumbnailSnapshot({}, env.savedConfig), new AbortController().signal);
  });
  expect(result).toContain('overlayPoints=8000'); expect(result).toContain('overlayRows=23000');
});

test('overlay scanning is cancellable in chunks without a new global row cap', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup(), controller = new AbortController();
    env.savedConfig.config.visState.filters = []; env.savedConfig.config.visState.layers = [env.savedConfig.config.visState.layers[0]];
    env.savedConfig.datasets[0].data.rows = Array.from({ length: 50000 }, () => [0, 170]);
    setTimeout(() => controller.abort(), 1);
    try { await f.applyDegradedStateOverlay(f.generatedTechnicalPreview().canvas, f.prepareThumbnailSnapshot({}, env.savedConfig), controller.signal); return false; } catch (error: any) { return error.name; }
  });
  expect(result).toBe('AbortError');
});

test('html2canvas fallback clones pixels immediately and disposes its DOM', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    const pending = f.beginFrozenHtmlCapture(env.root, new AbortController().signal);
    env.base.getContext('2d').fillStyle = '#ff00ff'; env.base.getContext('2d').fillRect(0, 0, 960, 540); env.root.remove();
    const capture = await pending;
    const pixel = capture.canvas.getContext('2d').getImageData(900, 500, 1, 1).data;
    return { method: capture.method, pixel: Array.from(pixel), frames: document.querySelectorAll('iframe.html2canvas-container').length, holders: document.querySelectorAll('[data-maono-no-preview]').length };
  });
  expect(result.method).toBe('html2canvas'); expect(result.pixel.slice(0, 3)).not.toEqual([255, 0, 255]); expect(result.frames).toBe(0); expect(result.holders).toBe(0);
});

test('actual WebGL source and PNG encode work at the render boundary', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture;
    let env: any; try { env = f.setup({ gpu: true }); } catch (error: any) { return { unsupported: error.message }; }
    const capture = await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options);
    const decoded = await f.decode(capture.blob); const offset = (500 * 960 + 900) * 4;
    return { quality: capture.quality, pixel: decoded.pixels.slice(offset, offset + 4) };
  });
  test.skip(Boolean(result.unsupported), result.unsupported || '');
  expect(result.quality).toBe('faithful'); expect(result.pixel).toEqual([51, 102, 153, 255]);
});

test('capture timings and long tasks are measured on the actual test browser', async ({ page }, testInfo) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup(); const samples: number[] = []; const bytes: number[] = []; const longTasks: number[] = [];
    let observer: PerformanceObserver | undefined;
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) { observer = new PerformanceObserver(entries => entries.getEntries().forEach(entry => longTasks.push(entry.duration))); observer.observe({ entryTypes: ['longtask'] }); }
    for (let n = 0; n < 20; n++) { const started = performance.now(); const result = await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options); samples.push(performance.now() - started); bytes.push(result.blob.size); }
    observer?.disconnect(); samples.sort((a, b) => a - b);
    return { samples: samples.length, p50Ms: samples[9], p95Ms: samples[18], p99Ms: samples[19], bytes, longTasksMs: longTasks, userAgent: navigator.userAgent };
  });
  await testInfo.attach('capture-benchmark.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.samples).toBe(20); expect(result.bytes.every(size => size > 0)).toBe(true);
});

test('tainted canvas fails closed as degraded and never retries another live frame', async ({ page }) => {
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    canvas.getContext('2d')!.fillRect(0, 0, 1, 1);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.route('http://127.0.0.1:41999/taint.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(png) }));
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    const image = new Image(); image.src = 'http://127.0.0.1:41999/taint.png'; await image.decode();
    env.base.getContext('2d').drawImage(image, 0, 0);
    const capture = await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options);
    return { quality: capture.quality, method: capture.method, holders: document.querySelectorAll('[data-maono-no-preview]').length, diagnostics: capture.diagnostics };
  });
  expect(result.quality).toBe('degraded'); expect(result.method).toBe('generated-technical-preview'); expect(result.holders).toBe(0);
});

test('cancelled html2canvas releases frozen DOM and settles without a live retry', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup(), controller = new AbortController();
    const pending = f.beginFrozenHtmlCapture(env.root, controller.signal); controller.abort();
    let name: string; try { await pending; name = 'unexpected'; } catch (error: any) { name = error.name; }
    await new Promise(resolve => setTimeout(resolve, 25));
    return { name, holders: document.querySelectorAll('[data-maono-no-preview]').length, frames: document.querySelectorAll('iframe.html2canvas-container').length };
  });
  expect(result).toEqual({ name: 'AbortError', holders: 0, frames: 0 });
});

test('crop uses editor bounds and excludes hidden, clipped-out and foreign canvases', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup({ width: 480, height: 270 });
    for (const style of ['display:none', 'visibility:hidden', 'opacity:0', 'left:1000px']) {
      const extra = document.createElement('canvas'); extra.width = 960; extra.height = 540; extra.style.cssText = `position:absolute;width:100%;height:100%;z-index:999;${style}`;
      const ctx = extra.getContext('2d')!; ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 960, 540); env.root.appendChild(extra);
    }
    const baseline = document.createElement('canvas'); baseline.width = 960; baseline.height = 540; const ctx = baseline.getContext('2d')!; ctx.drawImage(env.base, 0, 0); ctx.drawImage(env.deckCanvas, 0, 0); const pixels = ctx.getImageData(0, 0, 960, 540).data;
    const capture = await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options); const image = await f.decode(capture.blob);
    return { dimensions: [image.width, image.height], changed: image.pixels.filter((v: number, i: number) => v !== pixels[i]).length, diagnostics: capture.diagnostics };
  });
  expect(result.dimensions).toEqual([960, 540]); expect(result.changed).toBe(0); expect(result.diagnostics).toContain('canvases=2');
});

test('lost WebGL context never produces a faithful preview of a partial map', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture; let env: any;
    try { env = f.setup({ gpu: true }); } catch (error: any) { return error.message; }
    const gl = env.base.getContext('webgl'); const extension = gl.getExtension('WEBGL_lose_context');
    if (!extension) return 'CONTEXT_LOSS_EXTENSION_UNAVAILABLE';
    extension.loseContext(); await new Promise(resolve => setTimeout(resolve, 15));
    try { await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options); return 'unexpected-faithful'; } catch (error: any) { return error.message; }
  });
  test.skip(result.endsWith('UNAVAILABLE'), result);
  expect(result).toBe('CAPTURE_CONTEXT_LOST');
});


test('same-fixture pre-refactor baseline reports measured percentiles without claiming a hardware SLO', async ({ page }, testInfo) => {
  test.skip(!baselineBundle, 'Historical baseline unavailable in shallow checkout; no baseline performance claim.');
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, baseline = (window as any).baselineCapture, env = f.setup();
    document.getElementById('outside')?.remove();
    env.savedConfig.config.visState.layers = []; env.savedConfig.config.visState.filters = []; env.savedConfig.datasets = [];
    const state = { mapState: f.camera, visState: { layers: [], datasets: {} } };
    const oldSamples: number[] = [], newSamples: number[] = []; let oldEncodes = 0, newEncodes = 0;
    let phase = 'old';
    const oldDataUrl = HTMLCanvasElement.prototype.toDataURL, oldBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toDataURL = function(...args: any[]) { if (phase === 'old') oldEncodes++; else newEncodes++; return oldDataUrl.apply(this, args as any); };
    HTMLCanvasElement.prototype.toBlob = function(...args: any[]) { if (phase === 'old') oldEncodes++; else newEncodes++; return oldBlob.apply(this, args as any); };
    let previous: any, next: any;
    for (let n = 0; n < 20; n++) {
      phase = 'old'; let start = performance.now(); previous = await baseline.captureProjectThumbnail(state, env.savedConfig); oldSamples.push(performance.now() - start);
      phase = 'new'; start = performance.now(); next = await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options); newSamples.push(performance.now() - start);
    }
    const before = await f.decode(previous.blob), after = await f.decode(next.blob);
    const percentiles = (values: number[]) => { values.sort((a, b) => a - b); return { count: values.length, p50Ms: values[9], p95Ms: values[18], p99Ms: values[19] }; };
    return { baselineCommit: 'af652fe47b9f56ed8910b50aab0f1367645bd770', fixture: 'simple light multi-canvas, no manual overlay, same browser, interleaved runs', old: { ...percentiles(oldSamples), encodes: oldEncodes }, current: { ...percentiles(newSamples), encodes: newEncodes }, pixelDifferences: before.pixels.filter((value: number, index: number) => value !== after.pixels[index]).length, userAgent: navigator.userAgent };
  });
  await testInfo.attach('capture-baseline-benchmark.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.old.count).toBe(20); expect(result.current.count).toBe(20); expect(result.current.encodes).toBe(20); expect(result.old.encodes).toBeGreaterThan(20);
  expect(result.pixelDifferences).toBe(0);
});


test('same-camera delayed renderer commit cannot freeze old color/filter pixels', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    env.delayCommit();
    env.runtimeState.visState.layers = [{ id: 'point', type: 'point', config: { color: [0, 0, 255] } }];
    env.runtimeState.visState.filters = [{ id: 'filter', value: [4, 5] }];
    let done = false;
    const pending = f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options).then((value: any) => { done = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 60));
    const prematurelyCaptured = done;
    env.base.getContext('2d').fillStyle = '#0088ff'; env.base.getContext('2d').fillRect(0, 0, 960, 540); env.commit();
    const capture = await pending; const image = await f.decode(capture.blob);
    return { prematurelyCaptured, quality: capture.quality, pixel: image.pixels.slice((500 * 960 + 900) * 4, (500 * 960 + 900) * 4 + 4) };
  });
  expect(result).toEqual({ prematurelyCaptured: false, quality: 'faithful', pixel: [0, 136, 255, 255] });
});


test('actual MapLibre applies a changed style token and preserves token for equivalent replacement', async ({ page }) => {
  await page.addScriptTag({ content: maplibreBundle });
  const result = await page.evaluate(() => (window as any).realMapFixture.verifyActualStyleTokens());
  test.skip(Boolean(result.unavailable), result.unavailable || '');
  expect(result.initial).toBe(result.initialExpected); expect(result.unchanged).toBe(result.initial);
  expect(result.unchanged).toBe(result.unchangedExpected); expect(result.changed).toBe(result.changedExpected); expect(result.changed).not.toBe(result.initial);
});

test('split views prove both renderer generations and preserve their separate pixel regions', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup({ split: true });
    const capture = await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options);
    const decoded = await f.decode(capture.blob);
    const pixel = (x: number, y: number) => decoded.pixels.slice((y * 960 + x) * 4, (y * 960 + x) * 4 + 4);
    return { quality: capture.quality, left: pixel(450, 500), right: pixel(900, 500), diagnostics: capture.diagnostics };
  });
  expect(result.quality).toBe('faithful'); expect(result.left.slice(0, 3)).not.toEqual([34, 119, 85]); expect(result.right).toEqual([34, 119, 85, 255]); expect(result.diagnostics).toContain('canvases=4');
});

test('an unregistered visible canvas fails before capture fallbacks', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540; canvas.style.cssText = 'position:absolute;width:100%;height:100%'; env.root.append(canvas);
    try { await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options); return 'unexpected-success'; } catch (error: any) { return error.message; }
  });
  expect(result).toBe('CAPTURE_UNVERIFIED_SURFACE');
});


test('mounted Kepler stacking paints a later negative-z basemap below Deck pixels', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    // Actual DeckGL puts its canvas first, followed by MapLibre's child map
    // container with z-index:-1. Neither canvas has its own z-index.
    env.base.style.zIndex = 'auto'; env.deckCanvas.style.zIndex = 'auto';
    const wrapper = document.createElement('div'); wrapper.style.cssText = 'position:absolute;inset:0;z-index:0';
    const basemap = document.createElement('div'); basemap.style.cssText = 'position:absolute;inset:0;z-index:-1';
    basemap.append(env.base); wrapper.append(env.deckCanvas, basemap); env.root.append(wrapper);
    const expected = document.createElement('canvas'); expected.width = 960; expected.height = 540;
    const ctx = expected.getContext('2d')!; ctx.drawImage(env.base, 0, 0); ctx.drawImage(env.deckCanvas, 0, 0);
    const pixels = ctx.getImageData(0, 0, 960, 540).data;
    const capture = await f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options);
    const decoded = await f.decode(capture.blob);
    return { quality: capture.quality, differences: decoded.pixels.filter((value: number, i: number) => value !== pixels[i]).length };
  });
  expect(result).toEqual({ quality: 'faithful', differences: 0 });
});


test('removing the final layer still waits for Deck to acknowledge and clear its old pixels', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).captureFixture, env = f.setup();
    env.delayCommit(); env.runtimeState.visState.layers = [];
    let finished = false;
    const pending = f.captureProjectThumbnail(env.runtimeState, env.savedConfig, env.options).then((value: any) => { finished = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 50)); const early = finished;
    env.deckCanvas.getContext('2d').clearRect(0, 0, 960, 540); env.commit();
    const capture = await pending, decoded = await f.decode(capture.blob);
    const expected = document.createElement('canvas'); expected.width = 960; expected.height = 540;
    const ctx = expected.getContext('2d')!; ctx.drawImage(env.base, 0, 0); const pixels = ctx.getImageData(0, 0, 960, 540).data;
    return { early, quality: capture.quality, differences: decoded.pixels.filter((v: number, i: number) => v !== pixels[i]).length };
  });
  expect(result).toEqual({ early: false, quality: 'faithful', differences: 0 });
});

for (const source of [{ width: 1216, height: 720 }, { width: 390, height: 844 }]) test(`legacy nonuniform framing is explicit for ${source.width}x${source.height} source pixels`, async ({ page }, testInfo) => {
  const result = await page.evaluate(async source => {
    const f = (window as any).captureFixture;
    document.body.innerHTML = `<div class="kepler-gl" id="source-root" style="position:absolute;left:0;top:0;width:${source.width}px;height:${source.height}px"><canvas width="${source.width}" height="${source.height}" style="position:absolute;inset:0;width:100%;height:100%"></canvas></div>`;
    const root = document.getElementById('source-root')!, sourceCanvas = root.querySelector('canvas')!;
    const ctx = sourceCanvas.getContext('2d')!; ctx.fillStyle = '#e6e7e8'; ctx.fillRect(0, 0, source.width, source.height);
    ctx.fillStyle = '#fa0000'; ctx.beginPath(); ctx.arc(source.width / 2, source.height / 2, 60, 0, Math.PI * 2); ctx.fill();
    const capture = f.freezeCompositedPixels(root);
    const decoded = await f.decode(await f.encodeCapturePng(capture.canvas, new AbortController().signal));
    let minX = 960, maxX = -1, minY = 540, maxY = -1;
    for (let y = 0; y < 540; y++) for (let x = 0; x < 960; x++) {
      const index = (y * 960 + x) * 4;
      if (decoded.pixels[index] > 220 && decoded.pixels[index + 1] < 30 && decoded.pixels[index + 2] < 30) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const baseline = (window as any).baselineCapture;
    let baselineDifferences: number | null = null;
    if (baseline) {
      const prior = await baseline.captureProjectThumbnail({ mapState: f.camera }, { datasets: [], config: { mapState: f.camera, visState: { layers: [] } } });
      const pixels = await f.decode(prior.blob);
      baselineDifferences = decoded.pixels.filter((v: number, i: number) => v !== pixels.pixels[i]).length;
    }
    f.releaseCaptureCanvas(capture.canvas);
    return { sourcePixels: [sourceCanvas.width, sourceCanvas.height], outputPixels: [decoded.width, decoded.height], sourceCircleDiameter: 120,
      outputCircleWidth: maxX - minX + 1, outputCircleHeight: maxY - minY + 1, expectedWidth: 120 * 960 / source.width, expectedHeight: 120 * 540 / source.height,
      baselineDifferences, policy: 'legacy independent X/Y scaling; no aspect-ratio geometry preservation' };
  }, source);
  await testInfo.attach(`framing-${source.width}x${source.height}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.sourcePixels).toEqual([source.width, source.height]); expect(result.outputPixels).toEqual([960, 540]);
  expect(Math.abs(result.outputCircleWidth - result.expectedWidth)).toBeLessThanOrEqual(2);
  expect(Math.abs(result.outputCircleHeight - result.expectedHeight)).toBeLessThanOrEqual(2);
  expect(result.outputCircleWidth).not.toBe(result.outputCircleHeight);
  if (result.baselineDifferences !== null) expect(result.baselineDifferences).toBe(0);
});
