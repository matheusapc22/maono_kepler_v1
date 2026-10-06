import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { captureCameraMatches, mapCaptureRenderInputs, recordMaonoDeckRenderInputs, acknowledgeMaonoDeckRender, taggedCaptureMapStyle, captureStyleExpectation, registerMaonoCaptureStyleRuntime, registerMaonoCaptureDeckRuntime } from '../src/pages/Kepler/thumbnail/capture-render-generation.ts';
import { boundedCaptureWait } from '../src/pages/Kepler/thumbnail/capture-waits.ts';
import { freezeMaonoMapCaptureGeneration, registerMaonoMapRuntime, registerMaonoDeckRuntime, resetMaonoMapVisualReadinessRuntime, getMaonoMapVisualReadinessDiagnostics } from '../src/pages/Kepler/map-url-loader/map-visual-readiness.ts';

function load(path, mocks = {}, extra = '') {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8') + extra;
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }}).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: (id) => { if (id in mocks) return mocks[id]; throw new Error(id); }, structuredClone, DOMException, AbortController, performance, setTimeout, clearTimeout });
  return exports;
}
const snapshot = load('src/pages/Kepler/thumbnail/capture-snapshot.ts', { '@kepler.gl/schemas': { KeplerGlSchema: { save: (v) => v } } });
const camera = { longitude: 1, latitude: 2, zoom: 4, pitch: 0, bearing: 0 };
const saved = { config: { mapState: camera, visState: { layers: [], filters: [] } }, datasets: [] };

test('snapshot owns saved camera, filters and order; saved/runtime duplicates are never merged', () => {
  const layer = { id: 'same', type: 'point', config: { dataId: 'd', isVisible: true } };
  const value = structuredClone({ ...saved, config: { mapState: camera, visState: { filters: [{ id: 'filter' }], layers: [layer, layer, { id: 'hidden', config: { isVisible: false } }] } }, datasets: [{ info: { id: 'd' }, data: { rows: [] } }, { info: { id: 'd' }, data: { rows: [] } }] });
  const result = snapshot.prepareThumbnailSnapshot({ mapState: { longitude: 9 }, visState: { layers: [{ id: 'runtime-extra' }] } }, value);
  assert.equal(result.camera.longitude, 1); assert.equal(result.layers.length, 1); assert.equal(result.datasets.length, 1);
  value.config.mapState.longitude = 90; value.config.visState.filters[0].id = 'later';
  assert.equal(result.camera.longitude, 1); assert.equal(result.savedConfig.config.visState.filters[0].id, 'filter');
});

test('an absent callback and cancellation both settle bounded waits and run cleanup exactly once', async () => {
  const abort = new AbortController(); let cleanup = 0;
  const pending = boundedCaptureWait(() => () => cleanup++, abort.signal, 1000, 'never');
  abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(cleanup, 1);
  await assert.rejects(boundedCaptureWait(() => () => cleanup++, new AbortController().signal, 8, 'never'), /CAPTURE_TIMEOUT:never/);
  assert.equal(cleanup, 2);
});

test('late asynchronous resources are released after cancellation', async () => {
  const abort = new AbortController(); let complete; let released = 0;
  const pending = boundedCaptureWait((resolve) => { complete = resolve; }, abort.signal, 1000, 'late', () => released++);
  abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); complete({ canvas: true }); assert.equal(released, 1);
});

let releaseStyle = () => {};
let releaseDeck = () => {};
function setup({ tiles = true, cameraOverride = {}, deferredDeck = false } = {}) {
  resetMaonoMapVisualReadinessRuntime(); releaseStyle(); releaseDeck();
  const canvas = {}, deckCanvas = {};
  const listeners = new Map(); let frozen = 0; let redraws = 0;
  const root = { isConnected: true, contains: (value) => value === canvas || value === deckCanvas };
  globalThis.document = { visibilityState: 'visible', fonts: { status: 'loaded' }, addEventListener() {}, removeEventListener() {} };
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  const view = { ...camera, ...cameraOverride };
  const map = { getStyle: () => taggedCaptureMapStyle(undefined).style, getCanvas: () => canvas, isStyleLoaded: () => true, areTilesLoaded: () => tiles, isMoving: () => false,
    getCenter: () => ({ lng: view.longitude, lat: view.latitude }), getZoom: () => view.zoom, getPitch: () => view.pitch, getBearing: () => view.bearing,
    on: (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
    off: (event, callback) => listeners.get(event)?.delete(callback), triggerRepaint: () => setTimeout(() => [...(listeners.get('render') || [])].forEach((callback) => callback()), 0) };
  const rendered = { layers: [] };
  const sourceState = { visState: { layers: [], layerData: [], filters: [], datasets: {} }, mapStyle: { styleType: 'light' } };
  recordMaonoDeckRenderInputs(rendered, sourceState);
  const originalAfterRender = () => acknowledgeMaonoDeckRender(rendered);
  const deck = { canvas: deckCanvas, props: { layers: rendered.layers, onAfterRender: originalAfterRender }, setProps(props) { Object.assign(this.props, props); }, isInitialized: true, layerManager: { getLayers: () => [{ isLoaded: true }], needsUpdate: () => false }, getViewports: () => [view],
    redraw() { redraws++; if (deferredDeck && redraws === 1) setTimeout(() => deck.props.onAfterRender(), 0); else deck.props.onAfterRender(); } };
  registerMaonoMapRuntime(map); registerMaonoDeckRuntime(deck); releaseStyle = registerMaonoCaptureStyleRuntime("bottom", map); releaseDeck = registerMaonoCaptureDeckRuntime(deck);
  const controller = new AbortController();
  const options = { root, editorSessionId: 'session', editGeneration: 7, camera, requireDeck: true, renderInputs: mapCaptureRenderInputs(sourceState), clusterExpectation: { policies: {}, requiredByView: { 0: [], 1: [] } }, styleExpectation: captureStyleExpectation(sourceState.mapStyle), views: [{ index: 0, camera }], isCurrent: () => true, signal: controller.signal, timeoutMs: 35 };
  return { options, root, map, deck, rendered, sourceState, originalAfterRender, controller, freeze: () => ++frozen, counts: () => ({ frozen, redraws, listeners: listeners.get('render')?.size || 0 }) };
}

test('a fresh generation requires complete tiles, matched camera and actual Deck render', async () => {
  const fixture = setup({ deferredDeck: true });
  assert.equal(await freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze), 1);
  assert.ok(fixture.counts().redraws >= 2); assert.equal(fixture.counts().listeners, 1);
  assert.equal(fixture.deck.props.onAfterRender, fixture.originalAfterRender);
});

for (const options of [{ tiles: false }, { cameraOverride: { longitude: 9 } }]) test(`readiness fails closed for ${JSON.stringify(options)}`, async () => {
  const fixture = setup(options);
  await assert.rejects(freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze), /CAPTURE_TIMEOUT/);
  assert.equal(fixture.counts().frozen, 0); assert.equal(fixture.counts().listeners, 1);
});

test('superseded editor generation and runtime replacement do not capture another frame', async () => {
  const fixture = setup(); fixture.options.isCurrent = () => false;
  await assert.rejects(freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze), { name: 'AbortError' });
  assert.equal(fixture.counts().frozen, 0);
  const newer = setup({ tiles: false });
  const pending = freezeMaonoMapCaptureGeneration(newer.options, newer.freeze);
  await new Promise((resolve) => setTimeout(resolve, 5)); releaseStyle(); registerMaonoMapRuntime({});
  await assert.rejects(pending, /CAPTURE_RUNTIME_REPLACED/);
  assert.equal(newer.counts().frozen, 0); assert.equal(getMaonoMapVisualReadinessDiagnostics().mapRuntimeListenerCount, 0);
});

test('hidden tabs and missing animation frames have a finite cancellation boundary', async () => {
  const fixture = setup(); document.visibilityState = 'hidden';
  await assert.rejects(freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze), /CAPTURE_TIMEOUT/);
  assert.equal(fixture.counts().frozen, 0);
  const hiddenRaf = setup(); globalThis.requestAnimationFrame = () => 13;
  await assert.rejects(freezeMaonoMapCaptureGeneration(hiddenRaf.options, hiddenRaf.freeze), /CAPTURE_TIMEOUT/);
});

test('capture implementation encodes once, is rooted, preserves PNG size and never exports dataURL', () => {
  const main = readFileSync(new URL('../src/pages/Kepler/thumbnail/capture-thumbnail.ts', import.meta.url), 'utf8');
  const pixels = readFileSync(new URL('../src/pages/Kepler/thumbnail/capture-pixels.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main + pixels, /toDataURL|atob|querySelectorAll\("canvas"\).*document/);
  assert.match(pixels, /root.querySelectorAll\("canvas"\)/); assert.match(pixels, /PREVIEW_WIDTH = 960/); assert.match(pixels, /PREVIEW_HEIGHT = 540/);
  assert.equal((pixels.match(/\.toBlob\(/g) || []).length, 1);
  assert.match(main, /never publish `quality: degraded` as READY/);
});

test('fonts must settle for the saved generation and are bounded when they never finish', async () => {
  const fixture = setup(); let ready;
  document.fonts = { status: 'loading', ready: new Promise(resolve => { ready = resolve; }) };
  const pending = freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze);
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(fixture.counts().frozen, 0);
  document.fonts.status = 'loaded'; ready(); assert.equal(await pending, 1);
  const blocked = setup(); document.fonts = { status: 'loading', ready: new Promise(() => {}) };
  await assert.rejects(freezeMaonoMapCaptureGeneration(blocked.options, blocked.freeze), /CAPTURE_TIMEOUT/);
});


test('same-camera color/filter/style changes wait for the actual consumed generation acknowledgment', async () => {
  const fixture = setup();
  const expected = { visState: { ...fixture.sourceState.visState, layers: [{ id: 'same-layer', color: 'blue' }], filters: [{ value: [2, 3] }] }, mapStyle: { styleType: 'dark' } };
  fixture.options.renderInputs = mapCaptureRenderInputs(expected);
  fixture.options.timeoutMs = 100;
  const pending = freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(fixture.counts().frozen, 0, 'isCurrent=true plus same camera does not acknowledge stale layer/filter/style pixels');
  recordMaonoDeckRenderInputs(fixture.rendered, expected);
  assert.equal(await pending, 1);
});

test('same-ID stale generation times out even while maps keep rendering', async () => {
  const fixture = setup();
  fixture.options.renderInputs = mapCaptureRenderInputs({ ...fixture.sourceState, visState: { ...fixture.sourceState.visState, filters: [] } });
  await assert.rejects(freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze), /CAPTURE_TIMEOUT/);
  assert.equal(fixture.counts().frozen, 0);
});

test('identical visual style replacement shares token despite metadata and property order', () => {
  const first = taggedCaptureMapStyle({ version: 8, sources: {}, layers: [], metadata: { revision: 1 } });
  const next = taggedCaptureMapStyle({ layers: [], sources: {}, metadata: { revision: 2 }, version: 8 });
  assert.equal(first.token, next.token);
  const changed = taggedCaptureMapStyle({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000000' } }] });
  assert.notEqual(first.token, changed.token);
});

test('top map style/tiles require separate proof before its canvas can be frozen', async () => {
  const fixture = setup(); fixture.options.timeoutMs = 150;
  const style = taggedCaptureMapStyle({ version: 8, sources: {}, layers: [{ id: 'labels', type: 'background' }] });
  fixture.options.styleExpectation.top = style.token;
  const topCanvas = {};
  const oldContains = fixture.root.contains;
  fixture.root.contains = value => value === topCanvas || oldContains(value);
  let loaded = false;
  const topRender = new Set();
  const release = registerMaonoCaptureStyleRuntime('top', { getCanvas: () => topCanvas, getStyle: () => style.style, isStyleLoaded: () => true, areTilesLoaded: () => loaded, isMoving: () => false,
    getCenter: () => ({ lng: camera.longitude, lat: camera.latitude }), getZoom: () => camera.zoom, getPitch: () => camera.pitch, getBearing: () => camera.bearing,
    on: (_event, callback) => topRender.add(callback), off: (_event, callback) => topRender.delete(callback), triggerRepaint: () => setTimeout(() => [...topRender].forEach(callback => callback()), 0) });
  try {
    const pending = freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze);
    await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(fixture.counts().frozen, 0);
    loaded = true; assert.equal(await pending, 1);
  } finally { release(); }
});

test('cached style reuse after final runtime unregister preserves equivalent replacement token', () => {
  releaseStyle(); releaseDeck();
  const source = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] };
  const first = taggedCaptureMapStyle(source);
  const release = registerMaonoCaptureStyleRuntime('bottom', {}); release();
  const reused = taggedCaptureMapStyle(source);
  const replacement = taggedCaptureMapStyle(structuredClone(source));
  assert.equal(first.token, reused.token); assert.equal(reused.token, replacement.token);
});

test('top style token and ready flags cannot substitute for the top rendered frame', async () => {
  const fixture = setup(); fixture.options.timeoutMs = 150;
  const topCanvas = {}; const contains = fixture.root.contains; fixture.root.contains = value => value === topCanvas || contains(value);
  const style = taggedCaptureMapStyle({ version: 8, sources: {}, layers: [{ id: 'top', type: 'background' }] });
  fixture.options.styleExpectation.top = style.token;
  const listeners = new Set(); let renderEnabled = false;
  const release = registerMaonoCaptureStyleRuntime('top', { getCanvas: () => topCanvas, getStyle: () => style.style, isStyleLoaded: () => true, areTilesLoaded: () => true, isMoving: () => false,
    getCenter: () => ({ lng: camera.longitude, lat: camera.latitude }), getZoom: () => camera.zoom, getPitch: () => camera.pitch, getBearing: () => camera.bearing,
    on: (_event, callback) => listeners.add(callback), off: (_event, callback) => listeners.delete(callback), triggerRepaint: () => { if (renderEnabled) setTimeout(() => [...listeners].forEach(callback => callback()), 0); } });
  try {
    const pending = freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze);
    await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(fixture.counts().frozen, 0);
    renderEnabled = true; assert.equal(await pending, 1);
  } finally { release(); }
});

test('two split viewports require each camera and consumed Deck generation', async () => {
  const fixture = setup(); fixture.options.timeoutMs = 150;
  const secondCamera = { ...camera, longitude: 10 };
  fixture.options.views.push({ index: 1, camera: secondCamera });
  const mapCanvas = {}, deckCanvas = {}; const contains = fixture.root.contains; fixture.root.contains = value => value === mapCanvas || value === deckCanvas || contains(value);
  const listeners = new Set();
  const secondMap = { ...fixture.map, getCanvas: () => mapCanvas, getCenter: () => ({ lng: 10, lat: camera.latitude }),
    on: (_event, callback) => listeners.add(callback), off: (_event, callback) => listeners.delete(callback), triggerRepaint: () => setTimeout(() => [...listeners].forEach(callback => callback()), 0) };
  const props = { layers: [] };
  const secondDeck = { ...fixture.deck, canvas: deckCanvas, props, getViewports: () => [secondCamera], redraw: () => acknowledgeMaonoDeckRender(props) };
  recordMaonoDeckRenderInputs(props, { ...fixture.sourceState, visState: { ...fixture.sourceState.visState, filters: [] } });
  const releaseMap = registerMaonoCaptureStyleRuntime('bottom', secondMap, 1), releaseSecondDeck = registerMaonoCaptureDeckRuntime(secondDeck, 1);
  try {
    const pending = freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze);
    await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(fixture.counts().frozen, 0);
    recordMaonoDeckRenderInputs(props, fixture.sourceState); assert.equal(await pending, 1);
  } finally { releaseMap(); releaseSecondDeck(); }
});

test('render witnesses read applied metadata without serializing complete styles every frame', async () => {
  const fixture = setup();
  fixture.map.style = { stylesheet: taggedCaptureMapStyle(undefined).style };
  fixture.map.getStyle = () => { throw new Error('hot path must not clone full style'); };
  assert.equal(await freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze), 1);
});


test('capture unwraps real Kepler versioned config without altering the saved envelope or using live camera', () => {
  const contents = { mapState: camera, visState: { layers: [{ id: 'saved-layer', type: 'point', config: { isVisible: true } }], filters: [{ id: 'saved-filter' }] }, mapStyle: { styleType: 'light' } };
  const serialized = { version: 'v1', config: { version: 'v1', config: structuredClone(contents) }, datasets: [] };
  const before = JSON.stringify(serialized);
  const result = snapshot.prepareThumbnailSnapshot({ mapState: { longitude: 99, latitude: 88, zoom: 1 } }, serialized);
  assert.equal(result.camera.longitude, camera.longitude); assert.equal(result.camera.latitude, camera.latitude);
  assert.equal(result.layers[0].id, 'saved-layer'); assert.equal(result.savedConfig.config.visState.filters[0].id, 'saved-filter');
  assert.equal(JSON.stringify(serialized), before);
  const invalid = { version: 'v1', config: { version: 'v1', config: { visState: {} } }, datasets: [] };
  assert.throws(() => snapshot.prepareThumbnailSnapshot({ mapState: camera }, invalid), /CAPTURE_INVALID_CAMERA/);
});

test('actual KeplerGlSchema serializer roundtrip supplies saved camera to capture', async () => {
  const { KeplerGlSchema } = await import('@kepler.gl/schemas');
  const { visStateReducer, mapStateReducer, mapStyleReducer, uiStateReducer } = await import('@kepler.gl/reducers');
  const real = await import('../src/pages/Kepler/thumbnail/capture-snapshot.ts');
  const init = { type: '@@thumbnail-capture-test' };
  const state = { visState: visStateReducer(undefined, init), mapStyle: mapStyleReducer(undefined, init), uiState: uiStateReducer(undefined, init), mapState: { ...mapStateReducer(undefined, init), ...camera } };
  const schemaSaved = KeplerGlSchema.save(state);
  assert.equal(schemaSaved.config.version, 'v1');
  assert.equal(schemaSaved.config.config.mapState.longitude, camera.longitude);
  const serialized = real.serializeProjectConfig(state);
  const serializedBefore = JSON.stringify(serialized);
  const captured = real.prepareThumbnailSnapshot({ ...state, mapState: { ...camera, longitude: 99 } }, serialized);
  assert.deepEqual(captured.camera, camera);
  assert.deepEqual(captured.savedConfig.config.visState.filters, schemaSaved.config.config.visState.filters);
  assert.equal(JSON.stringify(serialized), serializedBefore);
});


test('missing saved envelope never borrows runtime camera while explicit flat saved input remains supported', () => {
  for (const value of [null, undefined, {}, { version: 'v1', datasets: [] }, { version: 'v1', visState: { layers: [] } }]) {
    assert.throws(() => snapshot.prepareThumbnailSnapshot({ mapState: camera }, value), /CAPTURE_INVALID_CAMERA/);
  }
  assert.deepEqual({ ...snapshot.prepareThumbnailSnapshot({ mapState: { ...camera, longitude: 99 } }, { version: 'v1', mapState: camera, visState: { layers: [] } }).camera }, camera);
});


test('high-zoom camera equality rejects visually stale small pans and retains roundoff/wrap equivalence', () => {
  const view = { longitude: -45, latitude: 60, zoom: 20, pitch: 45, bearing: 180 };
  assert.equal(captureCameraMatches({ ...view, longitude: view.longitude + 0.00009 }, view), false);
  assert.equal(captureCameraMatches({ ...view, latitude: view.latitude + 0.00009 }, view), false);
  assert.equal(captureCameraMatches({ ...view, zoom: view.zoom + 0.00009 }, view), false);
  assert.equal(captureCameraMatches({ ...view, longitude: view.longitude + 1e-12, latitude: view.latitude + 1e-12, zoom: view.zoom + 1e-12 }, view), true);
  assert.equal(captureCameraMatches({ ...view, longitude: view.longitude + 720, bearing: -180 }, view), true);
  assert.equal(captureCameraMatches({ ...view, longitude: NaN }, view), false);
});

test('high-zoom readiness cannot freeze until a small lagging pan reaches the saved camera', async () => {
  const fixture = setup(); fixture.options.timeoutMs = 150;
  const savedCamera = { ...camera, zoom: 20 };
  const laggingCamera = { ...savedCamera, longitude: savedCamera.longitude - 0.00009 };
  fixture.options.camera = savedCamera; fixture.options.views = [{ index: 0, camera: savedCamera }];
  fixture.map.getCenter = () => ({ lng: laggingCamera.longitude, lat: laggingCamera.latitude }); fixture.map.getZoom = () => laggingCamera.zoom;
  fixture.deck.getViewports = () => [laggingCamera];
  const pending = freezeMaonoMapCaptureGeneration(fixture.options, fixture.freeze);
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(fixture.counts().frozen, 0);
  laggingCamera.longitude = savedCamera.longitude; assert.equal(await pending, 1);
});
