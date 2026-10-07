const STAGES = new Set(['readiness','composition','encoding','capture','local-persistence','upload','retry-wait','decode']);
export function sanitizePreviewMetrics(input) {
  if (input?.version !== 1 || !Array.isArray(input.metrics) || !input.metrics.length || input.metrics.length > 32) return null;
  const metrics = [];
  for (const metric of input.metrics) {
    if (!STAGES.has(metric?.stage) || !Number.isFinite(metric.durationMs) || metric.durationMs < 0 || metric.durationMs > 86_400_000 || !['ok','failed'].includes(metric.result)) return null;
    metrics.push({ stage: metric.stage, durationMs: Math.round(metric.durationMs * 10) / 10, result: metric.result,
      ...(Number.isInteger(metric.bytes) && metric.bytes >= 0 && metric.bytes <= 4 * 1024 * 1024 ? { bytes: metric.bytes } : {}),
      ...(Number.isInteger(metric.attempt) && metric.attempt >= 0 && metric.attempt <= 100 ? { attempt: metric.attempt } : {}) });
  }
  return { version: 1, metrics };
}

const SERVER_STAGES = new Set(['storage-verification','storage-upload','publication','recovery']);
export function logPreviewServerMetric(stage, detail = {}) {
  if (!SERVER_STAGES.has(stage)) return;
  const numeric = {};
  for (const key of ['durationMs','bytes','attempts','inspected','ready','failed','oldestAgeMs']) {
    const value = Number(detail[key]);
    if (Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) numeric[key] = value;
  }
  console.info(JSON.stringify({ event:'project_preview_server_metric',stage,...numeric,result:detail.result === 'failed' ? 'failed' : 'ok' }));
}
