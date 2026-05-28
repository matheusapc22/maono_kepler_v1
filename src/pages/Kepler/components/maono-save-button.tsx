import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useParams } from "react-router";
import { KeplerGlSchema } from "@kepler.gl/schemas";
import html2canvas from "html2canvas";
import { useSession } from "../../../auth/session";

const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 540;

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

function getLargestVisibleCanvas() {
  const canvases = Array.from(document.querySelectorAll("canvas"));

  return (
    canvases
      .filter((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return canvas.width > 0 && canvas.height > 0 && rect.width > 80 && rect.height > 80;
      })
      .sort((a, b) => b.width * b.height - a.width * a.height)[0] || null
  );
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

  const dataUrl = outputCanvas.toDataURL("image/png", 0.92);

  if (!isValidDataUrl(dataUrl)) {
    throw new Error("Canvas gerou dataURL inválido.");
  }

  return dataUrl;
}

async function captureByDirectCanvas(): Promise<CaptureResult> {
  await waitForPaint();

  const canvas = getLargestVisibleCanvas();
  const canvasCount = document.querySelectorAll("canvas").length;

  if (!canvas) {
    throw new Error(`Nenhum canvas visível encontrado. Total de canvas na tela: ${canvasCount}.`);
  }

  const rect = canvas.getBoundingClientRect();
  const dataUrl = resizeToProjectPreview(canvas);

  return {
    dataUrl,
    method: "canvas-direct",
    diagnostics: [
      `canvasCount=${canvasCount}`,
      `source=${canvas.width}x${canvas.height}`,
      `rect=${Math.round(rect.width)}x${Math.round(rect.height)}`,
      `bytesBase64=${dataUrl.length}`,
    ],
  };
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

  const dataUrl = resizeToProjectPreview(captureCanvas);

  return {
    dataUrl,
    method: "html2canvas",
    diagnostics: [
      `target=${target.tagName.toLowerCase()}`,
      `targetRect=${Math.round(targetRect.width)}x${Math.round(targetRect.height)}`,
      `readableCanvas=${readableCanvasCount}/${canvasDataUrls.length}`,
      `capture=${captureCanvas.width}x${captureCanvas.height}`,
      `bytesBase64=${dataUrl.length}`,
    ],
  };
}

async function captureThumbnail(): Promise<CaptureResult> {
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

  throw new Error(errors.join(" | "));
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
        const capture = await captureThumbnail();
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
