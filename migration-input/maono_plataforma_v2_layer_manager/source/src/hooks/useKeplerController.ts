// src/hooks/useKeplerController.ts
import { useCallback } from 'react';
import { useDispatch, useStore } from 'react-redux';
import * as KeplerActions from '@kepler.gl/actions';

import {
  KEPLER_ID as DEFAULT_KEPLER_ID,
  selectDatasets,
  selectLayers,
  addFilterAndBindFirstFieldTx,
} from '../pages/Kepler/keplerBridge';

type AnyRecord = Record<string, any>;

/* =========================================================
   Sprint 5 — Blindagem (Adapter + Fallbacks + Fail Fast)
   ========================================================= */

type ActionFn = (...args: any[]) => any;

function isFn(x: unknown): x is ActionFn {
  return typeof x === 'function';
}

function pickFirstFn<T extends ActionFn>(...candidates: Array<T | undefined | null>): T | null {
  for (const c of candidates) if (isFn(c)) return c;
  return null;
}

function getWrapTo(): ActionFn | null {
  return pickFirstFn((KeplerActions as any).wrapTo);
}

function dispatchWrapped(dispatch: (a: any) => any, keplerId: string, action: any): void {
  const wrapTo = getWrapTo();
  if (!wrapTo) throw new Error('KeplerActions.wrapTo não disponível.');
  dispatch(wrapTo(keplerId, action));
}

/* =========================================================
   Helpers (Immutable-safe)
   ========================================================= */

function toArraySafe(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.toArray === 'function') return value.toArray();
  return [];
}

function getDataset(state: any, keplerId: string, dataId: string) {
  const datasets = selectDatasets(state, keplerId);
  if (!datasets) return null;

  if (typeof (datasets as any).get === 'function') return (datasets as any).get(dataId) ?? null;
  return (datasets as AnyRecord)[dataId] ?? null;
}

function getFieldsFromDataset(ds: any): any[] {
  if (!ds) return [];
  const fields = typeof ds.get === 'function' ? ds.get('fields') : ds.fields;
  return toArraySafe(fields);
}

function getFieldName(field: any): string | null {
  if (!field) return null;
  if (typeof field.get === 'function') return field.get('name') ?? null;
  return field.name ?? null;
}

function findLayerIndexById(layers: any, layerId: string): number {
  const arr = toArraySafe(layers);
  return arr.findIndex((l: any) => {
    const id = typeof l?.get === 'function' ? l.get('id') : l?.id;
    return id === layerId;
  });
}

/* =========================================================
   Sprint 5.2 — DataProcessor (Fail Fast) antes do addDataToMap
   ========================================================= */

export type KeplerField = {
  name: string;
  type?: string;
  format?: string;
};

export type KeplerTableData = {
  fields: KeplerField[];
  rows: any[][];
};

export type KeplerDatasetInput = {
  info: { id: string; label?: string };
  data: any; 
};

type ValidateResult =
  | { ok: true; datasets: KeplerDatasetInput[] }
  | { ok: false; reason: string };

function isNonEmptyString(x: any): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

function isGeoJsonLike(data: any): boolean {
  if (!data || typeof data !== 'object') return false;
  const t = (data as any).type;
  return t === 'FeatureCollection' || t === 'Feature' || t === 'GeometryCollection';
}

function validateTableData(data: any, datasetId: string): string | null {
  if (!data || typeof data !== 'object') return `Dataset ${datasetId}: data inválido.`;

  const fields = (data as any).fields;
  const rows = (data as any).rows;

  if (!Array.isArray(fields) || fields.length === 0) return `Dataset ${datasetId}: fields ausentes ou vazio.`;
  if (!Array.isArray(rows)) return `Dataset ${datasetId}: rows ausentes.`;

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f || typeof f !== 'object') return `Dataset ${datasetId}: field[${i}] inválido.`;
    if (!isNonEmptyString((f as any).name)) return `Dataset ${datasetId}: field[${i}] sem name.`;
  }

  const N = Math.min(rows.length, 200);
  for (let r = 0; r < N; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) return `Dataset ${datasetId}: row[${r}] não é array.`;
    if (row.length !== fields.length) {
      return `Dataset ${datasetId}: row[${r}] tem ${row.length} colunas, mas fields tem ${fields.length}.`;
    }
  }

  return null;
}

function validateDatasetsInput(input: KeplerDatasetInput | KeplerDatasetInput[]): ValidateResult {
  const datasets = Array.isArray(input) ? input : [input];

  if (!datasets.length) return { ok: false, reason: 'Nenhum dataset fornecido.' };

  const ids = new Set<string>();
  for (const d of datasets) {
    const id = d?.info?.id;
    if (!isNonEmptyString(id)) return { ok: false, reason: 'Dataset sem info.id.' };
    if (ids.has(id)) return { ok: false, reason: `Dataset id duplicado: ${id}` };
    ids.add(id);
  }

  for (const d of datasets) {
    const id = d.info.id;

    if (isGeoJsonLike(d.data)) {
      continue;
    }

    const err = validateTableData(d.data, id);
    if (err) return { ok: false, reason: err };
  }

  return { ok: true, datasets };
}

/* =========================================================
   Tipos públicos do controller
   ========================================================= */

export type KeplerTxResult =
  | { ok: true }
  | { ok: false; reason: string };

export type UseKeplerControllerOptions = {
  keplerId?: string;
};

/**
 * Ponte headless: UI chama semânticas, controller valida e dispara actions.
 * Sprint 5: todos os dispatches passam por Adapter (fallbacks) + validação.
 */
export function useKeplerController(opts: UseKeplerControllerOptions = {}) {
  const dispatch = useDispatch();
  const store = useStore() as any;
  const keplerId = opts.keplerId ?? DEFAULT_KEPLER_ID;

  // ---------- Sprint 3 (filtros) ----------
  
  /**
   * Cria um filtro de forma atômica protegendo contra o bug do "Orphan Filter".
   * Fail-Fast embutido: Retorna erro descritivo se os dados não estiverem prontos.
   */
  const createFilterOnFirstValidField = useCallback((dataId?: string): KeplerTxResult => {
    const result = addFilterAndBindFirstFieldTx({
      dispatch,
      getState: store.getState,
      keplerId, // Usa a const derivada do parâmetro ou do default
      dataId,
    });
    
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true };
  }, [dispatch, store, keplerId]);

  const createFilterOnField = useCallback(
    (dataId: string, fieldName: string): KeplerTxResult => {
      if (!dataId) return { ok: false, reason: 'dataId inválido.' };
      if (!fieldName) return { ok: false, reason: 'fieldName inválido.' };

      const state = store.getState();
      const ds = getDataset(state, keplerId, dataId);
      if (!ds) return { ok: false, reason: `Dataset não existe: ${dataId}` };

      const fields = getFieldsFromDataset(ds);
      const fieldExists = fields.some((f) => getFieldName(f) === fieldName);
      if (!fieldExists) return { ok: false, reason: `Field não encontrado em ${dataId}: ${fieldName}` };

      const r = addFilterAndBindFirstFieldTx({
        dispatch,
        getState: store.getState,
        keplerId,
        dataId,
      });
      if (!r.ok) return { ok: false, reason: r.reason };
      return { ok: true };
    },
    [dispatch, store, keplerId]
  );

  // ---------- Sprint 4 (camadas) + Sprint 5 (Adapter) ----------
  const toggleLayerVisibility = useCallback(
    (layerId: string): KeplerTxResult => {
      if (!layerId) return { ok: false, reason: 'layerId inválido.' };

      const state = store.getState();
      const layers = selectLayers(state, keplerId);
      const idx = findLayerIndexById(layers, layerId);
      if (idx < 0) return { ok: false, reason: `Layer não encontrada: ${layerId}` };

      const toggleByIndex = pickFirstFn<ActionFn>(
        (KeplerActions as any).toggleLayerForMap,
        (KeplerActions as any).toggleLayer
      );

      const toggleById = pickFirstFn<ActionFn>(
        (KeplerActions as any).toggleLayerVisibility,
        (KeplerActions as any).setLayerVisibility // fallback futuro
      );

      try {
        if (toggleByIndex) {
          dispatchWrapped(dispatch, keplerId, toggleByIndex(idx));
          return { ok: true };
        }
        if (toggleById) {
          dispatchWrapped(dispatch, keplerId, toggleById(layerId));
          return { ok: true };
        }
        return { ok: false, reason: 'Action de toggle layer não disponível nesta versão.' };
      } catch (e: any) {
        return { ok: false, reason: e?.message || 'Falha ao alternar visibilidade da layer.' };
      }
    },
    [dispatch, store, keplerId]
  );

  const removeLayer = useCallback(
    (layerId: string): KeplerTxResult => {
      if (!layerId) return { ok: false, reason: 'layerId inválido.' };

      const state = store.getState();
      const layers = selectLayers(state, keplerId);
      const idx = findLayerIndexById(layers, layerId);
      if (idx < 0) return { ok: false, reason: `Layer não encontrada: ${layerId}` };

      const removeByIndex = pickFirstFn<ActionFn>((KeplerActions as any).removeLayer);
      const removeById = pickFirstFn<ActionFn>((KeplerActions as any).removeLayerById);

      try {
        if (removeByIndex) {
          dispatchWrapped(dispatch, keplerId, removeByIndex(idx));
          return { ok: true };
        }
        if (removeById) {
          dispatchWrapped(dispatch, keplerId, removeById(layerId));
          return { ok: true };
        }
        return { ok: false, reason: 'Action removeLayer não disponível nesta versão.' };
      } catch (e: any) {
        return { ok: false, reason: e?.message || 'Falha ao remover layer.' };
      }
    },
    [dispatch, store, keplerId]
  );

  const openLayerConfig = useCallback(
    (layerId: string): KeplerTxResult => {
      if (!layerId) return { ok: false, reason: 'layerId inválido.' };

      const state = store.getState();
      const layers = selectLayers(state, keplerId);
      const idx = findLayerIndexById(layers, layerId);
      if (idx < 0) return { ok: false, reason: `Layer não encontrada: ${layerId}` };

      const selectLayer = pickFirstFn<ActionFn>(
        (KeplerActions as any).setSelectedLayer,
        (KeplerActions as any).selectLayer
      );

      const showLayerPanel = pickFirstFn<ActionFn>(
        (KeplerActions as any).showLayerPanel,
        (KeplerActions as any).openLayerPanel
      );

      try {
        if (selectLayer) dispatchWrapped(dispatch, keplerId, selectLayer(idx));
        if (showLayerPanel) dispatchWrapped(dispatch, keplerId, showLayerPanel(idx));

        if (!selectLayer && !showLayerPanel) {
          return { ok: false, reason: 'Actions de abrir painel de layer não disponíveis nesta versão.' };
        }

        return { ok: true };
      } catch (e: any) {
        return { ok: false, reason: e?.message || 'Falha ao abrir configuração da layer.' };
      }
    },
    [dispatch, store, keplerId]
  );

  // ---------- Sprint 5.2 — Entrada de dados segura ----------
  const addDataSafe = useCallback(
    (payload: { datasets: KeplerDatasetInput | KeplerDatasetInput[]; config?: any; options?: any }): KeplerTxResult => {
      const { datasets, config, options } = payload;

      const validated = validateDatasetsInput(datasets);
      if (!validated.ok) return { ok: false, reason: validated.reason };

      const addDataToMap = pickFirstFn<ActionFn>((KeplerActions as any).addDataToMap);
      if (!addDataToMap) return { ok: false, reason: 'KeplerActions.addDataToMap não disponível nesta versão.' };

      try {
        dispatchWrapped(
          dispatch,
          keplerId,
          addDataToMap({
            datasets: validated.datasets,
            config,
            options,
          })
        );
        return { ok: true };
      } catch (e: any) {
        return { ok: false, reason: e?.message || 'Falha ao adicionar dados no Kepler.' };
      }
    },
    [dispatch, keplerId]
  );

  // ---------- Outros (já existiam) ----------
  const setActiveSidePanel = useCallback(
    (panel: string): KeplerTxResult => {
      const setActive = pickFirstFn<ActionFn>(
        (KeplerActions as any).setActiveSidePanel,
        (KeplerActions as any).setSidePanel,
        (KeplerActions as any).toggleSidePanel
      );

      if (!setActive) {
        return { ok: false, reason: 'Actions de side panel não disponíveis nesta versão do Kepler.' };
      }

      try {
        dispatchWrapped(dispatch, keplerId, setActive(panel));
        return { ok: true };
      } catch (e: any) {
        return { ok: false, reason: e?.message || 'Falha ao alterar o painel ativo.' };
      }
    },
    [dispatch, keplerId]
  );

  const assertDatasetReady = useCallback(
    (dataId: string): KeplerTxResult => {
      const state = store.getState();
      const ds = getDataset(state, keplerId, dataId);
      if (!ds) return { ok: false, reason: `Dataset não existe: ${dataId}` };

      const fields = getFieldsFromDataset(ds);
      if (!fields.length) return { ok: false, reason: `Dataset ${dataId} sem fields (ainda processando).` };

      return { ok: true };
    },
    [store, keplerId]
  );

  return {
    keplerId,

    // Sprint 3
    createFilterOnFirstValidField,
    createFilterOnField,

    // Sprint 4 (camadas)
    toggleLayerVisibility,
    removeLayer,
    openLayerConfig,

    // Sprint 5 (blindagem)
    addDataSafe,

    // utilitários
    setActiveSidePanel,
    assertDatasetReady,
  };
}