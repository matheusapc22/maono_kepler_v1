import { expect, test, type Page } from '@playwright/test';
import { setupAdmin, adminMetric, expectAdminFixtureIntegrity } from './fixtures/admin-workspace';

const sections = [
  ['Painel', 'overview', 'Painel Admin'],
  ['Gestão de Organizações', 'organizations', 'Gestão de Organizações'],
  ['Usuários e Permissões', 'users', 'Usuários e Permissões'],
  ['Projetos e Mapas', 'projects', 'Projetos e Mapas'],
  ['Solicitações', 'requests', 'Solicitações'],
  ['Auditoria', 'audit', 'Auditoria'],
  ['Sistema', 'system', 'Sistema'],
] as const;

async function ready(page: Page) {
  await expect(page.locator('main.maono-admin-workspace')).toBeVisible();
  await expect(adminMetric(page, 'Arquivos').locator('strong')).toHaveText('10');
  await expect(page.locator('.admin-content .mm-skeleton')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const administrativeReads = (requests: string[]) => requests.filter(path => /^GET \/api\/admin\/(projects|users|organizations|access)$/.test(path));
// The follow-up compact-density requirement uses Projects' 15rem rail at the
// unchanged 16px root, replacing the original 262px visual proposal.
const desktopRailWidth = 240;

test.afterEach(async ({ page }) => { await expectAdminFixtureIntegrity(page); });

test('Admin overview uses real session, active counts and complete file sums without a refresh button', async ({ page }) => {
  await page.setViewportSize({ width: 1774, height: 887 });
  await setupAdmin(page, { visualCounts: true });
  await ready(page);
  await expect(page.locator('.admin-topbar h1')).toHaveText('Painel Admin');
  await expect(page.locator('.admin-workspace-identity')).toContainText('Operador sintético');
  await expect(page.locator('.admin-workspace-identity')).toContainText('qa@example.test');
  await expect(page.locator('.admin-workspace-identity')).toContainText('Super Admin');
  await expect(page.locator('.admin-topbar')).not.toContainText('Super Admin');
  for (const [label, value] of [['Organizações', '6'], ['Projetos', '7'], ['Usuários', '8'], ['Arquivos', '10']]) {
    await expect(adminMetric(page, label).locator('strong')).toHaveText(value);
  }
  // The fixture includes inactive organizations/projects/users. Files include
  // four held by the inactive organization, matching the existing formula.
  await expect(page.locator('.admin-overview-metrics .metric')).toHaveCount(4);
  await expect(page.locator('.admin-overview-shortcut')).toHaveCount(3);
  await expect(page.locator('.admin-overview-shortcuts h2')).toHaveText('Acesso rápido');
  await expect(page.getByRole('button', { name: /^(Atualizar|Atualizando\.\.\.)$/ })).toHaveCount(0);
  await expect(page.locator('.admin-topbar button, .admin-topbar .mm-topbar-actions')).toHaveCount(0);
  await expect(page.locator('.admin-overview input, .admin-overview select')).toHaveCount(0);
  expect(await page.locator('.admin-workspace-logo-image').evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test('seven Admin sections and three shortcuts preserve destinations, breadcrumb and existing reads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await setupAdmin(page, { visualCounts: true });
  await ready(page);
  const initialReads = administrativeReads(fixture.requests);
  expect(initialReads).toHaveLength(4);
  const navigation = page.getByRole('navigation', { name: 'Navegação administrativa' });
  await expect(navigation.getByRole('button')).toHaveCount(7);
  for (const [label, section, title] of sections) {
    const item = navigation.getByRole('button', { name: label, exact: true });
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/admin\\?section=${section}$`));
    await expect(item).toHaveAttribute('aria-current', 'page');
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    const breadcrumb = page.getByRole('navigation', { name: 'Caminho da página' });
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(title);
    await expect(breadcrumb.getByRole('link', { name: 'Início', exact: true })).toHaveAttribute('href', '/projects');
    if (section !== 'overview') await expect(breadcrumb.getByRole('link', { name: 'Painel Admin', exact: true })).toHaveAttribute('href', '/admin?section=overview');
  }
  for (const [action, section] of [['Abrir organizações', 'organizations'], ['Abrir projetos', 'projects'], ['Abrir auditoria', 'audit']]) {
    await navigation.getByRole('button', { name: 'Painel', exact: true }).click();
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin\\?section=${section}$`));
  }
  expect(administrativeReads(fixture.requests)).toEqual(initialReads);
});

for (const viewport of [
  { width: 1774, height: 887 }, { width: 1440, height: 900 },
  { width: 960, height: 800 }, { width: 768, height: 1024 },
  { width: 390, height: 844 }, { width: 320, height: 700 },
]) test(`Admin approved workspace fits ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  await setupAdmin(page, { visualCounts: true });
  await ready(page);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  const cards = await page.locator('.admin-overview-metric').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  const actions = await page.locator('.admin-overview-shortcut-action').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(cards).toHaveLength(4); expect(actions).toHaveLength(3);
  expect(cards.every(card => card.x >= 0 && card.x + card.width <= viewport.width + 1)).toBe(true);
  expect(actions.every(action => action.x >= 0 && action.x + action.width <= viewport.width + 1)).toBe(true);
  if (viewport.width >= 1440) {
    // Legacy .mm-card.metric strong previously won the cascade and reduced
    // these figures to 28px. Check rendered values, not the stylesheet text.
    const typography = await page.locator('.admin-overview-metric-copy > strong').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    }));
    expect(typography).toEqual(Array.from({ length: 4 }, () => ({ fontSize: '40px', lineHeight: '44px' })));
    expect(Math.max(...cards.map(card => card.y)) - Math.min(...cards.map(card => card.y))).toBeLessThanOrEqual(2);
    expect(Math.max(...cards.map(card => card.height)) - Math.min(...cards.map(card => card.height))).toBeLessThanOrEqual(2);
    expect(Math.max(...actions.map(action => action.y)) - Math.min(...actions.map(action => action.y))).toBeLessThanOrEqual(2);
    const rail = await page.locator('.admin-rail').boundingBox();
    expect(Math.abs(rail!.width - desktopRailWidth)).toBeLessThanOrEqual(1);
  }
  if (viewport.width <= 390) {
    expect(new Set(cards.map(card => Math.round(card.x))).size).toBe(1);
    expect(actions.every(action => action.height >= 44)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath(`admin-workspace-${viewport.width}x${viewport.height}.png`), fullPage: true });
});

test('Admin desktop rail collapses with accessible labels, keeps navigation and returns to its width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupAdmin(page, { visualCounts: true });
  await ready(page);
  const toggle = page.getByRole('button', { name: 'Recolher navegação', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.focus();
  expect(await toggle.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toHaveClass(/is-sidebar-collapsed/);
  const expand = page.getByRole('button', { name: 'Expandir navegação', exact: true });
  await expect(expand).toBeFocused(); await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.admin-rail')).toHaveCSS('width', '72px');
  await page.locator('.admin-nav').getByRole('button', { name: 'Sistema', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sistema', exact: true })).toBeVisible();
  await expand.click();
  await expect(page.locator('.admin-rail')).toHaveCSS('width', `${desktopRailWidth}px`);
  await expect(page.locator('.admin-nav button')).toHaveCount(7);
});

test('mobile navigation expands in document flow and all Admin sections keep their own overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupAdmin(page, { visualCounts: true });
  await ready(page);
  await page.getByRole('button', { name: 'Recolher navegação', exact: true }).click();
  await expect(page.locator('.admin-nav')).not.toBeVisible();
  await page.getByRole('button', { name: 'Expandir navegação', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: 'Navegação administrativa' });
  await expect(navigation).toBeVisible();
  for (const [label, , title] of sections) {
    await navigation.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  }
});

test('Projects to Admin to Projects is a real SPA transition and preserves each isolated shell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const navigations: string[] = [];
  page.on('request', request => { if (request.isNavigationRequest()) navigations.push(request.url()); });
  await setupAdmin(page, { visualCounts: true, path: '/projects' });
  await expect(page.locator('.mm-project-pages__heading h1')).toHaveText('Todos os Projetos');
  const projectsBox = await page.locator('.mm-projects-sidebar').boundingBox();
  expect(projectsBox!.width).toBe(desktopRailWidth);
  const projectsStyle = await page.locator('.mm-projects-page').evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  await page.locator('.mm-sidebar-nav').getByRole('link', { name: 'Painel Admin', exact: true }).click();
  await ready(page);
  await expect(page.locator('main')).toHaveClass(/maono-admin-workspace/);
  await expect(page.locator('.admin-rail')).toHaveCSS('width', `${desktopRailWidth}px`);
  expect((await page.locator('.admin-rail').boundingBox())!.width).toBe(projectsBox!.width);
  await page.getByRole('link', { name: 'Voltar para Projetos', exact: true }).click();
  await expect(page.locator('.mm-project-pages__heading h1')).toHaveText('Todos os Projetos');
  expect((await page.locator('.mm-projects-sidebar').boundingBox())!.width).toBe(projectsBox!.width);
  expect(await page.locator('.mm-projects-page').evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }))).toEqual(projectsStyle);
  expect(navigations).toHaveLength(1);
});

test('Admin logout retains the real session callback with a fully intercepted synthetic POST', async ({ page }) => {
  const fixture = await setupAdmin(page, { visualCounts: true, allowLogout: true });
  await ready(page);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  expect(fixture.mutations.map(mutation => mutation.path)).toEqual(['/api/auth/logout']);
  await expect(page.locator('.maono-admin-workspace')).toHaveCount(0);
});
