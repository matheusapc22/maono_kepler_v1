import { pointClusterCaptureExpectation } from "../clustering/point-cluster-render-provenance.ts";
import { mapCaptureRenderInputs, captureStyleExpectation, captureViews, maonoCaptureStyleRuntimes, maonoCaptureDeckRuntimes } from "./capture-render-generation";
import { freezeMaonoMapCaptureGeneration } from "../map-url-loader/map-visual-readiness";
import { prepareThumbnailSnapshot } from "./capture-snapshot";
import { applyDegradedStateOverlay } from "./capture-overlay";
import { assertVerifiedCaptureSurfaces, beginFrozenHtmlCapture, encodeCapturePng, freezeCompositedPixels, generatedTechnicalPreview, releaseCaptureCanvas } from "./capture-pixels";
import type { CanvasCapture } from "./capture-pixels";
import { throwIfCaptureAborted, captureAbortError } from "./capture-waits";

export { serializeProjectConfig } from "./capture-snapshot";

export type ProjectThumbnailCapture = {
  blob: Blob;
  method: string;
  diagnostics: string[];
  quality: "faithful" | "degraded";
  timings: { readinessMs: number; compositionMs: number; overlayMs: number; encodingMs: number; totalMs: number };
};

export type ProjectThumbnailCaptureOptions = {
  /** The exact mounted map viewport, never document/body or another editor. */
  root: HTMLElement;
  editorSessionId: string;
  editGeneration: number;
  /** Must compare the saved generation, account/org/project and mounted route.
   * Checked before/after freeze. Later edits cannot modify already-frozen pixels. */
  isCurrent: () => boolean;
  signal?: AbortSignal;
  /** Upper bound for renderer/tiles/fonts/visibility readiness. Default 8s. */
  timeoutMs?: number;
};

type ActiveCapture = {
  root: HTMLElement;
  generation: number;
  controller: AbortController;
  isCurrent: () => boolean;
  result: Promise<ProjectThumbnailCapture>;
};
const activeCaptures = new Map<string, ActiveCapture>();

export function cancelProjectThumbnailCapture(editorSessionId: string) {
  activeCaptures.get(editorSessionId)?.controller.abort();
}

async function performCapture(mapState: any, savedConfig: any, options: ProjectThumbnailCaptureOptions, signal: AbortSignal): Promise<ProjectThumbnailCapture> {
  const started = performance.now();
  throwIfCaptureAborted(signal);
  const snapshot = prepareThumbnailSnapshot(mapState, savedConfig);
  const renderInputs = mapCaptureRenderInputs(mapState);
  const clusterExpectation = pointClusterCaptureExpectation(snapshot.savedConfig.maono, snapshot.layers, mapState, snapshot.savedConfig.datasets);
  const styleExpectation = captureStyleExpectation(mapState?.mapStyle);
  const views = captureViews(mapState?.mapState || snapshot.camera);
  const frozen: { capture: CanvasCapture | null; fallback: Promise<CanvasCapture> | null } = { capture: null, fallback: null };
  const diagnostics: string[] = [];
  let freezeStartedAt = started;
  let compositionMs = 0;
  let overlayMs = 0;
  try {
    await freezeMaonoMapCaptureGeneration({ ...options, camera: snapshot.camera, requireDeck: true, renderInputs, clusterExpectation, styleExpectation, views, signal }, () => {
      freezeStartedAt = performance.now();
      const verified = new Set<HTMLCanvasElement>();
      for (const { map } of maonoCaptureStyleRuntimes(options.root)) { const canvas = map.getCanvas?.(); if (canvas) verified.add(canvas); }
      for (const { deck } of maonoCaptureDeckRuntimes(options.root)) { const canvas = deck.canvas || deck.gl?.canvas; if (canvas) verified.add(canvas); }
      assertVerifiedCaptureSurfaces(options.root, verified);
      try { frozen.capture = freezeCompositedPixels(options.root); }
      catch (error) {
        diagnostics.push(`canvas-composite:${error instanceof Error ? error.name : "unavailable"}`);
        // Start and clone synchronously at THIS render boundary. Never re-read
        // the mounted map after an awaited failed capture or after the receipt.
        frozen.fallback = beginFrozenHtmlCapture(options.root, signal);
        void frozen.fallback.catch(() => undefined);
      }
    });
    const frozenAt = performance.now();
    if (!frozen.capture && frozen.fallback) {
      try { frozen.capture = await frozen.fallback; }
      catch (error) {
        throwIfCaptureAborted(signal);
        diagnostics.push(`html2canvas:${error instanceof Error ? error.name : "unavailable"}`);
      }
    }
    throwIfCaptureAborted(signal);
    compositionMs = performance.now() - freezeStartedAt;
    if (!frozen.capture) {
      const overlayStartedAt = performance.now();
      frozen.capture = generatedTechnicalPreview();
      diagnostics.push(...await applyDegradedStateOverlay(frozen.capture.canvas, snapshot, signal));
      overlayMs = performance.now() - overlayStartedAt;
    }
    const encodedAt = performance.now();
    const blob = await encodeCapturePng(frozen.capture.canvas, signal);
    throwIfCaptureAborted(signal);
    return {
      blob,
      method: frozen.capture.method,
      quality: frozen.capture.quality,
      timings: { readinessMs: freezeStartedAt - started, compositionMs, overlayMs, encodingMs: performance.now() - encodedAt, totalMs: performance.now() - started },
      diagnostics: [...diagnostics, ...frozen.capture.diagnostics, `freezeMs=${Math.round(frozenAt - started)}`, `overlayMs=${Math.round(encodedAt - frozenAt)}`, `encodeMs=${Math.round(performance.now() - encodedAt)}`, `bytes=${blob.size}`],
    };
  } finally {
    if (frozen.capture) releaseCaptureCanvas(frozen.capture.canvas);
    // A cancelled generation may have started an asynchronous frozen DOM copy.
    // Dispose it even when cancellation won the race before the result arrived.
    if (frozen.fallback && !frozen.capture) void frozen.fallback.then((value) => releaseCaptureCanvas(value.canvas), () => undefined);
  }
}

/** Invoke at Save click, before any asynchronous config preparation/HTTP work.
 * JSON saving must run independently. Publish this Blob only with the matching
 * immutable save receipt, and never publish `quality: degraded` as READY.
 * A newer generation cancels older work; identical in-flight calls share it. */
export function captureProjectThumbnail(mapState: any, savedConfig: any, options: ProjectThumbnailCaptureOptions): Promise<ProjectThumbnailCapture> {
  if (!options?.root || !options.editorSessionId || typeof options.isCurrent !== "function") return Promise.reject(new Error("CAPTURE_IDENTITY_REQUIRED"));
  if (["BODY", "HTML"].includes(options.root.tagName)) return Promise.reject(new Error("CAPTURE_EDITOR_ROOT_REQUIRED"));
  if (!options.isCurrent()) return Promise.reject(captureAbortError());
  const existing = activeCaptures.get(options.editorSessionId);
  if (existing?.generation === options.editGeneration && existing.root === options.root && existing.isCurrent() && !existing.controller.signal.aborted) return existing.result;
  existing?.controller.abort();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const active = { root: options.root, generation: options.editGeneration, controller, isCurrent: options.isCurrent } as ActiveCapture;
  active.result = performCapture(mapState, savedConfig, options, controller.signal).finally(() => {
    options.signal?.removeEventListener("abort", abort);
    if (activeCaptures.get(options.editorSessionId) === active) activeCaptures.delete(options.editorSessionId);
  });
  activeCaptures.set(options.editorSessionId, active);
  return active.result;
}

export const beginProjectThumbnailCapture = captureProjectThumbnail;
