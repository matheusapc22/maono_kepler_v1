import { collectionToArray, readValue } from "./selectors.ts";

export type DatasetTableReader = {
  fieldNames: string[];
  rowCount: number;
  allIndexes: number[];
  filteredIndexes: number[] | null;
  fieldIndex: (name: string) => number;
  valueAt: (rowIndex: number, columnIndex: number) => unknown;
};

function normalizedIndexes(value: unknown): number[] {
  return collectionToArray<unknown>(value)
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0);
}

function datasetFields(dataset: unknown) {
  return collectionToArray(
    readValue(dataset, "fields") ??
      readValue(readValue(dataset, "data"), "fields"),
  );
}

export function createDatasetTableReader(dataset: unknown): DatasetTableReader {
  const fields = datasetFields(dataset);
  const fieldNames = fields.map((field) =>
    String(readValue(field, "name") ?? "").trim(),
  );
  const dataContainer = readValue(dataset, "dataContainer") as any;
  const rows = collectionToArray<any>(readValue(dataset, "allData"));
  const rawNumRows =
    dataContainer && typeof dataContainer.numRows === "function"
      ? dataContainer.numRows()
      : readValue(dataContainer, "numRows") ??
        readValue(dataContainer, "length");
  const fallbackRowCount = rows.length;
  const rowCount = Number.isFinite(Number(rawNumRows))
    ? Math.max(0, Number(rawNumRows))
    : fallbackRowCount;
  const explicitAllIndexes = normalizedIndexes(readValue(dataset, "allIndexes"));
  const allIndexes = explicitAllIndexes.length
    ? explicitAllIndexes
    : Array.from({ length: rowCount }, (_, index) => index);
  const filteredIndexSource = readValue(dataset, "filteredIndex");
  const filteredIndexes =
    filteredIndexSource == null ? null : normalizedIndexes(filteredIndexSource);

  return {
    fieldNames,
    rowCount,
    allIndexes,
    filteredIndexes,
    fieldIndex(name: string) {
      return fieldNames.indexOf(name);
    },
    valueAt(rowIndex: number, columnIndex: number) {
      if (dataContainer && typeof dataContainer.valueAt === "function") {
        return dataContainer.valueAt(rowIndex, columnIndex);
      }

      const row = rows[rowIndex];
      if (Array.isArray(row)) return row[columnIndex];
      if (row && typeof row === "object") {
        return readValue(row, fieldNames[columnIndex] ?? "");
      }
      return undefined;
    },
  };
}

export function deterministicSampleIndexes(
  indexes: readonly number[],
  maximum: number,
): { indexes: number[]; sampled: boolean } {
  if (indexes.length <= maximum) {
    return { indexes: Array.from(indexes), sampled: false };
  }

  if (maximum <= 1) {
    return { indexes: [indexes[0]], sampled: true };
  }

  const sampled: number[] = [];
  const last = indexes.length - 1;
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round((index * last) / (maximum - 1));
    sampled.push(indexes[sourceIndex]);
  }

  return { indexes: sampled, sampled: true };
}
