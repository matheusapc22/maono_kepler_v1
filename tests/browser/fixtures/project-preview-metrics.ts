import { expect, type Route } from '@playwright/test';
import { sanitizePreviewMetrics } from '../../../functions/_lib/project-preview-metrics.js';

// Only the bounded preview collector is a permitted background POST. Keep all
// other methods and paths in each fixture's existing unexpected-write guard.
export async function fulfillProjectPreviewMetrics(route: Route): Promise<boolean> {
  const request = route.request();
  if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/observability/project-preview') return false;

  expect(request.headers()['content-type']).toMatch(/^application\/json(?:;|$)/);
  const body = request.postDataBuffer();
  expect(body).not.toBeNull();
  expect(body!.byteLength).toBeLessThanOrEqual(8192);
  const payload = request.postDataJSON();
  const sanitized = sanitizePreviewMetrics(payload);
  expect(sanitized).not.toBeNull();
  // Equality also rejects extra/private fields and out-of-range optional
  // counters that the real collector would otherwise strip from its logs.
  expect(payload).toEqual(sanitized);
  await route.fulfill({ json: { ok: true }, headers: { 'Cache-Control': 'no-store' } });
  return true;
}
