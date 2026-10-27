import { expect, test } from '@playwright/test';
import { setupAdmin, expectAdminFixtureIntegrity } from './fixtures/admin-workspace';

test.afterEach(async ({ page }) => { await expectAdminFixtureIntegrity(page); });

test('requests separates real destinations without extra reads or invented counters', async ({ page }) => {
  const fixture = await setupAdmin(page, { section: 'requests' });
  const panel = page.locator('.admin-requests');
  await expect(panel).toContainText('Este painel não consolida contagens');
  await expect(panel.locator('.metric')).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Abrir chamados da organização' })).toHaveAttribute('href', '/projects?cc_org=1&cc_view=list');
  await expect(panel).toContainText('Organização ativa: Organização pronta');
  await expect(panel.getByRole('link', { name: 'Abrir projetos' })).toHaveAttribute('href', '/projects');
  const reads = fixture.requests.filter(request => request.includes('/api/admin/'));
  expect(reads).toHaveLength(4);
  await page.getByRole('navigation', { name: 'Navegação administrativa' }).getByRole('button', { name: 'Painel', exact: true }).click();
  await page.goBack();
  await expect(panel).toBeVisible();
  expect(fixture.requests.filter(request => request.includes('/api/admin/'))).toEqual(reads);
  expect(fixture.requests.some(request => /tickets|change-requests/.test(request))).toBe(false);
  await panel.getByRole('link', { name: 'Abrir chamados da organização' }).click();
  await expect(page).toHaveURL(/\/projects\?cc_org=1&cc_view=list$/);
  await expect(page.getByRole('heading', { name: 'Central de Chamados', exact: true }).first()).toBeVisible();
});

test('missing active session membership never leaks the administrative organization list into shortcuts', async ({ page }) => {
  await setupAdmin(page, { section: 'requests', visualCounts: true });
  await page.route('**/api/session', route => route.fulfill({ json: {
    authenticated: true,
    user: { id: 1, role: 'super_admin', email: 'qa@example.test' },
    projects: [], organizations: [], activeOrganization: null,
  } }));
  await page.reload();
  const panel = page.locator('.admin-requests');
  await expect(panel.getByRole('status')).toContainText('Chamados indisponíveis neste contexto');
  await expect(panel.getByRole('link', { name: 'Abrir chamados da organização' })).toHaveCount(0);
  await expect(panel).not.toContainText('Organização 6');
});

test('401 during administrative bootstrap immediately removes session shortcuts', async ({ page }) => {
  await setupAdmin(page, { section: 'requests', status: resource => resource === 'users' ? 401 : 200 });
  await expect(page.locator('.admin-notice.error')).toBeVisible();
  await expect(page.locator('.admin-requests a')).toHaveCount(0);
});

for (const width of [1440, 390, 320]) test(`requests supports keyboard and fits ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await setupAdmin(page, { section: 'requests' });
  const link = page.locator('.admin-requests').getByRole('link', { name: 'Abrir chamados da organização' });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.admin-requests').getByRole('link', { name: 'Abrir projetos' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath(`requests-${width}.png`), fullPage: true });
});
