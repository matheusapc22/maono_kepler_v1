import { expect, test, type Page, type Route } from '@playwright/test';
import { setupAdmin, expectAdminFixtureIntegrity, deferred } from './fixtures/admin-workspace';
const checks = { dbBinding: true, databaseReachable: true, dropboxAppKey: true, dropboxAppSecret: true, dropboxRefreshToken: true };
async function openSystem(page: Page, handler: (route: Route) => Promise<unknown>) {
  const fixture = await setupAdmin(page);
  await page.route('**/api/health', handler);
  await page.getByRole('navigation', { name: 'Navegação administrativa' }).getByRole('button', { name: 'Sistema', exact: true }).click();
  return fixture;
}
test.afterEach(async ({ page }) => { await expectAdminFixtureIntegrity(page); });
test('system describes limited observations and never displays arbitrary secrets', async ({ page }, testInfo) => {
  let reads = 0;
  const fixture = await openSystem(page, route => { reads++; return route.fulfill({ json: { ok: true, checks, runtime: { secret: 'PRIVATE_RUNTIME' }, service: 'PRIVATE_SERVICE' } }); });
  const panel = page.locator('.admin-system');
  await expect(panel.getByRole('status')).toHaveText('Verificações básicas confirmadas.');
  await expect(panel.locator('time')).toHaveAttribute('datetime', /^\d{4}-/);
  await expect(panel).toContainText('não certifica a saúde integral');
  await expect(panel).not.toContainText('PRIVATE');
  await expect(panel.locator('dl > div')).toHaveCount(5);
  await page.getByRole('button', { name: 'Recolher navegação' }).click();
  expect(reads).toBe(1);
  expect(fixture.requests.filter(request => /^GET \/api\/admin\/(projects|organizations|users|access)$/.test(request))).toHaveLength(4);
  await page.screenshot({ path: testInfo.outputPath('system-desktop.png'), fullPage: true });
});
test('false and partial checks are distinct from unavailable service and never become zero', async ({ page }) => {
  await openSystem(page, route => route.fulfill({ json: { ok: false, checks: { ...checks, databaseReachable: false, dropboxAppSecret: 'PRIVATE' } } }));
  const panel = page.locator('.admin-system');
  await expect(panel).toContainText('Resposta parcial');
  await expect(panel).toContainText('Não confirmado');
  await expect(panel).toContainText('Indisponível');
  await expect(panel).not.toContainText('PRIVATE');
});
for (const status of [401, 403, 404]) test(`system removes diagnostics and offers no retry on ${status}`, async ({ page }) => {
  await openSystem(page, route => route.fulfill({ status, json: { ok: false } }));
  await expect(page.locator('.admin-system [role=alert]')).toContainText('indisponível para este acesso');
  await expect(page.locator('.admin-system dl')).toHaveCount(0);
  await expect(page.locator('.admin-system button')).toHaveCount(0);
});
test('system contextual retry and mobile rendering retain limited scope', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 }); let reads = 0;
  await openSystem(page, route => route.fulfill(++reads === 1 ? { status: 503, json: { ok: false } } : { json: { ok: true, checks } }));
  const retry = page.locator('.admin-system').getByRole('button', { name: 'Tentar novamente' });
  await retry.focus(); await retry.press('Enter');
  await expect(page.locator('.admin-system dl')).toBeVisible(); expect(reads).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('system-mobile.png'), fullPage: true });
});
test('cancelled system observation cannot overwrite the next visit', async ({ page }) => {
  const gate = deferred(); let reads = 0;
  await openSystem(page, async route => { const current = ++reads; if (current === 1) await gate.promise; await route.fulfill({ json: { ok: current === 1, checks: current === 1 ? checks : { ...checks, databaseReachable: false } } }); });
  await expect(page.locator('.admin-system')).toHaveAttribute('aria-busy', 'true');
  const nav = page.getByRole('navigation', { name: 'Navegação administrativa' });
  await nav.getByRole('button', { name: 'Painel', exact: true }).click();
  await nav.getByRole('button', { name: 'Sistema', exact: true }).click();
  await expect(page.locator('.admin-system')).toContainText('Há verificações básicas não confirmadas');
  gate.release();
  await expect(page.locator('.admin-system')).toContainText('Há verificações básicas não confirmadas');
});
