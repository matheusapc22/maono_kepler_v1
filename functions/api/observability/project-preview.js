import { readPreviewJsonBody } from '../../_lib/project-preview-payload.js';
import { requireSession } from '../../_lib/auth.js';
import { errorResponse, errorResponseFromError, jsonResponse, methodNotAllowed } from '../../_lib/http.js';
import { sanitizePreviewMetrics } from '../../_lib/project-preview-metrics.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  try {
    await requireSession(env, request);
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return errorResponse('Origem inválida.', 403, 'PREVIEW_METRICS_ORIGIN_INVALID');
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return errorResponse('Envie JSON.', 415, 'PREVIEW_METRICS_INVALID');
    const body = await readPreviewJsonBody(request, { maxBytes: 8192 });
    const payload = sanitizePreviewMetrics(body);
    if (!payload) return errorResponse('Métricas inválidas.', 400, 'PREVIEW_METRICS_INVALID');
    // Structured Worker logs are the collector. Deployment retention/export is an operator decision.
    console.info(JSON.stringify({ event: 'project_preview_client_metrics', ...payload }));
    return jsonResponse({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponseFromError(error, { publicMessage: 'Não foi possível registrar as métricas.' }); }
}
