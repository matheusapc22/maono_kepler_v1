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
  mapStyleChange,
  removeDataset as removeKeplerDataset,
  removeFilter as removeKeplerFilter,
  removeLayer as removeKeplerLayer,
  reorderLayer as reorderKeplerLayer,
  setFilter,
  toggleMapControl,
  toggleModal,
  updateLayerBlending,
  updateOverlayBlending,
  updateMap,
  wrapTo,
} from "@kepler.gl/actions";
import { processGeojson } from "@kepler.gl/processors";

import {
  keplerColumnsFromSnapshot,
  migrateLayerConfigurationForTypeChange,
  moveLayerId,
  planLayerColumnUpdate,
  planLayerDatasetAssociation,
  replacementLayerIdAfterRemoval,
} from "./layer-management.ts";
import {
  colorsEqual,
  defaultScaleForDatasetField,
  layerBlendingMode,
  layerStyleCompatibilityForType,
  normalizePalette,
  numericRange,
  overlayBlendingMode,
  rgbEqual,
  scaleSupportsField,
} from "./layer-style-management.ts";
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
  normalizeKeplerDatasets,
  normalizeKeplerLayers,
  readValue,
  selectKeplerMapState,
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
  MapDatasetField,
  MapFilterType,
  MapLayerStructurePlan,
  MapPaletteSelection,
  MapRgbColor,
  MapViewportUpdate,
  RemoveDatasetOptions,
  SetLayerColumnsInput,
} from "./types.ts";

type CommandDependencies = {
  dispatch: (action: any) => unknown;
  getState: () => any;
  capabilities: Partial<MapCapabilities> | null | undefined;
  context?: MapPanelContextValue | null;
  setSelectedLayerId: (layerId: string | null) => void;
  getSelectedLayerId?: () => string | null;
  isTransientDataset: (dataId: string) => boolean;
  markTransientDataset: (dataId: string) => void;
  markPersistentDataset: (dataId: string) => void;
  now?: () => number;
  random?: () => number;
};

const NO_CHANGE = Symbol("kepler-engine-no-change");

type CommandExecution<T> = T | typeof NO_CHANGE;

// Kepler 3.2 types the visual-channel action as Partial<LayerBaseConfig>,
// although the reducer and concrete layers accept channel properties such as
// colorField/colorScale and strokeColorField/strokeColorScale. Keep the cast
// isolated here and restrict callers to the confirmed channel keys.
type KeplerVisualChannelPatch = {
  colorField?: unknown | null;
  colorScale?: MapColorScale;
  strokeColorField?: unknown | null;
  strokeColorScale?: MapColorScale;
};

function visualChannelPatch(
  patch: KeplerVisualChannelPatch,
): Parameters<typeof layerVisualChannelConfigChange>[1] {
  return patch as unknown as Parameters<
    typeof layerVisualChannelConfigChange
  >[1];
}

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

function paletteSelection(
  value: string[] | MapPaletteSelection,
): MapPaletteSelection {
  if (Array.isArray(value)) {
    return {
      id: "custom",
      label: "Maõno personalizada",
      kind: "sequential",
      colors: colorPalette(value),
    };
  }

  const id = nonEmptyText(value?.id, "Identificador da paleta", 80);
  const label = nonEmptyText(value?.label, "Nome da paleta", 120);
  const kind = value?.kind;
  if (kind !== "sequential" && kind !== "divergent" && kind !== "categorical") {
    fail("COMMAND_INVALID", "O tipo da paleta deve ser sequential, divergent ou categorical.");
  }
  return {id, label, kind, colors: colorPalette(value.colors)};
}

function colorScale(value: unknown, field = "Escala de cor"): MapColorScale {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase();

  if (
    normalized !== "quantile" &&
    normalized !== "quantize" &&
    normalized !== "linear" &&
    normalized !== "sqrt" &&
    normalized !== "log" &&
    normalized !== "ordinal"
  ) {
    fail(
      "COMMAND_INVALID",
      `${field} deve ser quantile, quantize, linear, sqrt, log ou ordinal.`,
    );
  }

  return normalized;
}

function datasetFieldSummary(field: unknown): MapDatasetField {
  const type =
    readValue(field, "type") ??
    readValue(field, "dataType") ??
    readValue(field, "analyzerType");

  return {
    name: String(readValue(field, "name") ?? ""),
    type: type == null ? null : String(type),
    format: null,
    filterType: null,
  };
}

function defaultScaleForField(field: unknown): MapColorScale {
  return defaultScaleForDatasetField(datasetFieldSummary(field));
}

function ensureScaleSupportsRawField(
  scale: MapColorScale,
  field: unknown,
  label: string,
) {
  if (!scaleSupportsField(scale, datasetFieldSummary(field))) {
    fail(
      "COMMAND_INVALID",
      `${label} não é compatível com o tipo do campo selecionado.`,
    );
  }
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

function orderedLayerIds(rootState: unknown) {
  const visState = selectKeplerVisState(rootState);
  return normalizeKeplerLayers(
    readValue(visState, "layers"),
    readValue(visState, "layerOrder"),
  ).map((layer) => layer.id);
}

function normalizedLayerSummary(rootState: unknown, layerId: string) {
  const visState = selectKeplerVisState(rootState);
  return (
    normalizeKeplerLayers(
      readValue(visState, "layers"),
      readValue(visState, "layerOrder"),
    ).find((layer) => layer.id === layerId) ?? null
  );
}

function normalizedDatasetSummary(rootState: unknown, datasetId: string) {
  const visState = selectKeplerVisState(rootState);
  return (
    normalizeKeplerDatasets(readValue(visState, "datasets")).find(
      (dataset) => dataset.id === datasetId,
    ) ?? null
  );
}

function failForStructurePlan(plan: MapLayerStructurePlan): never {
  const first = plan.issues[0];
  if (!first) {
    fail("COMMAND_INVALID", "A configuração estrutural da camada é inválida.");
  }

  if (first.code === "DATASET_NOT_FOUND") {
    fail("DATASET_NOT_FOUND", first.message);
  }
  if (first.code === "FIELD_NOT_FOUND") {
    fail("FIELD_NOT_FOUND", first.message);
  }
  if (
    first.code === "TYPE_CHANGE_NOT_ALLOWED" ||
    first.code === "UNSUPPORTED_LAYER_TYPE"
  ) {
    fail("UNSUPPORTED", first.message);
  }

  fail("COMMAND_INVALID", first.message);
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
      columns: {
        latitude: null,
        longitude: null,
        geojson,
        altitude: null,
      },
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
        latitude,
        longitude,
        geojson: null,
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
    getSelectedLayerId = () => null,
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
    execute: () => CommandExecution<T>,
    options: { requiresMap?: boolean } = {},
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
      if (options.requiresMap !== false && !selectKeplerMapState(getState())) {
        fail("MAP_UNAVAILABLE", "A instância do mapa ainda não está disponível.");
      }

      const value = execute();
      telemetry("map_panel_command_executed", command, capability);

      if (value === NO_CHANGE) {
        return { ok: true, changed: false };
      }

      return value === undefined
        ? { ok: true, changed: true }
        : { ok: true, changed: true, value };
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

  function unsupported(
    command: string,
    capability: keyof MapCapabilities,
    reason: string,
  ): KeplerCommandResult {
    return run(
      command,
      capability,
      () => fail("UNSUPPORTED", reason),
      { requiresMap: true },
    );
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

  function layerConfigRecord(layer: unknown) {
    return readValue(layer, "config") ?? {};
  }

  function layerVisConfigRecord(layer: unknown) {
    return readValue(layerConfigRecord(layer), "visConfig") ?? {};
  }

  function sameScalar(left: unknown, right: unknown) {
    return Object.is(left, right) || String(left ?? "") === String(right ?? "");
  }

  function currentPalette(layer: unknown, property: string): string[] {
    const range = readValue(layerVisConfigRecord(layer), property);
    const colors = readValue(range, "colors");
    return Array.isArray(colors)
      ? colors.map((color) => String(color))
      : collectionToArray<string>(colors).map((color) => String(color));
  }

  function updateVisConfig(
    layerId: string,
    patch: Record<string, unknown>,
  ): typeof NO_CHANGE | void {
    const layer = requireLayer(layerId);
    const visConfig = layerVisConfigRecord(layer);
    const unchanged = Object.entries(patch).every(([key, value]) => {
      const current = readValue(visConfig, key);
      if (Array.isArray(value) && Array.isArray(current)) {
        return value.length === current.length &&
          value.every((entry, index) => sameScalar(entry, current[index]));
      }
      return sameScalar(current, value);
    });

    if (unchanged) return NO_CHANGE;
    dispatchKepler(layerVisConfigChange(layer, patch));
  }

  function setPalette(
    layerId: string,
    value: string[] | MapPaletteSelection,
    channel: "fill" | "stroke",
  ): typeof NO_CHANGE | void {
    const layer = requireLayer(layerId);
    const property =
      channel === "stroke" ? "strokeColorRange" : "colorRange";
    const selection = paletteSelection(value);
    const currentRange = readValue(layerVisConfigRecord(layer), property);
    const currentId = String(readValue(currentRange, "name") ?? "").replace(/^maono:/, "");
    if (
      currentId === selection.id &&
      colorsEqual(currentPalette(layer, property), selection.colors)
    ) {
      return NO_CHANGE;
    }

    const keplerPaletteType =
      selection.kind === "categorical"
        ? "qualitative"
        : selection.kind === "divergent"
          ? "diverging"
          : "sequential";
    dispatchKepler(layerVisConfigChange(layer, {
      [property]: {
        name: `maono:${selection.id}`,
        type: keplerPaletteType,
        category: "Maõno",
        colors: selection.colors,
      },
    }));
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
        if (getSelectedLayerId() === layerId) return NO_CHANGE;
        setSelectedLayerId(layerId);
      });
    },

    setLayerVisibility(layerId, visible) {
      return run("setLayerVisibility", "toggleLayerVisibility", () => {
        const layer = requireLayer(layerId);
        const config = readValue(layer, "config");
        const current = readValue(config, "isVisible") !== false;
        const next = Boolean(visible);
        if (current === next) return NO_CHANGE;
        dispatchKepler(layerConfigChange(layer, { isVisible: next }));
      });
    },

    renameLayer(layerId, label) {
      return run("renameLayer", "editLayers", () => {
        const layer = requireLayer(layerId);
        const nextLabel = nonEmptyText(label, "Nome da camada");
        const currentLabel = String(
          readValue(readValue(layer, "config"), "label") ?? "",
        );
        if (currentLabel === nextLabel) return NO_CHANGE;
        dispatchKepler(layerConfigChange(layer, { label: nextLabel }));
      });
    },

    duplicateLayer(layerId) {
      return run("duplicateLayer", "duplicateLayer", () => {
        const source = requireLayer(layerId);
        const beforeOrder = orderedLayerIds(getState());
        const before = new Set(beforeOrder);

        dispatchKepler(duplicateKeplerLayer(layerId));

        const afterOrder = orderedLayerIds(getState());
        const duplicatedLayerId =
          afterOrder.find((candidate) => !before.has(candidate)) ?? null;
        const duplicated = duplicatedLayerId
          ? findRawLayer(getState(), duplicatedLayerId)
          : null;
        let finalOrder: string[] | null = null;

        if (duplicated && duplicatedLayerId) {
          const sourceLabel = String(
            readValue(readValue(source, "config"), "label") || "Camada",
          );
          dispatchKepler(
            layerConfigChange(duplicated, {
              label: uniqueLayerLabel(getState(), sourceLabel),
            }),
          );

          const sourceIndex = beforeOrder.indexOf(layerId);
          finalOrder = moveLayerId(
            afterOrder,
            duplicatedLayerId,
            sourceIndex < 0 ? 0 : sourceIndex,
          );
          if (finalOrder.some((id, index) => id !== afterOrder[index])) {
            dispatchKepler(reorderKeplerLayer(finalOrder));
          }
          setSelectedLayerId(duplicatedLayerId);
        }

        return {
          layerId: duplicatedLayerId,
          order: finalOrder,
        };
      });
    },

    removeLayer(layerId) {
      return run("removeLayer", "removeLayer", () => {
        requireLayer(layerId);
        const currentOrder = orderedLayerIds(getState());
        const nextSelectedLayerId = replacementLayerIdAfterRemoval(
          currentOrder,
          layerId,
          getSelectedLayerId(),
        );

        dispatchKepler(removeKeplerLayer(layerId));
        if (getSelectedLayerId() === layerId) {
          setSelectedLayerId(nextSelectedLayerId);
        }

        return { selectedLayerId: nextSelectedLayerId };
      });
    },

    reorderLayer(layerIds) {
      return run("reorderLayer", "reorderLayers", () => {
        const normalized = layerIds.map((id) =>
          nonEmptyText(id, "Identificador da camada"),
        );
        const current = orderedLayerIds(getState());

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

        if (normalized.every((id, index) => id === current[index])) {
          return NO_CHANGE;
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
        const datasetSummary = normalizedDatasetSummary(getState(), datasetId);
        if (!datasetSummary) {
          fail("DATASET_NOT_FOUND", `O dataset ${datasetId} não foi normalizado.`);
        }
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
              columns: keplerColumnsFromSnapshot(
                resolved.columns,
                datasetSummary,
              ),
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
        const layerSummary = normalizedLayerSummary(getState(), layerId);
        if (!layerSummary) {
          fail("LAYER_NOT_FOUND", `A camada ${layerId} não foi encontrada.`);
        }
        const datasetId = layerSummary.dataIds[0] ?? null;
        const dataset = datasetId
          ? normalizedDatasetSummary(getState(), datasetId)
          : null;
        const plan = migrateLayerConfigurationForTypeChange(
          layerSummary,
          nonEmptyText(type, "Tipo da camada", 40),
          dataset,
        );

        if (!plan.valid) failForStructurePlan(plan);
        if (!plan.changed) return NO_CHANGE;
        if (!plan.targetType) {
          fail("UNSUPPORTED", "O tipo de destino não foi normalizado.");
        }

        dispatchKepler(layerTypeChange(layer, plan.targetType));
        return plan;
      });
    },

    associateLayerDataset(layerId, datasetId) {
      return run("associateLayerDataset", "editLayers", () => {
        const layer = requireLayer(layerId);
        const normalizedDatasetId = nonEmptyText(
          datasetId,
          "Identificador do dataset",
        );
        requireDataset(normalizedDatasetId);
        const layerSummary = normalizedLayerSummary(getState(), layerId);
        const datasetSummary = normalizedDatasetSummary(
          getState(),
          normalizedDatasetId,
        );
        if (!layerSummary) {
          fail("LAYER_NOT_FOUND", `A camada ${layerId} não foi encontrada.`);
        }
        if (!datasetSummary) {
          fail(
            "DATASET_NOT_FOUND",
            `O dataset ${normalizedDatasetId} não foi encontrado.`,
          );
        }

        const plan = planLayerDatasetAssociation(layerSummary, datasetSummary);
        if (!plan.valid) {
          const details = plan.issues.map((item) => item.message).join(" ");
          fail(
            "CONFLICT",
            details || "O dataset não possui columns compatíveis com a camada.",
          );
        }
        if (!plan.changed) return NO_CHANGE;

        dispatchKepler(
          layerConfigChange(layer, {
            dataId: normalizedDatasetId,
            columns: keplerColumnsFromSnapshot(
              plan.columns,
              datasetSummary,
            ),
          }),
        );
        return plan;
      });
    },

    setLayerColumns(layerId, columns: SetLayerColumnsInput) {
      return run("setLayerColumns", "editLayers", () => {
        const layer = requireLayer(layerId);
        const layerSummary = normalizedLayerSummary(getState(), layerId);
        if (!layerSummary) {
          fail("LAYER_NOT_FOUND", `A camada ${layerId} não foi encontrada.`);
        }
        const datasetId = layerSummary.dataIds[0] ?? null;
        const datasetSummary = datasetId
          ? normalizedDatasetSummary(getState(), datasetId)
          : null;
        if (!datasetSummary) {
          fail("DATASET_NOT_FOUND", "A camada não possui um dataset associado.");
        }

        const plan = planLayerColumnUpdate(
          layerSummary,
          datasetSummary,
          columns,
        );
        if (!plan.valid) failForStructurePlan(plan);
        if (!plan.changed) return NO_CHANGE;

        dispatchKepler(
          layerConfigChange(layer, {
            columns: keplerColumnsFromSnapshot(
              plan.columns,
              datasetSummary,
            ),
          }),
        );
        return plan;
      });
    },

    setLayerOpacity(layerId, opacity) {
      return run("setLayerOpacity", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).opacity) {
          fail("UNSUPPORTED", "Este tipo de camada não expõe opacidade no painel Maõno.");
        }
        return updateVisConfig(layerId, {
          opacity: boundedNumber(opacity, "Opacidade", 0, 1),
        });
      });
    },

    setFixedColor(layerId, color) {
      return run("setFixedColor", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).fixedColor) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita cor fixa.");
        }
        const next = rgbColor(color);
        const config = layerConfigRecord(layer);
        if (rgbEqual(readValue(config, "color"), next)) return NO_CHANGE;
        dispatchKepler(layerConfigChange(layer, { color: next }));
      });
    },

    setColorField(layerId, fieldName) {
      return run("setColorField", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).colorField) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita campo de cor.");
        }
        const config = layerConfigRecord(layer);
        const currentName = String(readValue(readValue(config, "colorField"), "name") ?? "").trim() || null;

        if (fieldName === null || !String(fieldName).trim()) {
          if (currentName === null) return NO_CHANGE;
          dispatchKepler(
            layerVisualChannelConfigChange(
              layer,
              visualChannelPatch({colorField: null}),
              "color",
            ),
          );
          return;
        }

        const datasetId = dataIdsFromLayer(layer)[0];
        const dataset = requireDataset(datasetId);
        const normalizedFieldName = nonEmptyText(fieldName, "Campo de cor");
        const field = rawField(dataset, normalizedFieldName);

        if (!field) {
          fail(
            "FIELD_NOT_FOUND",
            `O campo ${fieldName} não existe no dataset da camada.`,
          );
        }
        if (currentName === normalizedFieldName) return NO_CHANGE;

        const scale = defaultScaleForField(field);
        dispatchKepler(
          layerVisualChannelConfigChange(
            layer,
            visualChannelPatch({colorField: field, colorScale: scale}),
            "color",
          ),
        );
      });
    },

    setColorScale(layerId, scale) {
      return run("setColorScale", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).colorScale) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita escala de cor configurável.");
        }
        const nextScale = colorScale(scale);
        const field = readValue(layerConfigRecord(layer), "colorField");
        if (!field) {
          fail("COMMAND_INVALID", "Selecione um campo de cor antes de alterar a escala.");
        }
        ensureScaleSupportsRawField(nextScale, field, "A escala de cor");
        const currentScale = String(readValue(layerConfigRecord(layer), "colorScale") ?? "");
        if (currentScale === nextScale) return NO_CHANGE;
        dispatchKepler(
          layerVisualChannelConfigChange(
            layer,
            visualChannelPatch({colorScale: nextScale}),
            "color",
          ),
        );
      });
    },

    setColorPalette(layerId, colors) {
      return run("setColorPalette", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).palette) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita paleta de cor.");
        }
        return setPalette(layerId, colors, "fill");
      });
    },

    setFillEnabled(layerId, enabled) {
      return run("setFillEnabled", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).fill) {
          fail("UNSUPPORTED", "Este tipo de camada não possui preenchimento configurável.");
        }
        return updateVisConfig(layerId, { filled: Boolean(enabled) });
      });
    },

    setStrokeEnabled(layerId, enabled) {
      return run("setStrokeEnabled", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).stroke) {
          fail("UNSUPPORTED", "Este tipo de camada não possui contorno configurável.");
        }
        const property =
          String(readValue(layer, "type") ?? "") === "point"
            ? "outline"
            : "stroked";
        return updateVisConfig(layerId, {[property]: Boolean(enabled)});
      });
    },

    setStrokeColor(layerId, color) {
      return run("setStrokeColor", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).stroke) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita cor de contorno.");
        }
        const next = rgbColor(color, "Cor do contorno");
        const current = readValue(layerVisConfigRecord(layer), "strokeColor");
        if (rgbEqual(current, next)) return NO_CHANGE;
        dispatchKepler(layerVisConfigChange(layer, {strokeColor: next}));
      });
    },

    setStrokeColorField(layerId, fieldName) {
      return run("setStrokeColorField", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).strokeField) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita campo de cor do contorno.");
        }
        const config = layerConfigRecord(layer);
        const currentName = String(readValue(readValue(config, "strokeColorField"), "name") ?? "").trim() || null;

        if (fieldName === null || !String(fieldName).trim()) {
          if (currentName === null) return NO_CHANGE;
          dispatchKepler(
            layerVisualChannelConfigChange(
              layer,
              visualChannelPatch({strokeColorField: null}),
              "strokeColor",
            ),
          );
          return;
        }

        const datasetId = dataIdsFromLayer(layer)[0];
        const dataset = requireDataset(datasetId);
        const normalizedFieldName = nonEmptyText(fieldName, "Campo de cor do contorno");
        const field = rawField(dataset, normalizedFieldName);

        if (!field) {
          fail(
            "FIELD_NOT_FOUND",
            `O campo ${fieldName} não existe no dataset da camada.`,
          );
        }
        if (currentName === normalizedFieldName) return NO_CHANGE;

        const scale = defaultScaleForField(field);
        dispatchKepler(
          layerVisualChannelConfigChange(
            layer,
            visualChannelPatch({
              strokeColorField: field,
              strokeColorScale: scale,
            }),
            "strokeColor",
          ),
        );
      });
    },

    setStrokeColorScale(layerId, scale) {
      return run("setStrokeColorScale", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).strokeField) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita escala de contorno.");
        }
        const nextScale = colorScale(scale, "Escala de cor do contorno");
        const field = readValue(layerConfigRecord(layer), "strokeColorField");
        if (!field) {
          fail("COMMAND_INVALID", "Selecione um campo de contorno antes de alterar a escala.");
        }
        ensureScaleSupportsRawField(nextScale, field, "A escala de contorno");
        const currentScale = String(readValue(layerConfigRecord(layer), "strokeColorScale") ?? "");
        if (currentScale === nextScale) return NO_CHANGE;
        dispatchKepler(
          layerVisualChannelConfigChange(
            layer,
            visualChannelPatch({strokeColorScale: nextScale}),
            "strokeColor",
          ),
        );
      });
    },

    setStrokeColorPalette(layerId, colors) {
      return run("setStrokeColorPalette", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).stroke) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita paleta de contorno.");
        }
        return setPalette(layerId, colors, "stroke");
      });
    },

    setStrokeOpacity(layerId, opacity) {
      return run("setStrokeOpacity", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (String(readValue(layer, "type") ?? "") !== "geojson") {
          fail("UNSUPPORTED", "A opacidade de contorno foi confirmada somente para GeoJSON.");
        }
        return updateVisConfig(layerId, {
          strokeOpacity: boundedNumber(opacity, "Opacidade do contorno", 0, 1),
        });
      });
    },

    setStrokeWidth(layerId, width) {
      return run("setStrokeWidth", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).stroke) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita espessura de contorno.");
        }
        return updateVisConfig(layerId, {
          thickness: boundedNumber(width, "Espessura do contorno", 0, 100),
        });
      });
    },

    setPointRadius(layerId, radius) {
      return run("setPointRadius", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).radius) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita raio fixo.");
        }
        return updateVisConfig(layerId, {
          radius: boundedNumber(radius, "Raio", 0, 100),
        });
      });
    },

    setRadiusField(layerId, fieldName) {
      return run("setRadiusField", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).radiusField) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita raio orientado por campo.");
        }
        const config = layerConfigRecord(layer);
        const channelFieldKey = String(readValue(layer, "type") ?? "") === "geojson" ? "radiusField" : "sizeField";
        const channel = String(readValue(layer, "type") ?? "") === "geojson" ? "radius" : "size";
        const currentName = String(readValue(readValue(config, channelFieldKey), "name") ?? "").trim() || null;

        if (fieldName === null || !String(fieldName).trim()) {
          if (currentName === null) return NO_CHANGE;
          dispatchKepler(
            layerVisualChannelConfigChange(
              layer,
              {[channelFieldKey]: null},
              channel,
            ),
          );
          return;
        }

        const datasetId = dataIdsFromLayer(layer)[0];
        const dataset = requireDataset(datasetId);
        const normalizedFieldName = nonEmptyText(fieldName, "Campo de raio");
        const field = rawField(dataset, normalizedFieldName);
        if (!field) {
          fail("FIELD_NOT_FOUND", `O campo ${fieldName} não existe no dataset da camada.`);
        }
        const summary = datasetFieldSummary(field);
        if (!scaleSupportsField("linear", summary) || summary.type == null) {
          fail("COMMAND_INVALID", "O campo de raio deve ser numérico.");
        }
        if (currentName === normalizedFieldName) return NO_CHANGE;

        dispatchKepler(
          layerVisualChannelConfigChange(
            layer,
            {[channelFieldKey]: field},
            channel,
            {radiusRange: [0, 50]},
          ),
        );
      });
    },

    setLayerRadiusRange(layerId, range) {
      return run("setLayerRadiusRange", "editLayerStyle", () => {
        const layer = requireLayer(layerId);
        if (!layerStyleCompatibilityForType(String(readValue(layer, "type") ?? "")).radiusRange) {
          fail("UNSUPPORTED", "Este tipo de camada não aceita faixa de raio.");
        }
        const type = String(readValue(layer, "type") ?? "");
        const minimum = type === "cluster" ? 1 : 0;
        const maximum = type === "cluster" ? 150 : 500;
        const normalized = numericRange(range, minimum, maximum);
        if (!normalized) {
          fail(
            "COMMAND_INVALID",
            `A faixa de raio deve conter mínimo e máximo entre ${minimum} e ${maximum}.`,
          );
        }
        return updateVisConfig(layerId, {radiusRange: normalized});
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
          patch.clusterRadius = boundedNumber(
            options.radius,
            "Raio do agrupamento",
            1,
            500,
          );
        }
        if (options.opacity !== undefined) {
          patch.opacity = boundedNumber(options.opacity, "Opacidade", 0, 1);
        }
        if (options.colorPalette) {
          const normalized = normalizePalette(options.colorPalette);
          if (!normalized) fail("COMMAND_INVALID", "A paleta de cluster é inválida.");
          if (!colorsEqual(currentPalette(layer, "colorRange"), normalized)) {
            patch.colorRange = {
              name: "Maõno cluster",
              type: "sequential",
              category: "Maõno",
              colors: normalized,
            };
          }
        }

        if (!Object.keys(patch).length) return NO_CHANGE;
        return updateVisConfig(layerId, patch);
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
          patch.heatmapRadius = boundedNumber(
            options.radius,
            "Raio do mapa de calor",
            0,
            100,
          );
        }
        if (options.opacity !== undefined) {
          patch.opacity = boundedNumber(options.opacity, "Opacidade", 0, 1);
        }
        if (options.colorPalette) {
          const normalized = normalizePalette(options.colorPalette);
          if (!normalized) fail("COMMAND_INVALID", "A paleta de heatmap é inválida.");
          if (!colorsEqual(currentPalette(layer, "colorRange"), normalized)) {
            patch.colorRange = {
              name: "Maõno heatmap",
              type: "sequential",
              category: "Maõno",
              colors: normalized,
            };
          }
        }

        if (!Object.keys(patch).length) return NO_CHANGE;
        return updateVisConfig(layerId, patch);
      });
    },

    removeDataset(datasetId, options: RemoveDatasetOptions = {}) {
      return run("removeDataset", "removeLayer", () => {
        const id = nonEmptyText(datasetId, "Identificador do dataset");
        requireDataset(id);
        const dependentLayers = rawLayers(getState()).filter((layer) =>
          dataIdsFromLayer(layer).includes(id),
        );

        if (dependentLayers.length && !options.removeDependentLayers) {
          fail(
            "CONFLICT",
            `O dataset possui ${dependentLayers.length} camada(s) dependente(s).`,
          );
        }

        for (const layer of dependentLayers) {
          dispatchKepler(removeKeplerLayer(String(readValue(layer, "id"))));
        }
        dispatchKepler(removeKeplerDataset(id));
        markPersistentDataset(id);
      });
    },

    renameDataset(datasetId, label) {
      return run("renameDataset", "editLayers", () => {
        requireDataset(datasetId);
        nonEmptyText(label, "Nome do dataset");
        fail(
          "UNSUPPORTED",
          "A action de renomear dataset não foi confirmada no pacote Kepler 3.1 disponível.",
        );
      });
    },

    replaceDataset(datasetId, data) {
      return run("replaceDataset", "editLayers", () => {
        requireDataset(datasetId);
        if (data === undefined) {
          fail("COMMAND_INVALID", "Os dados de substituição são obrigatórios.");
        }
        fail(
          "UNSUPPORTED",
          "A substituição transacional de dataset não possui action confirmada nesta versão.",
        );
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

    setFilterType(index, type) {
      return run("setFilterType", "editFilters", () => {
        if (!String(type ?? "").trim()) {
          fail("COMMAND_INVALID", "O tipo do filtro é obrigatório.");
        }
        if (!findRawFilter(getState(), index)) {
          fail("FILTER_NOT_FOUND", `O filtro ${index} não foi encontrado.`);
        }
        fail(
          "UNSUPPORTED",
          "A troca isolada do tipo do filtro não é segura sem recriar seu domínio no Kepler.",
        );
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

    setFilterEnabled(index, enabled) {
      return run("setFilterEnabled", "editFilters", () => {
        const filter = findRawFilter(getState(), index);
        if (!filter) {
          fail("FILTER_NOT_FOUND", `O filtro ${index} não foi encontrado.`);
        }
        const next = Boolean(enabled);
        if ((readValue(filter, "enabled") !== false) === next) {
          return NO_CHANGE;
        }
        dispatchKepler(setFilter(index, "enabled", next));
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

    setTooltipEnabled(enabled) {
      return run("setTooltipEnabled", "configureTooltips", () => {
        const interactionConfig = readValue(
          selectKeplerVisState(getState()),
          "interactionConfig",
        );
        const tooltip = readValue(interactionConfig, "tooltip");
        const next = Boolean(enabled);
        if ((readValue(tooltip, "enabled") !== false) === next) {
          return NO_CHANGE;
        }
        dispatchKepler(
          interactionConfigChange({
            ...(typeof tooltip?.toJS === "function"
              ? tooltip.toJS()
              : tooltip || {}),
            id: String(readValue(tooltip, "id") ?? "tooltip"),
            enabled: next,
          }),
        );
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
            ...(typeof tooltip?.toJS === "function"
              ? tooltip.toJS()
              : tooltip || {}),
            id: String(readValue(tooltip, "id") ?? "tooltip"),
            enabled: true,
            config: {
              ...(typeof tooltipConfig?.toJS === "function"
                ? tooltipConfig.toJS()
                : tooltipConfig),
              fieldsToShow: normalized,
            },
          }),
        );
      });
    },

    fitVisibleData() {
      return run("fitVisibleData", "focusMapData", () => fitData(false));
    },

    fitFilteredData() {
      return run("fitFilteredData", "focusMapData", () => fitData(true));
    },

    updateViewport(viewport: MapViewportUpdate) {
      return run("updateViewport", "focusMapData", () => {
        const current = selectKeplerViewportState(getState());
        if (!current) {
          fail("MAP_UNAVAILABLE", "O viewport do mapa ainda não está disponível.");
        }
        const patch: Record<string, number> = {};
        const ranges = {
          longitude: [-180, 180],
          latitude: [-90, 90],
          zoom: [0, 30],
          bearing: [-360, 360],
          pitch: [0, 85],
        } as const;
        for (const [key, value] of Object.entries(viewport)) {
          if (value === undefined) continue;
          const [minimum, maximum] = ranges[key as keyof typeof ranges];
          const normalized = boundedNumber(value, key, minimum, maximum);
          if (Number(readValue(current, key)) !== normalized) {
            patch[key] = normalized;
          }
        }
        if (!Object.keys(patch).length) return NO_CHANGE;
        dispatchKepler(updateMap(patch));
      });
    },

    fitBounds(bounds) {
      return run("fitBounds", "focusMapData", () => {
        const viewportState = selectKeplerViewportState(getState());
        const nextViewState = mapBoundsToViewState(viewportState, bounds);
        dispatchKepler(updateMap(nextViewState));
      });
    },

    setLegendVisible(visible) {
      return run("setLegendVisible", "toggleLegend", () => {
        const mapState = selectKeplerMapState(getState());
        const uiState = readValue(mapState, "uiState");
        const controls = readValue(uiState, "mapControls");
        const legend = readValue(controls, "mapLegend");
        const current = readValue(legend, "active") === true;
        if (current === Boolean(visible)) return NO_CHANGE;
        dispatchKepler(toggleMapControl("mapLegend", 0));
      });
    },

    toggleLegend() {
      return run("toggleLegend", "toggleLegend", () => {
        dispatchKepler(toggleMapControl("mapLegend", 0));
      });
    },

    setBasemapStyle(styleType) {
      return run("setBasemapStyle", "editLayerStyle", () => {
        const normalized = nonEmptyText(styleType, "Estilo do mapa-base");
        const mapState = selectKeplerMapState(getState());
        const mapStyle = readValue(mapState, "mapStyle");
        const styles = readValue(mapStyle, "mapStyles");
        const available = readValue(styles, normalized);
        if (!available) {
          fail("COMMAND_INVALID", `O estilo de mapa-base ${normalized} não está disponível.`);
        }
        if (String(readValue(mapStyle, "styleType") ?? "") === normalized) {
          return NO_CHANGE;
        }
        dispatchKepler(mapStyleChange(normalized));
      });
    },

    updateBasemapOptions(options) {
      if (!options || typeof options !== "object") {
        return {
          ok: false,
          code: "COMMAND_INVALID",
          reason: "As opções do mapa-base são obrigatórias.",
          command: "updateBasemapOptions",
        };
      }
      return unsupported(
        "updateBasemapOptions",
        "editLayerStyle",
        "As actions de grupos do basemap não estão confirmadas nos arquivos anexados.",
      );
    },

    setLayerBlending(mode) {
      return run("setLayerBlending", "editLayerStyle", () => {
        const normalized = layerBlendingMode(mode);
        if (!normalized) {
          fail(
            "COMMAND_INVALID",
            "O blending de camadas deve ser normal, additive ou subtractive.",
          );
        }
        const visState = selectKeplerVisState(getState());
        if (String(readValue(visState, "layerBlending") ?? "normal") === normalized) {
          return NO_CHANGE;
        }
        dispatchKepler(updateLayerBlending(normalized));
      });
    },

    setOverlayBlending(mode) {
      return run("setOverlayBlending", "editLayerStyle", () => {
        const normalized = overlayBlendingMode(mode);
        if (!normalized) {
          fail(
            "COMMAND_INVALID",
            "O blending de overlays deve ser normal, screen ou darken.",
          );
        }
        const visState = selectKeplerVisState(getState());
        if (String(readValue(visState, "overlayBlending") ?? "normal") === normalized) {
          return NO_CHANGE;
        }
        dispatchKepler(updateOverlayBlending(normalized));
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
        dispatchKepler(removeKeplerDataset(id));
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
