import {
  createDatasetTableReader,
  deterministicSampleIndexes,
} from "./dataset-table-reader.ts";
import {
  compileOtherDatasetFilters,
  rowPassesHistogramRules,
  toFiniteNumericValue,
} from "./filter-rule-evaluator.ts";
import { buildAdaptiveHistogram } from "./histogram-strategies.ts";
import type { MapSmartHistogram } from "./histogram-types.ts";
import {
  collectionToArray,
  findRawDataset,
  normalizeKeplerFilters,
  readValue,
  selectKeplerVisState,
} from "./selectors.ts";

export const MAX_SMART_HISTOGRAM_ROWS = 50_000;
const MAX_CACHE_ENTRIES_PER_DATASET = 32;

const datasetCache = new WeakMap<object, Map<string, MapSmartHistogram>>();

function values(value: unknown): unknown[] {
  const array = collectionToArray<unknown>(value);
  if (array.length) return array;
  return value == null ? [] : [value];
}

function firstString(value: unknown) {
  const normalized = String(values(value)[0] ?? "").trim();
  return normalized || null;
}

function numericDomain(value: unknown): [number, number] | null {
  const pair = values(value).slice(0, 2).map(Number);
  return pair.length === 2 &&
    pair.every(Number.isFinite) &&
    pair[1] > pair[0]
    ? [pair[0], pair[1]]
    : null;
}

function fallbackHistogram(
  rawFilters: unknown,
  filterIndex: number,
  domain: [number, number] | null,
  temporal: boolean,
  reason: string,
): MapSmartHistogram {
  const normalized = normalizeKeplerFilters(rawFilters)[filterIndex];
  const bins = normalized?.histogram ?? [];
  return {
    bins,
    originalDomain: domain,
    displayDomain: domain,
    observedDomain: null,
    observedCount: bins.reduce((total, bin) => total + bin.count, 0),
    scannedRowCount: 0,
    sampleSize: null,
    strategy: bins.length ? "native" : temporal ? "calendar" : "sturges",
    quality: bins.length ? "fallback" : "exact",
    source: bins.length ? "kepler-native" : "empty",
    axisScale: temporal ? "time" : "linear",
    fallbackReason: reason,
  };
}

function cacheForDataset(dataset: object) {
  let cache = datasetCache.get(dataset);
  if (!cache) {
    cache = new Map<string, MapSmartHistogram>();
    datasetCache.set(dataset, cache);
  }
  return cache;
}

function remember(
  dataset: object,
  key: string,
  histogram: MapSmartHistogram,
) {
  const cache = cacheForDataset(dataset);
  if (cache.has(key)) cache.delete(key);
  cache.set(key, histogram);
  while (cache.size > MAX_CACHE_ENTRIES_PER_DATASET) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
  return histogram;
}

function cacheIdentity(dataset: object) {
  const dataContainer = readValue(dataset, "dataContainer");
  return dataContainer && typeof dataContainer === "object"
    ? (dataContainer as object)
    : dataset;
}

export function buildSmartFilterHistogram(
  rootState: unknown,
  filterIndex: number,
): MapSmartHistogram {
  const visState = selectKeplerVisState(rootState);
  const rawFilters = readValue(visState, "filters");
  const rawFilter = collectionToArray<unknown>(rawFilters)[filterIndex];
  const type = String(readValue(rawFilter, "type") ?? "");
  const temporal = type === "timeRange";
  const domain = numericDomain(readValue(rawFilter, "domain"));

  if (!rawFilter || (type !== "range" && type !== "timeRange")) {
    return fallbackHistogram(
      rawFilters,
      filterIndex,
      domain,
      temporal,
      "O filtro não é numérico ou temporal.",
    );
  }

  const datasetId = firstString(readValue(rawFilter, "dataId"));
  const fieldName = firstString(readValue(rawFilter, "name"));
  if (!datasetId || !fieldName) {
    return fallbackHistogram(
      rawFilters,
      filterIndex,
      domain,
      temporal,
      "O filtro ainda não possui dataset e propriedade válidos.",
    );
  }

  const dataset = findRawDataset(rootState, datasetId);
  if (!dataset || typeof dataset !== "object") {
    return fallbackHistogram(
      rawFilters,
      filterIndex,
      domain,
      temporal,
      "O dataset do filtro não está disponível.",
    );
  }

  const reader = createDatasetTableReader(dataset);
  const columnIndex = reader.fieldIndex(fieldName);
  if (columnIndex < 0) {
    return fallbackHistogram(
      rawFilters,
      filterIndex,
      domain,
      temporal,
      "A propriedade do filtro não foi encontrada no dataset.",
    );
  }

  const compiled = compileOtherDatasetFilters(
    rawFilters,
    datasetId,
    filterIndex,
    reader,
  );
  if (compiled.unsupported) {
    return fallbackHistogram(
      rawFilters,
      filterIndex,
      domain,
      temporal,
      "Há outro filtro ativo do mesmo dataset que não pode ser reproduzido pelo motor inteligente.",
    );
  }

  const cacheKey = [
    fieldName,
    type,
    domain?.join(":") ?? "domain:auto",
    reader.rowCount,
    reader.allIndexes.length,
    compiled.signature,
  ].join("|");
  const owner = cacheIdentity(dataset);
  const cached = cacheForDataset(owner).get(cacheKey);
  if (cached) return cached;

  const sample = deterministicSampleIndexes(
    reader.allIndexes,
    MAX_SMART_HISTOGRAM_ROWS,
  );
  const histogramValues: number[] = [];

  for (const rowIndex of sample.indexes) {
    if (!rowPassesHistogramRules(reader, rowIndex, compiled.rules)) continue;
    const numeric = toFiniteNumericValue(reader.valueAt(rowIndex, columnIndex));
    if (numeric !== null) histogramValues.push(numeric);
  }

  const adaptive = buildAdaptiveHistogram(histogramValues, domain, temporal);
  const histogram: MapSmartHistogram = {
    bins: adaptive.bins,
    originalDomain: domain,
    displayDomain: adaptive.displayDomain,
    observedDomain: adaptive.observedDomain,
    observedCount: histogramValues.length,
    scannedRowCount: sample.indexes.length,
    sampleSize: sample.sampled ? sample.indexes.length : null,
    strategy: adaptive.strategy,
    quality: sample.sampled ? "sampled" : "exact",
    source: adaptive.bins.length ? "smart" : "empty",
    axisScale: adaptive.axisScale,
    fallbackReason: null,
  };

  return remember(owner, cacheKey, histogram);
}
