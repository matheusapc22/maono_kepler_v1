import { WebMercatorViewport } from "@deck.gl/core";
import { throwIfCaptureAborted, yieldCaptureTask } from "./capture-waits";
import { PREVIEW_WIDTH, PREVIEW_HEIGHT } from "./capture-pixels";
import type { ThumbnailSnapshot } from "./capture-snapshot";
const MAX_POINTS = 8000;
const MAX_GEOMETRIES = 2200;
type OverlayDatasetEntry = { id: string; dataset: any; source: "saved" };
type DrawStats = { points: number; geometries: number; rows: number; layers: number; datasets: number };
function normalize(value?: string | null) { return String(value || "").trim().toLowerCase(); }
function getViewport(mapState: any, savedConfig?: any) {
  const viewState = savedConfig?.config?.mapState || mapState?.mapState || {};
  const longitude = Number(viewState.longitude);
  const latitude = Number(viewState.latitude);
  const zoom = Number(viewState.zoom);

  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(zoom)
  ) {
    return null;
  }

  return new WebMercatorViewport({
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    longitude,
    latitude,
    zoom,
    pitch: Number(viewState.pitch) || 0,
    bearing: Number(viewState.bearing) || 0,
  });
}

function getAllLayers(_mapState: any, savedConfig?: any) {
  return savedConfig?.config?.visState?.layers || [];
}

function fieldsOf(dataset: any) {
  const fields =
    dataset?.data?.fields || dataset?.fields || dataset?.data?.schema?.fields || [];
  return Array.isArray(fields) ? fields : [];
}

function fieldName(field: any) {
  return String(field?.name || field?.id || field?.displayName || "");
}

function getDataContainer(dataset: any) {
  const data = dataset?.data || dataset;
  return dataset?.dataContainer || data?.dataContainer || null;
}

function getDataContainerRow(dc: any, rowIndex: number, fields: any[]) {
  try {
    if (typeof dc.row === "function") {
      const row = dc.row(rowIndex);
      if (row) return row;
    }
  } catch {
    // ignore
  }

  try {
    if (typeof dc.get === "function") {
      const row = dc.get(rowIndex);
      if (row) return row;
    }
  } catch {
    // ignore
  }

  const values: any[] = [];
  let hasValue = false;

  fields.forEach((field, fieldIndex) => {
    const name = fieldName(field);
    let value;

    try {
      if (typeof dc.valueAt === "function") {
        value = dc.valueAt(rowIndex, fieldIndex);
      }
    } catch {
      value = undefined;
    }

    if (value === undefined) {
      try {
        if (typeof dc.valueAt === "function") {
          value = dc.valueAt(rowIndex, name);
        }
      } catch {
        value = undefined;
      }
    }

    if (value === undefined) {
      try {
        if (typeof dc.getCell === "function") {
          value = dc.getCell(rowIndex, fieldIndex);
        }
      } catch {
        value = undefined;
      }
    }

    if (value !== undefined) hasValue = true;
    values[fieldIndex] = value;
  });

  return hasValue ? values : null;
}

/** Lazy rows preserve existing visible-point sampling without allocating a copy
 * or imposing a global row cap that silently hides later visible features. */
export function rowsOf(dataset: any): { length: number; at: (index: number) => any } {
  const data = dataset?.data || dataset;
  const values = [data?.allData, dataset?.allData, data?.rows, dataset?.rows, data?.data, data]
    .find(Array.isArray);
  if (values) return { length: values.length, at: (index) => values[index] };
  const dc = getDataContainer(dataset);
  const fields = fieldsOf(dataset);
  if (!dc) return { length: 0, at: () => null };
  const count = Number(typeof dc.numRows === "function" ? dc.numRows() : dc.numRows);
  if (Number.isFinite(count) && count >= 0) {
    return { length: count, at: (index) => getDataContainerRow(dc, index, fields) };
  }
  const rows = typeof dc.rows === "function" ? dc.rows() : [];
  return { length: rows.length || 0, at: (index) => rows[index] };
}

const fieldIndexes = new WeakMap<any[], Map<string, number>>();
function indexesOf(fields: any[]) {
  let indexes = fieldIndexes.get(fields);
  if (!indexes) {
    indexes = new Map(fields.map((field, index) => [normalize(fieldName(field)), index]));
    fieldIndexes.set(fields, indexes);
  }
  return indexes;
}

function valueOf(row: any, fields: any[], name?: string | null) {
  if (!name || !row) return undefined;

  if (Array.isArray(row)) {
    const index = indexesOf(fields).get(normalize(name));
    return index === undefined ? undefined : row[index];
  }

  if (typeof row === "object") {
    if (name in row) return row[name];
    const key = Object.keys(row).find(
      (candidate) => normalize(candidate) === normalize(name),
    );
    return key ? row[key] : undefined;
  }

  return undefined;
}

function findField(fields: any[], candidates: string[]) {
  const normalizedCandidates = candidates.map(normalize);
  const exact = fields.find((field) =>
    normalizedCandidates.includes(normalize(fieldName(field))),
  );

  if (exact) return fieldName(exact);

  const partial = fields.find((field) =>
    normalizedCandidates.some((candidate) =>
      normalize(fieldName(field)).includes(candidate),
    ),
  );

  return partial ? fieldName(partial) : null;
}

function getLayerDataIds(layer: any) {
  const value = layer?.config?.dataId || layer?.props?.dataId || layer?.dataId;
  if (Array.isArray(value)) return value.map(String);
  return value ? [String(value)] : [];
}

function layerMatchesDataset(layer: any, datasetId: string) {
  return getLayerDataIds(layer).includes(String(datasetId));
}

function layersForDataset(mapState: any, datasetId: string, savedConfig?: any) {
  return getAllLayers(mapState, savedConfig).filter((layer: any) =>
    layerMatchesDataset(layer, datasetId),
  );
}

function coordinateColumnsFromLayer(layer: any) {
  const columns = layer?.config?.columns || layer?.props?.columns || {};
  const lat = columns.lat || columns.latitude || columns.y || columns.lat0;
  const lng =
    columns.lng || columns.lon || columns.longitude || columns.x || columns.lng0;
  return lat && lng ? { lat: String(lat), lng: String(lng) } : null;
}

function coordinateColumns(
  mapState: any,
  datasetId: string,
  fields: any[],
  savedConfig?: any,
) {
  for (const layer of layersForDataset(mapState, datasetId, savedConfig)) {
    const columns = coordinateColumnsFromLayer(layer);
    if (columns) return columns;
  }

  return {
    lat: findField(fields, ["latitude", "lat", "y", "lat_dd", "latitud"]),
    lng: findField(fields, [
      "longitude",
      "lon",
      "lng",
      "long",
      "x",
      "lng_dd",
      "longitud",
    ]),
  };
}

function geometryColumnCandidatesFromLayer(layer: any) {
  const columns = layer?.config?.columns || layer?.props?.columns || {};
  return [columns.geojson, columns.geometry, columns.geom, columns.shape]
    .filter(Boolean)
    .map(String);
}

function geometryColumnCandidates(
  mapState: any,
  datasetId: string,
  fields: any[],
  savedConfig?: any,
) {
  const candidates = new Set<string>();

  for (const layer of layersForDataset(mapState, datasetId, savedConfig)) {
    geometryColumnCandidatesFromLayer(layer).forEach((column) =>
      candidates.add(column),
    );
  }

  fields.forEach((field) => {
    const name = fieldName(field);
    const type = normalize(field?.type || field?.fieldIdx || field?.format);

    if (
      ["geojson", "geometry", "geom", "the_geom", "shape"].some((candidate) =>
        normalize(name).includes(candidate),
      )
    ) {
      candidates.add(name);
    }

    if (type.includes("geojson") || type.includes("geometry")) candidates.add(name);
  });

  ["geojson", "geometry", "geom", "the_geom", "shape", "_geojson"].forEach(
    (candidate) => {
      const field = findField(fields, [candidate]);
      if (field) candidates.add(field);
    },
  );

  return Array.from(candidates);
}

function toNumber(value: any) {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  return NaN;
}

function geometryValues(value: any): any[] {
  if (!value) return [];
  let parsed = value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return [];

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (Array.isArray(parsed)) {
    if (parsed.length && Array.isArray(parsed[0])) {
      return [{ type: "LineString", coordinates: parsed }];
    }

    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];
  if (parsed.type === "FeatureCollection") {
    return (parsed.features || []).flatMap((feature: any) =>
      geometryValues(feature),
    );
  }

  if (parsed.type === "Feature") return geometryValues(parsed.geometry);
  if (parsed.type && parsed.coordinates) return [parsed];
  if (parsed.geometry) return geometryValues(parsed.geometry);

  return [];
}

function rowGeometries(row: any, fields: any[], geometryColumns: string[]) {
  // Explicit geometry columns already cover these values. Scanning them again
  // used to paint polygons twice, changing opacity and stroke fidelity.
  const values = geometryColumns.length
    ? geometryColumns.map((column) => valueOf(row, fields, column))
    : Array.isArray(row) ? row : Object.values(row || {});
  return Array.from(new Set(values)).flatMap(geometryValues);
}

function project(viewport: any, coordinate: any) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null;

  const lng = toNumber(coordinate[0]);
  const lat = toNumber(coordinate[1]);

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  try {
    const [x, y] = viewport.project([lng, lat]);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    if (
      x < -120 ||
      x > PREVIEW_WIDTH + 120 ||
      y < -120 ||
      y > PREVIEW_HEIGHT + 120
    ) {
      return null;
    }

    return { x, y };
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cssColor(color: any, alpha = 1) {
  if (Array.isArray(color)) {
    const red = Number(color[0]) || 0;
    const green = Number(color[1]) || 0;
    const blue = Number(color[2]) || 0;
    const ownAlpha = color.length > 3 ? (Number(color[3]) || 255) / 255 : 1;

    return `rgba(${red},${green},${blue},${clamp(alpha * ownAlpha, 0, 1)})`;
  }

  if (typeof color === "string") {
    if (color.startsWith("#")) {
      const hex = color.replace("#", "");
      const fullHex =
        hex.length === 3
          ? hex
              .split("")
              .map((char) => char + char)
              .join("")
          : hex;

      const red = Number.parseInt(fullHex.slice(0, 2), 16);
      const green = Number.parseInt(fullHex.slice(2, 4), 16);
      const blue = Number.parseInt(fullHex.slice(4, 6), 16);

      return `rgba(${red},${green},${blue},${alpha})`;
    }

    return color;
  }

  return `rgba(32,199,181,${alpha})`;
}

function stableHash(value: any) {
  const text = String(value ?? "");
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function colorRangeColors(layer: any) {
  const colors = layer?.config?.visConfig?.colorRange?.colors;
  return Array.isArray(colors) && colors.length ? colors : null;
}

function configuredColor(
  layer: any,
  row: any,
  fields: any[],
  index: number,
  alpha: number,
) {
  const range = colorRangeColors(layer);
  const colorField = layer?.config?.colorField?.name || layer?.config?.colorField?.id;

  if (range) {
    const key = colorField ? valueOf(row, fields, colorField) : index;
    return cssColor(range[stableHash(key) % range.length], alpha);
  }

  const color = layer?.config?.color || layer?.config?.visConfig?.color || [
    32, 199, 181,
  ];
  return cssColor(color, alpha);
}

function layerOpacity(layer: any, fallback = 0.55) {
  const vis = layer?.config?.visConfig || {};
  const opacity = Number(vis.opacity ?? vis.fillOpacity ?? fallback);

  if (!Number.isFinite(opacity)) return fallback;

  return opacity > 1 ? clamp(opacity / 100, 0.05, 1) : clamp(opacity, 0.05, 1);
}

function layerStrokeOpacity(layer: any) {
  const vis = layer?.config?.visConfig || {};
  const opacity = Number(
    vis.strokeOpacity ?? vis.outlineOpacity ?? Math.max(layerOpacity(layer), 0.55),
  );

  return opacity > 1 ? clamp(opacity / 100, 0.08, 1) : clamp(opacity, 0.08, 1);
}

function layerRadius(layer: any, row: any, fields: any[]) {
  const vis = layer?.config?.visConfig || {};
  const radiusField = layer?.config?.radiusField?.name || layer?.config?.radiusField?.id;
  const radiusValue = radiusField ? toNumber(valueOf(row, fields, radiusField)) : NaN;

  if (Number.isFinite(radiusValue)) {
    const maxRadius = Array.isArray(vis.radiusRange)
      ? Number(vis.radiusRange[1]) || 70
      : 70;
    return clamp(Math.sqrt(Math.max(radiusValue, 0)) * 1.8, 5, maxRadius);
  }

  const configured = Number(
    vis.radius ?? vis.fixedRadius ?? (Array.isArray(vis.radiusRange) ? vis.radiusRange[1] : NaN),
  );

  return clamp(Number.isFinite(configured) ? configured : 18, 4, 90);
}

function drawStyledPoint(
  ctx: CanvasRenderingContext2D,
  layer: any,
  row: any,
  fields: any[],
  x: number,
  y: number,
  index: number,
) {
  const alpha = layerOpacity(layer, 0.62);
  const radius = layerRadius(layer, row, fields);

  ctx.save();
  ctx.fillStyle = configuredColor(layer, row, fields, index, alpha);
  ctx.strokeStyle = "rgba(8,9,11,0.78)";
  ctx.lineWidth = radius > 15 ? 1.5 : 3;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  viewport: any,
  coordinates: any[],
  close = false,
) {
  let started = false;

  coordinates.forEach((coordinate) => {
    const point = project(viewport, coordinate);
    if (!point) return;

    if (!started) {
      ctx.moveTo(point.x, point.y);
      started = true;
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });

  if (started && close) ctx.closePath();

  return started;
}

function drawStyledGeometry(
  ctx: CanvasRenderingContext2D,
  viewport: any,
  layer: any,
  row: any,
  fields: any[],
  geometry: any,
  index: number,
) {
  if (!geometry?.type || !geometry?.coordinates) return 0;

  const fill = configuredColor(layer, row, fields, index, layerOpacity(layer, 0.48));
  const stroke = configuredColor(layer, row, fields, index, layerStrokeOpacity(layer));
  const strokeWidth = clamp(
    Number(layer?.config?.visConfig?.thickness || layer?.config?.visConfig?.strokeWidth || 1.4),
    0.7,
    5,
  );

  if (geometry.type === "Point") {
    const point = project(viewport, geometry.coordinates);
    if (!point) return 0;

    drawStyledPoint(ctx, layer, row, fields, point.x, point.y, index);
    return 1;
  }

  if (geometry.type === "MultiPoint") {
    let drawn = 0;

    geometry.coordinates.forEach((coordinate: any, pointIndex: number) => {
      const point = project(viewport, coordinate);

      if (point) {
        drawStyledPoint(ctx, layer, row, fields, point.x, point.y, index + pointIndex);
        drawn += 1;
      }
    });

    return drawn;
  }

  if (geometry.type === "LineString") {
    ctx.beginPath();
    if (!drawLine(ctx, viewport, geometry.coordinates)) return 0;

    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
    return 1;
  }

  if (geometry.type === "MultiLineString") {
    let drawn = 0;

    geometry.coordinates.forEach((line: any[]) => {
      ctx.beginPath();

      if (drawLine(ctx, viewport, line)) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
        drawn += 1;
      }
    });

    return drawn;
  }

  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    let drawn = 0;

    polygons.forEach((polygon: any[]) => {
      ctx.beginPath();
      let didDraw = false;

      polygon.forEach((ring: any[]) => {
        didDraw = drawLine(ctx, viewport, ring, true) || didDraw;
      });

      if (didDraw) {
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        ctx.fill("evenodd");
        ctx.stroke();
        drawn += 1;
      }
    });

    return drawn;
  }

  return 0;
}

function getDatasetById(entries: OverlayDatasetEntry[], datasetId: string) {
  return entries.find((entry) => entry.id === datasetId);
}

async function drawLayerOverlay(
  ctx: CanvasRenderingContext2D,
  viewport: any,
  layer: any,
  entry: OverlayDatasetEntry,
  mapState: any,
  savedConfig: any,
  stats: DrawStats,
  diagnostics: string[],
  signal: AbortSignal,
) {
  const fields = fieldsOf(entry.dataset);
  const rows = rowsOf(entry.dataset);
  const layerType = normalize(layer?.type || layer?.config?.type || layer?.visualChannels?.layerType);
  const columns =
    coordinateColumnsFromLayer(layer) ||
    coordinateColumns(mapState, entry.id, fields, savedConfig);
  const geometryColumns = geometryColumnCandidatesFromLayer(layer).length
    ? geometryColumnCandidatesFromLayer(layer)
    : geometryColumnCandidates(mapState, entry.id, fields, savedConfig);

  let layerPoints = 0;
  let layerGeometries = 0;

  const shouldDrawGeometry = geometryColumns.length > 0 || layerType === "geojson" || layerType === "polygon";
  const canDrawPoint = (layerType === "point" || !shouldDrawGeometry) && Boolean(columns.lat && columns.lng);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if ((!shouldDrawGeometry || stats.geometries >= MAX_GEOMETRIES) && (!canDrawPoint || stats.points >= MAX_POINTS)) break;
    throwIfCaptureAborted(signal);
    if (rowIndex > 0 && rowIndex % 256 === 0) await yieldCaptureTask(signal);
    const row = rows.at(rowIndex);
    stats.rows += 1;

    if (shouldDrawGeometry && stats.geometries < MAX_GEOMETRIES) {
      for (const geometry of rowGeometries(row, fields, geometryColumns)) {
        if (stats.geometries >= MAX_GEOMETRIES) break;
        const drawn = drawStyledGeometry(
          ctx,
          viewport,
          layer,
          row,
          fields,
          geometry,
          stats.geometries,
        );

        if (drawn) {
          layerGeometries += drawn;
          stats.geometries += drawn;
        }
      }
    }

    const shouldDrawPoint =
      (layerType.includes("point") ||
        layerType.includes("cluster") ||
        layerType.includes("icon") ||
        !shouldDrawGeometry) &&
      columns.lat &&
      columns.lng &&
      stats.points < MAX_POINTS;

    if (shouldDrawPoint) {
      const lat = toNumber(valueOf(row, fields, columns.lat));
      const lng = toNumber(valueOf(row, fields, columns.lng));
      const point =
        Number.isFinite(lat) && Number.isFinite(lng)
          ? project(viewport, [lng, lat])
          : null;

      if (point) {
        drawStyledPoint(ctx, layer, row, fields, point.x, point.y, stats.points);
        layerPoints += 1;
        stats.points += 1;
      }
    }

    if (stats.points >= MAX_POINTS && stats.geometries >= MAX_GEOMETRIES) break;
  }

  if (layerPoints || layerGeometries) stats.layers += 1;

  diagnostics.push(
    `layer:${layer?.id || "sem-id"}{type=${
      layerType || "-"
    },dataset=${entry.source}:${entry.id},rows=${rows.length},points=${layerPoints},geoms=${layerGeometries},lat=${
      columns.lat || "-"
    },lng=${columns.lng || "-"},geom=${geometryColumns.join("/") || "-"}}`,
  );
}


/** This renderer is a diagnostic last resort, never a faithful map capture.
 * Pixel captures already contain Deck layers, including filters and effects. */
export async function applyDegradedStateOverlay(canvas: HTMLCanvasElement, snapshot: ThumbnailSnapshot, signal: AbortSignal) {
  const diagnostics: string[] = ["overlayQuality=degraded"];
  const ctx = canvas.getContext("2d");
  const viewport = getViewport(null, snapshot.savedConfig);
  if (!ctx || !viewport) return diagnostics;
  const filters = snapshot.savedConfig.config.visState.filters || [];
  if (filters.length) return [...diagnostics, "overlaySkipped=filters-not-representable"];
  const entries: OverlayDatasetEntry[] = snapshot.datasets.map((entry) => ({ ...entry, source: "saved" }));
  const layers = snapshot.layers;
  const stats: DrawStats = { points: 0, geometries: 0, rows: 0, layers: 0, datasets: 0 };
  for (const layer of layers) {
    const type = normalize(layer?.type || layer?.config?.type);
    if (!["point", "geojson", "polygon"].includes(type)) {
      diagnostics.push(`overlayUnsupported=${type || "unknown"}`);
      continue;
    }
    for (const id of getLayerDataIds(layer)) {
      const entry = getDatasetById(entries, id);
      if (entry) await drawLayerOverlay(ctx, viewport, layer, entry, null, snapshot.savedConfig, stats, diagnostics, signal);
    }
  }
  return [...diagnostics, `overlayPoints=${stats.points}`, `overlayGeometries=${stats.geometries}`, `overlayRows=${stats.rows}`];
}
