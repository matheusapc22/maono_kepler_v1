import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useParams } from "react-router";
import { KeplerGlSchema } from "@kepler.gl/schemas";
import { WebMercatorViewport } from "@deck.gl/core";
import html2canvas from "html2canvas";
import { useSession } from "../../../auth/session";

const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 540;
const MAX_POINTS = 8000;
const MAX_GEOMETRIES = 2200;

type CaptureResult = {
  dataUrl: string;
  method: string;
  diagnostics: string[];
};

function normalize(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function canSaveProject(userRole?: string, accessLevel?: string) {
  if (normalize(userRole) === "admin") return true;
  return ["editor", "owner"].includes(normalize(accessLevel));
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
    datasets: Array.isArray(saved.datasets) ? saved.datasets : getFallbackDatasets(mapState),
    config,
  };
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
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
  return { mean, variance: sum2 / safeCount - mean * mean, useful: useful / safeCount };
}

function assertNotBlack(canvas: HTMLCanvasElement, label: string) {
  const q = brightnessQuality(canvas);
  if (q.useful < 0.008 && q.variance < 8) {
    throw new Error(`${label} gerou imagem preta ou sem conteúdo. mean=${q.mean.toFixed(1)} variance=${q.variance.toFixed(1)} useful=${(q.useful * 100).toFixed(2)}%`);
  }
  return q;
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
      zIndex: Number.parseInt(window.getComputedStyle(canvas).zIndex || "0", 10) || 0,
    }))
    .filter((item) => item.canvas.width > 0 && item.canvas.height > 0 && item.rect.width > 80 && item.rect.height > 80)
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

function drawCanvasIntoPreview(ctx: CanvasRenderingContext2D, item: any, targetRect: DOMRect) {
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
    (height / targetRect.height) * PREVIEW_HEIGHT
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
    const r = item.rect;
    return Math.max(0, Math.min(r.right, targetRect.right) - Math.max(r.left, targetRect.left)) > 0;
  });

  if (!canvases.length) throw new Error("Nenhum canvas visível encontrado para composição.");

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
      const q = brightnessQuality(temp);
      qualities.push(`o=${item.order},z=${item.zIndex},mean=${q.mean.toFixed(1)},var=${q.variance.toFixed(1)},useful=${(q.useful * 100).toFixed(1)}%`);

      if (q.mean < 45 && q.useful < 0.35) ctx.drawImage(maskBlackBackground(temp), 0, 0);
      else ctx.drawImage(temp, 0, 0);
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
    diagnostics: [`canvases=${canvases.length}`, `drawn=${drawn}`, `skipped=${skipped}`, qualities.join(";")],
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
    ignoreElements: (element) => Boolean(element.closest?.("[data-maono-no-preview='true']")),
  });
  return { dataUrl: cropCanvasToPreview(captured), method: "html2canvas", diagnostics: [`capture=${captured.width}x${captured.height}`] };
}

function getViewport(mapState: any) {
  const viewState = mapState?.mapState || {};
  const longitude = Number(viewState.longitude);
  const latitude = Number(viewState.latitude);
  const zoom = Number(viewState.zoom);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(zoom)) return null;
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

function fieldsOf(dataset: any) {
  const fields = dataset?.fields || dataset?.data?.fields || dataset?.data?.schema?.fields || [];
  return Array.isArray(fields) ? fields : [];
}

function fieldName(field: any) {
  return String(field?.name || field?.id || field?.displayName || "");
}

function rowsOf(dataset: any) {
  const data = dataset?.data || dataset;
  if (Array.isArray(data?.allData)) return data.allData;
  if (Array.isArray(dataset?.allData)) return dataset.allData;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(dataset?.rows)) return dataset.rows;
  if (Array.isArray(data)) return data;

  const dc = dataset?.dataContainer || data?.dataContainer;
  if (dc) {
    try {
      if (typeof dc.rows === "function") {
        const rows = dc.rows();
        if (Array.isArray(rows)) return rows;
      }
    } catch (_error) {
      // ignore
    }

    const count = Number(typeof dc.numRows === "function" ? dc.numRows() : dc.numRows);
    if (Number.isFinite(count) && count > 0) {
      const rows = [];
      const limit = Math.min(count, Math.max(MAX_POINTS, MAX_GEOMETRIES));
      for (let i = 0; i < limit; i += 1) {
        try {
          const row = typeof dc.row === "function" ? dc.row(i) : typeof dc.get === "function" ? dc.get(i) : null;
          if (row) rows.push(row);
        } catch (_error) {
          // ignore
        }
      }
      return rows;
    }
  }

  return [];
}

function valueOf(row: any, fields: any[], name?: string | null) {
  if (!name || !row) return undefined;
  if (Array.isArray(row)) {
    const index = fields.findIndex((field) => normalize(fieldName(field)) === normalize(name));
    return index >= 0 ? row[index] : undefined;
  }
  if (typeof row === "object") {
    if (name in row) return row[name];
    const key = Object.keys(row).find((candidate) => normalize(candidate) === normalize(name));
    return key ? row[key] : undefined;
  }
  return undefined;
}

function findField(fields: any[], candidates: string[]) {
  const exact = fields.find((field) => candidates.map(normalize).includes(normalize(fieldName(field))));
  if (exact) return fieldName(exact);
  const partial = fields.find((field) => candidates.some((candidate) => normalize(fieldName(field)).includes(normalize(candidate))));
  return partial ? fieldName(partial) : null;
}

function layersForDataset(mapState: any, datasetId: string) {
  const layers = mapState?.visState?.layers;
  if (!Array.isArray(layers)) return [];
  return layers.filter((layer: any) => String(layer?.config?.dataId || layer?.props?.dataId || "") === String(datasetId));
}

function coordinateColumns(mapState: any, datasetId: string, fields: any[]) {
  for (const layer of layersForDataset(mapState, datasetId)) {
    const columns = layer?.config?.columns || layer?.props?.columns || {};
    const lat = columns.lat || columns.latitude || columns.y || columns.lat0;
    const lng = columns.lng || columns.lon || columns.longitude || columns.x || columns.lng0;
    if (lat && lng) return { lat: String(lat), lng: String(lng) };
  }
  return {
    lat: findField(fields, ["latitude", "lat", "y", "lat_dd", "latitud"]),
    lng: findField(fields, ["longitude", "lon", "lng", "long", "x", "lng_dd", "longitud"]),
  };
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
    if (!trimmed.startsWith("{")) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch (_error) {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  if (parsed.type === "FeatureCollection") return (parsed.features || []).flatMap((feature: any) => geometryValues(feature));
  if (parsed.type === "Feature") return geometryValues(parsed.geometry);
  if (parsed.type && parsed.coordinates) return [parsed];
  if (parsed.geometry) return geometryValues(parsed.geometry);
  return [];
}

function rowGeometries(row: any, fields: any[]) {
  const out: any[] = [];
  ["geojson", "geometry", "geom", "the_geom", "shape"].forEach((candidate) => {
    out.push(...geometryValues(valueOf(row, fields, findField(fields, [candidate]))));
  });
  if (Array.isArray(row)) row.forEach((value) => out.push(...geometryValues(value)));
  else if (row && typeof row === "object") Object.values(row).forEach((value) => out.push(...geometryValues(value)));
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
    if (x < -120 || x > PREVIEW_WIDTH + 120 || y < -120 || y > PREVIEW_HEIGHT + 120) return null;
    return { x, y };
  } catch (_error) {
    return null;
  }
}

function drawPoint(ctx: CanvasRenderingContext2D, x: number, y: number, index: number) {
  const colors = ["#20C7B5", "#F2C766", "#22C55E", "#EF4444", "#3B82F6", "#F97316"];
  ctx.save();
  ctx.fillStyle = colors[index % colors.length];
  ctx.strokeStyle = "rgba(8,9,11,0.92)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLine(ctx: CanvasRenderingContext2D, viewport: any, coordinates: any[], close = false) {
  let started = false;
  coordinates.forEach((coordinate) => {
    const point = project(viewport, coordinate);
    if (!point) return;
    if (!started) {
      ctx.moveTo(point.x, point.y);
      started = true;
    } else ctx.lineTo(point.x, point.y);
  });
  if (started && close) ctx.closePath();
  return started;
}

function drawGeometry(ctx: CanvasRenderingContext2D, viewport: any, geometry: any, index: number) {
  if (!geometry?.type || !geometry?.coordinates) return 0;
  const fill = index % 2 === 0 ? "rgba(32,199,181,0.45)" : "rgba(214,168,79,0.38)";
  const stroke = index % 2 === 0 ? "rgba(242,199,102,0.95)" : "rgba(32,199,181,0.95)";

  if (geometry.type === "Point") {
    const point = project(viewport, geometry.coordinates);
    if (!point) return 0;
    drawPoint(ctx, point.x, point.y, index);
    return 1;
  }
  if (geometry.type === "MultiPoint") {
    let drawn = 0;
    geometry.coordinates.forEach((coordinate: any, pointIndex: number) => {
      const point = project(viewport, coordinate);
      if (point) {
        drawPoint(ctx, point.x, point.y, index + pointIndex);
        drawn += 1;
      }
    });
    return drawn;
  }
  if (geometry.type === "LineString") {
    ctx.beginPath();
    if (!drawLine(ctx, viewport, geometry.coordinates)) return 0;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    return 1;
  }
  if (geometry.type === "MultiLineString") {
    let drawn = 0;
    geometry.coordinates.forEach((line: any[]) => {
      ctx.beginPath();
      if (drawLine(ctx, viewport, line)) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.2;
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
        ctx.lineWidth = 1.5;
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

async function applyStateOverlay(capture: CaptureResult, mapState: any): Promise<CaptureResult> {
  const viewport = getViewport(mapState);
  const datasets = mapState?.visState?.datasets;
  if (!viewport || !datasets || typeof datasets !== "object") return capture;

  const image = await loadImage(capture.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return capture;
  ctx.drawImage(image, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  let points = 0;
  let geometries = 0;
  let rows = 0;
  let datasetCount = 0;

  Object.entries(datasets).forEach(([datasetId, dataset]: [string, any], datasetIndex) => {
    const fields = fieldsOf(dataset);
    const rowsForDataset = rowsOf(dataset);
    const columns = coordinateColumns(mapState, datasetId, fields);
    if (!rowsForDataset.length) return;
    datasetCount += 1;

    for (const row of rowsForDataset) {
      rows += 1;
      if (geometries < MAX_GEOMETRIES) {
        for (const geometry of rowGeometries(row, fields)) {
          if (geometries >= MAX_GEOMETRIES) break;
          const drawn = drawGeometry(ctx, viewport, geometry, geometries + datasetIndex);
          if (drawn) geometries += drawn;
        }
      }
      if (points < MAX_POINTS && columns.lat && columns.lng) {
        const lat = toNumber(valueOf(row, fields, columns.lat));
        const lng = toNumber(valueOf(row, fields, columns.lng));
        const point = Number.isFinite(lat) && Number.isFinite(lng) ? project(viewport, [lng, lat]) : null;
        if (point) {
          drawPoint(ctx, point.x, point.y, points + datasetIndex);
          points += 1;
        }
      }
      if (points >= MAX_POINTS && geometries >= MAX_GEOMETRIES) break;
    }
  });

  if (!points && !geometries) {
    return { ...capture, diagnostics: [...capture.diagnostics, "stateOverlay=0"] };
  }

  assertNotBlack(canvas, "preview com dados do estado");
  const dataUrl = canvas.toDataURL("image/png", 0.92);
  if (!isImageDataUrl(dataUrl)) return capture;

  return {
    dataUrl,
    method: `${capture.method}+state-overlay`,
    diagnostics: [
      ...capture.diagnostics,
      `stateOverlayPoints=${points}`,
      `stateOverlayGeometries=${geometries}`,
      `stateOverlayRows=${rows}`,
      `stateOverlayDatasets=${datasetCount}`,
      `stateOverlayBytesBase64=${dataUrl.length}`,
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
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PREVIEW_HEIGHT); ctx.stroke();
  }
  for (let y = 0; y < PREVIEW_HEIGHT; y += 42) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PREVIEW_WIDTH, y); ctx.stroke();
  }

  const dataUrl = canvas.toDataURL("image/png", 0.92);
  return { dataUrl, method: "generated-technical-preview", diagnostics: ["fallback técnico"] };
}

async function captureThumbnail(mapState: any): Promise<CaptureResult> {
  const errors: string[] = [];
  try {
    return await applyStateOverlay(await captureCompositedBase(), mapState);
  } catch (error) {
    errors.push(`canvas-composite: ${errorMessage(error)}`);
  }
  try {
    return await applyStateOverlay(await captureHtml2Canvas(), mapState);
  } catch (error) {
    errors.push(`html2canvas: ${errorMessage(error)}`);
  }
  return await applyStateOverlay({ ...generatedPreview(), diagnostics: errors }, mapState);
}

const MaonoSaveButton: React.FC = () => {
  const { projectSlug } = useParams();
  const { authenticated, user, projects } = useSession();
  const mapState = useSelector((state: any) => state?.demo?.keplerGl?.map);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const projectAccessLevel = useMemo(() => {
    const currentProject = projects.find((project) => normalize(project.slug) === normalize(projectSlug));
    return currentProject?.accessLevel;
  }, [projects, projectSlug]);

  const allowed = Boolean(authenticated && projectSlug && canSaveProject(user?.role, projectAccessLevel));

  async function handleSave() {
    if (!projectSlug || !mapState) return;

    setSaving(true);
    setMessage("");

    try {
      const rawSaved = KeplerGlSchema.save(mapState);
      const config = normalizeSavedKeplerConfig(rawSaved, mapState);
      const capture = await captureThumbnail(mapState);

      const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          config,
          thumbnailDataUrl: capture.dataUrl,
          thumbnailCapture: { method: capture.method, diagnostics: capture.diagnostics.join(" | ") },
        }),
      });

      const data = await response.json();
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error?.message || "Não foi possível salvar o projeto.");
      }

      setMessageType("success");
      setMessage(
        data?.preview
          ? `Projeto e visualização PNG salvos no Dropbox com sucesso. Método: ${capture.method}.`
          : `Projeto salvo no Dropbox. Preview PNG não foi gerado. Diagnóstico: ${capture.diagnostics.join(" | ")}`
      );
    } catch (error) {
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : "Erro ao salvar projeto.");
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) return null;

  return (
    <div data-maono-no-preview="true" className="fixed bottom-6 right-6 z-[99998] flex flex-col items-end gap-3">
      {message && (
        <div
          className={
            messageType === "success"
              ? "max-w-xl rounded-2xl border border-emerald-300/50 bg-emerald-800/95 px-4 py-3 text-sm font-semibold text-white shadow-2xl"
              : "max-w-xl rounded-2xl border border-red-300/50 bg-red-900/95 px-4 py-3 text-sm font-semibold text-white shadow-2xl"
          }
        >
          {message}
        </div>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !mapState}
        className="rounded-2xl border border-emerald-300/50 bg-emerald-600 px-5 py-4 text-sm font-extrabold text-white shadow-2xl transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        title="Salvar alterações no arquivo JSON original do projeto no Dropbox"
      >
        {saving ? "Salvando..." : "Salvar na Maõno"}
      </button>
    </div>
  );
};

export default MaonoSaveButton;
