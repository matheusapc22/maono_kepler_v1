import { expect, test } from '@playwright/test';
import { setupAdmin, deferred, expectAdminFixtureIntegrity } from './fixtures/admin-workspace';

test.afterEach(async ({ page }) => { await expectAdminFixtureIntegrity(page); });

test('repeated membership action preserves the draft and focus after an owner conflict', async ({ page }) => {
  await setupAdmin(page, { section: 'users' });
  const gate = deferred(); let writes = 0;
  await page.route('**/api/admin/users/2/organizations**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, organizations: [{ id: 1, name: 'Synthetic organization', slug: 'synthetic', assigned: true, accessLevel: 'owner', active: true }] } });
    writes++; await gate.promise;
    await route.fulfill({ status: 409, json: { ok: false, code: 'LAST_OWNER_REMOVAL_BLOCKED', error: 'Blocked', category: 'PERMISSION', retryable: false } });
  });
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerenciar usuário', exact: true });
  await dialog.getByLabel('Nome completo', { exact: true }).fill('Rascunho preservado');
  await dialog.getByRole('tab', { name: /Organizações/ }).click();
  const action = dialog.getByRole('button', { name: 'Remover acesso à organização', exact: true });
  await action.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await expect.poll(() => writes).toBe(1);
  await dialog.getByRole('tab', { name: /Dados do usuário/ }).click();
  const name = dialog.getByLabel('Nome completo', { exact: true });
  await name.focus(); gate.release();
  await expect(page.getByText(/Mantenha outro responsável ativo/)).toBeVisible();
  await expect(name).toHaveValue('Rascunho preservado'); await expect(name).toBeFocused();
  await dialog.getByRole('tab', { name: /Organizações/ }).click();
  await expect(action).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});

test('Back cancels the old view and a late membership success cannot publish into the next section', async ({ page }) => {
  const fixture = await setupAdmin(page);
  await page.locator('.admin-nav').getByRole('button', { name: 'Usuários e Permissões', exact: true }).click();
  const gate = deferred(); let writes = 0;
  await page.route('**/api/admin/users/2/organizations**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, organizations: [{ id: 1, name: 'Synthetic organization', slug: 'synthetic', assigned: true, accessLevel: 'viewer', active: true }] } });
    writes++; await gate.promise;
    await route.fulfill({ json: { ok: true, removed: true } });
  });
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByRole('tab', { name: /Organizações/ }).click();
  await page.getByRole('button', { name: 'Remover acesso à organização', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/section=overview|\/admin$/);
  const reads = fixture.requests.filter(value => value === 'GET /api/admin/users').length;
  gate.release();
  await page.goForward();
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toBeVisible();
  await expect(page.getByText('Organização removida.', { exact: true })).toHaveCount(0);
  expect(fixture.requests.filter(value => value === 'GET /api/admin/users')).toHaveLength(reads);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('failed account deletion keeps the editable draft and permits cancellation', async ({ page }) => {
  await setupAdmin(page, { section: 'users' });
  let writes = 0; const gate = deferred();
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/admin/users/2', async route => {
    expect(route.request().method()).toBe('DELETE'); writes++; await gate.promise;
    await route.fulfill({ status: 409, json: { ok: false, code: 'USER_TICKET_HISTORY_RETAINED', error: 'Retained' } });
  });
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Gerenciar usuário', exact: true });
  const input = dialog.getByLabel('Nome completo', { exact: true });
  await input.fill('Rascunho após retenção');
  await dialog.getByRole('button', { name: 'Excluir usuário', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Excluir usuário', exact: true })).toBeDisabled();
  await expect.poll(() => writes).toBe(1); gate.release();
  await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeEnabled();
  await expect(input).toHaveValue('Rascunho após retenção');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
