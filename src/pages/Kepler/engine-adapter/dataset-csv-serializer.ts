import { createDatasetTableReader } from "./dataset-table-reader.ts";
import { findRawDataset } from "./selectors.ts";

export const MAX_DATASET_CSV_ROWS = 250_000;
const FORMULA_PREFIX = /^[=+\-@]/;

export type DatasetCsvExport = {
  filename: string;
  content: string;
  rowCount: number;
};

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

export function buildFilteredDatasetCsv(
  rootState: unknown,
  datasetId: string,
  label = datasetId,
): DatasetCsvExport {
  const dataset = findRawDataset(rootState, datasetId);
  if (!dataset) {
    throw new Error("O dataset selecionado não está disponível para exportação.");
  }

  const reader = createDatasetTableReader(dataset);
  const names = reader.fieldNames.filter(Boolean);
  if (!names.length) {
    throw new Error("O dataset não possui colunas exportáveis.");
  }

  const indexes = reader.filteredIndexes ?? reader.allIndexes;
  if (indexes.length > MAX_DATASET_CSV_ROWS) {
    throw new Error(
      `A exportação foi limitada a ${MAX_DATASET_CSV_ROWS.toLocaleString("pt-BR")} registros para proteger o navegador.`,
    );
  }

  const lines = [names.map(csvCell).join(",")];
  for (const rowIndex of indexes) {
    const row = names.map((_, columnIndex) =>
      reader.valueAt(rowIndex, columnIndex),
    );
    lines.push(row.map(csvCell).join(","));
  }

  return {
    filename: `${safeFilename(label)}-filtrado.csv`,
    content: `\uFEFF${lines.join("\r\n")}`,
    rowCount: indexes.length,
  };
}
