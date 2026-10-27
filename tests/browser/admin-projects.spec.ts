import { expect, test, type Page } from '@playwright/test';

const organizations = [
  { id: 1, name: 'Floresta', slug: 'floresta', active: true },
  { id: 2, name: 'Oceano', slug: 'oceano', active: true },
  { id: 3, name: 'Desativada', slug: 'desativada', active: false },
];
const projects = Array.from({ length: 27 }, (_, index) => ({
  id: index + 1, name: `Mapa ${String(index + 1).padStart(2, '0')}`, slug: `mapa-${index + 1}`,
  organizationId: index === 3 ? 3 : index % 2 + 1,
  organization: organizations[index === 3 ? 2 : index % 2],
  active: index > 1, accessCount: index, metadataVersion: 4,
  lifecycle: { state: index === 0 ? 'DRAFT' : index === 1 ? 'PENDING' : 'ACTIVE', version: 3, configRevision: 2 },
  createdBy: { name: 'Criador sintético' }, updatedBy: { name: 'Editor sintético' },
  createdAt: '2026-10-01 10:00:00', updatedAt: '2026-10-27 11:00:00',
}));
const issues = new WeakMap<Page, string[]>();
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

async function setup(page: Page, options: { role?: string; empty?: boolean; query?: string; before?: (resource: string, attempt: number) => Promise<void>; status?: (resource: string, attempt: number) => number } = {}) {
  const requests: string[] = [];
  const attempts = new Map<string, number>();
  issues.set(page, []);
  page.on('pageerror', error => issues.get(page)!.push(error.message));
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    requests.push(`${request.method()} ${path}`);
    if (request.method() !== 'GET') { issues.get(page)!.push(`Unexpected mutation: ${path}`); return route.fulfill({ status: 403, json: { ok: false } }); }
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, user: { id: 1, name: 'Operador sintético', email: 'qa@example.test', role: options.role || 'super_admin', activeOrganizationId: 1 }, activeOrganization: organizations[0], organizations, projects: [] } });
    const resource = path.match(/^\/api\/admin\/(projects|organizations|users|access)$/)?.[1];
    if (resource) {
      const attempt = (attempts.get(resource) || 0) + 1; attempts.set(resource, attempt);
      await options.before?.(resource, attempt);
      const status = options.status?.(resource, attempt) || 200;
      if (status !== 200) return route.fulfill({ status, json: { ok: false, error: { code: status === 401 ? 'AUTH_SESSION_EXPIRED' : status === 403 ? 'AUTH_PERMISSION_DENIED' : 'INFRASTRUCTURE_UNEXPECTED_ERROR', category: status === 401 ? 'AUTH' : status === 403 ? 'PERMISSION' : 'INFRASTRUCTURE', retryable: status >= 500 } } });
      const payloads = { projects: { projects: options.empty ? [] : projects, scope: 'global', organizationId: null }, organizations: { organizations }, users: { users: [] }, access: { access: [] } };
      return route.fulfill({ json: { ok: true, ...payloads[resource as keyof typeof payloads] } });
    }
    if (path.endsWith('/change-requests/inbox')) return route.fulfill({ json: { ok: true, project: { name: 'Mapa 03', slug: 'mapa-3' }, items: [{ id: 'synthetic-review', status: 'submitted', reason: 'Revisão sintética', operationCount: 1, baseRevision: 2, reviewUrl: '/projects/mapa-3/review/synthetic-review' }], pagination: { page: 1, limit: 25, hasMore: false } } });
    if (path.endsWith('/map-navigation')) return route.fulfill({ status: 403, json: { ok: false, error: { code: 'AUTH_PERMISSION_DENIED', category: 'PERMISSION', message: 'Acesso ao destino negado.', retryable: false } } });
    return route.fulfill({ json: { ok: true, projects: [], organizations, users: [], items: [], files: [], notifications: [], enabled: false } });
  });
  await page.goto(`/admin?section=projects${options.query ? `&${options.query}` : ''}`);
  return { requests, attempts };
}
const panel = (page: Page) => page.locator('.admin-projects');
const row = (page: Page, name: string) => panel(page).getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
const select = (page: Page, name: string) => panel(page).getByRole('combobox', { name, exact: true });
async function ready(page: Page) { await expect(panel(page).getByRole('region', { name: 'Lista de projetos' })).toHaveAttribute('aria-busy', 'false'); await expect(row(page, 'Mapa 03').getByRole('link', { name: 'Gerenciar' })).toBeVisible(); }
test.afterEach(async ({ page }) => { expect(issues.get(page) || []).toEqual([]); });

test('actual lifecycle, organization, absent fields and existing destinations', async ({ page }) => {
  const fixture = await setup(page); await ready(page);
  await expect(row(page, 'Mapa 01')).toContainText('Rascunho');
  await expect(row(page, 'Mapa 02')).toContainText('Pendente');
  await expect(row(page, 'Mapa 01').getByRole('link')).toHaveCount(0);
  await expect(row(page, 'Mapa 04')).toContainText('Organização inativa.');
  await expect(row(page, 'Mapa 06')).toContainText('Ative esta organização');
  await expect(row(page, 'Mapa 06').getByRole('link')).toHaveCount(0);
  for (const [name, suffix] of [['Gerenciar', 'manage'], ['Solicitações', 'requests']]) await expect(row(page, 'Mapa 03').getByRole('link', { name })).toHaveAttribute('href', `/projects/mapa-3/${suffix}`);
  await expect(row(page, 'Mapa 03').getByRole('link', { name: 'Visualizar mapa' })).toHaveCount(0);
  await expect(row(page, 'Mapa 03')).toContainText('este perfil usa o modo Editor');
  await row(page, 'Mapa 03').locator('summary').click();
  await expect(row(page, 'Mapa 03')).toContainText('Criador sintético');
  await expect(row(page, 'Mapa 03')).toContainText('Versão dos metadados');
  await expect(row(page, 'Mapa 03')).not.toContainText('config.kepler.json');
  expect(fixture.requests.filter(path => path.startsWith('GET /api/admin/'))).toHaveLength(4);
});

test('filter drafts, cancel, apply, clear and browser history preserve the query without new reads', async ({ page }) => {
  const fixture = await setup(page); await ready(page);
  const search = panel(page).getByRole('searchbox', { name: 'Buscar projeto' });
  await search.fill('unsubmitted'); await panel(page).getByRole('button', { name: 'Cancelar', exact: true }).click(); await expect(search).toHaveValue('');
  await select(page, 'Organização').selectOption('1');
  await select(page, 'Estado do ciclo').selectOption('ACTIVE');
  await search.fill('Mapa 03'); await search.press('Enter');
  await expect(panel(page).locator('tbody tr')).toHaveCount(1); await expect(page).toHaveURL(/projectSearch=Mapa\+03/);
  await panel(page).getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(panel(page).locator('tbody tr')).toHaveCount(10);
  await page.goBack(); await expect(search).toHaveValue('Mapa 03'); await expect(panel(page).locator('tbody tr')).toHaveCount(1);
  await page.goForward(); await expect(search).toHaveValue('');
  expect(fixture.requests.filter(path => path === 'GET /api/admin/projects')).toHaveLength(1);
});

test('pagination accurately slices received collection and clamps deep links', async ({ page }) => {
  await setup(page, { query: 'projectPage=999' });
  await expect(panel(page).locator('tbody tr')).toHaveCount(7);
  await expect(panel(page)).toContainText('Exibindo 21–27 de 27 registros filtrados (27 recebidos).');
  await expect(panel(page).getByRole('button', { name: 'Próxima', exact: true })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Anterior', exact: true }).click();
  await expect(panel(page)).toContainText('Página 2 de 3');
  await select(page, 'Por página').selectOption('25');
  await expect(panel(page).locator('tbody tr')).toHaveCount(25); await expect(panel(page)).toContainText('Página 1 de 2');
});

test('late inventory respects current filters and does not reset focused draft', async ({ page }) => {
  const gate = deferred(); await setup(page, { before: async resource => { if (resource === 'projects') await gate.promise; } });
  const search = panel(page).getByRole('searchbox', { name: 'Buscar projeto' });
  await search.fill('Mapa 03'); await search.press('Enter'); await search.fill('draft in progress');
  gate.release(); await expect(row(page, 'Mapa 03')).toBeVisible();
  await expect(panel(page).locator('tbody tr')).toHaveCount(1); await expect(search).toHaveValue('draft in progress'); await expect(search).toBeFocused();
});

test('empty inventory and empty filter results are distinct', async ({ page }) => {
  await setup(page, { empty: true }); await expect(panel(page)).toContainText('Nenhum registro encontrado.');
  await expect(panel(page)).toContainText('0 recebidos');
});
test('unknown organization URL does not silently widen access', async ({ page }) => {
  await setup(page, { query: 'projectOrganization=999' }); await expect(panel(page)).toContainText('Nenhum projeto corresponde aos filtros aplicados.');
  await expect(select(page, 'Organização')).toHaveValue('999'); await expect(panel(page)).toContainText('27 recebidos');
});

for (const role of ['admin', 'owner', 'editor', 'viewer']) test(`${role} cannot open the administrative inventory`, async ({ page }) => {
  const fixture = await setup(page, { role }); await expect(page.getByRole('heading', { name: 'Acesso restrito' })).toBeVisible();
  expect(fixture.requests.some(path => path.startsWith('GET /api/admin/'))).toBe(false);
});
for (const status of [401, 403]) test(`${status} never appears as an empty successful inventory or offers retry`, async ({ page }) => {
  await setup(page, { status: resource => resource === 'projects' ? status : 200 });
  await expect(panel(page)).toContainText('Dados indisponíveis.'); await expect(panel(page)).toContainText('Contagem indisponível.');
  await expect(panel(page).locator('tbody a')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
});
test('401 invalidates a delayed successful projects response', async ({ page }) => {
  const gate = deferred(); await setup(page, { before: async resource => { if (resource === 'projects') await gate.promise; }, status: resource => resource === 'users' ? 401 : 200 });
  await expect(panel(page)).toContainText('Dados indisponíveis.'); gate.release();
  await expect(panel(page).getByText('Mapa 03', { exact: true })).toHaveCount(0); await expect(panel(page)).toContainText('Contagem indisponível.');
});
test('recoverable errors retry in context and retain applied filters', async ({ page }) => {
  await setup(page, { query: 'projectLifecycle=DRAFT', status: (resource, attempt) => resource === 'projects' && attempt === 1 ? 503 : 200 });
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(row(page, 'Mapa 01')).toBeVisible(); await expect(panel(page).locator('tbody tr')).toHaveCount(1);
  await expect(select(page, 'Estado do ciclo')).toHaveValue('DRAFT');
});

test('organization denial leaves inventory readable but never enables destination links', async ({ page }) => {
  await setup(page, { status: resource => resource === 'organizations' ? 403 : 200 });
  await expect(row(page, 'Mapa 03')).toContainText('Disponibilidade da organização não confirmada.');
  await expect(row(page, 'Mapa 03').getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
});

test('failed refresh keeps a clearly stale inventory and disables destinations until recovery', async ({ page }) => {
  await setup(page, { status: (resource, attempt) => resource === 'users' && attempt === 1 || resource === 'projects' && attempt === 2 ? 503 : 200 });
  await ready(page);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(panel(page)).toContainText('Os registros anteriores permanecem visíveis');
  await expect(row(page, 'Mapa 03')).toContainText('Aguardando confirmação dos dados.');
  await expect(row(page, 'Mapa 03').getByRole('link')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await ready(page);
});

test('keyboard opens details, select escape preserves focus and links reach existing inbox/review', async ({ page }) => {
  await setup(page); await ready(page);
  const organization = select(page, 'Organização'); await organization.focus(); await organization.press('Enter'); await page.keyboard.press('Escape'); await expect(organization).toBeFocused(); await expect(organization).toHaveValue('all');
  const summary = row(page, 'Mapa 03').locator('summary'); await summary.focus(); await summary.press('Enter'); await expect(row(page, 'Mapa 03').locator('details')).toHaveAttribute('open', '');
  const link = row(page, 'Mapa 03').getByRole('link', { name: 'Solicitações' }); await link.focus(); await link.press('Enter');
  await expect(page).toHaveURL(/\/projects\/mapa-3\/requests$/);
  await expect(page.getByRole('link', { name: 'Abrir Review' })).toHaveAttribute('href', '/projects/mapa-3/review/synthetic-review');
  await page.goBack(); await ready(page);
});
test('management destination reauthorizes and surfaces backend denial', async ({ page }) => {
  const fixture = await setup(page); await ready(page); await row(page, 'Mapa 03').getByRole('link', { name: 'Gerenciar' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(fixture.requests).toContain('GET /api/projects/mapa-3/map-navigation');
});

for (const width of [1440, 390, 320]) test(`projects fit ${width}px with local scrolling and visible focus`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 }); await setup(page); await ready(page);
  const table = panel(page).getByRole('region', { name: 'Lista de projetos' }); await table.focus();
  await expect(table).toBeFocused(); expect(await table.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('16px');
  if (width < 961) expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  else expect((await page.locator('.admin-rail').boundingBox())?.width).toBe(240);
  await page.screenshot({ path: testInfo.outputPath(`admin-projects-${width}.png`), fullPage: true });
});
