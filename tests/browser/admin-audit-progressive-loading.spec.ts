import { expect, test, type Page, type Route } from '@playwright/test';
import { setupAdmin, expectAdminFixtureIntegrity, deferred } from './fixtures/admin-workspace';

const entries = Array.from({ length: 25 }, (_, index) => ({ id: 100 - index, event: 'ticket_create', createdAt: '2026-10-27T12:00:00.000Z' }));
async function openAudit(page: Page, handler: (route: Route) => Promise<unknown>) {
  const fixture = await setupAdmin(page);
  await page.route('**/api/admin/audit*', handler);
  await page.getByRole('navigation', { name: 'Navegação administrativa' }).getByRole('button', { name: 'Auditoria', exact: true }).click();
  return fixture;
}
test.afterEach(async ({ page }) => { await expectAdminFixtureIntegrity(page); });

test('audit paginates bounded real response data, supports history and never reloads global regions', async ({ page }) => {
  const fixture = await openAudit(page, route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('before') ?
    { ok: true, entries: [{ id: 75, event: 'PRIVATE', createdAt: 'PRIVATE' }], nextBefore: null } : { ok: true, entries, nextBefore: 76 } }));
  const panel = page.locator('.admin-audit');
  await expect(panel.locator('tbody tr')).toHaveCount(25);
  await panel.getByRole('button', { name: 'Registros anteriores' }).click();
  await expect(page).toHaveURL(/audit_before=76/);
  await expect(panel.locator('tbody tr')).toHaveCount(1);
  await expect(panel).toContainText('Ação não catalogada');
  await expect(panel).toContainText('Horário indisponível');
  await expect(panel).not.toContainText('PRIVATE');
  await page.goBack();
  await expect(panel.locator('tbody tr')).toHaveCount(25);
  expect(fixture.requests.filter(request => /^GET \/api\/admin\/(projects|organizations|users|access)$/.test(request))).toHaveLength(4);
});

for (const status of [401, 403, 404]) test(`audit clears earlier rows and disables retry after ${status}`, async ({ page }) => {
  await openAudit(page, route => route.fulfill(new URL(route.request().url()).searchParams.has('before') ? { status, json: { ok: false } } : { json: { ok: true, entries, nextBefore: 76 } }));
  await expect(page.locator('.admin-audit tbody tr')).toHaveCount(25);
  await page.getByRole('button', { name: 'Registros anteriores' }).click();
  await expect(page.locator('.admin-audit [role=alert]')).toContainText('Consulta indisponível para este acesso');
  await expect(page.locator('.admin-audit tbody tr')).toHaveCount(0);
  await expect(page.locator('.admin-audit').getByRole('button', { name: 'Tentar novamente' })).toHaveCount(0);
});

test('unmounted audit request cannot publish late private rows into another page', async ({ page }) => {
  const gate = deferred(); let attempt = 0;
  await openAudit(page, async route => { const current = ++attempt; if (current === 1) await gate.promise; await route.fulfill({ json: { ok: true, entries: current === 1 ? entries : [], nextBefore: null } }); });
  await expect(page.locator('.admin-audit-data')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.admin-audit [aria-busy="true"] [role="status"]')).toHaveCount(0);
  await expect(page.locator('.admin-audit > [role="status"]')).toHaveText('Consultando registros de auditoria.');
  const nav = page.getByRole('navigation', { name: 'Navegação administrativa' });
  await nav.getByRole('button', { name: 'Painel', exact: true }).click();
  await nav.getByRole('button', { name: 'Auditoria', exact: true }).click();
  await expect(page.locator('.admin-audit')).toContainText('Nenhum registro encontrado nesta página');
  gate.release();
  await expect(page.locator('.admin-audit tbody tr')).toHaveCount(0);
});

test('audit contextual retry stays in the panel and mobile has no page overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  let attempt = 0;
  await openAudit(page, route => route.fulfill(++attempt === 1 ? { status: 503, json: { ok: false } } : { json: { ok: true, entries: entries.slice(0, 2), nextBefore: null } }));
  const retry = page.locator('.admin-audit').getByRole('button', { name: 'Tentar novamente' });
  await retry.focus(); await expect(retry).toBeFocused(); await retry.press('Enter');
  await expect(page.locator('.admin-audit tbody tr')).toHaveCount(2);
  expect(attempt).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('audit-mobile.png'), fullPage: true });
});
