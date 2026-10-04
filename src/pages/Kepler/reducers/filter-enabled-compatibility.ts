import { visStateUpdaters } from "@kepler.gl/reducers";
import type { VisState } from "@kepler.gl/schemas";
import { copyTableAndUpdate } from "@kepler.gl/table";
import { applyFiltersToDatasets, removeFilterPlot, updateFilterPlot } from "@kepler.gl/utils";

function containsDisabledFilter(record: unknown): boolean {
  return Boolean(record && typeof record === "object" &&
    Object.values(record).some((items) => Array.isArray(items) &&
      items.some((filter) => filter?.enabled === false)));
}

/** Kepler 3.2's diffFilters does not compare `enabled`, and its GPU evaluator
 * includes disabled rules. Keep the logical filters intact, but rebuild only
 * affected tables using active filters whenever native evaluation leaves an
 * inactive rule in its cache. This also covers hydration and later edits to
 * another filter, without replacing Kepler's operators or data algorithms. */
export function reconcileFilterEnabledState<T extends { visState?: VisState }>(state: T): T {
  const visState = state.visState;
  if (!visState?.filters?.some((filter) => filter.enabled === false)) return state;

  const candidateIds = new Set(visState.filters
    .filter((filter) => filter.enabled === false)
    .flatMap((filter) => Array.isArray(filter.dataId) ? filter.dataId : [filter.dataId]));
  const affectedIds = [...candidateIds].filter((id) => {
    const table = visState.datasets[id];
    return table && (!table.filterRecord || containsDisabledFilter(table.filterRecord) ||
      containsDisabledFilter(table.filterRecordCPU));
  });
  if (!affectedIds.length) return state;

  const logicalFilters = visState.filters;
  const activeFilters = logicalFilters.filter((filter) => filter.enabled !== false);
  const clonedDatasets = { ...visState.datasets };
  for (const id of affectedIds) {
    // The original table, row storage, IDs, rules and unrelated datasets are
    // never mutated. Native table methods own CPU/GPU evaluation and domains.
    clonedDatasets[id] = copyTableAndUpdate(visState.datasets[id], {
      filterRecord: undefined,
      filterRecordCPU: undefined,
      filteredIdxCPU: undefined,
      // With GPU-only active rules, the native CPU pass legitimately skips.
      // Start from the complete source index rather than an old CPU subset.
      filteredIndex: visState.datasets[id].allIndexes,
      filteredIndexForDomain: visState.datasets[id].allIndexes,
    });
  }
  const datasets = applyFiltersToDatasets(
    affectedIds, clonedDatasets, activeFilters, visState.layers,
  );
  for (const id of affectedIds) {
    if (visState.datasets[id].filteredIdxCPU !== undefined) {
      datasets[id].filterTableCPU(activeFilters, visState.layers);
    }
  }
  const updated = visStateUpdaters.updateAllLayerDomainData(
    { ...visState, datasets, filters: activeFilters }, affectedIds,
  );
  const filters = logicalFilters.map((filter) => {
    const dataIds = Array.isArray(filter.dataId) ? filter.dataId : [filter.dataId];
    const refreshIds = dataIds.filter((id) => affectedIds.includes(id));
    if (!refreshIds.length) return filter;
    const withoutStalePlots = refreshIds.reduce(
      (current, id) => removeFilterPlot(current, id), filter,
    );
    return updateFilterPlot(datasets, withoutStalePlots);
  });
  return { ...state, visState: { ...updated, filters } };
}
