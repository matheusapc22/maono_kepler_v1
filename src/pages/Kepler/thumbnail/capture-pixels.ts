import html2canvas from "html2canvas";
import { boundedCaptureWait, throwIfCaptureAborted } from "./capture-waits";

export const PREVIEW_WIDTH = 960;
export const PREVIEW_HEIGHT = 540;
export type CanvasCapture = { canvas: HTMLCanvasElement; method: string; diagnostics: string[]; quality: "faithful" | "degraded" };

export function releaseCaptureCanvas(canvas: HTMLCanvasElement) { canvas.width = 0; canvas.height = 0; }
export function newPreviewCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CAPTURE_2D_CONTEXT_UNAVAILABLE");
  return { canvas, ctx };
}

export function assertReadableContent(canvas: HTMLCanvasElement) {
  const sample = document.createElement("canvas");
  sample.width = 160; sample.height = 90;
  try {
    const ctx = sample.getContext("2d");
    if (!ctx) throw new Error("CAPTURE_2D_CONTEXT_UNAVAILABLE");
    ctx.drawImage(canvas, 0, 0, 160, 90);
    const pixels = ctx.getImageData(0, 0, 160, 90).data;
    let sum = 0, sum2 = 0, useful = 0, count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 8) continue;
      const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      sum += value; sum2 += value * value; count++;
      if (value > 28) useful++;
    }
    const mean = sum / Math.max(1, count);
    const variance = sum2 / Math.max(1, count) - mean * mean;
    if (!count || (useful / count < 0.008 && variance < 8)) throw new Error("CAPTURE_EMPTY_OR_BLACK");
  } finally { releaseCaptureCanvas(sample); }
}

function effectiveCanvasOpacity(canvas: HTMLCanvasElement, root: HTMLElement) {
  let opacity = 1;
  for (let node: HTMLElement | null = canvas; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") return 0;
    opacity *= Number(style.opacity || 1);
    if (node === root) break;
  }
  return opacity;
}

type CaptureStack = { element: Element; zIndex: number }[];
function canvasStack(canvas: HTMLCanvasElement, root: HTMLElement): CaptureStack {
  const stack: CaptureStack = [];
  for (let element: HTMLElement | null = canvas; element && element !== root; element = element.parentElement) {
    const style = getComputedStyle(element);
    const context = element === canvas || (style.zIndex !== "auto" && style.position !== "static")
      || ["fixed", "sticky"].includes(style.position) || Number(style.opacity) < 1
      || style.transform !== "none" || style.filter !== "none" || style.isolation === "isolate"
      || (style.mixBlendMode && style.mixBlendMode !== "normal");
    if (context) stack.unshift({ element, zIndex: Number.parseInt(style.zIndex, 10) || 0 });
  }
  return stack;
}

function compareCanvasStacks(a: CaptureStack, b: CaptureStack) {
  let index = 0;
  while (index < a.length && index < b.length && a[index].element === b[index].element) index++;
  const left = a[index], right = b[index];
  const z = (left?.zIndex || 0) - (right?.zIndex || 0);
  if (z) return z;
  if (!left || !right) return a.length - b.length;
  // Equal-z sibling contexts paint in DOM order as a unit: descendants cannot
  // escape an ancestor context just because their own z-index is larger.
  return left.element.compareDocumentPosition(right.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function surfaceItems(root: HTMLElement) {
  const target = root.getBoundingClientRect();
  if (target.width <= 0 || target.height <= 0) throw new Error("CAPTURE_EMPTY_EDITOR");
  return Array.from(root.querySelectorAll("canvas"))
    .map((canvas, order) => {
      const style = getComputedStyle(canvas);
      return { canvas, order, rect: canvas.getBoundingClientRect(), stack: canvasStack(canvas, root), opacity: effectiveCanvasOpacity(canvas, root), style };
    })
    .filter(({ canvas, rect, style, opacity }) => canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && opacity > 0 && !canvas.closest("[data-maono-no-preview='true']") && Math.min(rect.right, target.right) > Math.max(rect.left, target.left) && Math.min(rect.bottom, target.bottom) > Math.max(rect.top, target.top))
    .sort((a, b) => compareCanvasStacks(a.stack, b.stack) || a.order - b.order);
}

export function assertVerifiedCaptureSurfaces(root: HTMLElement, verified: Set<HTMLCanvasElement>) {
  if (surfaceItems(root).some(item => !verified.has(item.canvas))) throw new Error("CAPTURE_UNVERIFIED_SURFACE");
}

/** Copy the editor's pixels synchronously at the verified render boundary.
 * No per-surface encoding, no global canvas search, and no black-pixel masking:
 * opaque black is legitimate map content; transparent Deck pixels stay alpha. */
export function freezeCompositedPixels(root: HTMLElement): CanvasCapture {
  const target = root.getBoundingClientRect();
  const items = surfaceItems(root);
  if (!items.length) throw new Error("CAPTURE_NO_EDITOR_CANVASES");
  const { canvas, ctx } = newPreviewCanvas();
  try {
    ctx.fillStyle = "#08090B"; ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    for (const item of items) {
      const { rect, canvas: source } = item;
      const left = Math.max(rect.left, target.left), top = Math.max(rect.top, target.top);
      const width = Math.min(rect.right, target.right) - left, height = Math.min(rect.bottom, target.bottom) - top;
      ctx.globalAlpha = item.opacity;
      ctx.drawImage(source, (left - rect.left) * source.width / rect.width, (top - rect.top) * source.height / rect.height, width * source.width / rect.width, height * source.height / rect.height, (left - target.left) * PREVIEW_WIDTH / target.width, (top - target.top) * PREVIEW_HEIGHT / target.height, width * PREVIEW_WIDTH / target.width, height * PREVIEW_HEIGHT / target.height);
    }
    ctx.globalAlpha = 1;
    assertReadableContent(canvas); // Includes the controlled origin-clean check.
    return { canvas, method: "canvas-composite", diagnostics: [`canvases=${items.length}`, "stateOverlay=already-rendered"], quality: "faithful" };
  } catch (error) { releaseCaptureCanvas(canvas); throw error; }
}

/** Called at the same frozen boundary as composition, never after an awaited
 * fallback. html2canvas synchronously clones the supplied tree before its first
 * await. The owned, styled tree below contains copied canvas pixels, so no later
 * edit, remount or navigation can enter this fallback. */
export function beginFrozenHtmlCapture(root: HTMLElement, signal: AbortSignal): Promise<CanvasCapture> {
  const sourceRect = root.getBoundingClientRect();
  const clone = root.cloneNode(true) as HTMLElement;
  const ownedCanvases: HTMLCanvasElement[] = [];
  const originals = [root, ...Array.from(root.querySelectorAll("*"))];
  const copies = [clone, ...Array.from(clone.querySelectorAll("*"))];
  let holder: HTMLDivElement | null = null;
  const frames: HTMLIFrameElement[] = [];
  const release = () => {
    holder?.remove(); holder = null;
    frames.forEach((frame) => frame.remove());
    ownedCanvases.forEach(releaseCaptureCanvas);
  };
  try {
    originals.forEach((source, index) => {
      throwIfCaptureAborted(signal);
      const target = copies[index] as HTMLElement;
      const computed = getComputedStyle(source);
      for (const property of Array.from(computed)) target.style?.setProperty(property, computed.getPropertyValue(property));
      target.style?.setProperty("animation", "none"); target.style?.setProperty("transition", "none");
      if (source instanceof HTMLCanvasElement) {
        const canvas = target as HTMLCanvasElement;
        canvas.width = source.width; canvas.height = source.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("CAPTURE_2D_CONTEXT_UNAVAILABLE");
        ctx.drawImage(source, 0, 0);
        // Fail closed for tainted surfaces; never evade CORS by omitting them.
        if (canvas.width && canvas.height) ctx.getImageData(0, 0, 1, 1);
        ownedCanvases.push(canvas);
      }
    });
    holder = document.createElement("div");
    holder.dataset.maonoNoPreview = "true";
    holder.style.cssText = `position:fixed;left:-100000px;top:0;width:${sourceRect.width}px;height:${sourceRect.height}px;pointer-events:none;`;
    clone.style.position = "relative"; clone.style.left = "0"; clone.style.top = "0";
    clone.style.width = `${sourceRect.width}px`; clone.style.height = `${sourceRect.height}px`;
    holder.appendChild(clone); document.body.appendChild(holder);
    const existing = new Set(document.querySelectorAll("iframe.html2canvas-container"));
    return boundedCaptureWait<HTMLCanvasElement>((resolve, reject) => {
      const promise = html2canvas(clone, {
        backgroundColor: "#08090B", useCORS: true, allowTaint: false, logging: false, scale: 1, imageTimeout: 2000,
        ignoreElements: (element) => element !== holder && element !== clone && Boolean(element.closest?.("[data-maono-no-preview='true']")) && !clone.contains(element),
        onclone: () => { throwIfCaptureAborted(signal); },
      });
      for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe.html2canvas-container")) if (!existing.has(frame)) frames.push(frame);
      promise.then(resolve, reject);
      return release;
    }, signal, 4000, "html2canvas", releaseCaptureCanvas).then((captured) => {
      const { canvas, ctx } = newPreviewCanvas();
      try {
        // Keep the previous html2canvas fallback's centered 16:9 crop.
        const ratio = PREVIEW_WIDTH / PREVIEW_HEIGHT;
        const width = Math.min(captured.width, captured.height * ratio);
        const height = Math.min(captured.height, captured.width / ratio);
        ctx.drawImage(captured, (captured.width - width) / 2, (captured.height - height) / 2, width, height, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
        assertReadableContent(canvas);
        return { canvas, method: "html2canvas", diagnostics: ["source=frozen-editor-dom"], quality: "faithful" as const };
      } catch (error) { releaseCaptureCanvas(canvas); throw error; }
      finally { releaseCaptureCanvas(captured); }
    });
  } catch (error) { release(); return Promise.reject(error); }
}

export function generatedTechnicalPreview(): CanvasCapture {
  const { canvas, ctx } = newPreviewCanvas();
  const gradient = ctx.createLinearGradient(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  gradient.addColorStop(0, "#08090B"); gradient.addColorStop(0.5, "#11151C"); gradient.addColorStop(1, "#0E2A27");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  ctx.strokeStyle = "rgba(244,241,232,0.09)";
  for (let x = 0; x < PREVIEW_WIDTH; x += 42) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PREVIEW_HEIGHT); ctx.stroke(); }
  for (let y = 0; y < PREVIEW_HEIGHT; y += 42) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PREVIEW_WIDTH, y); ctx.stroke(); }
  return { canvas, method: "generated-technical-preview", diagnostics: ["fallback técnico", "quality=degraded"], quality: "degraded" };
}

export function encodeCapturePng(canvas: HTMLCanvasElement, signal: AbortSignal) {
  return boundedCaptureWait<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob?.size ? resolve(blob) : reject(new Error("CAPTURE_PNG_ENCODING_FAILED")), "image/png");
  }, signal, 4000, "png-encoding");
}
