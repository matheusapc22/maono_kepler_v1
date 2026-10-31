import { expect, test, type Page } from '@playwright/test';

import {
  setupAdmin as setup, adminMetric as metric, deferred,
  expectAdminFixtureIntegrity, saveSyntheticUser,
} from './fixtures/admin-workspace';

test.afterEach(async ({ page }) => { await expectAdminFixtureIntegrity(page); });

for (const width of [1440, 390]) test(`Admin ${width}px reveals independent metrics with stable shell`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const gate = deferred();
  const fixture = await setup(page, { beforeRead: async resource => { if (resource !== 'projects') await gate.promise; } });
  await expect(page.getByRole('heading', { name: 'Painel Admin', exact: true })).toBeVisible();
  await expect(page.locator('.admin-rail')).toBeVisible();
  await expect(metric(page, 'Projetos').locator('strong')).toHaveText('1');
  await expect(page.locator('.admin-content').getByRole('status')).toHaveText('Carregando dados administrativos.');
  await expect(metric(page, 'Usuários').locator('.mm-skeleton')).toBeVisible();
  await expect(metric(page, 'Organizações').locator('.mm-skeleton')).toBeVisible();
  await expect(metric(page, 'Arquivos').locator('strong')).toHaveCount(0);
  expect(fixture.requests.filter(path => path.startsWith('GET /api/admin/')).map(path => path.split('/').at(-1)).sort()).toEqual(['access', 'organizations', 'projects', 'users']);
  await expect(page.getByRole('button', { name: 'Abrir auditoria', exact: true })).toBeEnabled();
  const heading = await page.locator('.admin-topbar h1').boundingBox();
  await page.screenshot({ path: testInfo.outputPath(`admin-${width}-partial.png`), fullPage: true });
  gate.release();
  await expect(page.locator('.admin-content .mm-skeleton')).toHaveCount(0);
  await expect(metric(page, 'Arquivos').locator('strong')).toHaveText('7');
  expect((await page.locator('.admin-topbar h1').boundingBox())?.y).toBe(heading?.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath(`admin-${width}-ready.png`), fullPage: true });
});

test('Admin static panels never wait for unrelated reads and status stays outside busy regions', async ({ page }) => {
  const gate = deferred(); await setup(page, { section: 'system', beforeRead: () => gate.promise });
  await expect(page.getByRole('heading', { name: 'Sistema', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('.mm-code-panel')).toContainText('/ = /projects');
  await expect(page.locator('.admin-content .mm-skeleton')).toHaveCount(0);
  await expect(page.locator('.admin-main')).not.toHaveAttribute('aria-busy', 'true');
  const status = page.locator('.admin-content').getByRole('status');
  expect(await status.evaluate(element => element.closest('[aria-busy="true"]') === null)).toBe(true);
  await page.locator('.admin-nav').getByRole('button', { name: 'Auditoria', exact: true }).click();
  await expect(page.locator('.admin-audit')).toContainText('Registros de auditoria');
  await expect(page.locator('.admin-audit')).not.toContainText('admin.open');
  await page.locator('.admin-nav').getByRole('button', { name: 'Solicitações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Solicitações', exact: true, level: 2 })).toBeVisible();
  gate.release();
});

test('Admin initial user rows keep real filters usable and never report a fabricated zero', async ({ page }) => {
  const gate = deferred(); await setup(page, { section: 'users', beforeRead: async resource => { if (resource === 'users') await gate.promise; } });
  const search = page.getByPlaceholder('Nome, e-mail, organização ou perfil');
  await expect(search).toBeEnabled(); await search.fill('Pessoa');
  await expect(page.locator('.admin-user-filter-count')).toHaveText('Carregando usuários.');
  await expect(page.locator('.admin-users-table .mm-skeleton').first()).toBeVisible();
  await expect(page.locator('.admin-users-table thead')).toContainText('E-mail');
  gate.release(); await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta');
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Pessoa');
});

test('Admin refresh retains rows, typed filter, focused input and current scroll', async ({ page }, testInfo) => {
  const gate = deferred();
  const fixture = await setup(page, { section: 'users', manyUsers: true, allowUserSave: true, beforeRead: async (_resource, attempt) => { if (attempt > 1) await gate.promise; } });
  await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta');
  const search = page.getByPlaceholder('Nome, e-mail, organização ou perfil'); await search.fill('Pessoa');
  const retainedInput = await search.elementHandle();
  // A real user-save callback starts the refresh; only its HTTP write is synthetic.
  await saveSyntheticUser(page);
  expect(fixture.mutations).toHaveLength(1);
  expect(fixture.mutations[0].path).toBe('/api/admin/users/2');
  await search.focus();
  const scroll = await page.locator('.admin-main').evaluate(element => {
    element.scrollTop = 90;
    return element.scrollTop;
  });
  expect(scroll).toBeGreaterThan(0);
  await expect(page.locator('.admin-users-table')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.admin-content').getByRole('status')).toHaveText('Atualizando dados administrativos.');
  await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta');
  await expect(page.locator('.admin-content .mm-skeleton')).toHaveCount(0);
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Pessoa');
  expect(await page.locator('.admin-main').evaluate(element => element.scrollTop)).toBe(scroll);
  expect(await retainedInput!.evaluate(element => element.isConnected)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('admin-users-refresh-preserved.png'), fullPage: true });
  gate.release(); await expect(page.locator('.admin-users-table')).toHaveAttribute('aria-busy', 'false');
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Pessoa');
  expect(await page.locator('.admin-main').evaluate(element => element.scrollTop)).toBe(scroll);
  await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta — atualizada');
});

test('Admin region error ends its skeleton while successful regions remain visible and retry recovers', async ({ page }) => {
  await setup(page, { status: (resource, attempt) => resource === 'organizations' && attempt === 1 ? 503 : 200 });
  await expect(page.getByRole('alert')).toContainText('Organizações');
  await expect(metric(page, 'Projetos').locator('strong')).toHaveText('1');
  await expect(metric(page, 'Organizações').locator('.mm-skeleton')).toHaveCount(0);
  await expect(metric(page, 'Organizações').locator('strong')).toHaveAttribute('aria-label', 'Indisponível');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(metric(page, 'Organizações').locator('strong')).toHaveText('1');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Admin contextual retry waits for the active batch and produces one new four-read batch', async ({ page }) => {
  const gate = deferred();
  const fixture = await setup(page, {
    beforeRead: async (resource, attempt) => { if (attempt === 1 && resource !== 'organizations') await gate.promise; },
    status: (resource, attempt) => resource === 'organizations' && attempt === 1 ? 503 : 200,
  });
  const retry = page.getByRole('button', { name: 'Tentar novamente', exact: true });
  await expect(retry).toBeDisabled();
  gate.release(); await expect(retry).toBeEnabled();
  await retry.click();
  await expect(metric(page, 'Organizações').locator('strong')).toHaveText('1');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect([...fixture.attempts.values()]).toEqual([2, 2, 2, 2]);
  expect(fixture.mutations).toHaveLength(0);
});

test('Admin 403 after a real save clears denied user rows without a retry action', async ({ page }) => {
  const fixture = await setup(page, { section: 'users', allowUserSave: true, status: (resource, attempt) => resource === 'users' && attempt > 1 ? 403 : 200 });
  await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar dados', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.admin-users-table')).not.toContainText('Pessoa pronta');
  await expect(page.locator('.admin-users-table')).toContainText('Dados de usuários indisponíveis.');
  await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
  expect(fixture.mutations).toHaveLength(1);
});

test('Admin empty response is distinct from pending and reduced motion keeps placeholders static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const gate = deferred(); await setup(page, { section: 'projects', empty: true, beforeRead: () => gate.promise });
  const placeholder = page.locator('.admin-content .mm-skeleton').first(); await expect(placeholder).toBeVisible();
  expect(await placeholder.evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('none');
  await expect(page.getByText('Nenhum registro encontrado.', { exact: true })).toHaveCount(0);
  gate.release(); await expect(page.getByText('Nenhum registro encontrado.', { exact: true })).toBeVisible();
  await expect(page.locator('.admin-content .mm-skeleton')).toHaveCount(0);
});

test('Admin authorization guard makes no administrative reads for a viewer', async ({ page }) => {
  const fixture = await setup(page, { role: 'viewer' });
  // The existing route-level guard runs before the Admin component's redirect.
  await expect(page.getByRole('heading', { name: 'Acesso restrito', exact: true })).toBeVisible();
  await expect(page.locator('.admin-nav button')).toHaveCount(0);
  expect(fixture.requests.some(path => path.startsWith('GET /api/admin/'))).toBe(false);
});

test('late independent Admin data does not reset a focused in-progress user edit', async ({ page }) => {
  const gate = deferred(); await setup(page, { section: 'users', beforeRead: async resource => { if (resource === 'organizations') await gate.promise; } });
  await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const name = page.getByRole('dialog').getByLabel('Nome completo', { exact: true });
  await name.fill('Rascunho local ainda não salvo');
  gate.release();
  // LoadingStatus deliberately keeps its live-region node mounted when idle.
  await expect(page.locator('.admin-content').getByRole('status')).toHaveText('');
  await expect(page.locator('.admin-user-filters').getByRole('combobox', { name: 'Organização', exact: true })).toBeEnabled();
  await expect(name).toBeFocused(); await expect(name).toHaveValue('Rascunho local ainda não salvo');
});

async function freezePresentationClock(page: Page) {
  const time = new Date('2026-01-01T12:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
}

test('Admin fast data starts immediately, with exact80ms structure and total260ms content stages', async ({ page }, testInfo) => {
  await freezePresentationClock(page);
  const gate = deferred();
  const fixture = await setup(page, { beforeRead: () => gate.promise });
  const heading = page.locator('.admin-topbar h1 .mm-static-loading-text');
  await expect(heading).toHaveAttribute('data-loading-structure', 'pending');
  const pendingRequestGeometry = await page.locator('.admin-topbar h1').boundingBox();
  expect(fixture.requests.filter(path => path.startsWith('GET /api/admin/'))).toHaveLength(4);
  const responses = ['projects', 'access', 'users', 'organizations'].map(resource => page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/${resource}`));
  gate.release();
  await Promise.all((await Promise.all(responses)).map(response => response.finished()));
  await expect(heading).toHaveAttribute('data-loading-structure', 'pending');
  const geometry = await page.locator('.admin-topbar h1').boundingBox();
  expect(pendingRequestGeometry).not.toBeNull();
  expect(geometry).not.toBeNull();
  // The approved header has no refresh action: the complete heading geometry
  // is stable before and after the response, including its horizontal position.
  expect(geometry).toEqual(pendingRequestGeometry);
  await expect(page.locator('.admin-content').getByRole('status')).toHaveText('Carregando dados administrativos.');
  await expect(metric(page, 'Projetos').locator('strong')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('admin-stage-0.png'), fullPage: true });
  await page.clock.runFor(79);
  await expect(heading).toHaveAttribute('data-loading-structure', 'pending');
  await page.clock.runFor(1);
  await expect(heading).not.toHaveAttribute('data-loading-structure', 'pending');
  await expect(metric(page, 'Projetos').locator('.mm-skeleton')).toBeVisible();
  expect(await page.locator('.admin-topbar h1').boundingBox()).toEqual(geometry);
  await page.screenshot({ path: testInfo.outputPath('admin-stage-80.png'), fullPage: true });
  await page.clock.runFor(179);
  await expect(metric(page, 'Projetos').locator('strong')).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(metric(page, 'Projetos').locator('strong')).toHaveText('1');
  await expect(page.locator('.admin-content .mm-skeleton')).toHaveCount(0);
});

test('Admin slow response has no additional hold and refresh keeps focused controls mounted', async ({ page }) => {
  await freezePresentationClock(page);
  const initial = deferred(), refresh = deferred();
  const fixture = await setup(page, { section: 'users', allowUserSave: true, beforeRead: (_resource, attempt) => attempt === 1 ? initial.promise : refresh.promise });
  await page.clock.runFor(900);
  await expect(page.locator('.admin-user-manager h2 .mm-static-loading-text')).not.toHaveAttribute('data-loading-structure', 'pending');
  initial.release();
  await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta');
  const input = page.getByPlaceholder('Nome, e-mail, organização ou perfil');
  await input.fill('Pessoa');
  const retainedInput = await input.elementHandle();
  await saveSyntheticUser(page);
  expect(fixture.mutations).toHaveLength(1);
  await input.focus();
  await expect(page.locator('.admin-users-table')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.admin-content').getByRole('status')).toHaveText('Atualizando dados administrativos.');
  await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta');
  await expect(page.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  await expect(input).toBeFocused(); refresh.release();
  await expect(page.locator('.admin-users-table')).toHaveAttribute('aria-busy', 'false');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('Pessoa');
  expect(await retainedInput!.evaluate(element => element.isConnected)).toBe(true);
});

test('Admin initial authentication failure cancels every presentation stage and late companions cannot restore rows', async ({ page }) => {
  await freezePresentationClock(page);
  const failure = deferred(), late = deferred();
  await setup(page, { section: 'projects', beforeRead: resource => resource === 'users' ? failure.promise : late.promise, status: resource => resource === 'users' ? 401 : 200 });
  await expect(page.locator('.admin-topbar [data-loading-structure="pending"]')).not.toHaveCount(0);
  failure.release();
  await expect(page.locator('.admin-notice.error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  await expect(page.locator('.admin-content .mm-skeleton')).toHaveCount(0);
  late.release(); await page.clock.runFor(600);
  await expect(page.locator('.mm-table-wrap')).not.toContainText('Projeto pronto');
});

test('Admin reduced motion removes structure and content holds without changing real pending data', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freezePresentationClock(page);
  const gate = deferred(); await setup(page, { beforeRead: () => gate.promise });
  await expect(page.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  await expect(metric(page, 'Projetos').locator('.mm-skeleton')).toBeVisible();
  gate.release();
  await expect(metric(page, 'Projetos').locator('strong')).toHaveText('1');
  await expect(page.locator('.admin-content .mm-skeleton')).toHaveCount(0);
});
