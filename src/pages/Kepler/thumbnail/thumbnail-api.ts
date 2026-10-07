import type { PreviewManifest, PreviewOperation } from "./preview-contract.ts";
export type ProjectThumbnailStatus = "UNKNOWN" | "PENDING" | "READY" | "FAILED" | "MISSING";
export type ProjectThumbnailState = {
  thumbnailStatus: ProjectThumbnailStatus;
  configRevision: number;
  thumbnailRevision: number | null;
  thumbnailUpdatedAt: string | null;
  thumbnailAttempts: number;
  artifactId: string | null;
  jobState: string | null;
};
export class ProjectThumbnailRequestError extends Error {
  status: number; code: string; retryable: boolean; stale: boolean; retryAfterMs: number;
  constructor(message: string, options: { status?: number; code?: string; retryable?: boolean; stale?: boolean; retryAfterMs?: number } = {}) {
    super(message); this.name = "ProjectThumbnailRequestError"; this.status = options.status || 0;
    this.code = options.code || "PROJECT_THUMBNAIL_REQUEST_FAILED"; this.retryable = Boolean(options.retryable);
    this.stale = Boolean(options.stale); this.retryAfterMs = options.retryAfterMs || 0;
  }
}
function normalizeStatus(value: unknown): ProjectThumbnailStatus {
  const normalized = String(value || "").toUpperCase();
  return ["PENDING", "READY", "FAILED", "MISSING"].includes(normalized) ? normalized as ProjectThumbnailStatus : "UNKNOWN";
}
export function normalizeThumbnailState(value: any): ProjectThumbnailState {
  return { thumbnailStatus: normalizeStatus(value?.thumbnailStatus ?? value?.status), configRevision: Math.max(0, Number(value?.configRevision ?? value?.revision ?? 0) || 0),
    thumbnailRevision: value?.thumbnailRevision == null ? null : Math.max(0, Number(value.thumbnailRevision) || 0),
    thumbnailUpdatedAt: value?.thumbnailUpdatedAt ?? null, thumbnailAttempts: Math.max(0, Number(value?.thumbnailAttempts) || 0),
    artifactId: value?.artifactId ?? value?.thumbnailArtifactId ?? null, jobState: value?.jobState ?? value?.thumbnailJobState ?? null };
}
export function retryAfterMilliseconds(value: string | null, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  return Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now) || 0;
}
export async function requestPreview(slug: string, suffix: string, init: RequestInit, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), timeoutMs = init.method === "PUT" ? 90_000 : 15_000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const deadline = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); reject(new DOMException("Prévia interrompida.", "AbortError")); };
    init.signal?.addEventListener("abort", abort, { once: true });
    if (init.signal?.aborted) abort();
    timer = setTimeout(() => { controller.abort(); reject(new ProjectThumbnailRequestError("A consulta da prévia excedeu o prazo.", { code: "PREVIEW_REQUEST_TIMEOUT", status: 408, retryable: true })); }, timeoutMs);
  });
  const perform = async () => {
  let response: Response;
  try {
    response = await fetchImpl(`/api/projects/${encodeURIComponent(slug)}/thumbnail${suffix}`, {
      ...init, signal: controller.signal, credentials: "include", cache: "no-store", headers: { Accept: "application/json", ...init.headers },
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    throw new ProjectThumbnailRequestError("Não foi possível consultar a prévia. A mesma tentativa será verificada novamente.", { code: "PREVIEW_NETWORK_FAILURE", retryable: true });
  }
  let data: any;
  try { data = await response.json(); } catch { throw new ProjectThumbnailRequestError("A resposta da prévia não pôde ser confirmada.", { status: response.status, code: "PREVIEW_RESPONSE_UNVERIFIED", retryable: true }); }
  if (response.status === 409 && data?.ok === true && ["FAILED_FINAL", "SUPERSEDED"].includes(data?.operation?.state)) return data;
  if (!response.ok || data?.ok === false) {
    const code = String(data?.error?.code || data?.operation?.errorCode || data?.code || "PROJECT_THUMBNAIL_REQUEST_FAILED");
    throw new ProjectThumbnailRequestError("Não foi possível processar a prévia do projeto.", { status: response.status, code,
      retryable: [408, 429].includes(response.status) || response.status >= 500 || (response.status === 409 && code === "PROJECT_PREVIEW_UPLOAD_BUSY"),
      stale: response.status === 409 && /STALE|SUPERSEDED/.test(code), retryAfterMs: retryAfterMilliseconds(response.headers.get("Retry-After")) });
  }
  return data;
  };
  try { return await Promise.race([perform(), deadline]); }
  finally { clearTimeout(timer); init.signal?.removeEventListener("abort", abort); }
}
export async function fetchPreviewOperation(slug: string, operationId: string, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<PreviewOperation | null> {
  try {
    const operation = (await requestPreview(slug, `/status?operationId=${encodeURIComponent(operationId)}`, { method: "GET", signal }, fetchImpl)).operation;
    if (!operation || operation.operationId !== operationId || typeof operation.state !== "string") throw new ProjectThumbnailRequestError("Operação não confirmada.", { code: "PREVIEW_RESPONSE_UNVERIFIED", retryable: true });
    return operation;
  }
  catch (error) { if (error instanceof ProjectThumbnailRequestError && error.status === 404) return null; throw error; }
}
export async function registerPreviewOperation(slug: string, manifest: PreviewManifest, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<PreviewOperation> {
  return (await requestPreview(slug, "", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(manifest), signal }, fetchImpl)).operation;
}
export async function uploadProjectThumbnail({ slug, manifest, blob, signal, fetchImpl }: {
  slug: string; manifest: PreviewManifest; blob: Blob; signal?: AbortSignal; fetchImpl?: typeof fetch;
}): Promise<PreviewOperation> {
  return (await requestPreview(slug, `?operationId=${encodeURIComponent(manifest.operationId)}`, {
    method: "PUT", headers: { "Content-Type": "image/png" }, body: blob, signal,
  }, fetchImpl)).operation;
}
export async function fetchProjectThumbnailStatus(slug: string, signal?: AbortSignal) {
  return normalizeThumbnailState(await requestPreview(slug, "/status", { method: "GET", signal }));
}
export async function markProjectThumbnailFailed({ slug, operationId, errorCode, signal }: { slug: string; operationId: string; errorCode: string; signal?: AbortSignal }) {
  return requestPreview(slug, "", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId, errorCode }), signal });
}
