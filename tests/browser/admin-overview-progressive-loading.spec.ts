import { expect, test } from '@playwright/test';
import { setupAdmin, adminMetric, expectAdminFixtureIntegrity } from './fixtures/admin-workspace';

test.afterEach(async ({ page }) => { await expectAdminFixtureIntegrity(page); });
test('overview preserves real metrics and explains their scope without new reads', async ({ page }, testInfo) => {
  const fixture = await setupAdmin(page, { visualCounts: true });
  await expect(adminMetric(page, 'Arquivos').locator('strong')).toHaveText('10');
  const reads = fixture.requests.filter(request => request.includes('/api/admin/'));
  const source = page.getByText('Escopo e origem dos indicadores', { exact: true });
  await source.focus(); await source.press('Enter');
  await expect(page.locator('.admin-overview-provenance')).toContainText('inclusive inativas');
  await expect(page.locator('.admin-overview-provenance')).toContainText('organization_files');
  expect(fixture.requests.filter(request => request.includes('/api/admin/'))).toEqual(reads);
  await page.getByRole('button', { name: 'Abrir auditoria', exact: true }).click();
  await expect(page).toHaveURL(/section=audit$/); await page.goBack();
  await expect(adminMetric(page, 'Arquivos').locator('strong')).toHaveText('10');
  await page.screenshot({ path: testInfo.outputPath('overview-desktop.png'), fullPage: true });
});
test('missing file counts and missing collections are unavailable, not zero', async ({ page }) => {
  await setupAdmin(page);
  await page.route('**/api/admin/organizations', route => route.fulfill({ json: { ok: true, organizations: [{ id: 1, name: 'Sintética', active: true }] } }));
  await page.route('**/api/admin/projects', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/admin/users', route => route.fulfill({ json: { ok: true, users: null } }));
  await page.route('**/api/admin/access', route => route.fulfill({ json: { ok: true, access: [], users: [{ id: 99, active: true, name: 'Legacy user' }] } }));
  await page.reload();
  await expect(adminMetric(page, 'Organizações').locator('strong')).toHaveText('1');
  await expect(adminMetric(page, 'Arquivos').locator('strong')).toHaveAttribute('aria-label', 'Indisponível');
  await expect(adminMetric(page, 'Projetos').locator('strong')).toHaveAttribute('aria-label', 'Indisponível');
  await expect(adminMetric(page, 'Projetos').locator('strong')).not.toHaveText('0');
  await expect(adminMetric(page, 'Usuários').locator('strong')).toHaveAttribute('aria-label', 'Indisponível');
  await expect(adminMetric(page, 'Usuários').locator('strong')).not.toHaveText('1');
});
test('valid empty response remains zero', async ({ page }) => {
  await setupAdmin(page, { empty: true });
  for (const label of ['Organizações', 'Projetos', 'Usuários', 'Arquivos']) await expect(adminMetric(page, label).locator('strong')).toHaveText('0');
});
for (const status of [503, 403, 404]) test(`overview handles a ${status} refresh without misrepresenting prior numbers`, async ({ page }) => {
  await setupAdmin(page, { section: 'users', allowUserSave: true, status: (resource, attempt) => resource === 'projects' && attempt > 1 ? status : 200 });
  await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta');
  await expect(page.locator('.admin-content > [role="status"]')).toHaveText('');
  // Existing mutation fixture starts the unchanged global refresh callback.
  await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('Nome completo', { exact: true }).fill('Pessoa atualizada');
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar dados', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Navegação administrativa' }).getByRole('button', { name: 'Painel', exact: true }).click();
  const project = adminMetric(page, 'Projetos');
  if (status === 503) { await expect(project.locator('strong')).toHaveText('1'); await expect(project).toContainText('Dados anteriores - leitura falhou'); }
  else { await expect(project.locator('strong')).toHaveAttribute('aria-label', 'Indisponível'); await expect(project).not.toContainText('Dados anteriores'); }
});
test('overview provenance remains keyboard-accessible at 320px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await setupAdmin(page, { visualCounts: true });
  await expect(adminMetric(page, 'Arquivos').locator('strong')).toHaveText('10');
  const summary = page.locator('.admin-overview-provenance summary');
  await summary.focus(); await expect(summary).toBeFocused(); await summary.press('Enter');
  await expect(page.locator('.admin-overview-provenance')).toHaveAttribute('open', '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('overview-mobile.png'), fullPage: true });
});
