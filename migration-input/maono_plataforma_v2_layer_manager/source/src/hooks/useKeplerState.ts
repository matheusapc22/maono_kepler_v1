import { useMemo } from 'react';
import { useSelector } from 'react-redux';

import {
  KEPLER_ID as DEFAULT_KEPLER_ID,
  selectDatasets,
  selectFilters,
  selectLayers,
  selectUiState,
  selectMapState,
} from '../pages/Kepler/keplerBridge';

type AnyRecord = Record<string, any>;

const EMPTY_ARR: any[] = [];
const EMPTY_OBJ: AnyRecord = {};

function toArraySafe(value: any): any[] {
  if (!value) return EMPTY_ARR;
  if (Array.isArray(value)) return value;
  if (typeof value.toArray === 'function') return value.toArray(); // Immutable.List
  return EMPTY_ARR;
}

function toObjectSafe(value: any): AnyRecord {
  if (!value) return EMPTY_OBJ;
  if (typeof value === 'object') return value;
  return EMPTY_OBJ;
}

function toEntriesSafe(value: any): Array<[string, any]> {
  if (!value) return [];
  if (value instanceof Map) return Array.from(value.entries());
  if (typeof value.entrySeq === 'function') return value.entrySeq().toArray(); // Immutable.Map
  if (typeof value === 'object') return Object.entries(value);
  return [];
}

function getFieldName(field: any): string | null {
  if (!field) return null;
  // Immutable.Map
  if (typeof field.get === 'function') return field.get('name') ?? null;
  return field.name ?? null;
}

export type UseKeplerStateOptions = {
  keplerId?: string;
};

/**
 * Hook base: retorna os slices principais do Kepler (vis/ui/map) com fallbacks estáveis.
 */
export function useKeplerSlices(opts: UseKeplerStateOptions = {}) {
  const keplerId = opts.keplerId ?? DEFAULT_KEPLER_ID;

  const uiState = useSelector((state: any) => selectUiState(state, keplerId) ?? EMPTY_OBJ);
  const mapState = useSelector((state: any) => selectMapState(state, keplerId) ?? EMPTY_OBJ);

  // visState “bruto” não é exportado no seu bridge (por design); consumimos dados prontos via seletores.
  const datasets = useSelector((state: any) => selectDatasets(state, keplerId) ?? EMPTY_OBJ);
  const filters = useSelector((state: any) => selectFilters(state, keplerId) ?? EMPTY_ARR);
  const layers = useSelector((state: any) => selectLayers(state, keplerId) ?? EMPTY_ARR);

  return {
    keplerId,
    uiState: toObjectSafe(uiState),
    mapState: toObjectSafe(mapState),
    datasets: toObjectSafe(datasets),
    filters,
    layers,
  };
}

/**
 * UI Maõno consome "listas prontas" (arrays), não estruturas mutáveis/Immutable.
 */
export function useLayers(opts: UseKeplerStateOptions = {}) {
  const { layers } = useKeplerSlices(opts);
  return useMemo(() => toArraySafe(layers), [layers]);
}

export function useFilters(opts: UseKeplerStateOptions = {}) {
  const { filters } = useKeplerSlices(opts);
  return useMemo(() => toArraySafe(filters), [filters]);
}

/**
 * Retorna datasets como objeto e lista de IDs normalizada.
 * (Kepler pode usar Map/Immutable/obj — aqui a UI recebe sempre algo previsível)
 */
export function useDatasets(opts: UseKeplerStateOptions = {}) {
  const { datasets } = useKeplerSlices(opts);

  return useMemo(() => {
    const d = toObjectSafe(datasets);
    const entries = toEntriesSafe(d);
    const ids = entries.map(([id]) => id);
    return { datasets: d, datasetIds: ids };
  }, [datasets]);
}

/**
 * Exemplo do "pronto para consumo": mapa das fields disponíveis por dataset.
 */
export function useDatasetFields(opts: UseKeplerStateOptions = {}) {
  const { datasets } = useKeplerSlices(opts);

  return useMemo(() => {
    const d = toObjectSafe(datasets);
    const entries = toEntriesSafe(d);

    const fieldsByDataId: Record<string, string[]> = {};
    for (const [dataId, ds] of entries) {
      const fields =
        typeof ds?.get === 'function' ? ds.get('fields') : ds?.fields;

      const arr = toArraySafe(fields);
      fieldsByDataId[dataId] = arr
        .map(getFieldName)
        .filter((n): n is string => Boolean(n));
    }

    return fieldsByDataId;
  }, [datasets]);
}

/**
 * Config/estado de UI que costuma ser útil para “modo híbrido”
 */
export function useMapConfig(opts: UseKeplerStateOptions = {}) {
  const { uiState, mapState } = useKeplerSlices(opts);

  return useMemo(() => {
    const activeSidePanel = uiState?.activeSidePanel ?? null;
    const mapControls = uiState?.mapControls ?? EMPTY_OBJ;
    const center = mapState?.center ?? null;
    const zoom = mapState?.zoom ?? null;

    return {
      activeSidePanel,
      mapControls,
      center,
      zoom,
    };
  }, [uiState, mapState]);
}
