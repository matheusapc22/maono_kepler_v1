import { useCallback } from "react";
import { useStore } from "react-redux";

import { useMapPanel } from "../map-panel/MapPanelContext.tsx";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry.ts";
import { buildFilteredDatasetCsv } from "./dataset-csv-serializer.ts";

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
        const exported = buildFilteredDatasetCsv(
          store.getState(),
          datasetId,
          label,
        );
        const blob = new Blob([exported.content], {
          type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = exported.filename;
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
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
