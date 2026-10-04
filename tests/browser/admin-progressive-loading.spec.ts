import { expect, test, type Page } from '@playwright/test';

// Actual local React UI with intercepted synthetic reads. Never a production
// acceptance run; no real account, backend state, or external write is used.
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
const errors = new WeakMap<Page, string[]>(), writes = new WeakMap<Page, string[]>();
async function setup(page: Page, options: {
  section?: string; role?: string; beforeRead?: (resource: string, attempt: number) => Promise<void>;
  status?: (resource: string, attempt: number) => number; empty?: boolean;
} = {}) {
  const requests: string[] = [], attempts = new Map<string, number>();
  const organization = { id: 1, name: 'Organização pronta', slug: 'org-pronta', active: true, fileCount: 7, projectCount: 1, userCount: 1 };
  errors.set(page, []); writes.set(page, []);
  page.on('pageerror', error => errors.get(page)!.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    requests.push(`${request.method()} ${path}`);
    if (request.method() !== 'GET') { writes.get(page)!.push(`${request.method()} ${path}`); return route.fulfill({ status: 403, json: { ok: false } }); }
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, user: { id: 1, name: 'Operador sintético', email: 'qa@example.test', role: options.role ?? 'super_admin', activeOrganizationId: 1 }, projects: [], organizations: [organization], activeOrganization: organization } });
    const resource = path.match(/^\/api\/admin\/(projects|users|organizations|access)$/)?.[1];
    if (resource) {
      const attempt = (attempts.get(resource) ?? 0) + 1; attempts.set(resource, attempt);
      await options.beforeRead?.(resource, attempt);
      const status = options.status?.(resource, attempt) ?? 200;
      if (status !== 200) return route.fulfill({ status, json: { ok: false, error: { code: status === 403 ? 'AUTH_PERMISSION_DENIED' : 'INFRASTRUCTURE_UNEXPECTED_ERROR', category: status === 403 ? 'PERMISSION' : 'INFRASTRUCTURE', retryable: status >= 500 } } });
      const payloads = {
        projects: { projects: options.empty ? [] : [{ id: 4, name: 'Projeto pronto', slug: 'projeto-pronto', active: true }] },
        users: { users: options.empty ? [] : [{ id: 2, name: 'Pessoa pronta', email: 'pessoa@example.test', role: 'viewer', active: true, organizations: [{ ...organization, accessLevel: 'viewer' }] }] },
        organizations: { organizations: options.empty ? [] : [organization] }, access: { access: [] },
      };
      return route.fulfill({ json: { ok: true, ...payloads[resource as keyof typeof payloads] } });
    }
    return route.fulfill({ json: { ok: true, projects: [], users: [], organizations: [], enabled: false, notifications: [], unreadCount: 0 } });
  });
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  await page.goto(`/admin?section=${options.section ?? 'overview'}`);
  // The bootstrap skeleton also uses .admin-content and real heading copy.
  // Wait for the authorized interactive rail so region measurements cannot
  // accidentally inspect a placeholder that is being detached during handoff.
  if (!options.role || options.role === 'super_admin') await expect(page.locator('.admin-nav button')).toHaveCount(7);
  return { requests };
}
const metric = (page: Page, label: string) => page.locator('.admin-content .metric').filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) });
test.afterEach(async ({ page }) => { expect(errors.get(page) ?? []).toEqual([]); expect(writes.get(page) ?? []).toEqual([]); });

for (const width of [1440, 390]) test(`Admin ${width}px reveals independent metrics with stable shell`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const gate = deferred();
  const fixture = await setup(page, { beforeRead: async resource => { if (resource !== 'projects') await gate.promise; } });
  await expect(page.getByRole('heading', { name: 'Painel Admin', exact: true })).toBeVisible();
  await expect(page.locator('.admin-rail')).toBeVisible();
  await expect(metric(page, 'Projetos').locator('strong')).toHaveText('1');
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
  await page.locator('.admin-nav').getByRole('button', { name: '◌ Auditoria', exact: true }).click();
  await expect(page.locator('.mm-audit-list')).toContainText('admin.open');
  await page.locator('.admin-nav').getByRole('button', { name: '◇ Solicitações', exact: true }).click();
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
  const gate = deferred(); await setup(page, { section: 'users', beforeRead: async (_resource, attempt) => { if (attempt > 1) await gate.promise; } });
  await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta');
  const search = page.getByPlaceholder('Nome, e-mail, organização ou perfil'); await search.fill('Pessoa');
  const scroll = await page.evaluate(() => window.scrollY);
  // Trigger the existing refresh action without deliberately moving focus away.
  await page.getByRole('button', { name: 'Atualizar', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.admin-users-table')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.admin-users-table')).toContainText('Pessoa pronta');
  await expect(page.locator('.admin-content .mm-skeleton')).toHaveCount(0);
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Pessoa');
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await page.screenshot({ path: testInfo.outputPath('admin-users-refresh-preserved.png'), fullPage: true });
  gate.release(); await expect(page.locator('.admin-users-table')).toHaveAttribute('aria-busy', 'false');
});

test('Admin region error ends its skeleton while successful regions remain visible and retry recovers', async ({ page }) => {
  await setup(page, { status: (resource, attempt) => resource === 'organizations' && attempt === 1 ? 503 : 200 });
  await expect(page.getByRole('alert')).toContainText('Organizações');
  await expect(metric(page, 'Projetos').locator('strong')).toHaveText('1');
  await expect(metric(page, 'Organizações').locator('.mm-skeleton')).toHaveCount(0);
  await expect(metric(page, 'Organizações').locator('strong')).toHaveAttribute('aria-label', 'Indisponível');
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(metric(page, 'Organizações').locator('strong')).toHaveText('1');
  await expect(page.getByRole('alert')).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Atualizar', exact: true })).toBeEnabled();
  await expect(name).toBeFocused(); await expect(name).toHaveValue('Rascunho local ainda não salvo');
});
