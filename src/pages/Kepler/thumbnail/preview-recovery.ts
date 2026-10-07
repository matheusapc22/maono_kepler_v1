import { recordPreviewMetric, clearPreviewMetrics } from "./preview-metrics.ts";
import { defaultDurableSaveStore, receiptRevision } from "../durable-save-controller.ts";
import type { DurableSaveSnapshot } from "../durable-save-store.ts";
import { hashPreviewBlob, previewReceiptMatches, type PreviewManifest, type PreviewOperation } from "./preview-contract.ts";
import { defaultPreviewSpool, previewAccountKey, previewSpoolKey, type PreviewSpool, type PreviewSpoolRecord, type StagedPreview } from "./preview-spool.ts";
import { fetchPreviewOperation, ProjectThumbnailRequestError, registerPreviewOperation, uploadProjectThumbnail } from "./thumbnail-api.ts";

export type ProjectThumbnailJobState = "WAITING_CAPTURE" | "CAPTURING" | "LOCAL_READY" | "UPLOADING" | "PENDING" | "RETRY_WAIT" | "READY" | "FAILED" | "STALE" | "CANCELLED" | "PAUSED";
export type PreviewStateCallback = (state: ProjectThumbnailJobState, detail?: { errorCode?: string; durable?: boolean }) => void;
const activeJobs = new Map<string, { controller: AbortController; promise: Promise<ProjectThumbnailJobState>; actorId: string; organizationId: string; slug: string }>();
const MAX_ATTEMPTS = 12;
const pausedAccounts = new Set<string>();
export function waitForPreview(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Prévia interrompida.", "AbortError")); return; }
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, Math.max(0, delayMs));
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Prévia interrompida.", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export function previewRetryDelay(attempt: number, retryAfterMs = 0, random = Math.random) {
  return Math.max(retryAfterMs, Math.min(60_000, 800 * 2 ** Math.min(attempt, 7)) + Math.floor(random() * 400));
}
function safeCode(error: unknown) {
  return error instanceof ProjectThumbnailRequestError ? error.code : (error as { message?: string })?.message?.startsWith("PREVIEW_") ? (error as Error).message : "PREVIEW_NETWORK_FAILURE";
}
export async function publishPreviewRecord(record: PreviewSpoolRecord, options: {
  signal?: AbortSignal; spool?: PreviewSpool; fetchImpl?: typeof fetch; onState?: PreviewStateCallback;
  isCurrent?: () => boolean; wait?: typeof waitForPreview; now?: () => number; memoryOnly?: boolean;
} = {}): Promise<ProjectThumbnailJobState> {
  const { signal, spool = defaultPreviewSpool, fetchImpl, onState = () => {}, isCurrent = () => true, wait = waitForPreview, now = Date.now } = options;
  const ensureCurrent = () => { if (signal?.aborted || !isCurrent()) throw new DOMException("O contexto da prévia mudou.", "AbortError"); };
  const persist = async () => {
    ensureCurrent();
    if (!options.memoryOnly) {
      await spool.put(record, () => !signal?.aborted && isCurrent());
      // Pausing must never erase a previously durable PNG. Logout uses an atomic purge epoch.
      ensureCurrent();
    }
  };
  let operation: PreviewOperation | null;
  let hashVerified = false;
  try {
    while (true) {
      ensureCurrent();
      if (record.state === "FAILED_FINAL") { onState("FAILED", { errorCode: record.lastError || "PREVIEW_RETRY_EXHAUSTED" }); return "FAILED"; }
      if (record.expiresAt <= now()) { onState("FAILED", { errorCode: "PREVIEW_LOCAL_EXPIRED" }); return "FAILED"; }
      if (record.nextAttemptAt > now()) { onState("RETRY_WAIT"); const duration = record.nextAttemptAt - now(); await wait(duration, signal); recordPreviewMetric("retry-wait", duration, { attempt: record.attempts }); }
      ensureCurrent();
      try {
        // Always read the exact historical operation first. A lost response is never proof of absence.
        operation = await fetchPreviewOperation(record.slug, record.manifest.operationId, signal, fetchImpl);
        ensureCurrent();
        if (!operation) operation = await registerPreviewOperation(record.slug, record.manifest, signal, fetchImpl);
        ensureCurrent();
        if (operation.state === "READY") {
          if (!previewReceiptMatches(record.manifest, operation.receipt)) throw new ProjectThumbnailRequestError("Recibo de prévia divergente.", { code: "PREVIEW_RECEIPT_UNVERIFIED" });
          if (!options.memoryOnly) await spool.remove(record.key);
          onState("READY", { durable: true }); return "READY";
        }
        if (operation.state === "SUPERSEDED") { if (!options.memoryOnly) await spool.remove(record.key); onState("STALE"); return "STALE"; }
        if (operation.state === "FAILED_FINAL") {
          record = { ...record, state: "FAILED_FINAL", lastError: operation.errorCode || "PREVIEW_SERVER_FAILED_FINAL" };
          await persist(); onState("FAILED", { errorCode: record.lastError! }); return "FAILED";
        }
        if (operation.state === "WAITING_CAPTURE" || (operation.state === "RECEIVING" && Boolean(operation.nextAttemptAt) && operation.nextAttemptAt! <= now())) {
          if (!hashVerified) {
            if (await hashPreviewBlob(record.blob) !== record.manifest.imageChecksum) throw new ProjectThumbnailRequestError("PNG local corrompido.", { code: "PREVIEW_LOCAL_INTEGRITY_FAILED" });
            hashVerified = true;
          }
          onState("UPLOADING", { durable: !options.memoryOnly });
          // A mutation response is interpreted only on the next exact status lookup.
          // On uncertain failure the catch below schedules that lookup, not another operation.
          const uploadStarted = performance.now();
          await uploadProjectThumbnail({ slug: record.slug, manifest: record.manifest, blob: record.blob, signal, fetchImpl });
          recordPreviewMetric("upload", performance.now() - uploadStarted, { bytes: record.blob.size, attempt: record.attempts });
          record = { ...record, nextAttemptAt: 0 };
          continue;
        }
        if (!["RECEIVING", "PAYLOAD_STORED", "PROCESSING", "RETRY_WAIT"].includes(operation.state)) throw new ProjectThumbnailRequestError("Estado desconhecido.", { code: "PREVIEW_RESPONSE_UNVERIFIED", retryable: true });
        onState("PENDING", { durable: Boolean(operation.payloadStored) });
        record = { ...record, nextAttemptAt: Math.max(now() + 2000, operation.nextAttemptAt || (operation as any).retryAt || 0) };
        await persist();
      } catch (error) {
        ensureCurrent();
        if ((error as { name?: string })?.name === "AbortError") throw error;
        if (error instanceof ProjectThumbnailRequestError && error.status === 401) { pausedAccounts.add(record.accountKey); onState("PAUSED", { errorCode: error.code }); return "PAUSED"; }
        if (error instanceof ProjectThumbnailRequestError && error.stale) { if (!options.memoryOnly) await spool.remove(record.key); onState("STALE"); return "STALE"; }
        const retryable = error instanceof ProjectThumbnailRequestError ? error.retryable : error instanceof TypeError;
        const attempts = record.attempts + 1;
        const final = !retryable || attempts >= MAX_ATTEMPTS;
        record = { ...record, attempts, lastError: safeCode(error), state: final ? "FAILED_FINAL" : "RETRY_WAIT",
          nextAttemptAt: now() + previewRetryDelay(attempts - 1, error instanceof ProjectThumbnailRequestError ? error.retryAfterMs : 0) };
        // Quota/unavailable IDB is reported to the caller; a memory-only upload remains best effort.
        await persist();
        if (final) { onState("FAILED", { errorCode: record.lastError! }); return "FAILED"; }
        onState("RETRY_WAIT", { errorCode: record.lastError!, durable: !options.memoryOnly });
      }
    }
  } catch (error) {
    if (signal?.aborted || !isCurrent() || (error as { name?: string })?.name === "AbortError") { onState("CANCELLED"); return "CANCELLED"; }
    onState("FAILED", { errorCode: safeCode(error), durable: false }); return "FAILED";
  }
}
export async function bindCapturedPreview(snapshot: DurableSaveSnapshot, data: any, staged: StagedPreview, spool: PreviewSpool | null = defaultPreviewSpool, isCurrent: () => boolean = () => true) {
  const receipt = data?.operation?.receipt ?? data?.receipt ?? snapshot.receipt;
  const revision = receiptRevision({ receipt });
  if (!receipt || receipt.operationId !== staged.saveOperationId || staged.saveOperationId !== snapshot.manifest.operationId ||
    String(receipt.organizationId) !== staged.organizationId || staged.actorId !== snapshot.scope.actorId ||
    receipt.checksum !== snapshot.manifest.contentHash || receipt.checksumAlgorithm !== "dropbox-content-hash" ||
    staged.editorSessionId !== snapshot.editorSessionId || staged.editGeneration !== snapshot.editGeneration ||
    (snapshot.scope.projectId && String(receipt.projectId) !== snapshot.scope.projectId) || !revision) throw new Error("PREVIEW_SAVE_RECEIPT_UNVERIFIED");
  const manifest: PreviewManifest = { operationId: `pv2:${staged.saveOperationId}:${staged.imageChecksum.slice(0, 24)}`, saveOperationId: staged.saveOperationId,
    organizationId: staged.organizationId, projectId: String(receipt.projectId), revision, configChecksum: receipt.checksum,
    editorSessionId: staged.editorSessionId, editGeneration: staged.editGeneration, rendererVersion: staged.rendererVersion,
    imageChecksum: staged.imageChecksum, sizeBytes: staged.blob.size, captureMethod: staged.captureMethod };
  const record: PreviewSpoolRecord = { key: previewSpoolKey(staged.actorId, manifest), accountKey: previewAccountKey(staged.actorId, staged.organizationId),
    actorId: staged.actorId, organizationId: staged.organizationId, slug: snapshot.projectSlug, manifest, blob: staged.blob,
    purgeEpoch: staged.purgeEpoch, createdAt: staged.createdAt, expiresAt: staged.expiresAt, attempts: 0, nextAttemptAt: 0, lastError: null, state: "LOCAL_READY" };
  if (!isCurrent()) throw new DOMException("O contexto da prévia mudou.", "AbortError");
  if (spool) await spool.promote(record, staged.key, isCurrent);
  return record;
}
export function enqueuePreviewRecord(record: PreviewSpoolRecord, options: Parameters<typeof publishPreviewRecord>[1] = {}) {
  const existing = activeJobs.get(record.key); if (existing) return existing.promise;
  const controller = new AbortController();
  const abort = () => controller.abort(); options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const promise = publishPreviewRecord(record, { ...options, signal: controller.signal }).finally(() => {
    options.signal?.removeEventListener("abort", abort); if (activeJobs.get(record.key)?.controller === controller) activeJobs.delete(record.key);
  });
  activeJobs.set(record.key, { controller, promise, actorId: record.actorId, organizationId: record.organizationId, slug: record.slug }); return promise;
}
export function cancelProjectThumbnailJob(organizationId: string | number, slug: string) {
  for (const job of activeJobs.values()) if (job.organizationId === String(organizationId) && job.slug === slug) job.controller.abort();
}
let currentSession = "";
let lastKnownActor: string | null = null;
let sessionGeneration = 0;
let pendingAccountPurge: Promise<void> = Promise.resolve();
let sessionPurgeEpoch: Promise<number | undefined> = Promise.resolve(undefined);
export function isPreviewSessionCurrent(actorId: string, organizationId: string) { return currentSession === previewAccountKey(actorId, organizationId); }
/** The generation prevents logout → same-account login from reviving an old capture. */
export function capturePreviewSessionFence(actorId: string, organizationId: string) {
  const generation = sessionGeneration;
  const key = previewAccountKey(actorId, organizationId);
  return { purgeEpoch: sessionPurgeEpoch, isCurrent: () => generation === sessionGeneration && currentSession === key };
}
let removeSessionListeners: (() => void) | undefined;
let resumeVerifiedSession: (() => void) | undefined;
export function activatePreviewRecovery(actorId: string | null, organizationId: string | null, reason: "session" | "logout" = "session") {
  const key = actorId && organizationId ? previewAccountKey(actorId, organizationId) : "";
  if (reason !== "logout" && key === currentSession) { if (key && pausedAccounts.delete(key)) resumeVerifiedSession?.(); return; }
  const previousActor = lastKnownActor;
  sessionGeneration += 1;
  currentSession = key; removeSessionListeners?.(); resumeVerifiedSession = undefined; if (key) pausedAccounts.delete(key); clearPreviewMetrics();
  for (const job of activeJobs.values()) job.controller.abort();
  // Clearing on confirmed logout/account replacement is conservative on shared devices.
  // Organization changes pause another organization's jobs without sending their bytes.
  if (previousActor && (reason === "logout" || (actorId && previousActor !== actorId))) {
    // New session writes wait for this purge. A failed purge must not authorize a new epoch.
    pendingAccountPurge = pendingAccountPurge.then(() => defaultPreviewSpool.clearAccount(previousActor));
    void pendingAccountPurge.catch(() => { console.warn("[Maono preview] A limpeza local não foi confirmada; novas gravações de prévia estão pausadas."); });
  }
  if (reason === "logout") lastKnownActor = null;
  else if (actorId) lastKnownActor = actorId;
  sessionPurgeEpoch = actorId
    ? pendingAccountPurge.then(() => defaultPreviewSpool.accountEpoch(actorId).catch(() => undefined))
    : Promise.resolve(undefined);
  void sessionPurgeEpoch.catch(() => {});
  if (!actorId || !organizationId) return;
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let recovering = false;
  const recover = async () => {
    if (recovering || controller.signal.aborted || currentSession !== key || pausedAccounts.has(key) || document.visibilityState === "hidden") return;
    recovering = true;
    try {
      await pendingAccountPurge;
      if (controller.signal.aborted || currentSession !== key) return;
      // JSON and PNG lifecycles are separate. A staged PNG can still be bound after JSON payload cleanup.
      const saves = await defaultDurableSaveStore.listAccount(actorId, organizationId);
      for (const snapshot of saves) {
        if (snapshot.localState !== "confirmed" || !snapshot.receipt || controller.signal.aborted) continue;
        try {
          const staged = await defaultPreviewSpool.staged(actorId, organizationId, snapshot.manifest.operationId);
          const current = () => !controller.signal.aborted && currentSession === key;
          if (!current()) return;
          if (staged) await bindCapturedPreview(snapshot, { receipt: snapshot.receipt }, staged, defaultPreviewSpool, current);
        } catch { /* One corrupt/expired precursor must not block unrelated previews. */ }
      }
      const records = await defaultPreviewSpool.list(actorId, organizationId);
      if (controller.signal.aborted || currentSession !== key) return;
      for (const record of records) if (record.state !== "FAILED_FINAL") void enqueuePreviewRecord(record, { signal: controller.signal, isCurrent: () => currentSession === key });
    } catch { /* Local storage failure cannot change session or successful JSON state. */ }
    finally { recovering = false; if (!controller.signal.aborted) { clearTimeout(timer); timer = setTimeout(() => { void recover(); }, 30_000); } }
  };
  const onChange = () => { void recover(); };
  resumeVerifiedSession = onChange;
  window.addEventListener("online", onChange); document.addEventListener("visibilitychange", onChange);
  removeSessionListeners = () => { controller.abort(); clearTimeout(timer); window.removeEventListener("online", onChange); document.removeEventListener("visibilitychange", onChange); };
  void recover();
}
