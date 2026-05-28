import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useParams } from "react-router";
import { KeplerGlSchema } from "@kepler.gl/schemas";
import html2canvas from "html2canvas";
import { useSession } from "../../../auth/session";

const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 540;
const MIN_NON_DARK_RATIO = 0.008;
const MIN_VARIANCE = 8;

type CaptureResult = {
  dataUrl: string;
  method: string;
  diagnostics: string[];
};

type PreviewQuality = {
  mean: number;
  variance: number;
  nonDarkRatio: number;
  transparentRatio: number;
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

  if (!datasets || typeof datasets !== "object") {
    return [];
  }

  return Object.entries(datasets).map(([id, dataset]: [string, any]) => ({
    version: "v1",
    data: dataset?.data || dataset,
    info: {
      id,
      label: dataset?.label || dataset?.data?.label || id,
    },
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

  const datasets = Array.isArray(saved.datasets)
    ? saved.datasets
    : getFallbackDatasets(mapState);

  return {
    ...saved,
    version: saved.version || "v1",
    datasets,
    config,
  };
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isValidDataUrl(dataUrl?: string | null) {
  return Boolean(dataUrl && /^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl));
}

function findCaptureTarget() {
  return (
    document.querySelector(".kepler-gl") ||
    document.querySelector("[class*='kepler']") ||
    document.querySelector("main") ||
    document.body
  ) as HTMLElement;
}

function getVisibleCanvases() {
  return Array.from(document.querySelectorAll("canvas"))
    .filter((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return canvas.width > 0 && canvas.height > 0 && rect.width > 80 && rect.height > 80;
    })
    .sort((a, b) => b.width * b.height - a.width * a.height);
}

function collectCanvasDataUrls() {
  const canvases = Array.from(document.querySelectorAll("canvas"));

  return canvases.map((canvas) => {
    try {
      return canvas.toDataURL("image/png");
    } catch (_error) {
      return null;
    }
  });
}

function analyzeCanvasQuality(canvas: HTMLCanvasElement): PreviewQuality {
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 160;
  sampleCanvas.height = 90;

  const ctx = sampleCanvas.getContext("2d");
  if (!ctx) {
    return { mean: 0, variance: 0, nonDarkRatio: 0, transparentRatio: 1 };
  }

  ctx.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);

  const data = ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  const pixels = data.length / 4;
  let sum = 0;
  let sumSquares = 0;
  let nonDark = 0;
  let transparent = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 8) {
      transparent += 1;
      continue;
    }

    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += brightness;
    sumSquares += brightness * brightness;

    if (brightness > 28) {
      nonDark += 1;
    }
  }

  const opaquePixels = Math.max(1, pixels - transparent);
  const mean = sum / opaquePixels;
  const variance = sumSquares / opaquePixels - mean * mean;

  return {
    mean,
    variance,
    nonDarkRatio: nonDark / opaquePixels,
    transparentRatio: transparent / pixels,
  };
}

function formatQuality(quality: PreviewQuality) {
  return `mean=${quality.mean.toFixed(1)},variance=${quality.variance.toFixed(1)},nonDark=${(
    quality.nonDarkRatio * 100
  ).toFixed(2)}%,transparent=${(quality.transparentRatio * 100).toFixed(2)}%`;
}

function assertUsablePreview(canvas: HTMLCanvasElement, label: string) {
  const quality = analyzeCanvasQuality(canvas);

  // A Maõno usa mapas escuros, então não exigimos imagem clara.
  // Rejeitamos apenas captura praticamente sólida/preta, que é o caso típico de
  // WebGL lido depois de o framebuffer ter sido limpo.
  if (quality.nonDarkRatio < MIN_NON_DARK_RATIO && quality.variance < MIN_VARIANCE) {
    throw new Error(`${label} gerou preview preto ou sem conteúdo útil (${formatQuality(quality)}).`);
  }

  return quality;
}

function resizeToProjectPreview(sourceCanvas: HTMLCanvasElement) {
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = PREVIEW_WIDTH;
  outputCanvas.height = PREVIEW_HEIGHT;

  const ctx = outputCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("Não foi possível criar contexto para preview PNG.");
  }

  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = PREVIEW_WIDTH / PREVIEW_HEIGHT;

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }

  ctx.fillStyle = "#08090B";
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  const quality = assertUsablePreview(outputCanvas, "preview redimensionado");
  const dataUrl = outputCanvas.toDataURL("image/png", 0.92);

  if (!isValidDataUrl(dataUrl)) {
    throw new Error("Canvas gerou dataURL inválido.");
  }

  return { dataUrl, quality };
}

async function captureByDirectCanvas(): Promise<CaptureResult> {
  await waitForPaint();

  const canvases = getVisibleCanvases();
  const canvasCount = document.querySelectorAll("canvas").length;
  const errors: string[] = [];

  if (!canvases.length) {
    throw new Error(`Nenhum canvas visível encontrado. Total de canvas na tela: ${canvasCount}.`);
  }

  for (const [index, canvas] of canvases.entries()) {
    const rect = canvas.getBoundingClientRect();

    try {
      const { dataUrl, quality } = resizeToProjectPreview(canvas);

      return {
        dataUrl,
        method: `canvas-direct-${index}`,
        diagnostics: [
          `canvasCount=${canvasCount}`,
          `selectedIndex=${index}`,
          `source=${canvas.width}x${canvas.height}`,
          `rect=${Math.round(rect.width)}x${Math.round(rect.height)}`,
          formatQuality(quality),
          `bytesBase64=${dataUrl.length}`,
        ],
      };
    } catch (error) {
      errors.push(
        `canvas[${index}] ${canvas.width}x${canvas.height} rect=${Math.round(rect.width)}x${Math.round(
          rect.height
        )}: ${getErrorMessage(error)}`
      );
    }
  }

  throw new Error(errors.join(" | "));
}

async function captureByHtml2Canvas(): Promise<CaptureResult> {
  await waitForPaint();

  const target = findCaptureTarget();
  const targetRect = target.getBoundingClientRect();
  const canvasDataUrls = collectCanvasDataUrls();
  const readableCanvasCount = canvasDataUrls.filter(Boolean).length;

  const captureCanvas = await html2canvas(target, {
    backgroundColor: "#08090B",
    useCORS: true,
    allowTaint: true,
    logging: false,
    scale: 1,
    ignoreElements: (element) => Boolean(element.closest?.("[data-maono-no-preview='true']")),
    onclone: (clonedDocument) => {
      const clonedCanvases = Array.from(clonedDocument.querySelectorAll("canvas"));

      clonedCanvases.forEach((canvas, index) => {
        const dataUrl = canvasDataUrls[index];
        if (!dataUrl) return;

        const img = clonedDocument.createElement("img");
        img.src = dataUrl;
        img.width = canvas.width;
        img.height = canvas.height;
        img.style.width = canvas.style.width || `${canvas.getBoundingClientRect().width}px`;
        img.style.height = canvas.style.height || `${canvas.getBoundingClientRect().height}px`;
        img.style.display = "block";

        canvas.parentNode?.replaceChild(img, canvas);
      });
    },
  });

  if (!captureCanvas || captureCanvas.width <= 0 || captureCanvas.height <= 0) {
    throw new Error("html2canvas retornou canvas vazio.");
  }

  const { dataUrl, quality } = resizeToProjectPreview(captureCanvas);

  return {
    dataUrl,
    method: "html2canvas",
    diagnostics: [
      `target=${target.tagName.toLowerCase()}`,
      `targetRect=${Math.round(targetRect.width)}x${Math.round(targetRect.height)}`,
      `readableCanvas=${readableCanvasCount}/${canvasDataUrls.length}`,
      `capture=${captureCanvas.width}x${captureCanvas.height}`,
      formatQuality(quality),
      `bytesBase64=${dataUrl.length}`,
    ],
  };
}

function getDatasetCount(mapState: any) {
  const datasets = mapState?.visState?.datasets;
  if (!datasets || typeof datasets !== "object") return 0;
  return Object.keys(datasets).length;
}

function getLayerCount(mapState: any) {
  const layers = mapState?.visState?.layers;
  return Array.isArray(layers) ? layers.length : 0;
}

function createGeneratedProjectPreview(mapState: any): CaptureResult {
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Não foi possível criar canvas técnico de fallback.");
  }

  const datasetCount = getDatasetCount(mapState);
  const layerCount = getLayerCount(mapState);
  const latitude = mapState?.mapState?.latitude;
  const longitude = mapState?.mapState?.longitude;
  const zoom = mapState?.mapState?.zoom;

  const gradient = ctx.createLinearGradient(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  gradient.addColorStop(0, "#08090B");
  gradient.addColorStop(0.48, "#11151C");
  gradient.addColorStop(1, "#0E2A27");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  ctx.strokeStyle = "rgba(244,241,232,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= PREVIEW_WIDTH; x += 42) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, PREVIEW_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= PREVIEW_HEIGHT; y += 42) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(PREVIEW_WIDTH, y);
    ctx.stroke();
  }

  const polygons = [
    { x: 96, y: 88, w: 260, h: 150, stroke: "#20C7B5", fill: "rgba(32,199,181,0.10)" },
    { x: 280, y: 155, w: 410, h: 220, stroke: "#D6A84F", fill: "rgba(214,168,79,0.10)" },
    { x: 585, y: 92, w: 270, h: 178, stroke: "#F2C766", fill: "rgba(242,199,102,0.08)" },
    { x: 615, y: 290, w: 235, h: 128, stroke: "#22C55E", fill: "rgba(34,197,94,0.08)" },
  ];

  polygons.forEach((poly) => {
    ctx.fillStyle = poly.fill;
    ctx.strokeStyle = poly.stroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(poly.x, poly.y, poly.w, poly.h, 8);
    ctx.fill();
    ctx.stroke();
  });

  const points = [
    [225, 242, "#20C7B5"],
    [306, 208, "#3B82F6"],
    [392, 264, "#EF4444"],
    [487, 197, "#F97316"],
    [673, 228, "#F2C766"],
    [746, 316, "#22C55E"],
  ];

  points.forEach(([x, y, color]) => {
    ctx.fillStyle = color as string;
    ctx.strokeStyle = "#08090B";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x as number, y as number, 14, 14, 3);
    ctx.fill();
    ctx.stroke();
  });

  ctx.fillStyle = "rgba(8,9,11,0.72)";
  ctx.fillRect(0, 428, PREVIEW_WIDTH, 112);
  ctx.fillStyle = "#F4F1E8";
  ctx.font = "700 30px Arial";
  ctx.fillText("Maõno Maps · preview técnico", 34, 472);

  ctx.fillStyle = "#C6C0B1";
  ctx.font = "600 20px Arial";
  ctx.fillText(
    `datasets=${datasetCount}  camadas=${layerCount}  zoom=${Number.isFinite(zoom) ? Number(zoom).toFixed(2) : "n/d"}`,
    34,
    508
  );

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    ctx.fillText(`centro=${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`, 500, 508);
  }

  const quality = assertUsablePreview(canvas, "preview técnico gerado");
  const dataUrl = canvas.toDataURL("image/png", 0.92);

  return {
    dataUrl,
    method: "generated-technical-preview",
    diagnostics: [
      "WebGL screenshot indisponível; fallback técnico gerado a partir do estado do projeto.",
      `datasets=${datasetCount}`,
      `layers=${layerCount}`,
      formatQuality(quality),
      `bytesBase64=${dataUrl.length}`,
    ],
  };
}

async function captureThumbnail(mapState: any): Promise<CaptureResult> {
  const errors: string[] = [];

  try {
    return await captureByDirectCanvas();
  } catch (error) {
    errors.push(`canvas-direct: ${getErrorMessage(error)}`);
  }

  try {
    const result = await captureByHtml2Canvas();
    return {
      ...result,
      diagnostics: [...errors, ...result.diagnostics],
    };
  } catch (error) {
    errors.push(`html2canvas: ${getErrorMessage(error)}`);
  }

  const generated = createGeneratedProjectPreview(mapState);
  return {
    ...generated,
    diagnostics: [...errors, ...generated.diagnostics],
  };
}

const MaonoSaveButton: React.FC = () => {
  const { projectSlug } = useParams();
  const { authenticated, user, projects } = useSession();
  const mapState = useSelector((state: any) => state?.demo?.keplerGl?.map);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const projectAccessLevel = useMemo(() => {
    const currentProject = projects.find(
      (project) => normalize(project.slug) === normalize(projectSlug)
    );
    return currentProject?.accessLevel;
  }, [projects, projectSlug]);

  const allowed = Boolean(
    authenticated && projectSlug && canSaveProject(user?.role, projectAccessLevel)
  );

  async function handleSave() {
    if (!projectSlug || !mapState) return;

    setSaving(true);
    setMessage("");

    try {
      const rawSaved = KeplerGlSchema.save(mapState);
      const config = normalizeSavedKeplerConfig(rawSaved, mapState);

      let thumbnailDataUrl: string | null = null;
      let captureMethod = "none";
      let captureDiagnostics = "captura não iniciada";

      try {
        const capture = await captureThumbnail(mapState);
        thumbnailDataUrl = capture.dataUrl;
        captureMethod = capture.method;
        captureDiagnostics = capture.diagnostics.join(" | ");
      } catch (captureError) {
        captureDiagnostics = getErrorMessage(captureError);
        console.warn("Maõno Maps: não foi possível capturar o preview PNG do mapa.", captureError);
      }

      const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/config`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          config,
          thumbnailDataUrl,
          thumbnailCapture: {
            method: captureMethod,
            diagnostics: captureDiagnostics,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error?.message || "Não foi possível salvar o projeto.");
      }

      setMessageType("success");
      setMessage(
        data?.preview
          ? `Projeto e preview PNG salvos no Dropbox com sucesso. Método: ${captureMethod}.`
          : `Projeto salvo no Dropbox. Preview PNG não foi gerado. Diagnóstico: ${captureDiagnostics}`
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
