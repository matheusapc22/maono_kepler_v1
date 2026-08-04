import type {
  MapColorScale,
  MapDatasetField,
  MapLayerStyleCompatibility,
  MapManagedLayerType,
  MapRgbColor,
} from "./types.ts";

export const NUMERIC_COLOR_SCALES = [
  "quantile",
  "quantize",
  "linear",
  "sqrt",
  "log",
] as const satisfies readonly MapColorScale[];

export const CATEGORICAL_COLOR_SCALES = [
  "ordinal",
] as const satisfies readonly MapColorScale[];

export const LAYER_BLENDING_MODES = [
  "normal",
  "additive",
  "subtractive",
] as const;

export const OVERLAY_BLENDING_MODES = [
  "normal",
  "screen",
  "darken",
] as const;

export function managedStyleType(value: string): MapManagedLayerType | null {
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  return normalized === "point" ||
    normalized === "cluster" ||
    normalized === "heatmap" ||
    normalized === "geojson"
    ? normalized
    : null;
}

export function layerStyleCompatibilityForType(
  value: string,
): MapLayerStyleCompatibility {
  const type = managedStyleType(value);

  if (type === "point") {
    return {
      supported: true,
      fixedColor: true,
      colorField: true,
      colorScale: true,
      palette: true,
      opacity: true,
      fill: true,
      stroke: true,
      strokeField: true,
      radius: true,
      radiusField: true,
      radiusRange: true,
      clusterRadius: false,
      heatmapRadius: false,
    };
  }

  if (type === "cluster") {
    return {
      supported: true,
      fixedColor: false,
      colorField: true,
      colorScale: true,
      palette: true,
      opacity: true,
      fill: false,
      stroke: false,
      strokeField: false,
      radius: false,
      radiusField: false,
      radiusRange: true,
      clusterRadius: true,
      heatmapRadius: false,
    };
  }

  if (type === "heatmap") {
    return {
      supported: true,
      fixedColor: false,
      colorField: false,
      colorScale: false,
      palette: true,
      opacity: true,
      fill: false,
      stroke: false,
      strokeField: false,
      radius: false,
      radiusField: false,
      radiusRange: false,
      clusterRadius: false,
      heatmapRadius: true,
    };
  }

  if (type === "geojson") {
    return {
      supported: true,
      fixedColor: true,
      colorField: true,
      colorScale: true,
      palette: true,
      opacity: true,
      fill: true,
      stroke: true,
      strokeField: true,
      radius: true,
      radiusField: true,
      radiusRange: true,
      clusterRadius: false,
      heatmapRadius: false,
    };
  }

  return {
    supported: false,
    fixedColor: false,
    colorField: false,
    colorScale: false,
    palette: false,
    opacity: false,
    fill: false,
    stroke: false,
    strokeField: false,
    radius: false,
    radiusField: false,
    radiusRange: false,
    clusterRadius: false,
    heatmapRadius: false,
  };
}

export function fieldKind(field: Pick<MapDatasetField, "type"> | null) {
  const type = String(field?.type ?? "")
    .trim()
    .toLocaleLowerCase();

  if (
    type.includes("int") ||
    type.includes("real") ||
    type.includes("float") ||
    type.includes("double") ||
    type.includes("number") ||
    type.includes("decimal")
  ) {
    return "numeric" as const;
  }

  if (
    type.includes("string") ||
    type.includes("boolean") ||
    type.includes("category") ||
    type.includes("ordinal")
  ) {
    return "categorical" as const;
  }

  return "unknown" as const;
}

export function scalesForField(
  field: Pick<MapDatasetField, "type"> | null,
): readonly MapColorScale[] {
  const kind = fieldKind(field);
  return kind === "numeric"
    ? NUMERIC_COLOR_SCALES
    : kind === "categorical"
      ? CATEGORICAL_COLOR_SCALES
      : [...NUMERIC_COLOR_SCALES, ...CATEGORICAL_COLOR_SCALES];
}

export function scaleSupportsField(
  scale: MapColorScale,
  field: Pick<MapDatasetField, "type"> | null,
) {
  return scalesForField(field).includes(scale);
}

export function defaultScaleForDatasetField(
  field: Pick<MapDatasetField, "type"> | null,
): MapColorScale {
  return fieldKind(field) === "categorical" ? "ordinal" : "quantile";
}

export function normalizeColorScale(value: unknown): MapColorScale | null {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase();

  return normalized === "quantile" ||
    normalized === "quantize" ||
    normalized === "linear" ||
    normalized === "sqrt" ||
    normalized === "log" ||
    normalized === "ordinal"
    ? normalized
    : null;
}

export function normalizePalette(colors: readonly string[]) {
  if (!Array.isArray(colors) || colors.length < 2 || colors.length > 20) {
    return null;
  }

  const normalized = colors.map((color) =>
    String(color ?? "")
      .trim()
      .toUpperCase(),
  );

  return normalized.every((color) => /^#[0-9A-F]{6}$/.test(color))
    ? normalized
    : null;
}

export function colorsEqual(
  left: readonly string[] | null | undefined,
  right: readonly string[] | null | undefined,
) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every(
    (color, index) =>
      color.toLocaleUpperCase() === right[index]?.toLocaleUpperCase(),
  );
}

export function rgbEqual(
  left: readonly number[] | null | undefined,
  right: MapRgbColor,
) {
  return Boolean(
    left &&
      left.length === 3 &&
      left.every((channel, index) => Number(channel) === right[index]),
  );
}

export function numericRange(
  value: readonly number[],
  minimum: number,
  maximum: number,
): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const start = Number(value[0]);
  const end = Number(value[1]);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < minimum ||
    end > maximum ||
    start > end
  ) {
    return null;
  }
  return [start, end];
}

export function layerBlendingMode(value: unknown) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  return LAYER_BLENDING_MODES.find((mode) => mode === normalized) ?? null;
}

export function overlayBlendingMode(value: unknown) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  return OVERLAY_BLENDING_MODES.find((mode) => mode === normalized) ?? null;
}
