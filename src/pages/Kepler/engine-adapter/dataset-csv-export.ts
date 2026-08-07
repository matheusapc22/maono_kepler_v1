import { useCallback } from "react";
import { useStore } from "react-redux";

import { useMapPanel } from "../map-panel/MapPanelContext.tsx";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry.ts";
import {
  collectionToArray,
  findRawDataset,
  readValue,
} from "./selectors.ts";

const MAX_EXPORT_ROWS = 250_000;

type CsvExport = {
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

function csvCell(value: unknown) {
  if (value == null) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function fieldNames(dataset: unknown) {
  return collectionToArray(
    readValue(dataset, "fields") ?? readValue(readValue(dataset, "data"), "fields"),
  )
    .map((field) => String(readValue(field, "name") ?? "").trim())
    .filter(Boolean);
}

function containerRow(dataset: unknown, index: number, names: string[]) {
  const dataContainer = readValue(dataset, "dataContainer") as any;
  if (dataContainer && typeof dataContainer.valueAt === "function") {
    return names.map((_, columnIndex) => dataContainer.valueAt(index, columnIndex));
  }

  const rows = collectionToArray<any>(readValue(dataset, "allData"));
  const row = rows[index];
  if (Array.isArray(row)) return names.map((_, columnIndex) => row[columnIndex]);
  if (row && typeof row === "object") {
    return names.map((name) => readValue(row, name));
  }
  return names.map(() => null);
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
      : readValue(dataContainer, "numRows") ?? readValue(dataContainer, "length");
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
): CsvExport {
  const dataset = findRawDataset(rootState, datasetId);
  if (!dataset) {
    throw new Error("O dataset selecionado não está disponível para exportação.");
  }

  const names = fieldNames(dataset);
  if (!names.length) {
    throw new Error("O dataset não possui colunas exportáveis.");
  }

  const indexes = rowIndexes(dataset);
  if (indexes.length > MAX_EXPORT_ROWS) {
    throw new Error(
      `A exportação foi limitada a ${MAX_EXPORT_ROWS.toLocaleString("pt-BR")} registros para proteger o navegador.`,
    );
  }

  const lines = [names.map(csvCell).join(",")];
  for (const rowIndex of indexes) {
    lines.push(containerRow(dataset, rowIndex, names).map(csvCell).join(","));
  }

  return {
    filename: `${safeFilename(label)}-filtrado.csv`,
    content: `\uFEFF${lines.join("\r\n")}`,
    rowCount: indexes.length,
  };
}

export function useDatasetCsvExport() {
  const store = useStore();
  const { context } = useMapPanel();

  return useCallback(
    (datasetId: string, label: string) => {
      if (
        context?.capabilities?.viewLayers !== true &&
        context?.capabilities?.viewFilters !== true
      ) {
        return {
          ok: false as const,
          reason: "A exportação não foi autorizada para este mapa.",
        };
      }

      try {
        const exported = buildFilteredDatasetCsv(store.getState(), datasetId, label);
        const blob = new Blob([exported.content], {
          type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = exported.filename;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);

        emitMapPanelTelemetry("map_dataset_csv_exported", {
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          rowCount: exported.rowCount,
          source: "maono-layer-panel-compact-v1",
        });

        return {
          ok: true as const,
          rowCount: exported.rowCount,
        };
      } catch (error) {
        return {
          ok: false as const,
          reason:
            error instanceof Error
              ? error.message
              : "Não foi possível exportar os dados filtrados.",
        };
      }
    },
    [context, store],
  );
}
