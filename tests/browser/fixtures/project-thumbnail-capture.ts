import { recordMaonoDeckRenderInputs, acknowledgeMaonoDeckRender, taggedCaptureMapStyle, registerMaonoCaptureStyleRuntime, registerMaonoCaptureDeckRuntime } from "../../../src/pages/Kepler/thumbnail/capture-render-generation";
import { captureProjectThumbnail, cancelProjectThumbnailCapture } from '../../../src/pages/Kepler/thumbnail/capture-thumbnail';
import { freezeCompositedPixels, beginFrozenHtmlCapture, encodeCapturePng, generatedTechnicalPreview, releaseCaptureCanvas } from '../../../src/pages/Kepler/thumbnail/capture-pixels';
import { prepareThumbnailSnapshot } from '../../../src/pages/Kepler/thumbnail/capture-snapshot';
import { applyDegradedStateOverlay } from '../../../src/pages/Kepler/thumbnail/capture-overlay';
import { registerMaonoMapRuntime, registerMaonoDeckRuntime, resetMaonoMapVisualReadinessRuntime } from '../../../src/pages/Kepler/map-url-loader/map-visual-readiness';

export { captureProjectThumbnail, cancelProjectThumbnailCapture, freezeCompositedPixels, beginFrozenHtmlCapture, encodeCapturePng, generatedTechnicalPreview, releaseCaptureCanvas, prepareThumbnailSnapshot, applyDegradedStateOverlay };
export const camera = { longitude: 0, latitude: 0, zoom: 2, pitch: 0, bearing: 0 };

let releaseStyle = () => {};
let releaseDeck = () => {};
let releaseExtra: (() => void)[] = [];
export function setup({ dark = false, gpu = false, pitch = 0, width = 960, height = 540, split = false } = {}) {
  resetMaonoMapVisualReadinessRuntime(); releaseStyle(); releaseDeck(); releaseExtra.forEach(release => release()); releaseExtra = [];
  document.body.innerHTML = `<div id="outside" style="position:absolute;left:0;top:0;z-index:99"><canvas width="960" height="540"></canvas></div><div id="editor" class="kepler-gl" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px"><canvas id="base" width="960" height="540" style="position:absolute;width:100%;height:100%;z-index:0"></canvas><canvas id="deck" width="960" height="540" style="position:absolute;width:100%;height:100%;z-index:1"></canvas></div>`;
  const root = document.getElementById('editor')!;
  const base = document.getElementById('base') as HTMLCanvasElement;
  const deckCanvas = document.getElementById('deck') as HTMLCanvasElement;
  const outside = document.querySelector('#outside canvas') as HTMLCanvasElement;
  const outsideCtx = outside.getContext('2d')!; outsideCtx.fillStyle = '#ff00ff'; outsideCtx.fillRect(0, 0, 960, 540);
  if (gpu) {
    const gl = base.getContext('webgl', { preserveDrawingBuffer: true });
    if (!gl) throw new Error('WEBGL_UNAVAILABLE');
    gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  } else {
    const ctx = base.getContext('2d')!;
    ctx.fillStyle = dark ? '#121418' : '#e6e7e8'; ctx.fillRect(0, 0, 960, 540);
    ctx.fillStyle = '#000000'; ctx.fillRect(20, 20, 200, 100);
    ctx.strokeStyle = dark ? '#6d7984' : '#adb8c2'; ctx.lineWidth = 4;
    for (let x = 30; x < 960; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 100, 540); ctx.stroke(); }
  }
  const ctx = deckCanvas.getContext('2d')!;
  // Synthetic already-rendered polygon, cluster, heatmap and tilted-grid pixels.
  // The capture must preserve them exactly, including filters and transparency.
  ctx.fillStyle = 'rgba(30,180,140,0.55)'; ctx.beginPath(); ctx.moveTo(280, 80); ctx.lineTo(500, 110); ctx.lineTo(420, 260); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f8b84e'; ctx.beginPath(); ctx.arc(650, 170, 32, 0, Math.PI * 2); ctx.fill();
  const gradient = ctx.createRadialGradient(220, 380, 0, 220, 380, 95); gradient.addColorStop(0, 'rgba(255,30,50,0.8)'); gradient.addColorStop(1, 'rgba(255,30,50,0)'); ctx.fillStyle = gradient; ctx.fillRect(125, 285, 190, 190);
  ctx.fillStyle = '#826bd7'; ctx.beginPath(); ctx.moveTo(600, 400); ctx.lineTo(720, 320); ctx.lineTo(840, 390); ctx.lineTo(720, 460); ctx.closePath(); ctx.fill();
  const view = { ...camera, pitch };
  const listeners = new Map<string, Set<() => void>>();
  let generation = 1;
  let frameCount = 0;
  const map = { getStyle: () => taggedCaptureMapStyle(undefined)!.style, getCanvas: () => base, isStyleLoaded: () => true, areTilesLoaded: () => true, isMoving: () => false,
    getCenter: () => ({ lng: view.longitude, lat: view.latitude }), getZoom: () => view.zoom, getPitch: () => view.pitch, getBearing: () => view.bearing,
    on(event: string, callback: () => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback); },
    off(event: string, callback: () => void) { listeners.get(event)?.delete(callback); },
    triggerRepaint() { requestAnimationFrame(() => { frameCount++; [...(listeners.get('render') || [])].forEach(callback => callback()); }); } };
  const deck = { canvas: deckCanvas, props: { layers: [], onAfterRender: () => {} }, isInitialized: true, layerManager: { getLayers: () => [{ isLoaded: true }], needsUpdate: () => false }, getViewports: () => [view], setProps(props: any) { Object.assign(this.props, props); }, redraw() { this.props.onAfterRender(); } };
  registerMaonoMapRuntime(map); registerMaonoDeckRuntime(deck); releaseStyle = registerMaonoCaptureStyleRuntime("bottom", map); releaseDeck = registerMaonoCaptureDeckRuntime(deck);
  const savedConfig = { config: { mapState: view, visState: { filters: [{ id: 'visible-only', value: [1, 2] }], layers: ['point', 'geojson', 'heatmap', 'cluster'].map(type => ({ id: type, type, config: { dataId: 'data', isVisible: true, columns: { lat: 'lat', lng: 'lng' } } })) } }, datasets: [{ info: { id: 'data' }, data: { fields: [{ name: 'lat' }, { name: 'lng' }], rows: [[0, 0]] } }] };
  const runtimeState = { visState: savedConfig.config.visState, mapStyle: {}, mapState: view };
  let renderSource: any = runtimeState;
  let automaticCommit = true;
  const renderedProps = { layers: deck.props.layers };
  deck.props.onAfterRender = () => {
    recordMaonoDeckRenderInputs(renderedProps, automaticCommit ? runtimeState : renderSource);
    acknowledgeMaonoDeckRender(renderedProps);
  };
  if (split) {
    base.style.width = "50%"; deckCanvas.style.width = "50%";
    const rightBase = base.cloneNode(false) as HTMLCanvasElement, rightDeck = deckCanvas.cloneNode(false) as HTMLCanvasElement;
    rightBase.id = "right-base"; rightDeck.id = "right-deck"; rightBase.style.left = "50%"; rightDeck.style.left = "50%";
    const context = rightBase.getContext("2d")!; context.fillStyle = "#227755"; context.fillRect(0, 0, 960, 540);
    root.append(rightBase, rightDeck);
    const rightCamera = { ...view, longitude: 10 };
    Object.assign(view, { isSplit: true, isViewportSynced: false, splitMapViewports: [{ ...view }, rightCamera] });
    const rightListeners = new Map<string, Set<() => void>>();
    const rightMap = { ...map, getCanvas: () => rightBase, getCenter: () => ({ lng: 10, lat: 0 }),
      on(event: string, callback: () => void) { if (!rightListeners.has(event)) rightListeners.set(event, new Set()); rightListeners.get(event)!.add(callback); },
      off(event: string, callback: () => void) { rightListeners.get(event)?.delete(callback); },
      triggerRepaint() { requestAnimationFrame(() => [...(rightListeners.get("render") || [])].forEach(callback => callback())); } };
    const rightProps = { layers: [] };
    const rightRuntime = { ...deck, canvas: rightDeck, props: rightProps, getViewports: () => [rightCamera], redraw() { recordMaonoDeckRenderInputs(rightProps, automaticCommit ? runtimeState : renderSource); acknowledgeMaonoDeckRender(rightProps); } };
    releaseExtra.push(registerMaonoCaptureStyleRuntime("bottom", rightMap, 1), registerMaonoCaptureDeckRuntime(rightRuntime, 1));
  }
  const options = { root, editorSessionId: 'fixture', editGeneration: generation, isCurrent: () => generation === 1, timeoutMs: 1000 };
  return { root, runtimeState, delayCommit() { renderSource = { ...runtimeState, visState: { ...runtimeState.visState } }; automaticCommit = false; }, commit() { automaticCommit = true; }, base, deckCanvas, map, deck, savedConfig, options, edit() { generation++; }, frames: () => frameCount, listeners: () => Math.max(0, (listeners.get('render')?.size || 0) - 1) };
}

export async function decode(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, pixels: Array.from(ctx.getImageData(0, 0, image.width, image.height).data) };
  } finally { URL.revokeObjectURL(url); }
}
