import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  LAYER_SIDEBAR_ACCENT_FAMILIES,
  createLayerSidebarAccentRegistry,
  deriveLayerSidebarAccent,
  getLayerSidebarAccent,
  parseLayerSidebarAccents,
  persistLayerSidebarAccents,
  registerLayerSidebarAccents,
  resolveLayerSidebarAccent,
  serializeLayerSidebarAccents,
  toLayerSidebarAccents,
} from '../src/pages/Kepler/components/maono-layer-panel/layer-sidebar-accents.ts';
import {
  buildFilterGroups,
  NEUTRAL_FILTER_ACCENT,
} from '../src/pages/Kepler/components/maono-layer-panel/filters/filter-groups.ts';

const ids = count => Array.from({ length: count }, (_, index) => `layer-${index + 1}`);
const registryFor = count => registerLayerSidebarAccents(createLayerSidebarAccentRegistry(), ids(count));
const dataset = id => ({ id, label: `Base ${id}`, fields: [] });
const filter = (id, dataIds) => ({ id, dataIds, index: 0, value: ['A'], enabled: true });
const layer = (id, dataIds) => ({
  id, label: `Camada ${id}`, dataIds,
  get color() { throw new Error('Sidebar identity must never read cartographic color'); },
});

for (const count of [3, 6, 15]) {
  test(`${count} identities alternate gold, gray and white and vary only controlled shades`, () => {
    const registry = registryFor(count);
    const accents = toLayerSidebarAccents(registry);
    assert.equal(registry.nextSequence, count);
    assert.equal(new Set(accents.values()).size, count);
    for (const [index, id] of ids(count).entries()) {
      assert.equal(accents.get(id), LAYER_SIDEBAR_ACCENT_FAMILIES[index % 3][Math.floor(index / 3)]);
    }
  });
}

test('all 15 shades remain visibly distinct from the dark sidebar surface', () => {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const background = luminance('#0a0f18');
  for (const accent of LAYER_SIDEBAR_ACCENT_FAMILIES.flat()) {
    const hex = accent.match(/#[a-f0-9]{6}/)[0];
    assert.ok((luminance(hex) + 0.05) / (background + 0.05) >= 3, `${hex} must stay perceptible`);
  }
});

test('reorder, rename, hide, selection, search and removal never reassign an existing identity', () => {
  const registry = registryFor(6);
  const original = toLayerSidebarAccents(registry);
  const remaining = ['layer-6', 'layer-3', 'layer-1'];
  assert.equal(registerLayerSidebarAccents(registry, remaining), registry);
  const edited = remaining.map(id => ({ id, label: 'Renamed', isVisible: false, selected: true }));
  const reconciled = registerLayerSidebarAccents(registry, edited.map(item => item.id));
  for (const id of remaining) assert.equal(toLayerSidebarAccents(reconciled).get(id), original.get(id));
  assert.equal(registerLayerSidebarAccents(reconciled, ids(6)), registry, 'removed and re-added IDs retain their colors');
});

test('new and duplicated layers receive the next identity even after a removal', () => {
  const registry = registryFor(3);
  const afterRemoval = registerLayerSidebarAccents(registry, ['layer-1', 'layer-3']);
  const afterCreate = registerLayerSidebarAccents(afterRemoval, ['layer-1', 'layer-3', 'new-id']);
  const afterDuplicate = registerLayerSidebarAccents(afterCreate, ['new-id', 'copy-id']);
  const accents = toLayerSidebarAccents(afterDuplicate);
  assert.equal(accents.get('new-id'), getLayerSidebarAccent(3));
  assert.equal(accents.get('copy-id'), getLayerSidebarAccent(4));
  assert.notEqual(accents.get('copy-id'), accents.get('new-id'));
  assert.equal(registry.nextSequence, 3);
  assert.equal(registry.sequences.has('new-id'), false, 'reconciliation does not mutate render inputs');
});

test('palette cycling handles more than 15 layers without random RGB generation', () => {
  const registry = registryFor(48);
  const accents = toLayerSidebarAccents(registry);
  const allowed = new Set(LAYER_SIDEBAR_ACCENT_FAMILIES.flat());
  assert.equal(new Set(accents.values()).size, 15);
  for (const [index, id] of ids(48).entries()) {
    assert.ok(allowed.has(accents.get(id)));
    assert.equal(accents.get(id), getLayerSidebarAccent(index % 15));
  }
});

test('legacy and storage-disabled fallback is deterministic by ID across reorder and fresh loads', () => {
  const original = registerLayerSidebarAccents(createLayerSidebarAccentRegistry(), ids(15), 'id');
  const reordered = registerLayerSidebarAccents(createLayerSidebarAccentRegistry(), ids(15).reverse(), 'id');
  for (const id of ids(15)) {
    assert.equal(toLayerSidebarAccents(original).get(id), deriveLayerSidebarAccent(id));
    assert.equal(toLayerSidebarAccents(reordered).get(id), deriveLayerSidebarAccent(id));
    assert.equal(resolveLayerSidebarAccent(id), deriveLayerSidebarAccent(id));
  }
});

test('session serialization preserves colors and deleted IDs through reload, with no map metadata', () => {
  const registry = registryFor(6);
  const serialized = serializeLayerSidebarAccents(registry);
  const restored = parseLayerSidebarAccents(serialized);
  assert.deepEqual(restored, registry);
  assert.deepEqual(Object.keys(JSON.parse(serialized)), ['version', 'nextSequence', 'sequences']);
  const reloaded = registerLayerSidebarAccents(restored, ['layer-6', 'layer-2', 'new-after-reload']);
  assert.equal(toLayerSidebarAccents(reloaded).get('layer-6'), getLayerSidebarAccent(5));
  assert.equal(toLayerSidebarAccents(reloaded).get('new-after-reload'), getLayerSidebarAccent(6));
});

test('successful storage writes retain the alternating sequence and exact serialized state', () => {
  const registry = registryFor(6);
  let written;
  const committed = persistLayerSidebarAccents(registry, value => { written = value; });
  assert.equal(committed.registry, registry);
  assert.equal(committed.canPersist, true);
  assert.deepEqual(parseLayerSidebarAccents(written), registry);
});

test('readable but unwritable storage falls back for every ID before a reordered reload', () => {
  // Cover both an empty readable cache and a stale previously written sequence.
  for (const existing of [null, serializeLayerSidebarAccents(registryFor(3))]) {
    const storage = {
      getItem: () => existing,
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    const firstLoad = registerLayerSidebarAccents(
      parseLayerSidebarAccents(storage.getItem()) ?? createLayerSidebarAccentRegistry(), ids(6),
    );
    const firstCommit = persistLayerSidebarAccents(firstLoad, value => storage.setItem(value));
    assert.equal(firstCommit.canPersist, false);
    for (const id of ids(6)) {
      assert.equal(toLayerSidebarAccents(firstCommit.registry).get(id), deriveLayerSidebarAccent(id));
    }
    // Removed IDs remain in the UI registry; all use fallback too, so undo is stable.
    const afterRemoval = registerLayerSidebarAccents(firstCommit.registry, ['layer-6', 'layer-2'], 'id');
    assert.equal(afterRemoval.sequences.size, 6);
    assert.equal(toLayerSidebarAccents(afterRemoval).get('layer-1'), deriveLayerSidebarAccent('layer-1'));
    const reload = registerLayerSidebarAccents(
      parseLayerSidebarAccents(storage.getItem()) ?? createLayerSidebarAccentRegistry(), ids(6).reverse(),
    );
    const reloadCommit = persistLayerSidebarAccents(reload, value => storage.setItem(value));
    for (const id of ids(6)) {
      assert.equal(toLayerSidebarAccents(reloadCommit.registry).get(id), toLayerSidebarAccents(firstCommit.registry).get(id));
    }
    assert.deepEqual(firstLoad, registryFor(6), 'write failure does not mutate render inputs');
  }
});

test('cache validation discards malformed state and cannot accept arbitrary CSS', () => {
  for (const raw of [null, '', '{broken', '[]', '{}', 'null',
    '{"version":2,"nextSequence":0,"sequences":[]}',
    '{"version":1,"nextSequence":-1,"sequences":[]}',
    '{"version":1,"nextSequence":0,"sequences":[["a",0]]}',
    '{"version":1,"nextSequence":2,"sequences":[["a",0],["a",1]]}',
    '{"version":1,"nextSequence":1,"sequences":[["a","red"]]}',
    '{"version":1,"nextSequence":1,"sequences":[["a",-1]]}',
    '{"version":1,"nextSequence":1,"sequences":[["a",0.2]]}',
    '{"version":1,"nextSequence":1,"sequences":[[null,0]]}',
    '{"version":1,"nextSequence":1,"sequences":[["",0]]}',
  ]) assert.equal(parseLayerSidebarAccents(raw), null, raw);
  const specialIds = registerLayerSidebarAccents(createLayerSidebarAccentRegistry(), ['__proto__', 'constructor']);
  assert.deepEqual(parseLayerSidebarAccents(serializeLayerSidebarAccents(specialIds)), specialIds);
});

test('single-layer dataset filters inherit exactly the UI stripe without reading map style', () => {
  const layers = [layer('a', ['data-a']), layer('b', ['data-b'])];
  const accents = toLayerSidebarAccents(registerLayerSidebarAccents(createLayerSidebarAccentRegistry(), ['a', 'b']));
  const conditions = [filter('first', ['data-a']), filter('second', ['data-b'])];
  const groups = buildFilterGroups(conditions, [dataset('data-a'), dataset('data-b')], layers, accents);
  assert.deepEqual(groups.map(group => group.accent), [...accents.values()]);
  assert.equal(groups[0].filters[0], conditions[0]);
  assert.equal(groups[0].layerId, 'a');
});

test('shared, orphan, missing and multi-dataset filters retain neutral identities', () => {
  const conditions = [
    filter('shared', ['shared']), filter('detached', ['detached']),
    filter('missing', ['missing']), filter('multi-layer', ['multi-a']),
    filter('synchronized', ['data-a', 'data-b']), filter('orphan', []),
  ];
  const layers = [
    layer('shared-one', ['shared']), layer('shared-two', ['shared']),
    layer('missing-layer', ['missing']), layer('multi', ['multi-a', 'multi-b']),
  ];
  const groups = buildFilterGroups(conditions, ['shared', 'detached', 'multi-a', 'multi-b'].map(dataset), layers);
  assert.equal(groups.length, conditions.length);
  assert.ok(groups.every(group => group.layerId === null && group.accent === NEUTRAL_FILTER_ACCENT));
  assert.deepEqual(groups.flatMap(group => group.filters).map(item => item.id).sort(), conditions.map(item => item.id).sort());
});

test('row, filters and session hook keep UI identity separate from engine writes', async () => {
  const root = '../src/pages/Kepler/components/maono-layer-panel/';
  const [item, groups, hook, panel, css] = await Promise.all([
    'LayerListItem.tsx', 'filters/filter-groups.ts', 'useLayerSidebarAccents.ts', 'MaonoLayerPanel.tsx', 'maono-layer-panel.css',
  ].map(file => readFile(new URL(root + file, import.meta.url), 'utf8')));
  assert.match(item, /"--layer-accent-color": sidebarAccent/);
  assert.doesNotMatch(item + groups + hook, /layer\.color|fillColor|strokeColor|Math\.random/);
  assert.match(css, /\.maono-layer-row__swatch \{[^}]*background: var\(--layer-accent-color\)/);
  assert.match(css, /\.maono-layer-row\.is-hidden \{ opacity: 1; \}/);
  assert.match(hook, /useLayoutEffect\(\(\) => \{[\s\S]*sessionStorage\.setItem/);
  assert.match(hook, /useLayoutEffect\(\(\) => \{[\s\S]*sessionRegistries\.set/);
  assert.doesNotMatch(hook, /controller|dispatch|localStorage|saveConfig/);
  assert.match(panel, /organization\?\.id[\s\S]*project\?\.id/);
  assert.equal((panel.match(/registerLayer\(value\.layerId\)/g) ?? []).length, 2);
  assert.equal((panel.match(/sidebarAccents=\{sidebarAccents\}/g) ?? []).length, 2);
});
