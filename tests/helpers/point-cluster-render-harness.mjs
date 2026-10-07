import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as provenance from '../../src/pages/Kepler/clustering/point-cluster-render-provenance.ts';
import * as policy from '../../src/pages/Kepler/clustering/point-cluster-policy.ts';
import * as store from '../../src/pages/Kepler/clustering/point-cluster-store.ts';
import * as adapter from '../../src/pages/Kepler/clustering/point-cluster-native-data-adapter.ts';
import * as controller from '../../src/pages/Kepler/clustering/point-cluster-controller.ts';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../../src/pages/Kepler/clustering/point-cluster-adaptive-layer.ts', import.meta.url), 'utf8').replace('import.meta.env.VITE_POINT_CLUSTERING_V1', '"true"');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const exports = {};
const locals = { './point-cluster-render-provenance.ts': provenance, './point-cluster-policy.ts': policy, './point-cluster-store.ts': store, './point-cluster-native-data-adapter.ts': adapter, './point-cluster-controller.ts': controller };
vm.runInNewContext(compiled, { exports, require: id => locals[id] || require(id), console, Array, Object, Number, Map, Set, Promise });
export const { MaonoAdaptivePointLayer, MaonoAdaptiveGeoJsonLayer, MaonoMaterializedDeckClusterLayer } = exports;
export const camera = { longitude: 0, latitude: 0, zoom: 4, pitch: 0, bearing: 0, width: 960, height: 540 };
export const initialPolicy = { enabled: false, clusterSize: 40, clusterMaxZoom: 12, hysteresis: 0.25, showCount: false };
export function createFixture(kind = 'point', values = [1, 2, 3]) {
  const Class = kind === 'point' ? MaonoAdaptivePointLayer : MaonoAdaptiveGeoJsonLayer;
  const logical = new Class({ id: kind, dataId: 'data', isVisible: true });
  const data = { data: values.map((value, index) => kind === 'point' ? { index, position: [index * 0.01, 0], value } : { type: 'Feature', geometry: { type: 'Point', coordinates: [index * 0.01, 0] }, properties: { value } }), getPosition: row => row.position, getRadius: () => 4, getFillColor: [220, 100, 0], textLabels: [] };
  const gpuFilter = { filterRange: [[0, 100]], filterValueUpdateTriggers: {} };
  const dataset = { gpuFilter };
  const opts = { data, dataset, gpuFilter, mapState: camera, visible: true, interactionConfig: { tooltip: { enabled: true }, brush: { enabled: false, config: { size: 1 } } }, layerCallbacks: {} };
  const state = { visState: { layers: [logical], layerData: [data], datasets: { data: dataset }, filters: [], layerOrder: [0] }, mapState: camera, mapStyle: {} };
  store.loadPointClusterState({ pointClustering: { version: 2, layers: { [kind]: initialPolicy } } });
  return { logical, opts, state, produce: () => logical.renderLayer(opts), saved: () => ({ datasets: [{ info: { id: 'data' }, data: { rows: opts.data.data } }], maono: structuredClone(store.getMaonoConfigForSave()), layers: [{ id: kind, type: kind, config: { dataId: 'data', isVisible: true } }] }) };
}
/** Real installed ClusterLayer/CPUAggregator/ClusterBuilder, with only GPU
 * attribute/context plumbing replaced. Browser tests exercise actual GPU too. */
export function materialize(layer, transferredFrom) {
  layer.context = { viewport: camera };
  layer.getAttributeManager = () => ({ add() {} }); layer.getAttributes = () => ({});
  layer.setState = patch => { layer.state = { ...layer.state, ...patch }; };
  if (transferredFrom) layer.state = transferredFrom.state; else layer.initializeState();
  Object.defineProperty(layer, 'isLoaded', { configurable: true, value: true, writable: true });
  layer.updateState({ props: layer.props, oldProps: transferredFrom?.props || {}, changeFlags: { dataChanged: false, propsChanged: true, updateTriggersChanged: false } });
  return layer.state.cpuAggregator.state;
}
