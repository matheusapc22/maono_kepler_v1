import type {
  KeplerEngineCommands,
  KeplerEngineState,
  MapLayerSummary,
} from "../engine-adapter/types.ts";

export type ViewerLayerDefinitionSnapshot = {
  type: "point" | "cluster" | "heatmap" | "geojson";
  dataIds: string[];
  label: string;
  columns: {
    latitude: string | null;
    longitude: string | null;
    geojson: string | null;
    altitude: string | null;
  };
  colorField: string | null;
  colorScale: string | null;
  colorPalette: string[];
  colorPaletteId: string | null;
  strokeColorField: string | null;
  strokeColorScale: string | null;
  strokeColorPalette: string[];
  strokeColorPaletteId: string | null;
  radiusField: string | null;
  radiusScale: string | null;
  radiusRange: [number, number] | null;
};

export type ViewerLayerDefinitionUpdatePayload = {
  targetLayerId: string;
  before: ViewerLayerDefinitionSnapshot;
  after: ViewerLayerDefinitionSnapshot;
};

export type ViewerTooltipField = {
  name: string;
  format: string | null;
};

export type ViewerTooltipSnapshot = {
  enabled: boolean;
  fieldsByDataset: Record<string, ViewerTooltipField[]>;
};

export type ViewerTooltipConfigUpdatePayload = {
  before: ViewerTooltipSnapshot;
  after: ViewerTooltipSnapshot;
};

export type ViewerMapBlendingSnapshot = {
  layers: "normal" | "additive" | "subtractive";
  overlays: "normal" | "screen" | "darken";
};

export type ViewerMapBlendingUpdatePayload = {
  before: ViewerMapBlendingSnapshot;
  after: ViewerMapBlendingSnapshot;
};

export type ViewerMutationPolicyKind = "persistent" | "session" | "blocked";

export type ViewerMutationPolicy = {
  kind: ViewerMutationPolicyKind;
  operation?:
    | "point.create"
    | "layer.create"
    | "layer.duplicate"
    | "layer.remove"
    | "layer.style.update"
    | "layer.definition.update"
    | "layer.visibility.update"
    | "persistent.filter.update"
    | "layer.order.update"
    | "tooltip.config.update"
    | "map.blending.update"
    | "buffer.create"
    | "isochrone.create"
    | "dynamic";
};

const SUPPORTED_LAYER_TYPES = new Set([
  "point",
  "cluster",
  "heatmap",
  "geojson",
]);
const COLOR_SCALES = new Set([
  "quantile",
  "quantize",
  "linear",
  "sqrt",
  "log",
  "ordinal",
]);
const LAYER_BLEND = new Set(["normal", "additive", "subtractive"]);
const OVERLAY_BLEND = new Set(["normal", "screen", "darken"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximum = 300) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.length <= maximum ? normalized : "";
}

function optionalText(value: unknown, maximum = 300) {
  if (value == null || value === "") return null;
  return text(value, maximum) || null;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const expected = new Set(allowed);
  return Object.keys(value).every((key) => expected.has(key));
}

function palette(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some(
      (color) => typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color),
    )
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  return value.map(String);
}

function nullableRange(value: unknown): [number, number] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  const minimum = Number(value[0]);
  const maximum = Number(value[1]);
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    minimum < 0 ||
    maximum > 10_000 ||
    minimum > maximum
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  return [minimum, maximum];
}

export function viewerJsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateViewerLayerDefinitionSnapshot(
  value: unknown,
): asserts value is ViewerLayerDefinitionSnapshot {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, [
      "type",
      "dataIds",
      "label",
      "columns",
      "colorField",
      "colorScale",
      "colorPalette",
      "colorPaletteId",
      "strokeColorField",
      "strokeColorScale",
      "strokeColorPalette",
      "strokeColorPaletteId",
      "radiusField",
      "radiusScale",
      "radiusRange",
    ]) ||
    !SUPPORTED_LAYER_TYPES.has(text(source.type, 40)) ||
    !text(source.label, 300) ||
    !Array.isArray(source.dataIds) ||
    source.dataIds.length < 1 ||
    source.dataIds.length > 20
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }

  const dataIds = source.dataIds.map((item) => text(item, 200));
  if (dataIds.some((id) => !id) || new Set(dataIds).size !== dataIds.length) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }

  const columns = record(source.columns);
  if (
    !columns ||
    !exactKeys(columns, ["latitude", "longitude", "geojson", "altitude"])
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  for (const key of ["latitude", "longitude", "geojson", "altitude"] as const) {
    if (columns[key] != null && !text(columns[key], 200)) {
      throw new Error("WORKING_COPY_OPERATION_INVALID");
    }
  }

  for (const key of [
    "colorField",
    "colorPaletteId",
    "strokeColorField",
    "strokeColorPaletteId",
    "radiusField",
    "radiusScale",
  ] as const) {
    if (source[key] != null && !text(source[key], 200)) {
      throw new Error("WORKING_COPY_OPERATION_INVALID");
    }
  }
  for (const key of ["colorScale", "strokeColorScale"] as const) {
    if (
      source[key] != null &&
      !COLOR_SCALES.has(String(source[key]).trim().toLowerCase())
    ) {
      throw new Error("WORKING_COPY_OPERATION_INVALID");
    }
  }
  palette(source.colorPalette);
  palette(source.strokeColorPalette);
  nullableRange(source.radiusRange);
}

export function validateViewerLayerDefinitionPayload(payload: unknown) {
  const source = record(payload);
  if (
    !source ||
    !exactKeys(source, ["targetLayerId", "before", "after"]) ||
    !text(source.targetLayerId, 200)
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  validateViewerLayerDefinitionSnapshot(source.before);
  validateViewerLayerDefinitionSnapshot(source.after);
  if (viewerJsonEqual(source.before, source.after)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

function validTooltipFields(value: unknown) {
  const source = record(value);
  if (!source || Object.keys(source).length > 100) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  for (const [datasetId, fields] of Object.entries(source)) {
    if (!text(datasetId, 200) || !Array.isArray(fields) || fields.length > 100) {
      throw new Error("WORKING_COPY_OPERATION_INVALID");
    }
    for (const item of fields) {
      const field = record(item);
      if (
        !field ||
        !exactKeys(field, ["name", "format"]) ||
        !text(field.name, 200) ||
        (field.format != null && !text(field.format, 120))
      ) {
        throw new Error("WORKING_COPY_OPERATION_INVALID");
      }
    }
  }
}

export function validateViewerTooltipSnapshot(
  value: unknown,
): asserts value is ViewerTooltipSnapshot {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["enabled", "fieldsByDataset"]) ||
    typeof source.enabled !== "boolean"
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  validTooltipFields(source.fieldsByDataset);
}

export function validateViewerTooltipPayload(payload: unknown) {
  const source = record(payload);
  if (!source || !exactKeys(source, ["before", "after"])) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  validateViewerTooltipSnapshot(source.before);
  validateViewerTooltipSnapshot(source.after);
  if (viewerJsonEqual(source.before, source.after)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

export function validateViewerMapBlendingSnapshot(
  value: unknown,
): asserts value is ViewerMapBlendingSnapshot {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["layers", "overlays"]) ||
    !LAYER_BLEND.has(String(source.layers)) ||
    !OVERLAY_BLEND.has(String(source.overlays))
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

export function validateViewerMapBlendingPayload(payload: unknown) {
  const source = record(payload);
  if (!source || !exactKeys(source, ["before", "after"])) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  validateViewerMapBlendingSnapshot(source.before);
  validateViewerMapBlendingSnapshot(source.after);
  if (viewerJsonEqual(source.before, source.after)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

function scale(value: string | null) {
  const normalized = optionalText(value, 80)?.toLowerCase() || null;
  return normalized && COLOR_SCALES.has(normalized) ? normalized : null;
}

export function snapshotViewerLayerDefinition(
  layer: MapLayerSummary,
): ViewerLayerDefinitionSnapshot | null {
  const type = String(layer.type || "").trim().toLowerCase();
  if (!SUPPORTED_LAYER_TYPES.has(type) || !layer.dataIds.length) return null;
  const snapshot: ViewerLayerDefinitionSnapshot = {
    type: type as ViewerLayerDefinitionSnapshot["type"],
    dataIds: layer.dataIds.map(String),
    label: String(layer.label || layer.id).trim(),
    columns: {
      latitude: optionalText(layer.columns.latitude, 200),
      longitude: optionalText(layer.columns.longitude, 200),
      geojson: optionalText(layer.columns.geojson, 200),
      altitude: optionalText(layer.columns.altitude, 200),
    },
    colorField: optionalText(layer.style.colorField, 200),
    colorScale: scale(layer.style.colorScale),
    colorPalette: [...layer.style.colorPalette],
    colorPaletteId: optionalText(layer.style.colorPaletteId, 120),
    strokeColorField: optionalText(layer.style.strokeColorField, 200),
    strokeColorScale: scale(layer.style.strokeColorScale),
    strokeColorPalette: [...layer.style.strokeColorPalette],
    strokeColorPaletteId: optionalText(layer.style.strokeColorPaletteId, 120),
    radiusField: optionalText(layer.style.radiusField, 200),
    radiusScale: optionalText(layer.style.radiusScale, 80),
    radiusRange: layer.style.radiusRange
      ? [Number(layer.style.radiusRange[0]), Number(layer.style.radiusRange[1])]
      : null,
  };
  try {
    validateViewerLayerDefinitionSnapshot(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

export function snapshotViewerTooltip(
  state: Pick<KeplerEngineState, "interaction">,
): ViewerTooltipSnapshot {
  const fieldsByDataset = Object.fromEntries(
    Object.entries(state.interaction.tooltip.fieldsByDataset || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([datasetId, fields]) => [
        datasetId,
        fields.map((field) => ({
          name: String(field.name),
          format: field.format == null ? null : String(field.format),
        })),
      ]),
  );
  return {
    enabled: Boolean(state.interaction.tooltip.enabled),
    fieldsByDataset,
  };
}

export function snapshotViewerMapBlending(
  state: Pick<KeplerEngineState, "basemap">,
): ViewerMapBlendingSnapshot {
  const layers = String(state.basemap.blending.layers || "normal");
  const overlays = String(state.basemap.blending.overlays || "normal");
  return {
    layers: (LAYER_BLEND.has(layers) ? layers : "normal") as ViewerMapBlendingSnapshot["layers"],
    overlays: (OVERLAY_BLEND.has(overlays)
      ? overlays
      : "normal") as ViewerMapBlendingSnapshot["overlays"],
  };
}

export function applyViewerLayerDefinition(
  commands: KeplerEngineCommands,
  layerId: string,
  snapshot: ViewerLayerDefinitionSnapshot,
) {
  const results = [];
  results.push(commands.renameLayer(layerId, snapshot.label));
  results.push(commands.setLayerType(layerId, snapshot.type));
  if (snapshot.dataIds.length === 1) {
    results.push(commands.associateLayerDataset(layerId, snapshot.dataIds[0]));
  }
  results.push(commands.setLayerColumns(layerId, snapshot.columns));
  results.push(commands.setColorField(layerId, snapshot.colorField));
  if (snapshot.colorField && snapshot.colorScale) {
    results.push(commands.setColorScale(layerId, snapshot.colorScale));
  }
  if (snapshot.colorPalette.length >= 2) {
    results.push(commands.setColorPalette(layerId, snapshot.colorPalette));
  }
  results.push(commands.setStrokeColorField(layerId, snapshot.strokeColorField));
  if (snapshot.strokeColorField && snapshot.strokeColorScale) {
    results.push(commands.setStrokeColorScale(layerId, snapshot.strokeColorScale));
  }
  if (snapshot.strokeColorPalette.length >= 2) {
    results.push(commands.setStrokeColorPalette(layerId, snapshot.strokeColorPalette));
  }
  results.push(commands.setRadiusField(layerId, snapshot.radiusField));
  if (snapshot.radiusRange) {
    results.push(commands.setLayerRadiusRange(layerId, snapshot.radiusRange));
  }
  return {
    ok: results.every((result) => result.ok),
    changed: results.some((result) => result.ok && result.changed),
    error: results.find((result) => !result.ok)?.reason || null,
  };
}

export const VIEWER_MUTATION_POLICY = {
  selectLayer: { kind: "session" },
  setLayerVisibility: { kind: "persistent", operation: "layer.visibility.update" },
  renameLayer: { kind: "persistent", operation: "layer.definition.update" },
  duplicateLayer: { kind: "persistent", operation: "layer.duplicate" },
  removeLayer: { kind: "persistent", operation: "layer.remove" },
  reorderLayer: { kind: "persistent", operation: "layer.order.update" },
  openAddDataModal: { kind: "blocked" },
  createLayerFromDataset: { kind: "persistent", operation: "layer.create" },
  setLayerType: { kind: "persistent", operation: "layer.definition.update" },
  associateLayerDataset: { kind: "persistent", operation: "layer.definition.update" },
  setLayerColumns: { kind: "persistent", operation: "layer.definition.update" },
  setLayerOpacity: { kind: "persistent", operation: "layer.style.update" },
  setFixedColor: { kind: "persistent", operation: "layer.style.update" },
  setColorField: { kind: "persistent", operation: "layer.definition.update" },
  setColorScale: { kind: "persistent", operation: "layer.definition.update" },
  setColorPalette: { kind: "persistent", operation: "layer.definition.update" },
  setFillEnabled: { kind: "persistent", operation: "layer.style.update" },
  setStrokeEnabled: { kind: "persistent", operation: "layer.style.update" },
  setStrokeColor: { kind: "persistent", operation: "layer.style.update" },
  setStrokeColorField: { kind: "persistent", operation: "layer.definition.update" },
  setStrokeColorScale: { kind: "persistent", operation: "layer.definition.update" },
  setStrokeColorPalette: { kind: "persistent", operation: "layer.definition.update" },
  setStrokeOpacity: { kind: "persistent", operation: "layer.style.update" },
  setStrokeWidth: { kind: "persistent", operation: "layer.style.update" },
  setPointRadius: { kind: "persistent", operation: "layer.style.update" },
  setRadiusField: { kind: "persistent", operation: "layer.definition.update" },
  setLayerRadiusRange: { kind: "persistent", operation: "layer.definition.update" },
  setClusterOptions: { kind: "persistent", operation: "layer.style.update" },
  setHeatmapOptions: { kind: "persistent", operation: "layer.style.update" },
  removeDataset: { kind: "blocked" },
  renameDataset: { kind: "blocked" },
  replaceDataset: { kind: "blocked" },
  addFilter: { kind: "persistent", operation: "persistent.filter.update" },
  bindFilterField: { kind: "persistent", operation: "persistent.filter.update" },
  setFilterField: { kind: "persistent", operation: "persistent.filter.update" },
  setFilterType: { kind: "blocked" },
  setFilterValue: { kind: "persistent", operation: "persistent.filter.update" },
  setFilterEnabled: { kind: "persistent", operation: "persistent.filter.update" },
  removeFilter: { kind: "persistent", operation: "persistent.filter.update" },
  setTooltipEnabled: { kind: "persistent", operation: "tooltip.config.update" },
  setTooltipFields: { kind: "persistent", operation: "tooltip.config.update" },
  fitVisibleData: { kind: "session" },
  fitFilteredData: { kind: "session" },
  updateViewport: { kind: "session" },
  fitBounds: { kind: "session" },
  setLegendVisible: { kind: "session" },
  toggleLegend: { kind: "session" },
  setBasemapStyle: { kind: "session" },
  updateBasemapOptions: { kind: "blocked" },
  setLayerBlending: { kind: "persistent", operation: "map.blending.update" },
  setOverlayBlending: { kind: "persistent", operation: "map.blending.update" },
  addGeoJsonLayer: { kind: "blocked", operation: "dynamic" },
  removeTransientLayer: { kind: "session", operation: "dynamic" },
  markLayerPersistent: { kind: "session", operation: "dynamic" },
  markLayerTransient: { kind: "session", operation: "dynamic" },
} as const satisfies Record<keyof KeplerEngineCommands, ViewerMutationPolicy>;
