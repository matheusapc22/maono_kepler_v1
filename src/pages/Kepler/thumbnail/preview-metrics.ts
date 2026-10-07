export type PreviewMetricStage = "readiness" | "composition" | "encoding" | "capture" | "local-persistence" | "upload" | "retry-wait" | "decode";
type Metric = { stage: PreviewMetricStage; durationMs: number; bytes?: number; attempt?: number; result: "ok" | "failed" };
const metrics: Metric[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
/** Real bounded collector, containing timings/counts only. Never map data, URLs or pixels. */
export function recordPreviewMetric(stage: PreviewMetricStage, durationMs: number, detail: { bytes?: number; attempt?: number; result?: "ok" | "failed" } = {}) {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 86_400_000) return;
  const metric: Metric = { stage, durationMs: Math.round(durationMs * 10) / 10, result: detail.result || "ok",
    ...(detail.bytes == null ? {} : { bytes: Math.max(0, Math.min(4 * 1024 * 1024, Math.floor(detail.bytes))) }),
    ...(detail.attempt == null ? {} : { attempt: Math.max(0, Math.min(100, Math.floor(detail.attempt))) }) };
  if (metrics.length < 32) metrics.push(metric);
  if (typeof window === "undefined" || timer) return;
  timer = setTimeout(() => { timer = undefined; void flushPreviewMetrics(); }, 1000);
}
export async function flushPreviewMetrics(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
  if (!metrics.length) return;
  const batch = metrics.splice(0, 32);
  try { await fetchImpl("/api/observability/project-preview", { method: "POST", credentials: "include", cache: "no-store", keepalive: true,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 1, metrics: batch }) }); }
  catch { /* Measurement cannot change save/publication results and is never retried with private state. */ }
}
export function clearPreviewMetrics() { metrics.length = 0; clearTimeout(timer); timer = undefined; }
