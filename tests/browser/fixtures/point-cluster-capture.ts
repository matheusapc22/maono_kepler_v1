import { Deck } from '@deck.gl/core';
import { MaonoAdaptivePointLayer, MaonoAdaptiveGeoJsonLayer } from '../../../src/pages/Kepler/clustering/point-cluster-adaptive-layer';
import { loadPointClusterState, updatePointClusterLayerPolicy, getMaonoConfigForSave, subscribePointClusterStore } from '../../../src/pages/Kepler/clustering/point-cluster-store';
import { pointClusterCaptureExpectation } from '../../../src/pages/Kepler/clustering/point-cluster-render-provenance';
import { acknowledgeMaonoDeckRender, recordMaonoDeckRenderInputs, maonoDeckGenerationAcknowledgment, mapCaptureRenderInputs, taggedCaptureMapStyle, registerMaonoCaptureStyleRuntime, registerMaonoCaptureDeckRuntime } from '../../../src/pages/Kepler/thumbnail/capture-render-generation';
import { captureProjectThumbnail } from '../../../src/pages/Kepler/thumbnail/capture-thumbnail';

export async function setup(kind: 'point' | 'geojson') {
  document.body.innerHTML = '<div id="root" style="position:relative;width:960px;height:540px"><canvas id="base" width="960" height="540" style="position:absolute;inset:0"></canvas><canvas id="deck" style="position:absolute;inset:0"></canvas></div>';
  const root = document.querySelector('#root') as HTMLElement, base = document.querySelector('#base') as HTMLCanvasElement;
  const ctx = base.getContext('2d')!; ctx.fillStyle = '#101827'; ctx.fillRect(0, 0, 960, 540); ctx.fillStyle = '#26384d'; for (let x = 0; x < 960; x += 100) ctx.fillRect(x, 0, 12, 540);
  const camera = { longitude: 0, latitude: 0, zoom: 4, pitch: 0, bearing: 0, width: 960, height: 540 };
  const Class = kind === 'point' ? MaonoAdaptivePointLayer : MaonoAdaptiveGeoJsonLayer;
  const logical = new Class({ id: kind, dataId: 'data', isVisible: true });
  const data = { data: Array.from({ length: 60 }, (_, index) => kind === 'point' ? { index, position: [(index % 10) * 0.2 - 1, Math.floor(index / 10) * 0.2 - 0.5] } : { type: 'Feature', geometry: { type: 'Point', coordinates: [(index % 10) * 0.2 - 1, Math.floor(index / 10) * 0.2 - 0.5] }, properties: { index } }), getPosition: (row: any) => row.position, getRadius: () => 4, getFillColor: [255, 100, 0], textLabels: [] };
  const gpuFilter = { filterRange: [[0, 100]], filterValueUpdateTriggers: {} }, dataset = { gpuFilter };
  const opts = { data, dataset, gpuFilter, mapState: camera, visible: true, interactionConfig: { tooltip: { enabled: true }, brush: { enabled: false, config: { size: 1 } } }, layerCallbacks: {} };
  const state = { visState: { layers: [logical], layerData: [data], datasets: { data: dataset }, filters: [], layerOrder: [0] }, mapState: camera, mapStyle: {} };
  loadPointClusterState({ pointClustering: { version: 2, layers: { [kind]: { enabled: false, clusterSize: 40, clusterMaxZoom: 12, hysteresis: 0.25, showCount: false } } } });
  let generation = 1, frames = 0; const unsubscribe = subscribePointClusterStore(() => generation++);
  let props: any = { layers: [] };
  const errors: string[] = [];
  const deck = new Deck({ canvas: 'deck', width: 960, height: 540, useDevicePixels: false, initialViewState: camera, controller: false, glOptions: { preserveDrawingBuffer: true }, onError: (error: Error) => errors.push(error.message), layers: [] });
  const listeners = new Map<string, Set<() => void>>();
  const map = { getStyle: () => taggedCaptureMapStyle(undefined)!.style, getCanvas: () => base, isStyleLoaded: () => true, areTilesLoaded: () => true, isMoving: () => false,
    getCenter: () => ({ lng: 0, lat: 0 }), getZoom: () => 4, getPitch: () => 0, getBearing: () => 0,
    on(event: string, callback: () => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback); },
    off(event: string, callback: () => void) { listeners.get(event)?.delete(callback); },
    triggerRepaint() { requestAnimationFrame(() => [...(listeners.get('render') || [])].forEach(callback => callback())); } };
  const releaseMap = registerMaonoCaptureStyleRuntime('bottom', map), releaseDeck = registerMaonoCaptureDeckRuntime(deck);
  function saved() { return { datasets: [], maono: structuredClone(getMaonoConfigForSave()), config: { mapState: camera, visState: { layers: state.visState.layers.map(layer => ({ id: layer.id, type: kind, config: { dataId: 'data', isVisible: true } })), filters: [] } } }; }
  function expected() { const value = saved(); return pointClusterCaptureExpectation(value.maono, value.config.visState.layers, state); }
  function commit(empty = false) {
    props = { layers: empty ? [] : logical.renderLayer(opts) }; recordMaonoDeckRenderInputs(props, state);
    const consumed = props;
    deck.setProps({ layers: props.layers, onAfterRender: () => { frames++; acknowledgeMaonoDeckRender(consumed); } });
  }
  function acknowledged() { return Boolean(maonoDeckGenerationAcknowledgment(props.layers, mapCaptureRenderInputs(state), expected())); }
  async function waitFor(predicate: () => boolean) { const deadline = performance.now() + 5000; while (!predicate()) { if (performance.now() > deadline) throw new Error(`Fixture render timeout: ${errors.join(';')}`); await new Promise(resolve => setTimeout(resolve, 10)); } }
  commit(); await waitFor(acknowledged);
  return { state, deck, errors, get frames() { return frames; }, commit, acknowledged, waitFor,
    update(patch: any) { updatePointClusterLayerPolicy(kind, patch, data.data.length); },
    capture() { const current = generation; return captureProjectThumbnail(state, saved(), { root, editorSessionId: 'real-cluster', editGeneration: current, isCurrent: () => current === generation, timeoutMs: 4000 }); },
    remove() { state.visState.layers = []; state.visState.layerData = []; generation++; commit(true); },
    cleanup() { releaseMap(); releaseDeck(); unsubscribe(); deck.finalize(); },
  };
}
export async function pixels(blob: Blob) { const bitmap = await createImageBitmap(blob); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close(); return ctx.getImageData(0, 0, canvas.width, canvas.height).data; }
