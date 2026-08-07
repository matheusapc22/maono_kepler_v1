import type { DatasetTableReader } from "./dataset-table-reader.ts";
import { collectionToArray, readValue } from "./selectors.ts";

export type HistogramFilterRule = {
  columnIndex: number;
  type: "range" | "timeRange" | "select" | "multiSelect";
  value: unknown;
};

export type CompiledHistogramRules = {
  rules: HistogramFilterRule[];
  unsupported: boolean;
  signature: string;
};

function valueArray(value: unknown): unknown[] {
  const array = collectionToArray<unknown>(value);
  if (array.length) return array;
  return value == null ? [] : [value];
}

function firstString(value: unknown): string | null {
  const first = valueArray(value)[0];
  const normalized = String(first ?? "").trim();
  return normalized || null;
}

function dataIds(filter: unknown) {
  return valueArray(readValue(filter, "dataId"))
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function filterValue(filter: unknown, type: string): unknown {
  const raw = readValue(filter, "value");
  if (type === "range" || type === "timeRange" || type === "multiSelect") {
    return valueArray(raw);
  }
  if (type === "select") {
    const values = valueArray(raw);
    return values.length <= 1 ? values[0] : values;
  }
  return raw;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === "object") {
    const array = collectionToArray(value);
    if (array.length) return JSON.stringify(array);
  }
  return JSON.stringify(value ?? null);
}

export function compileOtherDatasetFilters(
  rawFilters: unknown,
  datasetId: string,
  excludedIndex: number,
  reader: DatasetTableReader,
): CompiledHistogramRules {
  const rules: HistogramFilterRule[] = [];
  const signatureParts: string[] = [];
  let unsupported = false;

  collectionToArray<unknown>(rawFilters).forEach((filter, index) => {
    if (index === excludedIndex || readValue(filter, "enabled") === false) return;

    const filterDataIds = dataIds(filter);
    if (filterDataIds.length !== 1 || filterDataIds[0] !== datasetId) return;

    const type = String(readValue(filter, "type") ?? "");
    const fieldName = firstString(readValue(filter, "name"));
    if (!fieldName) return;

    const columnIndex = reader.fieldIndex(fieldName);
    if (columnIndex < 0) return;

    if (!["range", "timeRange", "select", "multiSelect"].includes(type)) {
      unsupported = true;
      signatureParts.push(`${index}:${type}:${fieldName}:unsupported`);
      return;
    }

    const value = filterValue(filter, type);
    rules.push({
      columnIndex,
      type: type as HistogramFilterRule["type"],
      value,
    });
    signatureParts.push(`${index}:${type}:${fieldName}:${stableValue(value)}`);
  });

  return {
    rules,
    unsupported,
    signature: signatureParts.join("|"),
  };
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteTemporalValue(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  const numeric = finiteNumber(value);
  if (numeric !== null) return numeric;

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function categoricalValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const array = collectionToArray<unknown>(value);
  if (array.length) return array;
  return value == null ? [] : [value];
}

function includesValue(values: unknown[], candidate: unknown) {
  return values.some((value) => Object.is(value, candidate) || String(value) === String(candidate));
}

export function rowPassesHistogramRules(
  reader: DatasetTableReader,
  rowIndex: number,
  rules: readonly HistogramFilterRule[],
) {
  for (const rule of rules) {
    const cell = reader.valueAt(rowIndex, rule.columnIndex);

    if (rule.type === "range" || rule.type === "timeRange") {
      const converter = rule.type === "timeRange" ? finiteTemporalValue : finiteNumber;
      const pair = categoricalValues(rule.value).slice(0, 2).map(converter);
      if (pair.length !== 2 || pair[0] === null || pair[1] === null) continue;
      const numeric = converter(cell);
      if (numeric === null || numeric < pair[0] || numeric > pair[1]) return false;
      continue;
    }

    const selected = categoricalValues(rule.value);
    if (!selected.length) continue;
    if (!includesValue(selected, cell)) return false;
  }

  return true;
}

export function toFiniteNumericValue(value: unknown): number | null {
  return finiteNumber(value);
}

export function toFiniteHistogramValue(value: unknown, temporal: boolean) {
  return temporal ? finiteTemporalValue(value) : finiteNumber(value);
}
