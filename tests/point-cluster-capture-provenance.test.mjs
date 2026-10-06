import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture, materialize } from './helpers/point-cluster-render-harness.mjs';
import { pointClusterCaptureExpectation, pointClusterPolicyKey, recordPointClusterLayerProduction, recordPointClusterMaterialization, pointClusterMaterializationCurrent } from '../src/pages/Kepler/clustering/point-cluster-render-provenance.ts';
import { getPointClusterPolicy, loadPointClusterState, updatePointClusterLayerPolicy } from '../src/pages/Kepler/clustering/point-cluster-store.ts';
import { mapCaptureRenderInputs, recordMaonoDeckRenderInputs, acknowledgeMaonoDeckRender, maonoDeckGenerationAcknowledgment } from '../src/pages/Kepler/thumbnail/capture-render-generation.ts';
const expectation = f => { const saved = f.saved(); return pointClusterCaptureExpectation(saved.maono, saved.layers, f.state, saved.datasets); };
function render(f, layers = f.produce()) { for (const layer of layers) Object.defineProperty(layer, 'isLoaded', { configurable: true, value: true, writable: true }); const props = { layers }; recordMaonoDeckRenderInputs(props, f.state); return props; }
function ack(f, props, expected = expectation(f)) { acknowledgeMaonoDeckRender(props); return maonoDeckGenerationAcknowledgment(props.layers, mapCaptureRenderInputs(f.state), expected); }
function readAck(f, props, expected = expectation(f)) { return maonoDeckGenerationAcknowledgment(props.layers, mapCaptureRenderInputs(f.state), expected); }

for (const kind of ['point', 'geojson']) {
  test(`${kind}: same native references cannot acknowledge a newly saved external policy`, () => {
    const f = createFixture(kind), old = render(f), native = mapCaptureRenderInputs(f.state), before = expectation(f);
    assert.ok(ack(f, old, before));
    updatePointClusterLayerPolicy(kind, { enabled: true, clusterSize: 120 }, 3);
    assert.deepEqual(mapCaptureRenderInputs(f.state), native);
    assert.equal(ack(f, old), null);
    // Re-recording a cached object under new callbacks cannot rewrite its receipt.
    recordPointClusterLayerProduction(old.layers, f.logical, f.opts, getPointClusterPolicy(kind), 'points');
    recordMaonoDeckRenderInputs(old, f.state); assert.equal(ack(f, old), null);
    const next = render(f); assert.equal(ack(f, next), null);
    materialize(next.layers[0]);
    assert.equal(readAck(f, next), null, 'materialization cannot retroactively upgrade an undrawn ACK');
    assert.ok(ack(f, next));
    assert.ok(readAck(f, old, before), 'the old receipt retains only its original policy');
  });
  test(`${kind}: cluster size, count labels, disable and null policies require their emitted representation`, () => {
    const f = createFixture(kind); updatePointClusterLayerPolicy(kind, { enabled: true }, 3);
    let previous = render(f); materialize(previous.layers[0]); assert.ok(ack(f, previous));
    for (const patch of [{ clusterSize: 120 }, { showCount: true }, { showCount: false }, { enabled: false }]) {
      updatePointClusterLayerPolicy(kind, patch, 3); assert.equal(ack(f, previous), null);
      const next = render(f); if (getPointClusterPolicy(kind).enabled) materialize(next.layers[0], previous.layers[0]);
      assert.ok(ack(f, next)); previous = next;
    }
    loadPointClusterState(undefined); assert.equal(ack(f, previous), null);
    assert.ok(ack(f, render(f)), 'removing saved extension requires a null-policy production receipt');
  });
  test(`${kind}: reused native aggregation state must rebuild data/filter and old radius cache`, () => {
    const f = createFixture(kind); updatePointClusterLayerPolicy(kind, { enabled: true, clusterSize: 40 }, 3);
    const first = render(f), firstState = materialize(first.layers[0]); assert.ok(ack(f, first));
    const originalBuilder = firstState.clusterBuilder, originalData = firstState.layerData.data;
    updatePointClusterLayerPolicy(kind, { clusterSize: 120 }, 3);
    const second = render(f); const secondState = materialize(second.layers[0], first.layers[0]); assert.ok(ack(f, second));
    assert.notEqual(secondState.clusterBuilder, originalBuilder);
    // Replace dataset/filter while the next props wait for their native update.
    const data = { ...f.opts.data, data: [...f.opts.data.data], getFiltered: row => (kind === 'point' ? row.value : row.properties.value) === 3 ? 1 : 0 };
    const dataset = { gpuFilter: { filterRange: [[0, 3]], filterValueUpdateTriggers: {} } };
    Object.assign(f.opts, { data, dataset, gpuFilter: dataset.gpuFilter });
    f.state.visState = { ...f.state.visState, datasets: { data: dataset }, layerData: [data], filters: [{ id: 'changed' }] };
    updatePointClusterLayerPolicy(kind, { clusterSize: 40 }, 3);
    const third = render(f); third.layers[0].state = second.layers[0].state;
    assert.equal(ack(f, third), null, 'transferred old materialization does not earn new generation');
    assert.equal(recordPointClusterMaterialization(third.layers[0]), false, 'old produced array cannot be relabelled');
    const thirdState = materialize(third.layers[0], second.layers[0]);
    assert.notEqual(thirdState.clusterBuilder, originalBuilder);
    assert.equal(thirdState.layerData.data.reduce((n, cell) => n + cell.points.length, 0), 1);
    assert.ok(ack(f, third));
    // A late older result invalidates the newer frame, even with identical props.
    third.layers[0].state.cpuAggregator.state.layerData = { data: originalData };
    assert.equal(readAck(f, third), null);
    assert.equal(recordPointClusterMaterialization(third.layers[0]), false);
  });
  test(`${kind}: unmaterialized asynchronous fallback cannot attest a saved enabled policy`, () => {
    const f = createFixture(kind); updatePointClusterLayerPolicy(kind, { enabled: true }, 3);
    const data = { ...f.opts.data, data: Promise.resolve(f.opts.data.data) };
    f.opts.data = data; f.state.visState.layerData = [data];
    const props = render(f); assert.equal(ack(f, props), null);
  });
}

test('saved expectation is immutable and never samples a newer live store policy', () => {
  const f = createFixture(), saved = f.saved(), expected = pointClusterCaptureExpectation(saved.maono, saved.layers, f.state, saved.datasets);
  const key = expected.policies.point;
  saved.maono.pointClustering.layers.point.clusterSize = 120;
  updatePointClusterLayerPolicy('point', { enabled: true, clusterSize: 120 }, 3);
  assert.equal(expected.policies.point, key); assert.notEqual(expected.policies.point, pointClusterPolicyKey(getPointClusterPolicy('point')));
  assert.equal(Object.isFrozen(expected.requiredByView[0]), true);
});

test('empty data and removal of the last layer require a new native source/frame acknowledgment', () => {
  const f = createFixture(); updatePointClusterLayerPolicy('point', { enabled: true }, 3);
  const old = render(f); materialize(old.layers[0]); assert.ok(ack(f, old));
  const empty = { ...f.opts.data, data: [] };
  f.state.visState = { ...f.state.visState, layerData: [empty] }; f.opts.data = empty;
  assert.deepEqual(expectation(f).requiredByView[0], []);
  assert.equal(ack(f, old), null);
  assert.ok(ack(f, render(f, [])), 'Kepler omits a genuinely empty dataset before renderLayer');
  f.state.visState = { ...f.state.visState, layers: [], layerData: [] };
  const removed = pointClusterCaptureExpectation(f.saved().maono, [], f.state);
  assert.equal(ack(f, old, removed), null); assert.ok(ack(f, render(f, []), removed));
});

test('missing saved-extension expectation and unmarked produced layer fail closed', () => {
  const f = createFixture(), props = render(f); acknowledgeMaonoDeckRender(props);
  assert.equal(maonoDeckGenerationAcknowledgment(props.layers, mapCaptureRenderInputs(f.state)), null);
  assert.equal(ack(f, render(f, [{ id: 'unproved', props: {} }])), null);
});

test('loaded-state changes cannot force needless native aggregation cache rebuilds', () => {
  const f = createFixture(); updatePointClusterLayerPolicy('point', { enabled: true }, 3);
  const props = render(f); materialize(props.layers[0]); const layer = props.layers[0];
  const before = layer.state.cpuAggregator.state.clusterBuilder; layer.isLoaded = false;
  layer.updateState({ props: layer.props, oldProps: layer.props, changeFlags: {} });
  assert.equal(layer.state.cpuAggregator.state.clusterBuilder, before);
  assert.equal(pointClusterMaterializationCurrent(layer), false); layer.isLoaded = true; assert.ok(ack(f, props));
});

test('replacement props cannot reuse a materialization receipt even with unchanged data identity', () => {
  const f = createFixture(); updatePointClusterLayerPolicy('point', { enabled: true }, 3);
  const props = render(f); materialize(props.layers[0]); assert.ok(ack(f, props));
  const layer = props.layers[0]; layer.props = { ...layer.props, clusterRadius: 120 };
  assert.equal(readAck(f, props), null); assert.equal(recordPointClusterMaterialization(layer), false);
});

test('transient empty prepared data cannot prove an empty saved nonempty or unknown dataset', () => {
  const f = createFixture(), saved = f.saved();
  f.state.visState.layerData = [{ ...f.opts.data, data: [] }];
  for (const datasets of [saved.datasets, [], [{ info: { id: 'other' }, data: { rows: [] } }]]) {
    const expected = pointClusterCaptureExpectation(saved.maono, saved.layers, f.state, datasets);
    assert.deepEqual(expected.requiredByView[0], ['point']);
    assert.equal(ack(f, render(f, []), expected), null);
  }
});

test('native Kepler allData envelope proves only its own saved empty dataset', () => {
  const f = createFixture(), saved = f.saved(); f.state.visState.layerData = [{ data: [] }];
  const empty = [{ version: 'v1', data: { id: 'data', allData: [] } }];
  const expected = pointClusterCaptureExpectation(saved.maono, saved.layers, f.state, empty);
  assert.deepEqual(expected.requiredByView[0], []); assert.ok(ack(f, render(f, []), expected));
  empty[0].data.allData.push([1, 2]);
  assert.deepEqual(pointClusterCaptureExpectation(saved.maono, saved.layers, f.state, empty).requiredByView[0], ['point']);
});

test('duplicate IDs and conflicting serialized dataset representations never prove emptiness', () => {
  const f = createFixture(), saved = f.saved(); f.state.visState.layerData = [{ data: [] }];
  for (const datasets of [
    [{ data: { id: 'data', allData: [] } }, { data: { id: 'data', allData: [[1]] } }],
    [{ info: { id: 'other' }, data: { id: 'data', allData: [] } }],
    [{ data: { id: 'data', allData: [], rows: [[1]] } }],
    [{ data: { id: 'data', cols: [] } }],
  ]) assert.deepEqual(pointClusterCaptureExpectation(saved.maono, saved.layers, f.state, datasets).requiredByView[0], ['point']);
});
