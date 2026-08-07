import {
  collectionToArray,
  findRawDataset,
  readValue,
} from "./selectors.ts";

export const MAX_DATASET_CSV_ROWS = 250_000;
const FORMULA_PREFIX = /^[=+\-@]/;

export type DatasetCsvExport = {
  filename: string;
  content: string;
  rowCount: number;
};

type RowReader = (index: number) => unknown[];

function safeFilename(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return normalized || "dados-maono";
}

function spreadsheetSafeText(text: string) {
  return FORMULA_PREFIX.test(text.trimStart()) ? `'${text}` : text;
}

function csvCell(value: unknown) {
  if (value == null) return "";
  const serialized =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  const text = spreadsheetSafeText(serialized);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function fieldNames(dataset: unknown) {
  return collectionToArray(
    readValue(dataset, "fields") ??
      readValue(readValue(dataset, "data"), "fields"),
  )
    .map((field) => String(readValue(field, "name") ?? "").trim())
    .filter(Boolean);
}

function createRowReader(dataset: unknown, names: string[]): RowReader {
  const dataContainer = readValue(dataset, "dataContainer") as any;
  if (dataContainer && typeof dataContainer.valueAt === "function") {
    return (index) =>
      names.map((_, columnIndex) => dataContainer.valueAt(index, columnIndex));
  }

  const rows = collectionToArray<any>(readValue(dataset, "allData"));
  return (index) => {
    const row = rows[index];
    if (Array.isArray(row)) {
      return names.map((_, columnIndex) => row[columnIndex]);
    }
    if (row && typeof row === "object") {
      return names.map((name) => readValue(row, name));
    }
    return names.map(() => null);
  };
}

function rowIndexes(dataset: unknown) {
  const filteredIndex = readValue(dataset, "filteredIndex");
  const source =
    filteredIndex == null ? readValue(dataset, "allIndexes") : filteredIndex;
  const indexes = collectionToArray<unknown>(source)
    .map(Number)
    .filter(Number.isInteger);

  if (source != null) return indexes;

  const dataContainer = readValue(dataset, "dataContainer") as any;
  const rawNumRows =
    dataContainer && typeof dataContainer.numRows === "function"
      ? dataContainer.numRows()
      : readValue(dataContainer, "numRows") ??
        readValue(dataContainer, "length");
  const rawRows = collectionToArray(readValue(dataset, "allData"));
  const count = Number.isFinite(Number(rawNumRows))
    ? Number(rawNumRows)
    : rawRows.length;

  return Array.from({ length: Math.max(0, count) }, (_, index) => index);
}

export function buildFilteredDatasetCsv(
  rootState: unknown,
  datasetId: string,
  label = datasetId,
): DatasetCsvExport {
  const dataset = findRawDataset(rootState, datasetId);
  if (!dataset) {
    throw new Error("O dataset selecionado não está disponível para exportação.");
  }

  const names = fieldNames(dataset);
  if (!names.length) {
    throw new Error("O dataset não possui colunas exportáveis.");
  }

  const indexes = rowIndexes(dataset);
  if (indexes.length > MAX_DATASET_CSV_ROWS) {
    throw new Error(
      `A exportação foi limitada a ${MAX_DATASET_CSV_ROWS.toLocaleString("pt-BR")} registros para proteger o navegador.`,
    );
  }

  const readRow = createRowReader(dataset, names);
  const lines = [names.map(csvCell).join(",")];
  for (const rowIndex of indexes) {
    lines.push(readRow(rowIndex).map(csvCell).join(","));
  }

  return {
    filename: `${safeFilename(label)}-filtrado.csv`,
    content: `\uFEFF${lines.join("\r\n")}`,
    rowCount: indexes.length,
  };
}
