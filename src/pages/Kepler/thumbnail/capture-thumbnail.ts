import { KeplerGlSchema } from "@kepler.gl/schemas";
import { WebMercatorViewport } from "@deck.gl/core";
import html2canvas from "html2canvas";

const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 540;
const MAX_POINTS = 8000;
const MAX_GEOMETRIES = 2200;
const MAX_ROWS_TO_SCAN = 12000;

type CaptureResult = {
  dataUrl: string;
  method: string;
  diagnostics: string[];
};

type OverlayDatasetEntry = {
  id: string;
  dataset: any;
  source: "saved" | "runtime";
};

type DrawStats = {
  points: number;
  geometries: number;
  rows: number;
  layers: number;
  datasets: number;
};

function normalize(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function getFallbackDatasets(mapState: any) {
  const datasets = mapState?.visState?.datasets;
  if (!datasets || typeof datasets !== "object") return [];

  return Object.entries(datasets).map(([id, dataset]: [string, any]) => ({
    version: "v1",
    data: dataset?.data || dataset,
    info: { id, label: dataset?.label || dataset?.data?.label || id },
  }));
}

function normalizeSavedKeplerConfig(rawSaved: any, mapState: any) {
  const saved = rawSaved && typeof rawSaved === "object" ? rawSaved : {};
  const config =
    saved.config && typeof saved.config === "object"
      ? saved.config
      : {
          visState: saved.visState || mapState?.visState || {},
          mapState: saved.mapState || mapState?.mapState || {},
          mapStyle: saved.mapStyle || mapState?.mapStyle || {},
        };

  return {
    ...saved,
    version: saved.version || "v1",
    datasets: Array.isArray(saved.datasets)
      ? saved.datasets
      : getFallbackDatasets(mapState),
    config,
  };
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => resolve()),
    );
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isImageDataUrl(value?: string | null) {
  return Boolean(value && /^data:image\/(png|jpeg|webp);base64,/i.test(value));
}

function brightnessQuality(canvas: HTMLCanvasElement) {
  const sample = document.createElement("canvas");
  sample.width = 160;
  sample.height = 90;
  const ctx = sample.getContext("2d");
  if (!ctx) return { mean: 0, variance: 0, useful: 0 };

  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
  let sum = 0;
  let sum2 = 0;
  let useful = 0;
  let count = 0;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 8) continue;
    const value = (data[index] + data[index + 1] + data[index + 2]) / 3;
    sum += value;
    sum2 += value * value;
    if (value > 28) useful += 1;
    count += 1;
  }

  const safeCount = Math.max(1, count);
  const mean = sum / safeCount;
  return {
    mean,
    variance: sum2 / safeCount - mean * mean,
    useful: useful / safeCount,
  };
}

function assertNotBlack(canvas: HTMLCanvasElement, label: string) {
  const quality = brightnessQuality(canvas);
  if (quality.useful < 0.008 && quality.variance < 8) {
    throw new Error(
      `${label} gerou imagem preta ou sem conteúdo. mean=${quality.mean.toFixed(
        1,
      )} variance=${quality.variance.toFixed(1)} useful=${(
        quality.useful * 100
      ).toFixed(2)}%`,
    );
  }
  return quality;
}

function getCaptureTarget() {
  return (
    document.querySelector(".kepler-gl") ||
    document.querySelector("[class*='kepler']") ||
    document.querySelector("main") ||
    document.body
  ) as HTMLElement;
}

function getVisibleCanvases() {
  return Array.from(document.querySelectorAll("canvas"))
    .map((canvas, order) => ({
      canvas,
      order,
      rect: canvas.getBoundingClientRect(),
      zIndex:
        Number.parseInt(window.getComputedStyle(canvas).zIndex || "0", 10) || 0,
    }))
    .filter(
      (item) =>
        item.canvas.width > 0 &&
        item.canvas.height > 0 &&
        item.rect.width > 80 &&
        item.rect.height > 80,
    )
    .sort((a, b) => a.zIndex - b.zIndex || a.order - b.order);
}

function cropCanvasToPreview(source: HTMLCanvasElement) {
  const out = document.createElement("canvas");
  out.width = PREVIEW_WIDTH;
  out.height = PREVIEW_HEIGHT;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Contexto 2D indisponível para preview.");

  const sourceRatio = source.width / source.height;
  const targetRatio = PREVIEW_WIDTH / PREVIEW_HEIGHT;
  let sx = 0;
  let sy = 0;
  let sw = source.width;
  let sh = source.height;

  if (sourceRatio > targetRatio) {
    sw = source.height * targetRatio;
    sx = (source.width - sw) / 2;
  } else {
    sh = source.width / targetRatio;
    sy = (source.height - sh) / 2;
  }

  ctx.fillStyle = "#08090B";
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  assertNotBlack(out, "preview redimensionado");
  const dataUrl = out.toDataURL("image/png", 0.92);
  if (!isImageDataUrl(dataUrl)) throw new Error("DataURL inválido.");
  return dataUrl;
}

function drawCanvasIntoPreview(
  ctx: CanvasRenderingContext2D,
  item: any,
  targetRect: DOMRect,
) {
  const rect = item.rect;
  const left = Math.max(rect.left, targetRect.left);
  const top = Math.max(rect.top, targetRect.top);
  const right = Math.min(rect.right, targetRect.right);
  const bottom = Math.min(rect.bottom, targetRect.bottom);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return false;

  const scaleX = item.canvas.width / rect.width;
  const scaleY = item.canvas.height / rect.height;
  ctx.drawImage(
    item.canvas,
    (left - rect.left) * scaleX,
    (top - rect.top) * scaleY,
    width * scaleX,
    height * scaleY,
    ((left - targetRect.left) / targetRect.width) * PREVIEW_WIDTH,
    ((top - targetRect.top) / targetRect.height) * PREVIEW_HEIGHT,
    (width / targetRect.width) * PREVIEW_WIDTH,
    (height / targetRect.height) * PREVIEW_HEIGHT,
  );
  return true;
}

function maskBlackBackground(canvas: HTMLCanvasElement) {
  const out = document.createElement("canvas");
  out.width = PREVIEW_WIDTH;
  out.height = PREVIEW_HEIGHT;
  const ctx = out.getContext("2d");
  if (!ctx) return canvas;

  ctx.drawImage(canvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const brightness = (r + g + b) / 3;
    const chroma = max - min;
    if (brightness < 24 && chroma < 14) data[i + 3] = 0;
  }

  ctx.putImageData(imageData, 0, 0);
  return out;
}

async function captureCompositedBase() {
  await waitForPaint();

  const target = getCaptureTarget();
  const targetRect = target.getBoundingClientRect();
  const canvases = getVisibleCanvases().filter((item) => {
    const rect = item.rect;
    return (
      Math.max(
        0,
        Math.min(rect.right, targetRect.right) -
          Math.max(rect.left, targetRect.left),
      ) > 0
    );
  });

  if (!canvases.length) {
    throw new Error("Nenhum canvas visível encontrado para composição.");
  }

  const out = document.createElement("canvas");
  out.width = PREVIEW_WIDTH;
  out.height = PREVIEW_HEIGHT;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Contexto 2D indisponível para composição.");

  ctx.fillStyle = "#08090B";
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  let drawn = 0;
  let skipped = 0;
  const qualities: string[] = [];

  for (const item of canvases) {
    try {
      item.canvas.toDataURL("image/png");
      const temp = document.createElement("canvas");
      temp.width = PREVIEW_WIDTH;
      temp.height = PREVIEW_HEIGHT;
      const tempCtx = temp.getContext("2d");
      if (!tempCtx) continue;
      drawCanvasIntoPreview(tempCtx, item, targetRect);
      const quality = brightnessQuality(temp);
      qualities.push(
        `o=${item.order},z=${item.zIndex},mean=${quality.mean.toFixed(
          1,
        )},var=${quality.variance.toFixed(1)},useful=${(
          quality.useful * 100
        ).toFixed(1)}%`,
      );

      if (quality.mean < 45 && quality.useful < 0.35) {
        ctx.drawImage(maskBlackBackground(temp), 0, 0);
      } else {
        ctx.drawImage(temp, 0, 0);
      }

      drawn += 1;
    } catch (_error) {
      skipped += 1;
    }
  }

  if (!drawn) throw new Error("Nenhum canvas legível foi composto.");
  assertNotBlack(out, "preview composto");
  return {
    dataUrl: out.toDataURL("image/png", 0.92),
    method: "canvas-composite",
    diagnostics: [
      `canvases=${canvases.length}`,
      `drawn=${drawn}`,
      `skipped=${skipped}`,
      qualities.join(";"),
    ],
  };
}

async function captureHtml2Canvas() {
  await waitForPaint();
  const target = getCaptureTarget();
  const captured = await html2canvas(target, {
    backgroundColor: "#08090B",
    useCORS: true,
    allowTaint: true,
    logging: false,
    scale: 1,
    ignoreElements: (element) =>
      Boolean(element.closest?.("[data-maono-no-preview='true']")),
  });

  return {
    dataUrl: cropCanvasToPreview(captured),
    method: "html2canvas",
    diagnostics: [`capture=${captured.width}x${captured.height}`],
  };
}

function getViewport(mapState: any, savedConfig?: any) {
  const viewState = mapState?.mapState || savedConfig?.config?.mapState || {};
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

function getDatasetId(dataset: any, fallback: string) {
  return String(dataset?.data?.id || dataset?.info?.id || dataset?.id || fallback);
}

function getOverlayDatasetEntries(
  mapState: any,
  savedConfig?: any,
): OverlayDatasetEntry[] {
  const entries: OverlayDatasetEntry[] = [];
  const seen = new Set<string>();

  if (Array.isArray(savedConfig?.datasets)) {
    savedConfig.datasets.forEach((dataset: any, index: number) => {
      const id = getDatasetId(dataset, `saved-${index}`);
      entries.push({ id, dataset, source: "saved" });
      seen.add(id);
    });
  }

  const runtimeDatasets = mapState?.visState?.datasets;
  if (runtimeDatasets && typeof runtimeDatasets === "object") {
    Object.entries(runtimeDatasets).forEach(([id, dataset]: [string, any]) => {
      if (seen.has(id)) return;
      entries.push({ id, dataset, source: "runtime" });
    });
  }

  return entries;
}

function getAllLayers(mapState: any, savedConfig?: any) {
  const layers = [] as any[];
  if (Array.isArray(savedConfig?.config?.visState?.layers)) {
    layers.push(...savedConfig.config.visState.layers);
  }
  if (Array.isArray(mapState?.visState?.layers)) {
    layers.push(...mapState.visState.layers);
  }
  return layers.filter(
    (layer) => layer?.config?.isVisible !== false && layer?.isVisible !== false,
  );
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
  } catch (_error) {
    // ignore
  }

  try {
    if (typeof dc.get === "function") {
      const row = dc.get(rowIndex);
      if (row) return row;
    }
  } catch (_error) {
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
    } catch (_error) {
      value = undefined;
    }

    if (value === undefined) {
      try {
        if (typeof dc.valueAt === "function") {
          value = dc.valueAt(rowIndex, name);
        }
      } catch (_error) {
        value = undefined;
      }
    }

    if (value === undefined) {
      try {
        if (typeof dc.getCell === "function") {
          value = dc.getCell(rowIndex, fieldIndex);
        }
      } catch (_error) {
        value = undefined;
      }
    }

    if (value !== undefined) hasValue = true;
    values[fieldIndex] = value;
  });

  return hasValue ? values : null;
}

function rowsOf(dataset: any) {
  const data = dataset?.data || dataset;
  if (Array.isArray(data?.allData)) return data.allData;
  if (Array.isArray(dataset?.allData)) return dataset.allData;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(dataset?.rows)) return dataset.rows;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(dataset?.data?.data)) return dataset.data.data;
  if (Array.isArray(data)) return data;

  const dc = getDataContainer(dataset);
  const fields = fieldsOf(dataset);

  if (dc) {
    try {
      if (typeof dc.rows === "function") {
        const rows = dc.rows();
        if (Array.isArray(rows) && rows.length) return rows;
      }
    } catch (_error) {
      // ignore
    }

    const count = Number(
      typeof dc.numRows === "function" ? dc.numRows() : dc.numRows,
    );

    if (Number.isFinite(count) && count > 0) {
      const rows = [];
      const limit = Math.min(count, MAX_ROWS_TO_SCAN);

      for (let index = 0; index < limit; index += 1) {
        const row = getDataContainerRow(dc, index, fields);
        if (row) rows.push(row);
      }

      return rows;
    }
  }

  return [];
}

function valueOf(row: any, fields: any[], name?: string | null) {
  if (!name || !row) return undefined;

  if (Array.isArray(row)) {
    const index = fields.findIndex(
      (field) => normalize(fieldName(field)) === normalize(name),
    );
    return index >= 0 ? row[index] : undefined;
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
    } catch (_error) {
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
  const out: any[] = [];
  geometryColumns.forEach((column) =>
    out.push(...geometryValues(valueOf(row, fields, column))),
  );

  if (Array.isArray(row)) {
    row.forEach((value) => out.push(...geometryValues(value)));
  } else if (row && typeof row === "object") {
    Object.values(row).forEach((value) =>
      out.push(...geometryValues(value)),
    );
  }

  return out;
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
  } catch (_error) {
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

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível carregar preview base."));
    image.src = dataUrl;
  });
}


function getDatasetById(entries: OverlayDatasetEntry[], datasetId: string) {
  return (
    entries.find((entry) => entry.id === datasetId) ||
    entries.find((entry) => entry.id.endsWith(datasetId))
  );
}

function drawLayerOverlay(
  ctx: CanvasRenderingContext2D,
  viewport: any,
  layer: any,
  entry: OverlayDatasetEntry,
  mapState: any,
  savedConfig: any,
  stats: DrawStats,
  diagnostics: string[],
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

  for (const row of rows) {
    stats.rows += 1;

    const shouldDrawGeometry =
      geometryColumns.length > 0 ||
      layerType.includes("geojson") ||
      layerType.includes("polygon");

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

function drawDatasetFallbackOverlay(
  ctx: CanvasRenderingContext2D,
  viewport: any,
  entries: OverlayDatasetEntry[],
  mapState: any,
  savedConfig: any,
  stats: DrawStats,
  diagnostics: string[],
) {
  entries.forEach((entry, datasetIndex) => {
    const fields = fieldsOf(entry.dataset);
    const rows = rowsOf(entry.dataset);
    const columns = coordinateColumns(mapState, entry.id, fields, savedConfig);
    const geometryColumns = geometryColumnCandidates(
      mapState,
      entry.id,
      fields,
      savedConfig,
    );
    let datasetPoints = 0;
    let datasetGeometries = 0;

    for (const row of rows) {
      stats.rows += 1;

      if (stats.geometries < MAX_GEOMETRIES) {
        for (const geometry of rowGeometries(row, fields, geometryColumns)) {
          if (stats.geometries >= MAX_GEOMETRIES) break;

          const fakeLayer = {
            config: {
              color: [32, 199, 181],
              visConfig: { opacity: 0.45, strokeOpacity: 0.85 },
            },
          };

          const drawn = drawStyledGeometry(
            ctx,
            viewport,
            fakeLayer,
            row,
            fields,
            geometry,
            stats.geometries + datasetIndex,
          );

          if (drawn) {
            datasetGeometries += drawn;
            stats.geometries += drawn;
          }
        }
      }

      if (columns.lat && columns.lng && stats.points < MAX_POINTS) {
        const lat = toNumber(valueOf(row, fields, columns.lat));
        const lng = toNumber(valueOf(row, fields, columns.lng));
        const point =
          Number.isFinite(lat) && Number.isFinite(lng)
            ? project(viewport, [lng, lat])
            : null;

        if (point) {
          const fakeLayer = {
            config: {
              color: [242, 199, 102],
              visConfig: { radius: 8, opacity: 0.9 },
            },
          };

          drawStyledPoint(
            ctx,
            fakeLayer,
            row,
            fields,
            point.x,
            point.y,
            stats.points + datasetIndex,
          );
          datasetPoints += 1;
          stats.points += 1;
        }
      }

      if (stats.points >= MAX_POINTS && stats.geometries >= MAX_GEOMETRIES) break;
    }

    if (datasetPoints || datasetGeometries) stats.datasets += 1;

    diagnostics.push(
      `fallback:${entry.source}:${entry.id}{fields=${fields.length},rows=${
        rows.length
      },points=${datasetPoints},geoms=${datasetGeometries},lat=${
        columns.lat || "-"
      },lng=${columns.lng || "-"},geom=${geometryColumns.join("/") || "-"}}`,
    );
  });
}

async function applyStateOverlay(
  capture: CaptureResult,
  mapState: any,
  savedConfig?: any,
): Promise<CaptureResult> {
  const viewport = getViewport(mapState, savedConfig);
  const entries = getOverlayDatasetEntries(mapState, savedConfig);
  if (!viewport || !entries.length) return capture;

  const image = await loadImage(capture.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return capture;

  ctx.drawImage(image, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  const stats: DrawStats = {
    points: 0,
    geometries: 0,
    rows: 0,
    layers: 0,
    datasets: 0,
  };
  const diagnostics: string[] = [];
  const layers = getAllLayers(mapState, savedConfig);

  layers.forEach((layer) => {
    const dataIds = getLayerDataIds(layer);
    dataIds.forEach((dataId) => {
      const entry = getDatasetById(entries, dataId);
      if (!entry) return;
      drawLayerOverlay(
        ctx,
        viewport,
        layer,
        entry,
        mapState,
        savedConfig,
        stats,
        diagnostics,
      );
    });
  });

  if (!stats.points && !stats.geometries) {
    drawDatasetFallbackOverlay(
      ctx,
      viewport,
      entries,
      mapState,
      savedConfig,
      stats,
      diagnostics,
    );
  }

  if (!stats.points && !stats.geometries) {
    return {
      ...capture,
      diagnostics: [
        ...capture.diagnostics,
        "stateOverlay=0",
        `stateDatasets=${entries.length}`,
        `stateLayers=${layers.length}`,
        diagnostics.join(";"),
      ],
    };
  }

  assertNotBlack(canvas, "preview com dados do estado");
  const dataUrl = canvas.toDataURL("image/png", 0.92);
  if (!isImageDataUrl(dataUrl)) return capture;

  return {
    dataUrl,
    method: `${capture.method}+kepler-layer-overlay`,
    diagnostics: [
      ...capture.diagnostics,
      `overlayPoints=${stats.points}`,
      `overlayGeometries=${stats.geometries}`,
      `overlayRows=${stats.rows}`,
      `overlayLayers=${stats.layers}`,
      `overlayDatasets=${stats.datasets}`,
      diagnostics.join(";"),
      `overlayBytesBase64=${dataUrl.length}`,
    ],
  };
}

function generatedPreview(): CaptureResult {
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas técnico indisponível.");

  const gradient = ctx.createLinearGradient(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  gradient.addColorStop(0, "#08090B");
  gradient.addColorStop(0.5, "#11151C");
  gradient.addColorStop(1, "#0E2A27");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  ctx.strokeStyle = "rgba(244,241,232,0.09)";

  for (let x = 0; x < PREVIEW_WIDTH; x += 42) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, PREVIEW_HEIGHT);
    ctx.stroke();
  }

  for (let y = 0; y < PREVIEW_HEIGHT; y += 42) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(PREVIEW_WIDTH, y);
    ctx.stroke();
  }

  const dataUrl = canvas.toDataURL("image/png", 0.92);

  return {
    dataUrl,
    method: "generated-technical-preview",
    diagnostics: ["fallback técnico"],
  };
}

async function captureThumbnail(
  mapState: any,
  savedConfig?: any,
): Promise<CaptureResult> {
  const errors: string[] = [];

  try {
    return await applyStateOverlay(await captureCompositedBase(), mapState, savedConfig);
  } catch (error) {
    errors.push(`canvas-composite: ${errorMessage(error)}`);
  }

  try {
    return await applyStateOverlay(await captureHtml2Canvas(), mapState, savedConfig);
  } catch (error) {
    errors.push(`html2canvas: ${errorMessage(error)}`);
  }

  return await applyStateOverlay(
    { ...generatedPreview(), diagnostics: errors },
    mapState,
    savedConfig,
  );
}


export type ProjectThumbnailCapture = CaptureResult & {
  blob: Blob;
};

export function serializeProjectConfig(mapState: any) {
  return normalizeSavedKeplerConfig(
    KeplerGlSchema.save(mapState),
    mapState,
  );
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Captura cancelada.", "AbortError");
  }
}

function dataUrlToBlob(dataUrl: string) {
  const [metadata, base64 = ""] = dataUrl.split(",", 2);
  const contentType =
    metadata.match(/^data:([^;]+);base64$/i)?.[1] || "image/png";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: contentType });
}

export async function captureProjectThumbnail(
  mapState: any,
  savedConfig: any,
  options: { signal?: AbortSignal } = {},
): Promise<ProjectThumbnailCapture> {
  throwIfAborted(options.signal);
  const capture = await captureThumbnail(mapState, savedConfig);
  throwIfAborted(options.signal);

  return {
    ...capture,
    blob: dataUrlToBlob(capture.dataUrl),
  };
}

