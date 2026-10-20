// src/pages/Kepler/keplerBridge.ts
import * as KeplerActions from '@kepler.gl/actions';

type AnyRecord = Record<string, any>;

/**
 * ✅ ID padrão da instância (coerente com src/pages/Kepler/index.tsx)
 */
export const KEPLER_ID = 'map';

export type TxResult =
  | { ok: true; index: number; dataId: string; fieldName: string }
  | { ok: false; reason: string };

const EMPTY_ARR: any[] = [];
const EMPTY_OBJ: AnyRecord = {};

// ----------------------------
// Helpers (Immutable-safe)
// ----------------------------
function toArraySafe(value: any): any[] {
  if (!value) return EMPTY_ARR;
  if (Array.isArray(value)) return value;
  if (typeof value.toArray === 'function') return value.toArray(); // Immutable.List
  return EMPTY_ARR;
}

function toObjectSafe(value: any): AnyRecord {
  if (!value || typeof value !== 'object') return EMPTY_OBJ;
  return value;
}

function getFieldName(field: any): string | null {
  if (!field) return null;
  if (typeof field.get === 'function') return field.get('name') ?? null; // Immutable.Map
  return field.name ?? null;
}

function getFieldType(field: any): string | null {
  if (!field) return null;
  if (typeof field.get === 'function') {
    return (
      field.get('type') ??
      field.get('dataType') ??
      field.get('analyzerType') ??
      null
    );
  }
  return field.type ?? field.dataType ?? field.analyzerType ?? null;
}

/**
 * Filtro de “campo válido” — conservador e tolerante a variações.
 * Aceita string/number/date/time e afins; ignora campos sem nome.
 */
function isValidFilterField(field: any): boolean {
  const name = getFieldName(field);
  if (!name) return false;

  const tRaw = (getFieldType(field) ?? '').toString().toLowerCase();

  // Se não vier type, ainda aceitamos (Kepler às vezes preenche depois)
  if (!tRaw) return true;

  const ALLOW = [
    'string',
    'text',
    'varchar',
    'number',
    'int',
    'integer',
    'float',
    'double',
    'real',
    'boolean',
    'bool',
    'date',
    'datetime',
    'timestamp',
    'time',
  ];

  return ALLOW.some((k) => tRaw.includes(k));
}

function pickAction<T extends (...args: any[]) => any>(
  candidates: Array<T | undefined>
): T | null {
  for (const fn of candidates) if (typeof fn === 'function') return fn;
  return null;
}

// ----------------------------
// Selectors (centralizados)
// ----------------------------
function selectKeplerInstance(state: any, keplerId = KEPLER_ID) {
  return state?.demo?.keplerGl?.[keplerId] ?? null;
}

export function selectVisState(state: any, keplerId = KEPLER_ID) {
  return selectKeplerInstance(state, keplerId)?.visState ?? null;
}

export function selectUiState(state: any, keplerId = KEPLER_ID) {
  return selectKeplerInstance(state, keplerId)?.uiState ?? null;
}

export function selectMapState(state: any, keplerId = KEPLER_ID) {
  return selectKeplerInstance(state, keplerId)?.mapState ?? null;
}

export function selectDatasets(state: any, keplerId = KEPLER_ID) {
  const visState = selectVisState(state, keplerId);
  return visState?.datasets ?? null;
}

export function selectFilters(state: any, keplerId = KEPLER_ID) {
  const visState = selectVisState(state, keplerId);
  return visState?.filters ?? null;
}

export function selectLayers(state: any, keplerId = KEPLER_ID) {
  const visState = selectVisState(state, keplerId);
  return visState?.layers ?? null;
}

/**
 * Lê o array de filters de forma segura (Immutable/List/Array).
 */
export function getFilterArray(filters: any): any[] {
  return toArraySafe(filters);
}

/**
 * Busca dataset por dataId em datasets (Map/Immutable/obj).
 */
function getDatasetById(datasets: any, dataId: string): any | null {
  if (!datasets || !dataId) return null;
  if (typeof datasets.get === 'function') return datasets.get(dataId) ?? null; // Immutable.Map
  return (datasets as AnyRecord)[dataId] ?? null;
}

/**
 * Encontra o primeiro field válido dentro de um dataset (tolerante a Immutable).
 */
function findFirstValidFieldName(dataset: any): string | null {
  const fields =
    typeof dataset?.get === 'function' ? dataset.get('fields') : dataset?.fields;

  const arr = toArraySafe(fields);
  for (const f of arr) {
    if (isValidFilterField(f)) return getFieldName(f);
  }
  return null;
}

/**
 * Retorna o primeiro dataId "pronto" (dataset existe e tem pelo menos 1 field válido).
 * (Fail-fast: evita filtro fantasma)
 */
export function findFirstValidDataId(datasets: any): string | null {
  if (!datasets) return null;

  // Immutable.Map: entrySeq().toArray() => [[key, value], ...]
  if (typeof (datasets as any).entrySeq === 'function') {
    const entries = (datasets as any).entrySeq().toArray() as Array<[string, any]>;
    for (const [dataId, ds] of entries) {
      const fieldName = findFirstValidFieldName(ds);
      if (fieldName) return dataId;
    }
    return null;
  }

  // Plain object
  const obj = toObjectSafe(datasets);
  for (const [dataId, ds] of Object.entries(obj)) {
    const fieldName = findFirstValidFieldName(ds);
    if (fieldName) return dataId;
  }

  return null;
}

// ----------------------------
// ✅ Sprint 3 — Add & Bind (Atomic Transaction)
// ----------------------------
export function addFilterAndBindFirstFieldTx(params: {
  dispatch: (a: any) => any;
  getState: () => any;
  keplerId: string;
  datasets?: any;
  dataId?: string;
}): TxResult {
  const { dispatch, getState, keplerId } = params;
  const state = getState();

  const wrapTo = pickAction<any>([(KeplerActions as any).wrapTo]);
  if (!wrapTo) return { ok: false, reason: 'KeplerActions.wrapTo não disponível.' };

  const addFilter = pickAction<any>([(KeplerActions as any).addFilter]);
  const setFilter = pickAction<any>([
    (KeplerActions as any).setFilter,
    (KeplerActions as any).updateFilter, // fallback comum
  ]);

  if (!addFilter) return { ok: false, reason: 'Action addFilter não disponível nesta versão.' };
  if (!setFilter) return { ok: false, reason: 'Action setFilter/updateFilter não disponível.' };

  // 1) datasets (sempre via selector do bridge)
  const datasets = params.datasets ?? selectDatasets(state, keplerId);
  if (!datasets) return { ok: false, reason: 'Datasets ainda não inicializados.' };

  // 2) dataId
  const dataId = params.dataId ?? findFirstValidDataId(datasets);
  if (!dataId) return { ok: false, reason: 'Nenhum dataset válido (fields ainda não prontos).' };

  // 3) dataset + fieldName
  const dataset = getDatasetById(datasets, dataId);
  if (!dataset) return { ok: false, reason: `Dataset não encontrado: ${dataId}` };

  const fieldName = findFirstValidFieldName(dataset);
  if (!fieldName) return { ok: false, reason: `Dataset ${dataId} não tem field válido para filtro.` };

  // 4) índice do novo filtro (antes do addFilter ser resolvido, o length é o futuro index zero-based)
  const filters = selectFilters(state, keplerId);
  const idx = getFilterArray(filters).length;

  // 5) Dispatch transacional atômico (wrapTo obrigatório)
  dispatch(wrapTo(keplerId, addFilter(dataId)));

  // Bind imediato para evitar "Orphan Filter" e garantir a re-renderização nativa
  try {
    dispatch(wrapTo(keplerId, setFilter(idx, 'dataId', dataId)));
    dispatch(wrapTo(keplerId, setFilter(idx, 'name', fieldName)));
  } catch {
    // Fallback: assinatura alternativa em versões diferentes do vis-state
    try {
      dispatch(wrapTo(keplerId, setFilter(idx, { dataId, name: fieldName })));
    } catch {
      return {
        ok: false,
        reason: 'Falha ao bindar field no filtro (assinatura de setFilter divergente).',
      };
    }
  }

  return { ok: true, index: idx, dataId, fieldName };
}

/**
 * ✅ Compatibilidade com o FilterPanel atual
 */
export function addFilterAndBindFirstField(args: {
  dispatch: (a: any) => any;
  getState: () => any;
  datasets: any;
  dataId: string;
  keplerId: string;
}): { ok: boolean; reason?: string } {
  const r = addFilterAndBindFirstFieldTx({
    dispatch: args.dispatch,
    getState: args.getState,
    keplerId: args.keplerId,
    datasets: args.datasets,
    dataId: args.dataId,
  });

  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true };
}