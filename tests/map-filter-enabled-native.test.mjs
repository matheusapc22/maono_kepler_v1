import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { registerEntry, setFilter, wrapTo } from '@kepler.gl/actions';
import { processRowObject } from '@kepler.gl/processors';
import { keplerGlReducer, visStateUpdaters } from '@kepler.gl/reducers';
import { KeplerTable, assignGpuChannel } from '@kepler.gl/table';
import { getDefaultFilter } from '@kepler.gl/utils';
import { reconcileFilterEnabledState } from '../src/pages/Kepler/reducers/filter-enabled-compatibility.ts';

const rows = ['A', 'A', 'A', 'B', 'B', 'C'].map((category, i) => ({
  category, value: (i + 1) * 10, eligible: i % 2 === 0,
  observed_at: `2026-01-0${i + 1}T00:00:00Z`,
}));
async function table(id = 'a') {
  const result = new KeplerTable({ info: { id }, color: [30, 120, 200] });
  await result.importData({ data: processRowObject(rows) });
  return result;
}
function filterFor(dataset, name, value, existing = []) {
  let result = { ...getDefaultFilter({ dataId: dataset.id }), ...dataset.getColumnFilterProps(name),
    id: `filter-${name}`, name: [name], fieldIdx: [dataset.fields.findIndex(f => f.name === name)], value, enabled: true };
  if (result.gpu) result = assignGpuChannel(result, existing);
  return result;
}
function stateFor(datasets, filters) {
  for (const dataset of Object.values(datasets)) dataset.filterTable(filters, []);
  return { visState: { ...visStateUpdaters.INITIAL_VIS_STATE, datasets, filters, layers: [], layerData: [] } };
}
function nativeUpdate(state, idx, prop, value) {
  return { ...state, visState: visStateUpdaters.setFilterUpdater(state.visState, setFilter(idx, prop, value)) };
}
function update(state, idx, prop, value) { return reconcileFilterEnabledState(nativeUpdate(state, idx, prop, value)); }
function logical(filter) {
  return Object.fromEntries(['id', 'dataId', 'name', 'type', 'value', 'enabled', 'gpu', 'gpuChannel', 'domain', 'fixedDomain']
    .map(key => [key, filter[key]]));
}
// Use the actual native CPU indices and GPU accessor/uniforms supplied to the
// renderer. Numeric/date filters do not reduce filteredIndex on the GPU path.
function renderPopulation(dataset) {
  const accessor = dataset.gpuFilter.filterValueAccessor(dataset.dataContainer)();
  return dataset.filteredIndex.filter(index => accessor({ index }).every((value, channel) =>
    value >= dataset.gpuFilter.filterRange[channel][0] && value <= dataset.gpuFilter.filterRange[channel][1]));
}

for (const [field, value, expected] of [
  ['category', ['B'], [3, 4]], ['eligible', true, [0, 2, 4]],
  ['value', [20, 50], [1, 2, 3, 4]],
  ['observed_at', [Date.parse('2026-01-02T00:00:00Z'), Date.parse('2026-01-05T00:00:00Z')], [1, 2, 3, 4]],
]) {
  test(`native ${field}: disable restores all renderer inputs and enable restores the unchanged rule`, async () => {
    const dataset = await table();
    const rule = filterFor(dataset, field, value);
    const on = stateFor({ a: dataset }, [rule]);
    assert.deepEqual(renderPopulation(on.visState.datasets.a), expected);
    const broken = nativeUpdate(on, 0, 'enabled', false);
    assert.deepEqual(renderPopulation(broken.visState.datasets.a), expected, 'reproduces the native 3.2 bug before compatibility');
    const originalTable = broken.visState.datasets.a;
    const originalRows = originalTable.dataContainer;
    const originalRule = structuredClone(logical(broken.visState.filters[0]));
    const off = reconcileFilterEnabledState(broken);
    assert.notEqual(off.visState.datasets.a, originalTable);
    assert.equal(off.visState.datasets.a.dataContainer, originalRows);
    assert.deepEqual(renderPopulation(off.visState.datasets.a), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(logical(off.visState.filters[0]), originalRule);
    assert.deepEqual(renderPopulation(originalTable), expected, 'original cached table is not mutated');
    assert.equal(reconcileFilterEnabledState(off), off, 'ordinary map actions do not rescan corrected tables');
    const enabled = update(off, 0, 'enabled', true);
    assert.deepEqual(renderPopulation(enabled.visState.datasets.a), expected);
    assert.deepEqual(logical(enabled.visState.filters[0]), logical(rule));
  });
}

test('disabled GPU range stays neutral after another native filter edit and logical rules remain serializable', async () => {
  const dataset = await table();
  const range = filterFor(dataset, 'value', [20, 30]);
  const category = filterFor(dataset, 'category', ['B'], [range]);
  let state = stateFor({ a: dataset }, [range, category]);
  assert.deepEqual(renderPopulation(dataset), []);
  state = update(state, 0, 'enabled', false);
  assert.deepEqual(renderPopulation(state.visState.datasets.a), [3, 4]);
  state = update(state, 1, 'value', ['A']);
  assert.deepEqual(renderPopulation(state.visState.datasets.a), [0, 1, 2]);
  assert.deepEqual(state.visState.filters[0].value, [20, 30]);
  assert.equal(state.visState.filters[0].enabled, false);
  assert.equal(state.visState.filters[0].id, range.id);
  state = update(state, 0, 'enabled', true);
  assert.deepEqual(renderPopulation(state.visState.datasets.a), [1, 2]);
});

test('hydrated disabled filters and synchronized datasets are corrected without touching unrelated tables', async () => {
  const a = await table('a'), b = await table('b'), untouched = await table('unrelated');
  const category = { ...filterFor(a, 'category', ['B']), dataId: ['a', 'b'], name: ['category', 'category'], fieldIdx: [0, 0] };
  let state = stateFor({ a, b, unrelated: untouched }, [category]);
  state = nativeUpdate(state, 0, 'enabled', false);
  const corrected = reconcileFilterEnabledState(state);
  assert.equal(corrected.visState.datasets.unrelated, untouched);
  assert.deepEqual(corrected.visState.filters[0].dataId, ['a', 'b']);
  for (const id of ['a', 'b']) assert.deepEqual(renderPopulation(corrected.visState.datasets[id]), [0, 1, 2, 3, 4, 5]);
  // Re-create native tables with the unchanged disabled rule after hydration.
  const loaded = stateFor({ a: await table('a'), b: await table('b') }, [structuredClone(corrected.visState.filters[0])]);
  const reopened = reconcileFilterEnabledState(loaded);
  for (const id of ['a', 'b']) assert.deepEqual(renderPopulation(reopened.visState.datasets[id]), [0, 1, 2, 3, 4, 5]);
});

test('CPU export cache is refreshed with active rules while raw records and permissions remain untouched', async () => {
  const dataset = await table();
  const range = filterFor(dataset, 'value', [20, 30]);
  const on = stateFor({ a: dataset }, [range]);
  dataset.filterTableCPU([range], []);
  assert.deepEqual(dataset.filteredIdxCPU, [1, 2]);
  const off = update(on, 0, 'enabled', false);
  assert.deepEqual(off.visState.datasets.a.filteredIdxCPU, [0, 1, 2, 3, 4, 5]);
  assert.equal(off.visState.datasets.a.dataContainer, dataset.dataContainer);
  const source = await readFile(new URL('../src/pages/Kepler/reducers/filter-enabled-compatibility.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|capabilities|permissions|generateHashId|\.value\s*=/);
  const reducer = await readFile(new URL('../src/pages/Kepler/reducers/index.ts', import.meta.url), 'utf8');
  assert.match(reducer, /keplerGlReducer\.initialState\([\s\S]*?\}\)\.plugin\(reconcileFilterEnabledState\)/);
  assert.match(reducer, /map: reconcileFilterEnabledState\(keplerGlInstance\)/);
});

test('disabling the only CPU filter restores source indices while a GPU filter remains active', async () => {
  const dataset = await table();
  const category = filterFor(dataset, 'category', ['B']);
  const range = filterFor(dataset, 'value', [20, 50], [category]);
  let state = stateFor({ a: dataset }, [category, range]);
  assert.deepEqual(dataset.filteredIndex, [3, 4]);
  state = update(state, 0, 'enabled', false);
  assert.deepEqual(state.visState.datasets.a.filteredIndex, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(renderPopulation(state.visState.datasets.a), [1, 2, 3, 4]);
  assert.deepEqual(state.visState.filters[1].value, [20, 50]);
  assert.equal(state.visState.filters[1].enabled, true);
});

test('real wrapped reducer plugin executes after native actions without discarding initial UI settings', async () => {
  const reducer = keplerGlReducer.initialState({ uiState: { currentModal: null } }).plugin(reconcileFilterEnabledState);
  let registered = reducer(undefined, registerEntry({ id: 'map' }));
  assert.equal(registered.map.uiState.currentModal, null);
  const dataset = await table();
  const rule = filterFor(dataset, 'category', ['B']);
  registered = { ...registered, map: { ...registered.map, visState: stateFor({ a: dataset }, [rule]).visState } };
  const off = reducer(registered, wrapTo('map', setFilter(0, 'enabled', false)));
  assert.deepEqual(renderPopulation(off.map.visState.datasets.a), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(off.map.visState.filters[0].value, ['B']);
  const on = reducer(off, wrapTo('map', setFilter(0, 'enabled', true)));
  assert.deepEqual(renderPopulation(on.map.visState.datasets.a), [3, 4]);
});
