import {
  addDataToMap,
  interactionConfigChange,
  layerVisConfigChange,
  layerVisualChannelConfigChange,
  removeDataset as removeKeplerDataset,
  wrapTo,
} from "@kepler.gl/actions";
import { processGeojson } from "@kepler.gl/processors";

import { authorizeMapPanelCommand } from "../map-panel/map-panel-capabilities.ts";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry.ts";
import type {
  MapCapabilities,
  MapPanelContextValue,
} from "../map-panel/types.ts";
import {
  KEPLER_MAP_ID,
  collectionToArray,
  findRawDataset,
  findRawLayer,
  readValue,
  selectKeplerMapState,
  selectKeplerVisState,
} from "./selectors.ts";
import type {
  AddGeoJsonLayerInput,
  KeplerCommandErrorCode,
  KeplerCommandResult,
  MapAnalysisKind,
  MapRgbColor,
} from "./types.ts";

type AnalysisCommandDependencies = {
  dispatch: (action: any) => unknown;
  getState: () => any;
  capabilities: Partial<MapCapabilities> | null | undefined;
  context?: MapPanelContextValue | null;
  isTransientDataset: (dataId: string) => boolean;
  markTransientDataset: (dataId: string) => void;
  markPersistentDataset: (dataId: string) => void;
  now?: () => number;
  random?: () => number;
};

class AnalysisCommandFailure extends Error {
  code: KeplerCommandErrorCode;

  constructor(code: KeplerCommandErrorCode, message: string) {
    super(message);
    this.name = "AnalysisCommandFailure";
    this.code = code;
  }
}

function fail(code: KeplerCommandErrorCode, message: string): never {
  throw new AnalysisCommandFailure(code, message);
}

function nonEmptyText(value: unknown, label: string, maximumLength = 160) {
  const normalized = String(value ?? "").trim();
  if (!normalized) fail("COMMAND_INVALID", `${label} é obrigatório.`);
  if (normalized.length > maximumLength) {
    fail(
      "COMMAND_INVALID",
      `${label} deve ter no máximo ${maximumLength} caracteres.`,
    );
  }
  return normalized;
}

function boundedNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    fail(
      "COMMAND_INVALID",
      `${label} deve estar entre ${minimum} e ${maximum}.`,
    );
  }
  return parsed;
}

function rgbColor(value: MapRgbColor, label: string): MapRgbColor {
  if (!Array.isArray(value) || value.length !== 3) {
    fail("COMMAND_INVALID", `${label} deve possuir três canais RGB.`);
  }
  return value.map((channel) =>
    Math.round(boundedNumber(channel, label, 0, 255)),
  ) as MapRgbColor;
}

function normalizedAnalysisKind(value: unknown): MapAnalysisKind {
  if (value === "isochrone" || value === "buffer") return value;
  fail(
    "COMMAND_INVALID",
    "Toda camada transitória de análise deve informar analysisKind válido.",
  );
}

function analysisCapability(
  kind: MapAnalysisKind,
  phase: "preview" | "persist",
): keyof MapCapabilities {
  if (kind === "buffer") {
    return phase === "persist" ? "persistBuffer" : "previewBuffer";
  }
  return phase === "persist" ? "persistIsochrone" : "previewIsochrone";
}

function rawFields(dataset: any) {
  return collectionToArray<any>(
    readValue(dataset, "fields") ??
      readValue(readValue(dataset, "data"), "fields"),
  );
}

function rawField(dataset: any, fieldName: string) {
  return rawFields(dataset).find(
    (field) => String(readValue(field, "name") ?? "") === fieldName,
  );
}

function objectValue(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value.toJS === "function") return value.toJS();
  if (typeof value === "object") return { ...value };
  return {};
}

function interactionConfigPatch(
  value: Record<string, unknown>,
): Parameters<typeof interactionConfigChange>[0] {
  // Kepler 3.1 restringe `id` a uma union literal, mas o reducer recebe
  // snapshots vindos do próprio estado. Mantemos o cast isolado na borda
  // do adapter, sem propagar `any` para o contrato Maõno.
  return value as unknown as Parameters<typeof interactionConfigChange>[0];
}

function normalizePalette(colors: unknown) {
  if (!Array.isArray(colors) || colors.length < 2 || colors.length > 12) {
    fail(
      "COMMAND_INVALID",
      "A paleta da análise deve possuir entre 2 e 12 cores.",
    );
  }
  const normalized = colors.map((color) => String(color ?? "").trim().toUpperCase());
  if (normalized.some((color) => !/^#[0-9A-F]{6}$/.test(color))) {
    fail("COMMAND_INVALID", "A paleta da análise contém uma cor inválida.");
  }
  return normalized;
}

export function createAnalysisLayerCommands(
  dependencies: AnalysisCommandDependencies,
) {
  const {
    dispatch,
    getState,
    capabilities,
    context,
    isTransientDataset,
    markTransientDataset,
    markPersistentDataset,
    now = Date.now,
    random = Math.random,
  } = dependencies;

  function telemetry(
    event: "map_panel_command_denied" | "map_panel_command_executed",
    command: string,
    capability: keyof MapCapabilities,
    code?: string,
  ) {
    emitMapPanelTelemetry(event, {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      policyVersion: context?.policyVersion ?? null,
      command,
      capability,
      code: code ?? null,
      source: "kepler-analysis-layer-adapter-v1",
    });
  }

  function run<T>(
    command: string,
    capability: keyof MapCapabilities,
    execute: () => T | undefined,
  ): KeplerCommandResult<T> {
    const authorization = authorizeMapPanelCommand(
      capabilities,
      command,
      capability,
    );
    if (!authorization.ok) {
      telemetry(
        "map_panel_command_denied",
        command,
        capability,
        authorization.code,
      );
      return {
        ok: false,
        code: authorization.code,
        reason: authorization.reason,
        command,
        capability,
      };
    }

    try {
      if (!selectKeplerMapState(getState())) {
        fail("MAP_UNAVAILABLE", "A instância do mapa ainda não está disponível.");
      }
      const value = execute();
      telemetry("map_panel_command_executed", command, capability);
      return value === undefined
        ? { ok: true, changed: true }
        : { ok: true, changed: true, value };
    } catch (error) {
      const failure =
        error instanceof AnalysisCommandFailure
          ? error
          : new AnalysisCommandFailure(
              "COMMAND_FAILED",
              error instanceof Error
                ? error.message
                : "O Kepler recusou o comando de análise.",
            );
      telemetry("map_panel_command_denied", command, capability, failure.code);
      return {
        ok: false,
        code: failure.code,
        reason: failure.message,
        command,
        capability,
      };
    }
  }

  function dispatchKepler(action: any) {
    if (!action || typeof action !== "object") {
      fail(
        "KEPLER_ACTION_UNAVAILABLE",
        "A ação de análise não está disponível nesta versão do Kepler.",
      );
    }
    dispatch(wrapTo(KEPLER_MAP_ID, action));
  }

  function requireDataset(dataId: string) {
    const dataset = findRawDataset(getState(), dataId);
    if (!dataset) {
      fail("DATASET_NOT_FOUND", `O dataset ${dataId} não foi encontrado.`);
    }
    return dataset;
  }

  function configurePresentation(
    dataId: string,
    layerId: string,
    input: AddGeoJsonLayerInput,
  ) {
    const presentation = input.presentation;
    if (!presentation) return;

    const dataset = requireDataset(dataId);
    const available = new Set(
      rawFields(dataset).map((field) => String(readValue(field, "name") ?? "")),
    );

    if (presentation.tooltipFields?.length) {
      const tooltipFields = Array.from(
        new Set(
          presentation.tooltipFields.map((field) =>
            nonEmptyText(field, "Campo de tooltip"),
          ),
        ),
      );
      if (tooltipFields.some((field) => !available.has(field))) {
        fail(
          "FIELD_NOT_FOUND",
          "Um campo de tooltip da análise não existe no dataset gerado.",
        );
      }

      const interactionConfig = readValue(
        selectKeplerVisState(getState()),
        "interactionConfig",
      );
      const tooltip = readValue(interactionConfig, "tooltip");
      const tooltipRecord = objectValue(tooltip);
      const tooltipConfig = objectValue(readValue(tooltip, "config"));
      const fieldsToShow = objectValue(
        readValue(readValue(tooltip, "config"), "fieldsToShow"),
      );

      dispatchKepler(
        interactionConfigChange(
          interactionConfigPatch({
            ...tooltipRecord,
            id: String(readValue(tooltip, "id") ?? "tooltip"),
            enabled: true,
            config: {
              ...tooltipConfig,
              fieldsToShow: {
                ...fieldsToShow,
                [dataId]: tooltipFields.map((name) => ({ name, format: null })),
              },
            },
          }),
        ),
      );
    }

    if (presentation.legendField) {
      const layer = findRawLayer(getState(), layerId);
      if (!layer) {
        fail("LAYER_NOT_FOUND", "A camada da análise não foi criada pelo Kepler.");
      }
      const fieldName = nonEmptyText(
        presentation.legendField,
        "Campo da legenda",
      );
      const field = rawField(dataset, fieldName);
      if (!field) {
        fail(
          "FIELD_NOT_FOUND",
          `O campo ${fieldName} da legenda não existe no dataset gerado.`,
        );
      }

      dispatchKepler(
        layerVisualChannelConfigChange(
          layer,
          {
            colorField: field,
            colorScale: "ordinal",
          } as any,
          "color",
        ),
      );

      if (presentation.legendPalette?.length) {
        dispatchKepler(
          layerVisConfigChange(layer, {
            colorRange: {
              name: `maono:${input.analysisKind || "analysis"}`,
              type: "qualitative",
              category: "Maõno",
              colors: normalizePalette(presentation.legendPalette),
            },
          }),
        );
      }
    }
  }

  function removeTooltipEntry(dataId: string) {
    const interactionConfig = readValue(
      selectKeplerVisState(getState()),
      "interactionConfig",
    );
    const tooltip = readValue(interactionConfig, "tooltip");
    const tooltipRecord = objectValue(tooltip);
    const tooltipConfig = objectValue(readValue(tooltip, "config"));
    const fieldsToShow = objectValue(
      readValue(readValue(tooltip, "config"), "fieldsToShow"),
    );

    if (!Object.prototype.hasOwnProperty.call(fieldsToShow, dataId)) return;
    delete fieldsToShow[dataId];
    dispatchKepler(
      interactionConfigChange(
        interactionConfigPatch({
          ...tooltipRecord,
          id: String(readValue(tooltip, "id") ?? "tooltip"),
          config: {
            ...tooltipConfig,
            fieldsToShow,
          },
        }),
      ),
    );
  }

  return {
    addGeoJsonLayer(input: AddGeoJsonLayerInput) {
      const kind = normalizedAnalysisKind(input.analysisKind);
      const capability = analysisCapability(kind, "preview");
      return run("addGeoJsonLayer", capability, () => {
        if (!input.transient) {
          fail(
            "COMMAND_INVALID",
            "O adapter de análise aceita apenas camadas transient=true.",
          );
        }
        const label = nonEmptyText(input.label, "Nome da camada");
        const dataId =
          input.dataId?.trim() ||
          `maono_analysis_${kind}_${now().toString(36)}_${Math.floor(
            random() * 1_000_000,
          ).toString(36)}`;

        if (findRawDataset(getState(), dataId)) {
          fail(
            "COMMAND_INVALID",
            "Já existe um dataset com o identificador informado.",
          );
        }

        const processed = processGeojson(input.geoJson as any);
        if (!processed) {
          fail("COMMAND_INVALID", "O GeoJSON informado é inválido.");
        }

        const layerId = `layer_${dataId}`;
        dispatchKepler(
          addDataToMap({
            datasets: {
              info: { id: dataId, label },
              data: processed,
            },
            options: {
              centerMap: input.centerMap !== false,
              keepExistingConfig: true,
            },
            config: {
              version: "v1",
              config: {
                visState: {
                  layers: [
                    {
                      id: layerId,
                      type: "geojson",
                      config: {
                        dataId,
                        label,
                        color: rgbColor(
                          input.color || [197, 160, 89],
                          "Cor da análise",
                        ),
                        columns: { geojson: "_geojson" },
                        isVisible: true,
                        visConfig: {
                          opacity: boundedNumber(
                            input.opacity ?? 0.28,
                            "Opacidade",
                            0,
                            1,
                          ),
                          filled: true,
                          stroked: true,
                          strokeColor: rgbColor(
                            input.strokeColor || [183, 121, 31],
                            "Cor do contorno",
                          ),
                          strokeOpacity: 0.95,
                          thickness: 1.5,
                        },
                      },
                    },
                  ],
                },
              },
            },
          }),
        );

        markTransientDataset(dataId);
        try {
          configurePresentation(dataId, layerId, input);
        } catch (error) {
          removeTooltipEntry(dataId);
          dispatchKepler(removeKeplerDataset(dataId));
          markPersistentDataset(dataId);
          throw error;
        }
        return { dataId };
      });
    },

    removeTransientLayer(dataId: string, analysisKind: MapAnalysisKind) {
      const kind = normalizedAnalysisKind(analysisKind);
      const capability = analysisCapability(kind, "preview");
      return run("removeTransientLayer", capability, () => {
        const id = nonEmptyText(dataId, "Identificador da camada temporária");
        if (!isTransientDataset(id)) {
          fail(
            "TRANSIENT_LAYER_REQUIRED",
            "Somente uma camada temporária pode ser descartada por este comando.",
          );
        }
        requireDataset(id);
        removeTooltipEntry(id);
        dispatchKepler(removeKeplerDataset(id));
        markPersistentDataset(id);
      });
    },

    markLayerPersistent(dataId: string, analysisKind: MapAnalysisKind) {
      const kind = normalizedAnalysisKind(analysisKind);
      const capability = analysisCapability(kind, "persist");
      return run("markLayerPersistent", capability, () => {
        const id = nonEmptyText(dataId, "Identificador da camada temporária");
        if (!isTransientDataset(id)) {
          fail(
            "TRANSIENT_LAYER_REQUIRED",
            "A camada informada não está registrada como temporária.",
          );
        }
        requireDataset(id);
        markPersistentDataset(id);
      });
    },

    markLayerTransient(dataId: string, analysisKind: MapAnalysisKind) {
      const kind = normalizedAnalysisKind(analysisKind);
      const capability = analysisCapability(kind, "persist");
      return run("markLayerTransient", capability, () => {
        const id = nonEmptyText(dataId, "Identificador da camada de análise");
        requireDataset(id);
        markTransientDataset(id);
      });
    },
  };
}
