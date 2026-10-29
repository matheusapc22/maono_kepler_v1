import { expect, test } from '@playwright/test';
import { expectAdminFixtureIntegrity, setupAdmin } from './fixtures/admin-workspace';

type FetchAttempt = { request: string; aborted: boolean; outcome: string };
type ObservedWindow = Window & { __ORGANIZATION_OFF_FETCH_ATTEMPTS__?: FetchAttempt[] };

// The development gate explicitly sets VITE_ORGANIZATION_MANAGEMENT_V1=false.
// The compiled enabled suite runs separately; neither case changes deployed flags.
test('flag OFF preserves legacy organizations and never calls management API', async ({ page }) => {
  // Observe the real fetch before browser-native cancellation. Firefox can
  // cancel StrictMode's first effect before Playwright emits a route event.
  // Forward the original arguments/promise; do not replace transport or signals.
  await page.addInitScript(() => {
    const attempts: FetchAttempt[] = [];
    (window as ObservedWindow).__ORGANIZATION_OFF_FETCH_ATTEMPTS__ = attempts;
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
      const attempt = { request: `${method.toUpperCase()} ${path}`, aborted: signal?.aborted ?? false, outcome: 'pending' };
      if (path.startsWith('/api/admin/')) attempts.push(attempt);
      signal?.addEventListener('abort', () => { attempt.aborted = true; }, { once: true });
      const result = nativeFetch.call(this, input, init);
      void result.then(response => { attempt.outcome = String(response.status); }, error => { attempt.outcome = error.name; });
      return result;
    };
  });
  const fixture = await setupAdmin(page, { section: 'organizations' });
  await expect(page.getByRole('heading', { level: 1, name: 'Gestão de Organizações', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Organização pronta', exact: true })).toBeVisible();
  await expect(page.locator('.admin-organizations-workspace')).toHaveCount(0);
  await expect(page.locator('#admin-organizations-actions')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nova organização', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Importar', exact: true })).toHaveCount(0);
  const reads = [
    'GET /api/admin/access', 'GET /api/admin/organizations', 'GET /api/admin/projects', 'GET /api/admin/users',
  ];
  const attempts = await page.evaluate(() => (window as ObservedWindow).__ORGANIZATION_OFF_FETCH_ATTEMPTS__ ?? []);
  expect(attempts.map(attempt => attempt.request).sort()).toEqual(reads.flatMap(path => [path, path]));
  expect(attempts.filter(attempt => attempt.aborted).map(attempt => ({ request: attempt.request, outcome: attempt.outcome })).sort((a, b) => a.request.localeCompare(b.request)))
    .toEqual(reads.map(request => ({ request, outcome: 'AbortError' })));
  expect(attempts.filter(attempt => !attempt.aborted).map(attempt => ({ request: attempt.request, outcome: attempt.outcome })).sort((a, b) => a.request.localeCompare(b.request)))
    .toEqual(reads.map(request => ({ request, outcome: '200' })));
  const intercepted = fixture.requests.filter(path => /^GET \/api\/admin\/(projects|users|organizations|access)$/.test(path));
  expect([...new Set(intercepted)].sort()).toEqual(reads);
  for (const request of reads) expect(intercepted.filter(path => path === request).length).toBeLessThanOrEqual(2);
  expect(fixture.requests.filter(path => path.includes('/api/admin/organization-management'))).toEqual([]);
  expect(fixture.mutations).toEqual([]);
  await expectAdminFixtureIntegrity(page);
});
