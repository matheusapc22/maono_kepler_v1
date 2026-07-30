import {
  KEPLER_MAP_ID,
  collectionToArray,
  filterableFields,
  normalizeKeplerDatasets as normalizeEngineDatasets,
  normalizeKeplerFilters as normalizeEngineFilters,
  normalizeKeplerLayers as normalizeEngineLayers,
  readValue,
  selectKeplerMapState,
  selectKeplerUiState,
  selectKeplerViewportState,
  selectKeplerVisState,
} from "../engine-adapter/selectors.ts";
import type {
  MapDatasetSummary,
  MapFilterSummary,
  MapLayerSummary,
} from "../engine-adapter/types.ts";

/**
 * Facade temporário para consumidores anteriores ao Engine Adapter v2.
 * Novos componentes devem importar de ../engine-adapter.
 */
export { KEPLER_MAP_ID };
export const KEPLER_ID = KEPLER_MAP_ID;

export {
  selectKeplerMapState,
  selectKeplerUiState,
  selectKeplerViewportState,
  selectKeplerVisState,
};

export const selectVisState = selectKeplerVisState;
export const selectUiState = selectKeplerUiState;
export const selectMapState = selectKeplerViewportState;

export function selectDatasets(state: any, _keplerId = KEPLER_MAP_ID) {
  return readValue(selectKeplerVisState(state), "datasets") ?? null;
}

export function selectFilters(state: any, _keplerId = KEPLER_MAP_ID) {
  return readValue(selectKeplerVisState(state), "filters") ?? null;
}

export function selectLayers(state: any, _keplerId = KEPLER_MAP_ID) {
  return readValue(selectKeplerVisState(state), "layers") ?? null;
}

export type MaonoLayerSnapshot = MapLayerSummary & {
  color: [number, number, number];
  opacity: number;
  dataId: string | string[] | null;
};

export type MaonoFilterSnapshot = MapFilterSummary & {
  dataId: string | string[] | null;
  name: string | string[] | null;
};

export type MaonoDatasetSnapshot = MapDatasetSummary;

export function normalizeKeplerLayers(
  value: unknown,
  layerOrder?: unknown,
): MaonoLayerSnapshot[] {
  return normalizeEngineLayers(value, layerOrder).map((layer) => ({
    ...layer,
    color: layer.style.color,
    opacity: layer.style.opacity,
    dataId:
      layer.dataIds.length > 1 ? layer.dataIds : (layer.dataIds[0] ?? null),
  }));
}

export function normalizeKeplerFilters(value: unknown): MaonoFilterSnapshot[] {
  return normalizeEngineFilters(value).map((filter) => ({
    ...filter,
    dataId:
      filter.dataIds.length > 1 ? filter.dataIds : (filter.dataIds[0] ?? null),
    name:
      filter.fieldNames.length > 1
        ? filter.fieldNames
        : (filter.fieldNames[0] ?? null),
  }));
}

export function normalizeKeplerDatasets(
  value: unknown,
): MaonoDatasetSnapshot[] {
  return normalizeEngineDatasets(value);
}

export function getFilterArray(filters: unknown) {
  return collectionToArray(filters);
}

export function findFirstValidDataId(datasets: unknown): string | null {
  const entries =
    datasets && typeof (datasets as any).entrySeq === "function"
      ? (datasets as any).entrySeq().toArray()
      : datasets instanceof Map
        ? Array.from(datasets.entries())
        : Object.entries(
            (datasets && typeof datasets === "object"
              ? datasets
              : {}) as Record<string, unknown>,
          );

  for (const [key, dataset] of entries as Array<[string, any]>) {
    if (filterableFields(dataset).length) {
      return String(readValue(dataset, "id") ?? key);
    }
  }

  return null;
}
