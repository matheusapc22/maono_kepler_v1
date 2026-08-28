import { addDataToMap, wrapTo } from "@kepler.gl/actions";
import { processGeojson } from "@kepler.gl/processors";
import { useCallback } from "react";
import { useDispatch, useStore } from "react-redux";

import { authorizeMapPanelCommand } from "../map-panel/map-panel-capabilities.ts";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry.ts";
import { useMapPanel } from "../map-panel/MapPanelContext.tsx";
import {
  KEPLER_MAP_ID,
  findRawDataset,
  selectKeplerMapState,
} from "./selectors.ts";
import type { KeplerCommandResult } from "./types.ts";

export type MultiBufferDatasetUpdateInput = {
  dataId: string;
  label: string;
  geoJson: unknown;
};

const MULTIBUFFER_DATASET_PREFIX = "maono_analysis_buffer_buffer-session-";

function failure(
  code: "CAPABILITY_DENIED" | "COMMAND_INVALID" | "MAP_UNAVAILABLE" | "DATASET_NOT_FOUND" | "COMMAND_FAILED",
  reason: string,
): KeplerCommandResult {
  return {
    ok: false,
    code,
    reason,
    command: "updateMultiBufferDataset",
    capability: "previewBuffer",
  };
}

export function useMultiBufferDatasetUpdater() {
  const dispatch = useDispatch();
  const store = useStore();
  const { context } = useMapPanel();

  return useCallback(
    (input: MultiBufferDatasetUpdateInput): KeplerCommandResult => {
      const authorization = authorizeMapPanelCommand(
        context?.capabilities,
        "updateMultiBufferDataset",
        "previewBuffer",
      );
      if (!authorization.ok) {
        return failure(authorization.code, authorization.reason);
      }

      const dataId = String(input.dataId ?? "").trim();
      if (!dataId.startsWith(MULTIBUFFER_DATASET_PREFIX)) {
        return failure(
          "COMMAND_INVALID",
          "Somente datasets identificados como sessão Multibuffer podem ser atualizados por este comando.",
        );
      }

      const rootState = store.getState();
      if (!selectKeplerMapState(rootState)) {
        return failure("MAP_UNAVAILABLE", "A instância do mapa ainda não está disponível.");
      }
      if (!findRawDataset(rootState, dataId)) {
        return failure("DATASET_NOT_FOUND", `O dataset ${dataId} não foi encontrado.`);
      }

      const processed = processGeojson(input.geoJson as any);
      if (!processed) {
        return failure("COMMAND_INVALID", "O GeoJSON agregado do Multibuffer é inválido.");
      }

      try {
        dispatch(
          wrapTo(
            KEPLER_MAP_ID,
            addDataToMap({
              datasets: {
                info: {
                  id: dataId,
                  label: String(input.label || "Multibuffers").trim() || "Multibuffers",
                },
                data: processed,
              },
              options: {
                centerMap: false,
                keepExistingConfig: true,
              },
            }),
          ),
        );

        emitMapPanelTelemetry("map_multibuffer_dataset_updated", {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          source: "kepler-engine-adapter-multibuffer-v1",
          dataId,
        });

        return { ok: true, changed: true };
      } catch (error) {
        return failure(
          "COMMAND_FAILED",
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar a sessão Multibuffer no mapa.",
        );
      }
    },
    [context, dispatch, store],
  );
}
