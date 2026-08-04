import {
  KEPLER_MAP_ID,
  collectionToArray,
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
 * Compatibilidade temporária para consumidores anteriores à Etapa 02.
 * A normalização continua pertencendo exclusivamente ao Engine Adapter.
 */
export { KEPLER_MAP_ID };
export const KEPLER_ID = KEPLER_MAP_ID;

/** @deprecated Acesso bruto permitido somente para integrações legadas. */
export {
  selectKeplerMapState,
  selectKeplerUiState,
  selectKeplerViewportState,
  selectKeplerVisState,
};

/** @deprecated Use useKeplerState ou os seletores públicos do adapter. */
export const selectVisState = selectKeplerVisState;
/** @deprecated Use useKeplerState ou os seletores públicos do adapter. */
export const selectUiState = selectKeplerUiState;
/** @deprecated Use useKeplerState ou os seletores públicos do adapter. */
export const selectMapState = selectKeplerViewportState;

/** @deprecated Retorna coleção bruta apenas para código legado existente. */
export function selectDatasets(state: unknown, keplerId = KEPLER_MAP_ID) {
  void keplerId;
  return readValue(selectKeplerVisState(state), "datasets") ?? null;
}

/** @deprecated Retorna coleção bruta apenas para código legado existente. */
export function selectFilters(state: unknown, keplerId = KEPLER_MAP_ID) {
  void keplerId;
  return readValue(selectKeplerVisState(state), "filters") ?? null;
}

/** @deprecated Retorna coleção bruta apenas para código legado existente. */
export function selectLayers(state: unknown, keplerId = KEPLER_MAP_ID) {
  void keplerId;
  return readValue(selectKeplerVisState(state), "layers") ?? null;
}

export type MaonoLayerSnapshot = MapLayerSummary & {
  color: [number, number, number];
  opacity: number;
  dataId: string | string[] | null;
};

export type MaonoFilterSnapshot = Omit<MapFilterSummary, "dataId"> & {
  dataId: string | string[] | null;
  name: string | string[] | null;
};

export type MaonoDatasetSnapshot = MapDatasetSummary;

export function toMaonoLayerSnapshot(
  layer: MapLayerSummary,
): MaonoLayerSnapshot {
  return {
    ...layer,
    color: layer.style.color,
    opacity: layer.style.opacity,
    dataId:
      layer.dataIds.length > 1 ? layer.dataIds : (layer.dataIds[0] ?? null),
  };
}

export function toMaonoFilterSnapshot(
  filter: MapFilterSummary,
): MaonoFilterSnapshot {
  return {
    ...filter,
    dataId:
      filter.dataIds.length > 1
        ? filter.dataIds
        : (filter.dataIds[0] ?? null),
    name:
      filter.fieldNames.length > 1
        ? filter.fieldNames
        : (filter.fieldNames[0] ?? null),
  };
}

export function normalizeKeplerLayers(
  value: unknown,
  layerOrder?: unknown,
): MaonoLayerSnapshot[] {
  return normalizeEngineLayers(value, layerOrder).map(toMaonoLayerSnapshot);
}

export function normalizeKeplerFilters(value: unknown): MaonoFilterSnapshot[] {
  return normalizeEngineFilters(value).map(toMaonoFilterSnapshot);
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
  return (
    normalizeEngineDatasets(datasets).find((dataset) =>
      dataset.fields.some((field) => field.filterType !== null),
    )?.id ?? null
  );
}
