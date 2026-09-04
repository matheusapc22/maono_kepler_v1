import {
  addDataToMap,
  replaceDataInMap,
  wrapTo,
} from "@kepler.gl/actions";
import { processCsvData } from "@kepler.gl/processors";
import { useCallback } from "react";
import { useDispatch, useStore } from "react-redux";

import { authorizeMapPanelCommand } from "../map-panel/map-panel-capabilities.ts";
import { useMapPanel } from "../map-panel/MapPanelContext.tsx";
import { createDatasetTableReader } from "./dataset-table-reader.ts";
import {
  KEPLER_MAP_ID,
  findRawDataset,
  readValue,
  selectKeplerMapState,
} from "./selectors.ts";
import type { KeplerCommandResult } from "./types.ts";

export type PointFieldMap = {
  latitude: string;
  longitude: string;
  name?: string | null;
  type?: string | null;
  description?: string | null;
  id?: string | null;
};

export type PointDatasetTarget = {
  dataId: string | null;
  layerId: string | null;
  label: string;
  fieldMap: PointFieldMap;
  createNew?: boolean;
};

export type PointDatasetInput = {
  target: PointDatasetTarget;
  latitude: number;
  longitude: number;
  tempId: string;
  properties: {
    name: string;
    type?: string;
    description?: string;
  };
};

type PointDatasetResult = {
  dataId: string;
  layerId: string | null;
};

type PointCommandFailure = Extract<
  KeplerCommandResult<PointDatasetResult>,
  { ok: false }
>;

function failure(
  command: string,
  capability: "editLayers" | "addData",
  code: "CAPABILITY_DENIED" | "COMMAND_INVALID" | "MAP_UNAVAILABLE" | "DATASET_NOT_FOUND" | "COMMAND_FAILED",
  reason: string,
): PointCommandFailure {
  return { ok: false, code, reason, command, capability };
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvText(headers: string[], rows: unknown[][]) {
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function finiteCoordinate(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function datasetLabel(dataset: unknown, fallback: string) {
  return String(
    readValue(dataset, "label") ??
      readValue(readValue(dataset, "info"), "label") ??
      fallback,
  );
}

function nextRow(
  headers: string[],
  input: PointDatasetInput,
): unknown[] {
  const values = new Map<string, unknown>([
    [input.target.fieldMap.latitude, input.latitude],
    [input.target.fieldMap.longitude, input.longitude],
  ]);

  if (input.target.fieldMap.name) {
    values.set(input.target.fieldMap.name, input.properties.name);
  }
  if (input.target.fieldMap.type) {
    values.set(input.target.fieldMap.type, input.properties.type || "");
  }
  if (input.target.fieldMap.description) {
    values.set(
      input.target.fieldMap.description,
      input.properties.description || "",
    );
  }
  if (input.target.fieldMap.id) {
    values.set(input.target.fieldMap.id, input.tempId);
  }

  return headers.map((field) => values.get(field) ?? null);
}

export function usePointDatasetCommand() {
  const dispatch = useDispatch();
  const store = useStore();
  const { context } = useMapPanel();

  return useCallback(
    (input: PointDatasetInput): KeplerCommandResult<PointDatasetResult> => {
      const command = "createPointFromPin";
      const capability = input.target.createNew ? "addData" : "editLayers";
      const authorization = authorizeMapPanelCommand(
        context?.capabilities,
        command,
        capability,
      );
      if (!authorization.ok) {
        return failure(
          command,
          capability,
          authorization.code,
          authorization.reason,
        );
      }

      const latitude = finiteCoordinate(input.latitude, -90, 90);
      const longitude = finiteCoordinate(input.longitude, -180, 180);
      if (latitude === null || longitude === null) {
        return failure(
          command,
          capability,
          "COMMAND_INVALID",
          "As coordenadas do ponto são inválidas.",
        );
      }
      if (!String(input.properties.name || "").trim()) {
        return failure(
          command,
          capability,
          "COMMAND_INVALID",
          "O nome do ponto é obrigatório.",
        );
      }

      const rootState = store.getState();
      if (!selectKeplerMapState(rootState)) {
        return failure(
          command,
          capability,
          "MAP_UNAVAILABLE",
          "A instância do mapa ainda não está disponível.",
        );
      }

      try {
        if (input.target.createNew) {
          const dataId = `maono_pin_points_${crypto.randomUUID()}`;
          const layerId = `layer_${dataId}`;
          const headers = [
            "latitude",
            "longitude",
            "name",
            "type",
            "description",
            "maono_point_id",
          ];
          const data = processCsvData(
            csvText(headers, [[
              latitude,
              longitude,
              input.properties.name.trim(),
              input.properties.type || "",
              input.properties.description || "",
              input.tempId,
            ]]),
          );
          if (!data) {
            return failure(
              command,
              capability,
              "COMMAND_INVALID",
              "Não foi possível estruturar o novo dataset de pontos.",
            );
          }

          dispatch(
            wrapTo(
              KEPLER_MAP_ID,
              addDataToMap({
                datasets: {
                  info: { id: dataId, label: input.target.label || "Pontos" },
                  data,
                },
                options: {
                  centerMap: false,
                  keepExistingConfig: true,
                },
                config: {
                  version: "v1",
                  config: {
                    visState: {
                      layers: [
                        {
                          id: layerId,
                          type: "point",
                          config: {
                            dataId,
                            label: input.target.label || "Pontos",
                            columns: {
                              lat: "latitude",
                              lng: "longitude",
                            },
                            isVisible: true,
                            color: [197, 160, 89],
                            visConfig: {
                              radius: 10,
                              opacity: 0.8,
                              outline: false,
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              }),
            ),
          );

          return { ok: true, changed: true, value: { dataId, layerId } };
        }

        const dataId = String(input.target.dataId || "").trim();
        if (!dataId) {
          return failure(
            command,
            capability,
            "COMMAND_INVALID",
            "A camada selecionada não possui dataset associado.",
          );
        }
        const dataset = findRawDataset(rootState, dataId);
        if (!dataset) {
          return failure(
            command,
            capability,
            "DATASET_NOT_FOUND",
            `O dataset ${dataId} não foi encontrado.`,
          );
        }

        const reader = createDatasetTableReader(dataset);
        const headers = reader.fieldNames;
        const required = [
          input.target.fieldMap.latitude,
          input.target.fieldMap.longitude,
        ];
        if (required.some((field) => !headers.includes(field))) {
          return failure(
            command,
            capability,
            "COMMAND_INVALID",
            "A camada selecionada não possui os campos geográficos esperados.",
          );
        }

        const rows = reader.allIndexes.map((rowIndex) =>
          headers.map((_, columnIndex) => reader.valueAt(rowIndex, columnIndex)),
        );
        rows.push(nextRow(headers, { ...input, latitude, longitude }));
        const data = processCsvData(csvText(headers, rows));
        if (!data) {
          return failure(
            command,
            capability,
            "COMMAND_INVALID",
            "Não foi possível estruturar o dataset atualizado.",
          );
        }

        dispatch(
          wrapTo(
            KEPLER_MAP_ID,
            replaceDataInMap({
              datasetToReplaceId: dataId,
              datasetToUse: {
                info: {
                  id: dataId,
                  label: datasetLabel(dataset, input.target.label || dataId),
                },
                data,
              },
              options: {
                centerMap: false,
                keepExistingConfig: true,
                autoCreateLayers: false,
              },
            }),
          ),
        );

        return {
          ok: true,
          changed: true,
          value: { dataId, layerId: input.target.layerId },
        };
      } catch (error) {
        return failure(
          command,
          capability,
          "COMMAND_FAILED",
          error instanceof Error
            ? error.message
            : "Não foi possível adicionar o ponto ao mapa.",
        );
      }
    },
    [context?.capabilities, dispatch, store],
  );
}
