import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: [new URL('../src/pages/Projects/components/roadmap-pagination.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { paginateRoadmapTasks, reconcileRoadmapPagination, roadmapPaginationKey } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const filters = { search: '', status: '', priority: '', assigneeId: '', phaseId: '', periodStart: '', periodEnd: '' };

for (const size of [10, 25, 50]) {
  for (const count of [0, 1, size - 1, size, size + 1, 105]) {
    test(`real client paging preserves all ${count} filtered rows at size ${size}`, () => {
      const tasks = Object.freeze(Array.from({ length: count }, (_, id) => Object.freeze({ id })));
      const all = [];
      const totalPages = Math.max(1, Math.ceil(count / size));
      for (let index = 0; index < totalPages; index += 1) {
        const page = paginateRoadmapTasks(tasks, index, size);
        assert.equal(page.total, count); assert.equal(page.totalPages, totalPages);
        assert.equal(page.pageIndex, index); assert.equal(page.pageSize, size);
        assert.equal(page.canGoPrevious, index > 0); assert.equal(page.canGoNext, index < totalPages - 1);
        assert.equal(page.tasks.length, Math.min(size, Math.max(0, count - index * size)));
        all.push(...page.tasks);
      }
      assert.deepEqual(all, tasks);
    });
  }
}

test('query identity includes organization, roadmap and every real filter', () => {
  const key = roadmapPaginationKey(1, 1, filters);
  assert.equal(roadmapPaginationKey('1', 1, filters), key);
  assert.equal(roadmapPaginationKey(1, 1, Object.fromEntries(Object.entries(filters).reverse())), key);
  assert.notEqual(roadmapPaginationKey(2, 1, filters), key);
  assert.notEqual(roadmapPaginationKey(1, 2, filters), key);
  for (const field of Object.keys(filters)) assert.notEqual(roadmapPaginationKey(1, 1, { ...filters, [field]: 'changed' }), key);
});

test('changing filters, roadmap or organization resets to page one while preserving chosen size', () => {
  const key = roadmapPaginationKey(1, 1, filters);
  const current = { queryKey: key, pageIndex: 3, pageSize: 25 };
  for (const nextKey of [roadmapPaginationKey(1, 1, { ...filters, search: 'new' }), roadmapPaginationKey(1, 2, filters), roadmapPaginationKey(2, 1, filters)]) {
    assert.deepEqual(reconcileRoadmapPagination(current, nextKey, 100), { queryKey: nextKey, pageIndex: 0, pageSize: 25 });
  }
});

test('shrinking results clamp persistently and later growth does not resurrect an old page', () => {
  const current = { queryKey: 'same', pageIndex: 3, pageSize: 10 };
  const smaller = reconcileRoadmapPagination(current, 'same', 11);
  assert.deepEqual(smaller, { queryKey: 'same', pageIndex: 1, pageSize: 10 });
  assert.equal(reconcileRoadmapPagination(smaller, 'same', 50), smaller);
  assert.deepEqual(reconcileRoadmapPagination(smaller, 'same', 0), { queryKey: 'same', pageIndex: 0, pageSize: 10 });
});

test('invalid indices and sizes are normalized without recurring NaN state', () => {
  for (const index of [NaN, Infinity, -Infinity, -5]) {
    assert.equal(paginateRoadmapTasks([1, 2], index, 17).pageIndex, 0);
    const state = reconcileRoadmapPagination({ queryKey: 'same', pageIndex: index, pageSize: 17 }, 'same', 2);
    assert.deepEqual(state, { queryKey: 'same', pageIndex: 0, pageSize: 10 });
    assert.equal(reconcileRoadmapPagination(state, 'same', 2), state);
  }
  assert.equal(paginateRoadmapTasks(Array.from({ length: 36 }), 999, 10).pageIndex, 3);
});
