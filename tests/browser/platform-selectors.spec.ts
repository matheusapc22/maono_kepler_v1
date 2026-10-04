import { expect, test, type Page } from '@playwright/test';
import { openMap, openFilters, panel } from './fixtures/map-panel-minimal';

async function adminFixture(page: Page, startUrl = "/admin?section=users") {
  const errors: string[] = [], writes: string[] = [];
  const organization = { id: 1, name: 'Organização de demonstração', slug: 'demo', active: true };
  const person = { id: 2, name: 'Pessoa de teste', email: 'person@example.test', role: 'editor', active: true, projectCount: 1, organizations: [{ ...organization, accessLevel: 'editor' }] };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { writes.push(`${request.method()} ${path}`); return route.fulfill({ status: 403, json: { ok: false } }); }
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, user: { id: 1, name: 'Operador', email: 'qa@example.test', role: 'super_admin', activeOrganizationId: 1 }, projects: [], organizations: [organization], activeOrganization: organization } });
    if (path.endsWith('/change-requests/inbox')) return route.fulfill({ json: { ok: true, project: { name: 'Projeto de demonstração', slug: 'demo' }, items: [], pagination: { page: 1, limit: 25, hasMore: false } } });
    if (path === '/api/admin/users') return route.fulfill({ json: { ok: true, users: [person] } });
    if (path === '/api/admin/users/2/organizations') return route.fulfill({ json: { ok: true, organizations: [{ ...organization, assigned: true, accessLevel: 'editor' }, { id: 2, name: 'Organização indisponível', slug: 'disabled', active: true, assigned: false, accessLevel: 'viewer' }] } });
    return route.fulfill({ json: { ok: true, users: [], projects: [], access: [], organizations: [organization] } });
  });
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  await page.goto(startUrl);
  return { errors, writes };
}

test('Maono selectors: real Admin filters and membership modal have one visible themed face', async ({ page }, testInfo) => {
  const fixture = await adminFixture(page);
  const filter = page.locator('.admin-user-filters').getByRole('combobox', { name: 'Perfil', exact: true });
  await expect(filter).toHaveCSS('background-color', 'rgb(11, 16, 22)');
  await expect(filter).toHaveCSS('color', 'rgb(232, 237, 245)');
  await expect(page.locator('.admin-user-filters input')).toHaveCSS('background-color', 'rgb(11, 16, 22)');
  await filter.click();
  expect(await filter.evaluate(element => getComputedStyle(element).boxShadow)).toContain('197, 160, 89');
  await expect(page.locator('.maono-select-menu')).toHaveCSS('background-color', 'rgb(16, 23, 32)');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('tab', { name: /Organizações/ }).click();
  const field = modal.locator('.admin-membership-level select').first();
  await expect(field).toHaveCSS('opacity', '1');
  await expect(field).toHaveCSS('appearance', 'none');
  await expect(field).toHaveCSS('background-color', 'rgb(11, 16, 22)');
  await expect(field).toHaveCSS('-webkit-text-fill-color', 'rgb(232, 237, 245)');
  await expect(field.locator('..')).toHaveCSS('display', 'grid');
  await expect(modal.locator('.admin-membership-level-surface')).toHaveCount(0);
  await expect(modal.locator('.admin-membership-level select').last()).toBeDisabled();
  await expect(modal.locator('.admin-membership-level select').last()).toHaveCSS('opacity', '0.5');
  await field.click();
  await expect(modal.locator('.maono-select-menu')).toBeVisible();
  await expect(modal.locator('.maono-select-menu').getByRole('option', { name: 'Editor / Colaborador', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: testInfo.outputPath('maono-admin-membership-select.png') });
  await field.press('Escape');
  await expect(modal).toBeVisible();
  await expect(field).toBeFocused();
  expect(fixture.errors).toEqual([]); expect(fixture.writes).toEqual([]);
});

test('Maono selectors: real map filter field popup escapes panel clipping and cancels without edits', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const fixture = await openMap(page, { layerCount: 3 });
  await openFilters(page);
  await panel(page).getByRole('button', { name: 'Adicionar Filtro', exact: true }).click();
  const field = panel(page).getByRole('combobox', { name: '1. Base de dados', exact: true });
  await field.click();
  await expect(page.locator('.maono-select-menu')).toBeVisible();
  await expect(page.locator('.maono-select-menu')).toHaveCSS('background-color', 'rgb(16, 23, 32)');
  await page.screenshot({ path: testInfo.outputPath('maono-map-filter-select.png') });
  await field.press('Escape');
  await expect(field).toBeFocused();
  await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'true');
  expect(fixture.errors).toEqual([]); expect(fixture.unexpectedWrites).toEqual([]);
});


test('Maono selectors: change-request inbox resists the legacy fallback white style', async ({ page }, testInfo) => {
  const fixture = await adminFixture(page, '/projects/demo/requests');
  const field = page.locator('.maono-editor-inbox select');
  await expect(field).toHaveCSS('background-color', 'rgb(11, 16, 22)');
  await expect(field).toHaveCSS('-webkit-text-fill-color', 'rgb(232, 237, 245)');
  await expect(field.locator('..')).toHaveCSS('display', 'grid');
  await field.click();
  expect(await field.evaluate(element => getComputedStyle(element).boxShadow)).toContain('197, 160, 89');
  await expect(page.locator('.maono-select-menu')).toHaveCSS('background-color', 'rgb(16, 23, 32)');
  await page.locator('.maono-select-menu').getByRole('option', { name: 'Todas', exact: true }).click();
  await expect(field).toHaveValue('all');
  await page.screenshot({ path: testInfo.outputPath('maono-inbox-select.png') });
  expect(fixture.errors).toEqual([]); expect(fixture.writes).toEqual([]);
});
