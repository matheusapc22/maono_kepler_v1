import { WebMercatorViewport } from "@deck.gl/core";
import {
  addDataToMap,
  addFilter as addKeplerFilter,
  addLayer,
  duplicateLayer as duplicateKeplerLayer,
  interactionConfigChange,
  layerConfigChange,
  layerTypeChange,
  layerVisConfigChange,
  layerVisualChannelConfigChange,
  removeDataset,
  removeFilter as removeKeplerFilter,
  removeLayer as removeKeplerLayer,
  reorderLayer as reorderKeplerLayer,
  setFilter,
  toggleMapControl,
  toggleModal,
  updateMap,
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
  calculateKeplerBounds,
  collectionToArray,
  filterableFields,
  findRawDataset,
  findRawFilter,
  findRawLayer,
  firstFilterableDataset,
  normalizeKeplerLayers,
  readValue,
  selectKeplerViewportState,
  selectKeplerVisState,
} from "./selectors.ts";
import type {
  AddGeoJsonLayerInput,
  ClusterStyleOptions,
  CreateLayerFromDatasetInput,
  HeatmapStyleOptions,
  KeplerCommandErrorCode,
  KeplerCommandResult,
  KeplerEngineCommands,
  MapColorScale,
  MapFilterType,
  MapPointLayerType,
  MapRgbColor,
} from "./types.ts";

type CommandDependencies = {
  dispatch: (action: any) => unknown;
  getState: () => any;
  capabilities: Partial<MapCapabilities> | null | undefined;
  context?: MapPanelContextValue | null;
  setSelectedLayerId: (layerId: string | null) => void;
  isTransientDataset: (dataId: string) => boolean;
  markTransientDataset: (dataId: string) => void;
  markPersistentDataset: (dataId: string) => void;
  now?: () => number;
  random?: () => number;
};

class CommandFailure extends Error {
  code: KeplerCommandErrorCode;

  constructor(code: KeplerCommandErrorCode, message: string) {
    super(message);
    this.name = "CommandFailure";
    this.code = code;
  }
}

function fail(code: KeplerCommandErrorCode, reason: string): never {
  throw new CommandFailure(code, reason);
}

function nonEmptyText(value: unknown, field: string, maximumLength = 160) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    fail("COMMAND_INVALID", `${field} é obrigatório.`);
  }
  if (normalized.length > maximumLength) {
    fail(
      "COMMAND_INVALID",
      `${field} deve ter no máximo ${maximumLength} caracteres.`,
    );
  }

  return normalized;
}

function boundedNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    fail(
      "COMMAND_INVALID",
      `${field} deve estar entre ${minimum} e ${maximum}.`,
    );
  }

  return parsed;
}

function rgbColor(value: MapRgbColor, field = "Cor"): MapRgbColor {
  if (!Array.isArray(value) || value.length !== 3) {
    fail("COMMAND_INVALID", `${field} deve possuir três canais RGB.`);
  }

  return value.map((channel) =>
    Math.round(boundedNumber(channel, field, 0, 255)),
  ) as MapRgbColor;
}

function colorPalette(colors: string[]) {
  if (!Array.isArray(colors) || colors.length < 2 || colors.length > 20) {
    fail("COMMAND_INVALID", "A paleta deve possuir entre 2 e 20 cores.");
  }

  const normalized = colors.map((color) =>
    String(color ?? "")
      .trim()
      .toUpperCase(),
  );

  if (normalized.some((color) => !/^#[0-9A-F]{6}$/.test(color))) {
    fail("COMMAND_INVALID", "A paleta contém uma cor hexadecimal inválida.");
  }

  return normalized;
}

const POINT_LAYER_TYPES = new Set<MapPointLayerType>([
  "point",
  "cluster",
  "heatmap",
]);

function pointLayerType(value: unknown): MapPointLayerType | null {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase();

  return POINT_LAYER_TYPES.has(normalized as MapPointLayerType)
    ? (normalized as MapPointLayerType)
    : null;
}

function colorScale(value: unknown, field = "Escala de cor"): MapColorScale {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase();

  if (
    normalized !== "quantile" &&
    normalized !== "quantize" &&
    normalized !== "linear" &&
    normalized !== "ordinal"
  ) {
    fail(
      "COMMAND_INVALID",
      `${field} deve ser quantile, quantize, linear ou ordinal.`,
    );
  }

  return normalized;
}

function defaultScaleForField(field: any): MapColorScale {
  const type = String(
    readValue(field, "type") ??
      readValue(field, "dataType") ??
      readValue(field, "analyzerType") ??
      "",
  ).toLocaleLowerCase();

  return type.includes("string") ||
    type.includes("boolean") ||
    type.includes("category")
    ? "ordinal"
    : "quantile";
}

function dataIdsFromLayer(layer: any) {
  const config = readValue(layer, "config");
  const dataId = readValue(config, "dataId");
  const values = Array.isArray(dataId)
    ? dataId
    : dataId == null
      ? []
      : [dataId];

  return values.map((value) => String(value));
}

function rawLayers(rootState: any) {
  return collectionToArray<any>(
    readValue(selectKeplerVisState(rootState), "layers"),
  );
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

function rawFilterValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  const collection = collectionToArray<unknown>(value);
  if (collection.length) return collection;

  return value == null ? [] : [value];
}

function filterType(filter: any): MapFilterType {
  const type = String(readValue(filter, "type") ?? "");

  return type === "range" ||
    type === "timeRange" ||
    type === "multiSelect" ||
    type === "select" ||
    type === "polygon"
    ? type
    : "unknown";
}

function numericFilterPair(
  value: unknown,
  label: string,
): [number, number] {
  const values = rawFilterValues(value).slice(0, 2).map(Number);

  if (
    values.length !== 2 ||
    !values.every(Number.isFinite) ||
    values[0] > values[1]
  ) {
    fail(
      "COMMAND_INVALID",
      `${label} deve conter um limite mínimo e um máximo válidos.`,
    );
  }

  return [values[0], values[1]];
}

function isFilterPrimitive(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function validatedFilterValue(filter: any, value: unknown): unknown {
  const type = filterType(filter);
  const domain = rawFilterValues(readValue(filter, "domain"));

  if (type === "range" || type === "timeRange") {
    const pair = numericFilterPair(
      value,
      type === "timeRange" ? "O período" : "O intervalo",
    );

    if (domain.length >= 2) {
      const allowed = numericFilterPair(domain, "O domínio do filtro");
      if (pair[0] < allowed[0] || pair[1] > allowed[1]) {
        fail(
          "COMMAND_INVALID",
          "O valor do filtro deve permanecer dentro do domínio calculado pelo Kepler.",
        );
      }
    }

    return pair;
  }

  if (type === "select") {
    if (typeof value !== "boolean") {
      fail(
        "COMMAND_INVALID",
        "O filtro booleano aceita apenas verdadeiro ou falso.",
      );
    }

    return value;
  }

  if (type === "multiSelect") {
    const selected = rawFilterValues(value);
    if (selected.length > 5_000 || !selected.every(isFilterPrimitive)) {
      fail(
        "COMMAND_INVALID",
        "A seleção contém categorias demais ou valores inválidos.",
      );
    }

    if (
      domain.length &&
      selected.some(
        (candidate) =>
          !domain.some((allowed) => Object.is(allowed, candidate)),
      )
    ) {
      fail(
        "COMMAND_INVALID",
        "A seleção contém uma categoria fora do domínio calculado pelo Kepler.",
      );
    }

    return Array.from(new Set(selected));
  }

  fail(
    "COMMAND_INVALID",
    "Este tipo de filtro deve ser editado no painel nativo do Kepler.",
  );
}

function uniqueLayerLabel(rootState: any, preferred: string) {
  const labels = new Set(
    normalizeKeplerLayers(
      readValue(selectKeplerVisState(rootState), "layers"),
    ).map((layer) => layer.label.toLocaleLowerCase()),
  );
  const base = nonEmptyText(preferred, "Nome da camada");

  if (!labels.has(base.toLocaleLowerCase())) return base;

  let suffix = 2;
  while (labels.has(`${base} (${suffix})`.toLocaleLowerCase())) {
    suffix += 1;
  }

  return `${base} (${suffix})`;
}

function inferColumns(dataset: any) {
  const fields = rawFields(dataset)
    .map((field) => ({
      name: String(readValue(field, "name") ?? "").trim(),
      type: String(
        readValue(field, "type") ?? readValue(field, "dataType") ?? "",
      ).toLocaleLowerCase(),
    }))
    .filter((field) => field.name);
  const byName = (pattern: RegExp) =>
    fields.find((field) => pattern.test(field.name));
  const geojson =
    fields.find((field) => field.type.includes("geojson")) ??
    byName(/^(_?geojson|geometry|geom)$/i);

  if (geojson) {
    return {
      sourceType: "geojson" as const,
      columns: { geojson: geojson.name },
    };
  }

  const latitude = byName(/^(_?lat|_?latitude|y)$/i);
  const longitude = byName(/^(_?lng|_?lon|_?long|_?longitude|x)$/i);

  if (latitude && longitude) {
    return {
      sourceType: "point" as const,
      columns: {
        lat: latitude.name,
        lng: longitude.name,
        altitude: null,
      },
    };
  }

  return null;
}

function resolveLayerColumns(
  dataset: any,
  providedColumns: Record<string, unknown> | undefined,
) {
  const inferred = inferColumns(dataset);
  const hasProvidedColumns =
    providedColumns && Object.keys(providedColumns).length > 0;
  const columns: Record<string, unknown> | undefined = hasProvidedColumns
    ? providedColumns
    : inferred?.columns;
  const columnName = (key: string) => {
    const value = columns?.[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const geojson = columnName("geojson");
  const latitude = columnName("lat");
  const longitude = columnName("lng");

  if (geojson) {
    if (!rawField(dataset, geojson)) {
      fail(
        "FIELD_NOT_FOUND",
        `O campo geográfico ${geojson} não foi encontrado no dataset.`,
      );
    }

    return {
      sourceType: "geojson" as const,
      columns: { geojson },
    };
  }

  if (latitude && longitude) {
    for (const fieldName of [latitude, longitude]) {
      if (!rawField(dataset, fieldName)) {
        fail(
          "FIELD_NOT_FOUND",
          `O campo geográfico ${fieldName} não foi encontrado no dataset.`,
        );
      }
    }

    const altitude = columnName("altitude");
    if (altitude && !rawField(dataset, altitude)) {
      fail(
        "FIELD_NOT_FOUND",
        `O campo de altitude ${altitude} não foi encontrado no dataset.`,
      );
    }

    return {
      sourceType: "point" as const,
      columns: {
        lat: latitude,
        lng: longitude,
        altitude: altitude || null,
      },
    };
  }

  fail(
    "COMMAND_INVALID",
    "O dataset não possui uma geometria GeoJSON nem campos reconhecíveis de latitude e longitude.",
  );
}

function mapBoundsToViewState(
  viewportState: any,
  bounds: ReturnType<typeof calculateKeplerBounds>,
) {
  if (
    !bounds ||
    !Number.isFinite(Number(viewportState?.width)) ||
    !Number.isFinite(Number(viewportState?.height)) ||
    Number(viewportState.width) <= 0 ||
    Number(viewportState.height) <= 0
  ) {
    fail(
      "MAP_UNAVAILABLE",
      "A extensão geográfica do mapa ainda não está disponível.",
    );
  }

  const viewport = new WebMercatorViewport({
    width: Number(viewportState.width),
    height: Number(viewportState.height),
  });
  const fitted = viewport.fitBounds(
    [
      [bounds.minLongitude, bounds.minLatitude],
      [bounds.maxLongitude, bounds.maxLatitude],
    ],
    { padding: 100 },
  );
  const [longitude, latitude] = fitted.unproject([
    Number(viewportState.width) / 2,
    Number(viewportState.height) / 2,
  ]);

  return {
    bearing: Number(viewportState.bearing || 0),
    latitude,
    longitude,
    pitch: Number(viewportState.pitch || 0),
    zoom: Math.max(0, Number(fitted.zoom) - 0.35),
  };
}

export function createKeplerEngineCommands(
  dependencies: CommandDependencies,
): KeplerEngineCommands {
  const {
    dispatch,
    getState,
    capabilities,
    context,
    setSelectedLayerId,
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
      source: "kepler-engine-adapter-v2",
    });
  }

  function run<T>(
    command: string,
    capability: keyof MapCapabilities,
    execute: () => T,
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
      const value = execute();
      telemetry("map_panel_command_executed", command, capability);
      return value === undefined ? { ok: true } : { ok: true, value };
    } catch (error) {
      const failure =
        error instanceof CommandFailure
          ? error
          : new CommandFailure(
              "COMMAND_FAILED",
              error instanceof Error
                ? error.message
                : "O Kepler recusou o comando.",
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
        "A ação solicitada não está disponível nesta versão do Kepler.",
      );
    }

    dispatch(wrapTo(KEPLER_MAP_ID, action));
  }

  function requireLayer(layerId: string) {
    const id = nonEmptyText(layerId, "Identificador da camada");
    const layer = findRawLayer(getState(), id);

    if (!layer) {
      fail("LAYER_NOT_FOUND", `A camada ${id} não foi encontrada.`);
    }

    return layer;
  }

  function requireDataset(datasetId: string) {
    const id = nonEmptyText(datasetId, "Identificador do dataset");
    const dataset = findRawDataset(getState(), id);

    if (!dataset) {
      fail("DATASET_NOT_FOUND", `O dataset ${id} não foi encontrado.`);
    }

    return dataset;
  }

  function updateVisConfig(layerId: string, patch: Record<string, unknown>) {
    const layer = requireLayer(layerId);
    dispatchKepler(layerVisConfigChange(layer, patch));
  }

  function setPalette(
    layerId: string,
    colors: string[],
    channel: "fill" | "stroke",
  ) {
    const property =
      channel === "stroke" ? "strokeColorRange" : "colorRange";

    updateVisConfig(layerId, {
      [property]: {
        name:
          channel === "stroke"
            ? "Maõno contorno"
            : "Maõno personalizada",
        type: "sequential",
        category: "Maõno",
        colors: colorPalette(colors),
      },
    });
  }

  function fitData(filteredOnly: boolean) {
    const rootState = getState();
    const viewportState = selectKeplerViewportState(rootState);
    const bounds = calculateKeplerBounds(rootState, { filteredOnly });
    const nextViewState = mapBoundsToViewState(viewportState, bounds);

    dispatchKepler(updateMap(nextViewState));
  }

  return {
    selectLayer(layerId) {
      return run("selectLayer", "inspectLayer", () => {
        if (layerId !== null) requireLayer(layerId);
        setSelectedLayerId(layerId);
      });
    },

    setLayerVisibility(layerId, visible) {
      return run("setLayerVisibility", "toggleLayerVisibility", () => {
        const layer = requireLayer(layerId);
        dispatchKepler(
          layerConfigChange(layer, { isVisible: Boolean(visible) }),
        );
      });
    },

    renameLayer(layerId, label) {
      return run("renameLayer", "editLayers", () => {
        const layer = requireLayer(layerId);
        dispatchKepler(
          layerConfigChange(layer, {
            label: nonEmptyText(label, "Nome da camada"),
          }),
        );
      });
    },

    duplicateLayer(layerId) {
      return run("duplicateLayer", "duplicateLayer", () => {
        const source = requireLayer(layerId);
        const before = new Set(
          rawLayers(getState()).map((layer) => String(readValue(layer, "id"))),
        );

        dispatchKepler(duplicateKeplerLayer(layerId));

        const duplicated = rawLayers(getState()).find(
          (layer) => !before.has(String(readValue(layer, "id"))),
        );

        if (duplicated) {
          const sourceLabel = String(
            readValue(readValue(source, "config"), "label") || "Camada",
          );
          dispatchKepler(
            layerConfigChange(duplicated, {
              label: uniqueLayerLabel(getState(), sourceLabel),
            }),
          );
        }

        return {
          layerId: duplicated ? String(readValue(duplicated, "id")) : null,
        };
      });
    },

    removeLayer(layerId) {
      return run("removeLayer", "removeLayer", () => {
        requireLayer(layerId);
        dispatchKepler(removeKeplerLayer(layerId));
      });
    },

    reorderLayer(layerIds) {
      return run("reorderLayer", "reorderLayers", () => {
        const normalized = layerIds.map((id) =>
          nonEmptyText(id, "Identificador da camada"),
        );
        const current = rawLayers(getState()).map((layer) =>
          String(readValue(layer, "id")),
        );

        if (
          normalized.length !== current.length ||
          new Set(normalized).size !== normalized.length ||
          normalized.some((id) => !current.includes(id))
        ) {
          fail(
            "COMMAND_INVALID",
            "A ordenação deve conter cada camada exatamente uma vez.",
          );
        }

        dispatchKepler(reorderKeplerLayer(normalized));
      });
    },

    openAddDataModal() {
      return run("openAddDataModal", "createLayer", () => {
        dispatchKepler(toggleModal("addData"));
      });
    },

    createLayerFromDataset(input: CreateLayerFromDatasetInput) {
      return run("createLayerFromDataset", "createLayer", () => {
        const datasetId = nonEmptyText(
          input.datasetId,
          "Identificador do dataset",
        );
        const dataset = requireDataset(datasetId);
        const resolved = resolveLayerColumns(dataset, input.columns);
        const type = nonEmptyText(
          input.type || resolved.sourceType,
          "Tipo da camada",
          40,
        ).toLocaleLowerCase();
        const supportedTypes =
          resolved.sourceType === "geojson"
            ? ["geojson"]
            : ["point", "cluster", "heatmap"];

        if (!supportedTypes.includes(type)) {
          fail(
            "COMMAND_INVALID",
            `O tipo ${type} não é compatível com os campos geográficos do dataset.`,
          );
        }

        const preferredLabel =
          input.label ||
          readValue(dataset, "label") ||
          readValue(readValue(dataset, "info"), "label") ||
          datasetId;
        const label = uniqueLayerLabel(getState(), String(preferredLabel));
        const layerId = `maono_layer_${now().toString(36)}_${Math.floor(
          random() * 1_000_000,
        ).toString(36)}`;

        dispatchKepler(
          addLayer({
            id: layerId,
            type,
            config: {
              dataId: datasetId,
              label,
              isVisible: true,
              columns: resolved.columns,
              color: [197, 160, 89],
              visConfig: {
                filled: true,
                opacity: 0.8,
                stroked: type === "geojson",
              },
            },
          } as any),
        );

        return { layerId };
      });
    },

    setLayerType(layerId, type) {
      return run("setLayerType", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        const currentType = pointLayerType(readValue(layer, "type"));
        const nextType = pointLayerType(
          nonEmptyText(type, "Tipo da camada", 40),
        );

        if (!currentType || !nextType) {
          fail(
            "COMMAND_INVALID",
            "A troca de formato é permitida apenas entre ponto, cluster e heatmap.",
          );
        }

        if (currentType !== nextType) {
          dispatchKepler(layerTypeChange(layer, nextType));
        }
      });
    },

    setLayerOpacity(layerId, opacity) {
      return run("setLayerOpacity", "editLayerStyle", () => {
        updateVisConfig(layerId, {
          opacity: boundedNumber(opacity, "Opacidade", 0, 1),
        });
      });
    },

    setFixedColor(layerId, color) {
      return run("setFixedColor", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        dispatchKepler(layerConfigChange(layer, { color: rgbColor(color) }));
      });
    },

    setColorField(layerId, fieldName) {
      return run("setColorField", "editLayerStyle", () => {
        const layer = requireLayer(layerId);

        if (fieldName === null || !String(fieldName).trim()) {
          dispatchKepler(
            layerVisualChannelConfigChange(
              layer,
              { colorField: null } as any,
              "color",
            ),
          );
          return;
        }

        const datasetId = dataIdsFromLayer(layer)[0];
        const dataset = requireDataset(datasetId);
        const field = rawField(
          dataset,
          nonEmptyText(fieldName, "Campo de cor"),
        );

        if (!field) {
          fail(
            "FIELD_NOT_FOUND",
            `O campo ${fieldName} não existe no dataset da camada.`,
          );
        }

        dispatchKepler(
          layerVisualChannelConfigChange(
            layer,
            { colorField: field } as any,
            "color",
          ),
        );
        dispatchKepler(
          layerVisConfigChange(layer, {
            colorScale: defaultScaleForField(field),
          }),
        );
      });
    },

    setColorScale(layerId, scale) {
      return run("setColorScale", "editLayerStyle", () => {
        updateVisConfig(layerId, {
          colorScale: colorScale(scale),
        });
      });
    },

    setColorPalette(layerId, colors) {
      return run("setColorPalette", "editLayerStyle", () => {
        setPalette(layerId, colors, "fill");
      });
    },

    setFillEnabled(layerId, enabled) {
      return run("setFillEnabled", "editLayerStyle", () => {
        updateVisConfig(layerId, { filled: Boolean(enabled) });
      });
    },

    setStrokeEnabled(layerId, enabled) {
      return run("setStrokeEnabled", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        const property =
          String(readValue(layer, "type") ?? "") === "point"
            ? "outline"
            : "stroked";

        dispatchKepler(
          layerVisConfigChange(layer, {
            [property]: Boolean(enabled),
          }),
        );
      });
    },

    setStrokeColor(layerId, color) {
      return run("setStrokeColor", "editLayerStyle", () => {
        updateVisConfig(layerId, {
          strokeColor: rgbColor(color, "Cor do contorno"),
        });
      });
    },

    setStrokeColorField(layerId, fieldName) {
      return run("setStrokeColorField", "editLayerStyle", () => {
        const layer = requireLayer(layerId);

        if (fieldName === null || !String(fieldName).trim()) {
          dispatchKepler(
            layerVisualChannelConfigChange(
              layer,
              { strokeColorField: null } as any,
              "strokeColor",
            ),
          );
          return;
        }

        const datasetId = dataIdsFromLayer(layer)[0];
        const dataset = requireDataset(datasetId);
        const field = rawField(
          dataset,
          nonEmptyText(fieldName, "Campo de cor do contorno"),
        );

        if (!field) {
          fail(
            "FIELD_NOT_FOUND",
            `O campo ${fieldName} não existe no dataset da camada.`,
          );
        }

        dispatchKepler(
          layerVisualChannelConfigChange(
            layer,
            { strokeColorField: field } as any,
            "strokeColor",
          ),
        );
        dispatchKepler(
          layerVisConfigChange(layer, {
            strokeColorScale: defaultScaleForField(field),
          }),
        );
      });
    },

    setStrokeColorScale(layerId, scale) {
      return run("setStrokeColorScale", "editLayerStyle", () => {
        updateVisConfig(layerId, {
          strokeColorScale: colorScale(
            scale,
            "Escala de cor do contorno",
          ),
        });
      });
    },

    setStrokeColorPalette(layerId, colors) {
      return run("setStrokeColorPalette", "editLayerStyle", () => {
        setPalette(layerId, colors, "stroke");
      });
    },

    setStrokeOpacity(layerId, opacity) {
      return run("setStrokeOpacity", "editLayerStyle", () => {
        updateVisConfig(layerId, {
          strokeOpacity: boundedNumber(opacity, "Opacidade do contorno", 0, 1),
        });
      });
    },

    setStrokeWidth(layerId, width) {
      return run("setStrokeWidth", "editLayerStyle", () => {
        updateVisConfig(layerId, {
          thickness: boundedNumber(width, "Espessura do contorno", 0, 20),
        });
      });
    },

    setPointRadius(layerId, radius) {
      return run("setPointRadius", "editLayerStyle", () => {
        updateVisConfig(layerId, {
          radius: boundedNumber(radius, "Raio do ponto", 0, 100),
        });
      });
    },

    setClusterOptions(layerId, options: ClusterStyleOptions) {
      return run("setClusterOptions", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        const type = String(readValue(layer, "type") ?? "");

        if (type !== "cluster") {
          fail(
            "COMMAND_INVALID",
            "As opções de agrupamento exigem uma camada do tipo cluster.",
          );
        }

        const patch: Record<string, unknown> = {};
        if (options.radius !== undefined) {
          const radius = boundedNumber(
            options.radius,
            "Raio do agrupamento",
            1,
            500,
          );
          patch.clusterRadius = radius;
        }
        if (options.opacity !== undefined) {
          patch.opacity = boundedNumber(options.opacity, "Opacidade", 0, 1);
        }
        if (options.colorPalette) {
          patch.colorRange = {
            name: "Maõno cluster",
            type: "sequential",
            category: "Maõno",
            colors: colorPalette(options.colorPalette),
          };
        }

        if (!Object.keys(patch).length) {
          fail("COMMAND_INVALID", "Informe ao menos uma opção de agrupamento.");
        }

        dispatchKepler(layerVisConfigChange(layer, patch));
      });
    },

    setHeatmapOptions(layerId, options: HeatmapStyleOptions) {
      return run("setHeatmapOptions", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        const type = String(readValue(layer, "type") ?? "");

        if (type !== "heatmap") {
          fail(
            "COMMAND_INVALID",
            "As opções de calor exigem uma camada do tipo heatmap.",
          );
        }

        const patch: Record<string, unknown> = {};
        if (options.radius !== undefined) {
          const radius = boundedNumber(
            options.radius,
            "Raio do mapa de calor",
            0,
            100,
          );
          patch.heatmapRadius = radius;
        }
        if (options.opacity !== undefined) {
          patch.opacity = boundedNumber(options.opacity, "Opacidade", 0, 1);
        }
        if (options.colorPalette) {
          patch.colorRange = {
            name: "Maõno heatmap",
            type: "sequential",
            category: "Maõno",
            colors: colorPalette(options.colorPalette),
          };
        }

        if (!Object.keys(patch).length) {
          fail(
            "COMMAND_INVALID",
            "Informe ao menos uma opção do mapa de calor.",
          );
        }

        dispatchKepler(layerVisConfigChange(layer, patch));
      });
    },

    addFilter(datasetId) {
      return run("addFilter", "editFilters", () => {
        const selected = datasetId
          ? {
              id: nonEmptyText(datasetId, "Identificador do dataset"),
              field: filterableFields(requireDataset(String(datasetId)))[0],
            }
          : firstFilterableDataset(getState());

        if (!selected) {
          fail(
            "DATASET_NOT_FOUND",
            "Nenhum dataset disponível aceita filtros.",
          );
        }
        if (!selected.field) {
          fail(
            "FIELD_NOT_FOUND",
            `O dataset ${selected.id} não possui campo filtrável.`,
          );
        }

        const index = collectionToArray(
          readValue(selectKeplerVisState(getState()), "filters"),
        ).length;

        dispatchKepler(addKeplerFilter(selected.id));
        dispatchKepler(setFilter(index, "dataId", selected.id, 0));
        dispatchKepler(setFilter(index, "name", selected.field.name, 0));

        return {
          index,
          datasetId: selected.id,
          fieldName: selected.field.name,
        };
      });
    },

    bindFilterField(index, datasetId, fieldName) {
      return run("bindFilterField", "editFilters", () => {
        if (!Number.isInteger(index) || index < 0) {
          fail("COMMAND_INVALID", "Índice de filtro inválido.");
        }

        const filter = findRawFilter(getState(), index);
        if (!filter) {
          fail("FILTER_NOT_FOUND", `O filtro ${index} não foi encontrado.`);
        }
        if (
          filterType(filter) === "polygon" ||
          filterType(filter) === "unknown" ||
          rawFilterValues(readValue(filter, "dataId")).length > 1
        ) {
          fail(
            "COMMAND_INVALID",
            "Este filtro deve ser configurado no painel nativo do Kepler.",
          );
        }

        const normalizedDatasetId = nonEmptyText(
          datasetId,
          "Identificador do dataset",
        );
        const dataset = requireDataset(normalizedDatasetId);
        const fields = filterableFields(dataset);
        const selectedField = fieldName
          ? fields.find((field) => field.name === fieldName)
          : fields[0];

        if (!selectedField) {
          fail(
            "FIELD_NOT_FOUND",
            `O dataset ${normalizedDatasetId} não possui o campo solicitado.`,
          );
        }

        dispatchKepler(setFilter(index, "dataId", normalizedDatasetId, 0));
        dispatchKepler(setFilter(index, "name", selectedField.name, 0));
      });
    },

    setFilterField(index, fieldName) {
      return run("setFilterField", "editFilters", () => {
        const filter = findRawFilter(getState(), index);
        if (!filter) {
          fail("FILTER_NOT_FOUND", `O filtro ${index} não foi encontrado.`);
        }

        const dataIds = rawFilterValues(readValue(filter, "dataId"))
          .map((value) => String(value ?? "").trim())
          .filter(Boolean);
        if (dataIds.length !== 1) {
          fail(
            "COMMAND_INVALID",
            "Filtros sincronizados devem ser editados no painel nativo do Kepler.",
          );
        }
        const datasetId = dataIds[0];
        const dataset = requireDataset(datasetId);
        const name = nonEmptyText(fieldName, "Campo do filtro");

        if (!filterableFields(dataset).some((field) => field.name === name)) {
          fail(
            "FIELD_NOT_FOUND",
            `O campo ${name} não existe no dataset do filtro.`,
          );
        }

        dispatchKepler(setFilter(index, "name", name, 0));
      });
    },

    setFilterValue(index, value) {
      return run("setFilterValue", "editFilters", () => {
        const filter = findRawFilter(getState(), index);
        if (!filter) {
          fail("FILTER_NOT_FOUND", `O filtro ${index} não foi encontrado.`);
        }

        dispatchKepler(
          setFilter(index, "value", validatedFilterValue(filter, value)),
        );
      });
    },

    removeFilter(index) {
      return run("removeFilter", "editFilters", () => {
        if (!findRawFilter(getState(), index)) {
          fail("FILTER_NOT_FOUND", `O filtro ${index} não foi encontrado.`);
        }

        dispatchKepler(removeKeplerFilter(index));
      });
    },

    setTooltipFields(fieldsByDataset) {
      return run("setTooltipFields", "configureTooltips", () => {
        const normalized: Record<
          string,
          Array<{ name: string; format: null }>
        > = {};

        for (const [datasetId, fieldNames] of Object.entries(
          fieldsByDataset || {},
        )) {
          const dataset = requireDataset(datasetId);
          const available = new Set(
            rawFields(dataset).map((field) =>
              String(readValue(field, "name") ?? ""),
            ),
          );
          const names = Array.from(
            new Set(
              (fieldNames || []).map((fieldName) =>
                nonEmptyText(fieldName, "Campo de tooltip"),
              ),
            ),
          );

          if (names.some((name) => !available.has(name))) {
            fail(
              "FIELD_NOT_FOUND",
              `Um campo de tooltip não existe no dataset ${datasetId}.`,
            );
          }

          normalized[datasetId] = names.map((name) => ({
            name,
            format: null,
          }));
        }

        const interactionConfig = readValue(
          selectKeplerVisState(getState()),
          "interactionConfig",
        );
        const tooltip = readValue(interactionConfig, "tooltip");
        const tooltipConfig = readValue(tooltip, "config") || {};

        dispatchKepler(
          interactionConfigChange({
            tooltip: {
              ...(typeof tooltip?.toJS === "function"
                ? tooltip.toJS()
                : tooltip || {}),
              enabled: true,
              config: {
                ...(typeof tooltipConfig?.toJS === "function"
                  ? tooltipConfig.toJS()
                  : tooltipConfig),
                fieldsToShow: normalized,
              },
            },
          } as any),
        );
      });
    },

    fitVisibleData() {
      return run("fitVisibleData", "focusMapData", () => fitData(false));
    },

    fitFilteredData() {
      return run("fitFilteredData", "focusMapData", () => fitData(true));
    },

    toggleLegend() {
      return run("toggleLegend", "toggleLegend", () => {
        dispatchKepler(toggleMapControl("mapLegend", 0));
      });
    },

    addGeoJsonLayer(input: AddGeoJsonLayerInput) {
      const capability = input.transient ? "previewIsochrone" : "createLayer";

      return run("addGeoJsonLayer", capability, () => {
        const label = nonEmptyText(input.label, "Nome da camada");
        const dataId =
          input.dataId?.trim() ||
          `maono_geojson_${now().toString(36)}_${Math.floor(
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
                      id: `layer_${dataId}`,
                      type: "geojson",
                      config: {
                        dataId,
                        label,
                        color: rgbColor(input.color || [197, 160, 89]),
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

        if (input.transient) markTransientDataset(dataId);
        return { dataId };
      });
    },

    removeTransientLayer(dataId) {
      return run("removeTransientLayer", "previewIsochrone", () => {
        const id = nonEmptyText(dataId, "Identificador da camada temporária");

        if (!isTransientDataset(id)) {
          fail(
            "TRANSIENT_LAYER_REQUIRED",
            "Somente uma camada temporária pode ser descartada por este comando.",
          );
        }

        requireDataset(id);
        dispatchKepler(removeDataset(id));
        markPersistentDataset(id);
      });
    },

    markLayerPersistent(dataId) {
      return run("markLayerPersistent", "persistIsochrone", () => {
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

    markLayerTransient(dataId) {
      return run("markLayerTransient", "persistIsochrone", () => {
        const id = nonEmptyText(dataId, "Identificador da camada de análise");

        requireDataset(id);
        markTransientDataset(id);
      });
    },
  };
}
