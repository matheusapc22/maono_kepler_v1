import type { MapLayerSummary } from "../engine-adapter/types.ts";

export const VIEWER_LAYER_LIFECYCLE_TYPES = Object.freeze([
  "layer.create",
  "layer.duplicate",
  "layer.remove",
] as const);

export type ViewerLayerLifecycleType =
  (typeof VIEWER_LAYER_LIFECYCLE_TYPES)[number];

export type ViewerLayerSnapshot = {
  id: string;
  type: "point" | "cluster" | "heatmap" | "geojson";
  dataIds: string[];
  label: string;
  isVisible: boolean;
  columns: {
    latitude: string | null;
    longitude: string | null;
    geojson: string | null;
    altitude: string | null;
  };
  style: {
    fillEnabled: boolean;
    opacity: number;
    color: [number, number, number];
    colorField: string | null;
    colorScale: string | null;
    colorPalette: string[];
    colorPaletteId: string | null;
    strokeEnabled: boolean;
    strokeColor: [number, number, number];
    strokeColorField: string | null;
    strokeColorScale: string | null;
    strokeColorPalette: string[];
    strokeColorPaletteId: string | null;
    strokeOpacity: number;
    strokeWidth: number;
    pointRadius: number | null;
    radiusField: string | null;
    radiusScale: string | null;
    radiusRange: [number, number] | null;
    clusterRadius: number | null;
    heatmapRadius: number | null;
  };
  visualChannels: {
    color: { field: string | null; scale: string | null };
    strokeColor: { field: string | null; scale: string | null };
    size: { field: string | null; scale: string | null };
    height: { field: string | null; scale: string | null };
  };
};

export type ViewerLayerCreatePayload = {
  layer: ViewerLayerSnapshot;
  insertIndex: number;
};

export type ViewerLayerDuplicatePayload = {
  sourceLayerId: string;
  source: ViewerLayerSnapshot;
  layer: ViewerLayerSnapshot;
  insertIndex: number;
};

export type ViewerLayerRemovePayload = {
  targetLayerId: string;
  before: ViewerLayerSnapshot;
  previousIndex: number;
};

export type ViewerLayerLifecyclePayload =
  | ViewerLayerCreatePayload
  | ViewerLayerDuplicatePayload
  | ViewerLayerRemovePayload;

const SUPPORTED_TYPES = new Set<ViewerLayerSnapshot["type"]>([
  "point",
  "cluster",
  "heatmap",
  "geojson",
]);
const COLUMN_KEYS = ["latitude", "longitude", "geojson", "altitude"] as const;
const STYLE_KEYS = [
  "fillEnabled",
  "opacity",
  "color",
  "colorField",
  "colorScale",
  "colorPalette",
  "colorPaletteId",
  "strokeEnabled",
  "strokeColor",
  "strokeColorField",
  "strokeColorScale",
  "strokeColorPalette",
  "strokeColorPaletteId",
  "strokeOpacity",
  "strokeWidth",
  "pointRadius",
  "radiusField",
  "radiusScale",
  "radiusRange",
  "clusterRadius",
  "heatmapRadius",
] as const;
const VISUAL_CHANNEL_KEYS = ["color", "strokeColor", "size", "height"] as const;

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

function validRgb(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((channel) => {
      const number = Number(channel);
      return Number.isFinite(number) && number >= 0 && number <= 255;
    })
  );
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  nullable = false,
) {
  if (nullable && value == null) return true;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const expected = new Set(allowed);
  return Object.keys(value).every((key) => expected.has(key));
}

function validPalette(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every(
      (color) => typeof color === "string" && /^#[0-9A-Fa-f]{6}$/.test(color),
    )
  );
}

function validateChannel(value: unknown) {
  const source = record(value);
  if (!source || !exactKeys(source, ["field", "scale"])) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  if (source.field != null && !text(source.field, 200)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  if (source.scale != null && !text(source.scale, 80)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

export function validateViewerLayerSnapshot(value: unknown): asserts value is ViewerLayerSnapshot {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, [
      "id",
      "type",
      "dataIds",
      "label",
      "isVisible",
      "columns",
      "style",
      "visualChannels",
    ]) ||
    !text(source.id, 200) ||
    !SUPPORTED_TYPES.has(String(source.type) as ViewerLayerSnapshot["type"]) ||
    !text(source.label, 300) ||
    typeof source.isVisible !== "boolean" ||
    !Array.isArray(source.dataIds) ||
    source.dataIds.length < 1 ||
    source.dataIds.length > 20
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }

  const dataIds = source.dataIds.map((item) => text(item, 200));
  if (dataIds.some((item) => !item) || new Set(dataIds).size !== dataIds.length) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }

  const columns = record(source.columns);
  if (!columns || !exactKeys(columns, COLUMN_KEYS)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  for (const key of COLUMN_KEYS) {
    if (columns[key] != null && !text(columns[key], 200)) {
      throw new Error("WORKING_COPY_OPERATION_INVALID");
    }
  }

  const style = record(source.style);
  if (
    !style ||
    !exactKeys(style, STYLE_KEYS) ||
    typeof style.fillEnabled !== "boolean" ||
    typeof style.strokeEnabled !== "boolean" ||
    !boundedNumber(style.opacity, 0, 1) ||
    !validRgb(style.color) ||
    !validRgb(style.strokeColor) ||
    !validPalette(style.colorPalette) ||
    !validPalette(style.strokeColorPalette) ||
    !boundedNumber(style.strokeOpacity, 0, 1) ||
    !boundedNumber(style.strokeWidth, 0, 500) ||
    !boundedNumber(style.pointRadius, 0, 500, true) ||
    !boundedNumber(style.clusterRadius, 0, 500, true) ||
    !boundedNumber(style.heatmapRadius, 0, 500, true)
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  for (const key of [
    "colorField",
    "colorScale",
    "colorPaletteId",
    "strokeColorField",
    "strokeColorScale",
    "strokeColorPaletteId",
    "radiusField",
    "radiusScale",
  ] as const) {
    if (style[key] != null && !text(style[key], 200)) {
      throw new Error("WORKING_COPY_OPERATION_INVALID");
    }
  }
  if (
    style.radiusRange != null &&
    (!Array.isArray(style.radiusRange) ||
      style.radiusRange.length !== 2 ||
      !style.radiusRange.every((entry) => boundedNumber(entry, 0, 10000)) ||
      Number(style.radiusRange[0]) > Number(style.radiusRange[1]))
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }

  const visualChannels = record(source.visualChannels);
  if (!visualChannels || !exactKeys(visualChannels, VISUAL_CHANNEL_KEYS)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  for (const key of VISUAL_CHANNEL_KEYS) validateChannel(visualChannels[key]);
}

function validIndex(value: unknown) {
  return Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 500;
}

export function validateViewerLayerCreatePayload(payload: unknown) {
  const source = record(payload);
  if (!source || !exactKeys(source, ["layer", "insertIndex"]) || !validIndex(source.insertIndex)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  validateViewerLayerSnapshot(source.layer);
}

export function validateViewerLayerDuplicatePayload(payload: unknown) {
  const source = record(payload);
  if (
    !source ||
    !exactKeys(source, ["sourceLayerId", "source", "layer", "insertIndex"]) ||
    !text(source.sourceLayerId, 200) ||
    !validIndex(source.insertIndex)
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  validateViewerLayerSnapshot(source.source);
  validateViewerLayerSnapshot(source.layer);
  const sourceLayer = source.source as ViewerLayerSnapshot;
  const createdLayer = source.layer as ViewerLayerSnapshot;
  if (
    sourceLayer.id !== String(source.sourceLayerId) ||
    sourceLayer.id === createdLayer.id ||
    sourceLayer.type !== createdLayer.type ||
    JSON.stringify(sourceLayer.dataIds) !== JSON.stringify(createdLayer.dataIds)
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

export function validateViewerLayerRemovePayload(payload: unknown) {
  const source = record(payload);
  if (
    !source ||
    !exactKeys(source, ["targetLayerId", "before", "previousIndex"]) ||
    !text(source.targetLayerId, 200) ||
    !validIndex(source.previousIndex)
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  validateViewerLayerSnapshot(source.before);
  if ((source.before as ViewerLayerSnapshot).id !== String(source.targetLayerId)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

function rgb(value: [number, number, number]): [number, number, number] {
  return value.map((channel) => Math.round(Number(channel))) as [number, number, number];
}

function channel(value: { field: string | null; scale: string | null }) {
  return {
    field: optionalText(value.field, 200),
    scale: optionalText(value.scale, 80),
  };
}

export function snapshotViewerLifecycleLayer(
  layer: MapLayerSummary,
): ViewerLayerSnapshot | null {
  const type = String(layer.type || "").toLowerCase() as ViewerLayerSnapshot["type"];
  if (!SUPPORTED_TYPES.has(type) || !layer.dataIds.length) return null;
  const snapshot: ViewerLayerSnapshot = {
    id: text(layer.id, 200),
    type,
    dataIds: layer.dataIds.map((id) => text(id, 200)).filter(Boolean),
    label: text(layer.label, 300),
    isVisible: Boolean(layer.isVisible),
    columns: {
      latitude: optionalText(layer.columns.latitude, 200),
      longitude: optionalText(layer.columns.longitude, 200),
      geojson: optionalText(layer.columns.geojson, 200),
      altitude: optionalText(layer.columns.altitude, 200),
    },
    style: {
      fillEnabled: Boolean(layer.style.fillEnabled),
      opacity: Number(layer.style.opacity),
      color: rgb(layer.style.color),
      colorField: optionalText(layer.style.colorField, 200),
      colorScale: optionalText(layer.style.colorScale, 80),
      colorPalette: [...layer.style.colorPalette],
      colorPaletteId: optionalText(layer.style.colorPaletteId, 120),
      strokeEnabled: Boolean(layer.style.strokeEnabled),
      strokeColor: rgb(layer.style.strokeColor),
      strokeColorField: optionalText(layer.style.strokeColorField, 200),
      strokeColorScale: optionalText(layer.style.strokeColorScale, 80),
      strokeColorPalette: [...layer.style.strokeColorPalette],
      strokeColorPaletteId: optionalText(layer.style.strokeColorPaletteId, 120),
      strokeOpacity: Number(layer.style.strokeOpacity),
      strokeWidth: Number(layer.style.strokeWidth),
      pointRadius: layer.style.pointRadius == null ? null : Number(layer.style.pointRadius),
      radiusField: optionalText(layer.style.radiusField, 200),
      radiusScale: optionalText(layer.style.radiusScale, 80),
      radiusRange: layer.style.radiusRange
        ? [Number(layer.style.radiusRange[0]), Number(layer.style.radiusRange[1])]
        : null,
      clusterRadius: layer.style.clusterRadius == null ? null : Number(layer.style.clusterRadius),
      heatmapRadius: layer.style.heatmapRadius == null ? null : Number(layer.style.heatmapRadius),
    },
    visualChannels: {
      color: channel(layer.visualChannels.color),
      strokeColor: channel(layer.visualChannels.strokeColor),
      size: channel(layer.visualChannels.size),
      height: channel(layer.visualChannels.height),
    },
  };
  try {
    validateViewerLayerSnapshot(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

function duplicateSignature(snapshot: ViewerLayerSnapshot) {
  return JSON.stringify({
    type: snapshot.type,
    dataIds: snapshot.dataIds,
    isVisible: snapshot.isVisible,
    columns: snapshot.columns,
    style: snapshot.style,
    visualChannels: snapshot.visualChannels,
  });
}

export function inferViewerDuplicateSource(
  previousLayers: MapLayerSummary[],
  createdLayer: MapLayerSummary,
  insertIndex: number,
) {
  const created = snapshotViewerLifecycleLayer(createdLayer);
  if (!created) return null;
  const signature = duplicateSignature(created);
  const candidates = previousLayers.flatMap((layer) => {
    const snapshot = snapshotViewerLifecycleLayer(layer);
    return snapshot && duplicateSignature(snapshot) === signature
      ? [{ layer, snapshot }]
      : [];
  });
  if (!candidates.length) return null;
  candidates.sort(
    (left, right) =>
      Math.abs(left.layer.order - insertIndex) - Math.abs(right.layer.order - insertIndex),
  );
  return candidates[0]?.snapshot || null;
}

export function isViewerLayerLifecycleOperation(operation: { type?: unknown } | null | undefined) {
  return VIEWER_LAYER_LIFECYCLE_TYPES.includes(
    String(operation?.type || "") as ViewerLayerLifecycleType,
  );
}

export function viewerLifecycleCreatedLayerId(
  operation: { type?: unknown; payload?: unknown },
) {
  const source = record(operation.payload);
  if (operation.type !== "layer.create" && operation.type !== "layer.duplicate") {
    return null;
  }
  const layer = record(source?.layer);
  return text(layer?.id, 200) || null;
}

export function viewerLifecycleTargetLayerId(
  operation: { type?: unknown; payload?: unknown },
) {
  const source = record(operation.payload);
  if (operation.type === "layer.create" || operation.type === "layer.duplicate") {
    return text(record(source?.layer)?.id, 200) || null;
  }
  if (operation.type === "layer.remove") {
    return text(source?.targetLayerId, 200) || null;
  }
  if (
    operation.type === "layer.style.update" ||
    operation.type === "layer.visibility.update" ||
    operation.type === "point.create" ||
    operation.type === "buffer.create" ||
    operation.type === "isochrone.create"
  ) {
    return text(source?.targetLayerId, 200) || null;
  }
  return null;
}

export function compactViewerOperationsForLocalLayerRemoval<
  T extends { type: string; payload: unknown },
>(operations: T[], layerId: string): T[] {
  const normalizedLayerId = text(layerId, 200);
  if (!normalizedLayerId) return [...operations];
  const bornLocally = operations.some(
    (operation) => viewerLifecycleCreatedLayerId(operation) === normalizedLayerId,
  );
  if (!bornLocally) return [...operations];

  return operations.flatMap((operation) => {
    if (viewerLifecycleTargetLayerId(operation) === normalizedLayerId) return [];
    if (operation.type !== "layer.order.update") return [operation];
    const payload = record(operation.payload);
    const before = Array.isArray(payload?.before)
      ? payload.before.map(String).filter((id) => id !== normalizedLayerId)
      : null;
    const after = Array.isArray(payload?.after)
      ? payload.after.map(String).filter((id) => id !== normalizedLayerId)
      : null;
    if (!before || !after) return [operation];
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    return [
      {
        ...operation,
        payload: { ...payload, before, after },
      } as T,
    ];
  });
}
