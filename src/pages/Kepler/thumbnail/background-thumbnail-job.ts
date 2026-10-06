import { recordPreviewMetric } from "./preview-metrics.ts";
import { captureProjectThumbnail, type ProjectThumbnailCapture } from "./capture-thumbnail.ts";
import type { DurableSaveSnapshot } from "../durable-save-store.ts";
import { hashPreviewBlob, PREVIEW_RENDERER_VERSION } from "./preview-contract.ts";
import { defaultPreviewSpool, PREVIEW_SPOOL_RETENTION_MS, type StagedPreview } from "./preview-spool.ts";
import { bindCapturedPreview, enqueuePreviewRecord, capturePreviewSessionFence, type PreviewStateCallback } from "./preview-recovery.ts";
export { cancelProjectThumbnailJob, waitForPreview } from "./preview-recovery.ts";
export type { ProjectThumbnailJobState } from "./preview-recovery.ts";

export type PreparedPreviewCapture = { promise: Promise<StagedPreview | null>; cancel: () => void; isCurrent: () => boolean };
/** Called at the explicit Save click, before the first serialization/hash/network await. */
export function prepareProjectThumbnailCapture(input: {
  actorId: string; organizationId: string; saveOperationId: string; editorSessionId: string; editGeneration: number;
  root: HTMLElement | null; isCurrent: () => boolean; mapState: any; savedConfig: any;
  onState?: PreviewStateCallback;
}): PreparedPreviewCapture {
  const controller = new AbortController();
  const sessionFence = capturePreviewSessionFence(input.actorId, input.organizationId);
  const canPersist = () => !controller.signal.aborted && sessionFence.isCurrent();
  const promise = (async () => {
    input.onState?.("CAPTURING");
    if (!input.root) { input.onState?.("WAITING_CAPTURE", { errorCode: "PREVIEW_EDITOR_UNAVAILABLE" }); return null; }
    const captureStarted = performance.now();
    let capture: ProjectThumbnailCapture;
    try {
      capture = await captureProjectThumbnail(input.mapState, input.savedConfig, { root: input.root,
        editorSessionId: input.editorSessionId, editGeneration: input.editGeneration, isCurrent: input.isCurrent, signal: controller.signal });
    } catch (error) {
      input.onState?.("WAITING_CAPTURE", { errorCode: (error as any)?.code || "PREVIEW_FRAME_UNAVAILABLE" }); return null;
    }
    recordPreviewMetric("capture", performance.now() - captureStarted, { bytes: capture.blob.size });
    recordPreviewMetric("readiness", capture.timings.readinessMs);
    recordPreviewMetric("composition", capture.timings.compositionMs + capture.timings.overlayMs);
    recordPreviewMetric("encoding", capture.timings.encodingMs, { bytes: capture.blob.size });
    if (capture.quality !== "faithful") { input.onState?.("FAILED", { errorCode: "PREVIEW_CAPTURE_DEGRADED" }); return null; }
    const createdAt = Date.now();
    const staged: StagedPreview = { key: JSON.stringify([input.actorId, input.organizationId, input.saveOperationId]),
      actorId: input.actorId, organizationId: input.organizationId, saveOperationId: input.saveOperationId,
      editorSessionId: input.editorSessionId, editGeneration: input.editGeneration, rendererVersion: PREVIEW_RENDERER_VERSION,
      blob: capture.blob, imageChecksum: await hashPreviewBlob(capture.blob), captureMethod: capture.method,
      purgeEpoch: await sessionFence.purgeEpoch, createdAt, expiresAt: createdAt + PREVIEW_SPOOL_RETENTION_MS };
    if (!canPersist()) return null;
    const persistenceStarted = performance.now();
    try { await defaultPreviewSpool.stage(staged, canPersist);
      recordPreviewMetric("local-persistence", performance.now() - persistenceStarted, { bytes: capture.blob.size });
      if (!canPersist()) return null;
      input.onState?.("LOCAL_READY", { durable: true }); }
    catch (error) {
      if (!canPersist() || (error as { name?: string })?.name === "AbortError") return null;
      input.onState?.("LOCAL_READY", { durable: false, errorCode: "PREVIEW_LOCAL_STORAGE_UNAVAILABLE" });
    }
    return staged;
  })().catch(() => { input.onState?.("FAILED", { errorCode: "PREVIEW_CAPTURE_FAILED" }); return null; });
  return { promise, cancel: () => controller.abort(), isCurrent: canPersist };
}
/** Receives the immutable save result, never live map state or reparsed GeoJSON. */
export async function enqueueProjectThumbnailJob(input: {
  snapshot: DurableSaveSnapshot; data: any; capture?: PreparedPreviewCapture | null; isCurrent?: () => boolean; onState?: PreviewStateCallback;
}) {
  const sessionFence = capturePreviewSessionFence(input.snapshot.scope.actorId, input.snapshot.scope.organizationId);
  const current = () => sessionFence.isCurrent() && (!input.capture || input.capture.isCurrent()) && (!input.isCurrent || input.isCurrent());
  try { await sessionFence.purgeEpoch; } catch { return "CANCELLED" as const; }
  if (!current()) return "CANCELLED" as const;
  const staged = input.capture ? await input.capture.promise : await defaultPreviewSpool.staged(input.snapshot.scope.actorId, input.snapshot.scope.organizationId, input.snapshot.manifest.operationId).catch(() => null);
  if (!current()) return "CANCELLED" as const;
  if (!staged) { input.onState?.("WAITING_CAPTURE", { errorCode: "PREVIEW_CAPTURE_REQUIRED" }); return "WAITING_CAPTURE" as const; }
  try {
    const record = await bindCapturedPreview(input.snapshot, input.data, staged, defaultPreviewSpool, current);
    return enqueuePreviewRecord(record, { onState: input.onState, isCurrent: current });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError" || !current()) return "CANCELLED" as const;
    if ((error as Error).message === "PREVIEW_SAVE_RECEIPT_UNVERIFIED") {
      input.onState?.("FAILED", { errorCode: "PREVIEW_SAVE_RECEIPT_UNVERIFIED" }); return "FAILED" as const;
    }
    input.onState?.("LOCAL_READY", { errorCode: "PREVIEW_LOCAL_STORAGE_UNAVAILABLE", durable: false });
    const record = await bindCapturedPreview(input.snapshot, input.data, staged, null, current);
    return enqueuePreviewRecord(record, { onState: input.onState, isCurrent: current, memoryOnly: true });
  }
}
