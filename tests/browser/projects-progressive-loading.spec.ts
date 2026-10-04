import { expect, test, type Page } from '@playwright/test';

// Local compiled application with synthetic HTTP. This is behavioral evidence,
// not a claim that deployed APIs, real sessions or external images were tested.
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
const errors = new WeakMap<Page, string[]>(), writes = new WeakMap<Page, string[]>();
async function setup(page: Page, options: {
  count?: number; sessionCount?: number; image?: boolean; imageStatus?: number;
  beforeRead?: (path: string, attempt: number) => Promise<void>;
  status?: (path: string, attempt: number) => number;
} = {}) {
  const attempts = new Map<string, number>();
  const organization = { id: 1, name: 'Organização sintética', slug: 'synthetic', active: true };
  const projects = Array.from({ length: options.count ?? 4 }, (_, index) => ({ id: index + 1, slug: `mapa-${index + 1}`, name: `Projeto pronto ${index + 1}`, description: 'Conteúdo conhecido durante o carregamento da imagem.', organizationId: 1, accessLevel: 'owner', active: true, thumbnailStatus: options.image ? 'READY' : 'MISSING', configRevision: 1, thumbnailRevision: options.image ? 1 : null }));
  const sessionProjects = Array.from({ length: options.sessionCount ?? 0 }, (_, index) => ({ id: index + 101, slug: `cache-${index}`, name: `Projeto em cache ${index}`, organizationId: 1, accessLevel: 'owner', active: true }));
  errors.set(page, []); writes.set(page, []); page.on('pageerror', error => errors.get(page)!.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { writes.get(page)!.push(`${request.method()} ${path}`); return route.fulfill({ status: 403, json: { ok: false } }); }
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, user: { id: 1, name: 'Operador sintético', email: 'qa@example.test', role: 'super_admin', activeOrganizationId: 1 }, projects: sessionProjects, organizations: [organization], activeOrganization: organization } });
    const attempt = (attempts.get(path) ?? 0) + 1; attempts.set(path, attempt);
    await options.beforeRead?.(path, attempt);
    if (path.endsWith('/thumbnail')) {
      // Browsers can decode a valid image even on an HTTP error response. A
      // real failed thumbnail delivers a non-image error body, not a valid SVG.
      if (options.imageStatus && options.imageStatus !== 200) return route.fulfill({ status: options.imageStatus, json: { ok: false, error: 'Synthetic thumbnail unavailable' } });
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#183124"/></svg>' });
    }
    if (['/api/projects', '/api/projects/recent', '/api/projects/favorites'].includes(path)) {
      const status = options.status?.(path, attempt) ?? 200;
      if (status !== 200) return route.fulfill({ status, json: { ok: false, error: { code: status === 403 ? 'AUTH_PERMISSION_DENIED' : 'INFRASTRUCTURE_UNEXPECTED_ERROR', category: status === 403 ? 'PERMISSION' : 'INFRASTRUCTURE', retryable: status >= 500 } } });
      return route.fulfill({ json: { ok: true, projects } });
    }
    return route.fulfill({ json: { ok: true, projects: [], files: [], folders: [], items: [], users: [], organization, enabled: false, notifications: [], unreadCount: 0 } });
  });
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  await page.goto('/projects');
  // The load event can precede session hydration and the Projects module mount.
  // Observe the authorized region and its first read before a fixture advances
  // virtual time; this adds no clock ticks or response/presentation delay.
  await expect(page.locator('.mm-sidebar-nav').getByRole('button', { name: 'Todos os Projetos', exact: true })).toBeVisible();
  await expect(page.locator('.mm-project-pages__heading h1')).toHaveText('Todos os Projetos');
  await expect.poll(() => attempts.get('/api/projects')).toBe(1);
  return { attempts };
}
const cards = (page: Page) => page.locator('.mm-project-card:not(.mm-project-skeleton):visible');
const search = (page: Page) => page.getByRole('form', { name: 'Filtros de projetos' }).getByLabel('Buscar', { exact: true });
async function reopenAll(page: Page) {
  await page.locator('.mm-sidebar-nav').getByRole('button', { name: 'Auditoria', exact: true }).click();
  await page.locator('.mm-sidebar-nav').getByRole('button', { name: 'Todos os Projetos', exact: true }).click();
}
test.afterEach(async ({ page }) => { expect(errors.get(page) ?? []).toEqual([]); expect(writes.get(page) ?? []).toEqual([]); });

for (const width of [1440, 390]) test(`Projects ${width}px keeps structure and unknown pending footer, then reveals results`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const gate = deferred(); await setup(page, { count: 17, beforeRead: async path => { if (path === '/api/projects') await gate.promise; } });
  await expect(page.getByRole('heading', { name: 'Todos os Projetos', exact: true, level: 1 })).toBeVisible();
  await expect(search(page)).toBeEnabled(); await search(page).fill('Texto de busca ainda não aplicado');
  await expect(page.locator('.mm-project-skeleton').first()).toBeVisible();
  const count = await page.locator('.mm-project-skeleton').count();
  expect(count).toBeGreaterThan(0); expect(count).toBeLessThanOrEqual(width === 390 ? 3 : 9);
  await expect(page.locator('.mm-project-pages__footer')).toContainText('Carregando projetos.');
  await expect(page.locator('.mm-project-pages__footer')).not.toContainText('0/0');
  await expect(page.locator('.mm-sidebar-nav').getByRole('button', { name: 'Todos os Projetos', exact: true }).locator('.mm-sidebar-count')).toHaveText('—');
  await expect(page.locator('.mm-project-pages__footer').getByRole('status')).toHaveCount(1);
  expect(await page.locator('.mm-project-pages__footer').getByRole('status').evaluate(element => element.closest('[aria-busy="true"]') === null)).toBe(true);
  const heading = await page.locator('.mm-project-pages__heading').boundingBox();
  const pendingCard = await page.locator('.mm-project-skeleton').first().boundingBox();
  const pendingColumns = await page.locator('.mm-project-pages__grid').evaluate(element => getComputedStyle(element).gridTemplateColumns);
  await page.screenshot({ path: testInfo.outputPath(`projects-${width}-pending.png`), fullPage: true });
  gate.release(); await expect(cards(page)).toHaveCount(10);
  await expect(page.locator('.mm-project-skeleton')).toHaveCount(0);
  await expect(search(page)).toBeFocused(); await expect(search(page)).toHaveValue('Texto de busca ainda não aplicado');
  await expect(page.locator('.mm-project-pages__footer')).toContainText('Exibindo 10/17.');
  await expect(page.locator('.mm-sidebar-nav').getByRole('button', { name: 'Todos os Projetos', exact: true }).locator('.mm-sidebar-count')).toHaveText('17');
  const readyCard = await cards(page).first().boundingBox();
  expect(readyCard?.width).toBe(pendingCard?.width);
  // Creator metadata is optional; only that short row may differ from the estimate.
  expect(Math.abs(readyCard!.height - pendingCard!.height)).toBeLessThanOrEqual(32);
  expect(await page.locator('.mm-project-pages__grid').evaluate(element => getComputedStyle(element).gridTemplateColumns)).toBe(pendingColumns);
  expect((await page.locator('.mm-project-pages__heading').boundingBox())?.y).toBe(heading?.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath(`projects-${width}-ready.png`), fullPage: true });
});

test('Projects same-context refresh and transient failure retain cards and focused draft', async ({ page }, testInfo) => {
  const gate = deferred(); await setup(page, { beforeRead: async (path, attempt) => { if (path === '/api/projects' && attempt === 2) await gate.promise; }, status: (path, attempt) => path === '/api/projects' && attempt === 2 ? 503 : 200 });
  await expect(cards(page)).toHaveCount(4); await reopenAll(page);
  await expect(page.locator('.mm-project-pages__grid')).toHaveAttribute('aria-busy', 'true');
  await expect(cards(page)).toHaveCount(4); await expect(page.locator('.mm-project-skeleton')).toHaveCount(0);
  await expect(page.locator('.mm-project-pages__footer')).toContainText('Atualizando projetos.');
  await search(page).fill('Rascunho preservado');
  await page.screenshot({ path: testInfo.outputPath('projects-refresh-preserved.png'), fullPage: true });
  gate.release(); await expect(page.getByRole('alert')).toContainText('Não foi possível carregar os projetos');
  await expect(cards(page)).toHaveCount(4); await expect(search(page)).toBeFocused(); await expect(search(page)).toHaveValue('Rascunho preservado');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(cards(page)).toHaveCount(4);
});

test('Projects access rejection discards previously revealed rows and never describes it as empty success', async ({ page }) => {
  const retry = deferred();
  await setup(page, { sessionCount: 4, beforeRead: async (path, attempt) => { if (path === '/api/projects' && attempt === 3) await retry.promise; }, status: (path, attempt) => path === '/api/projects' && attempt === 2 ? 403 : 200 });
  await expect(cards(page)).toHaveCount(4); await reopenAll(page);
  await expect(page.getByRole('alert')).toBeVisible(); await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('.mm-project-skeleton')).toHaveCount(0);
  await expect(page.locator('.mm-project-pages__footer')).toContainText('Contagem de projetos indisponível.');
  await expect(page.getByText('Nenhum projeto encontrado.', { exact: true })).toHaveCount(0);
  const badge = page.locator('.mm-sidebar-nav').getByRole('button', { name: 'Todos os Projetos', exact: true }).locator('.mm-sidebar-count');
  await expect(badge).toHaveText('—');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(badge).toHaveText('—'); retry.release(); await expect(badge).toHaveText('4');
});

test('Projects known-empty refresh does not replay a full grid skeleton', async ({ page }) => {
  const gate = deferred(); await setup(page, { count: 0, beforeRead: async (path, attempt) => { if (path === '/api/projects' && attempt === 2) await gate.promise; } });
  await expect(page.getByText('Nenhum projeto encontrado.', { exact: true })).toBeVisible(); await reopenAll(page);
  await expect(page.getByText('Nenhum projeto encontrado.', { exact: true })).toBeVisible();
  await expect(page.locator('.mm-project-skeleton')).toHaveCount(0);
  await expect(page.locator('.mm-project-pages__footer')).toContainText('Exibindo 0/0. Atualizando projetos.');
  gate.release(); await expect(page.locator('.mm-project-pages__footer')).toContainText('Exibindo 0/0.');
});

for (const imageStatus of [200, 503]) test(`Project image ${imageStatus}: only media stays busy while title and actions remain usable`, async ({ page }, testInfo) => {
  const gate = deferred(); await setup(page, { count: 1, image: true, imageStatus, beforeRead: async path => { if (path.endsWith('/thumbnail')) await gate.promise; } });
  const card = cards(page); await expect(card).toHaveCount(1);
  await expect(card).not.toHaveAttribute('aria-busy', 'true');
  await expect(card.locator('.mm-project-card__preview')).toHaveAttribute('aria-busy', 'true');
  await expect(card.locator('.mm-project-card__content')).toContainText('Projeto pronto 1');
  await expect(card.locator('.mm-project-card__preview .mm-skeleton')).toBeVisible();
  await expect(card.locator('.mm-project-card__content .mm-skeleton')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Adicionar projeto aos favoritos' })).toBeEnabled();
  expect(await card.getByRole('button', { name: 'Adicionar projeto aos favoritos' }).evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await page.screenshot({ path: testInfo.outputPath(`project-media-${imageStatus}-pending.png`), fullPage: true });
  gate.release();
  await expect(card.locator('.mm-project-card__preview')).toHaveAttribute('aria-busy', 'false');
  await expect(card.locator('.mm-skeleton')).toHaveCount(0);
  if (imageStatus === 200) {
    await expect(card.locator('img.is-loaded')).toBeVisible();
    await page.locator('.mm-sidebar-nav').getByRole('button', { name: 'Recentes', exact: true }).click();
    await expect(cards(page).locator('img.is-loaded')).toBeVisible();
    await expect(cards(page).locator('.mm-skeleton')).toHaveCount(0);
  } else await expect(card).toContainText('Prévia indisponível');
});

test('Project pending media honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); const gate = deferred();
  await setup(page, { count: 1, image: true, beforeRead: async path => { if (path.endsWith('/thumbnail')) await gate.promise; } });
  const placeholder = cards(page).locator('.mm-skeleton'); await expect(placeholder).toBeVisible();
  expect(await placeholder.evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('none');
  gate.release(); await expect(placeholder).toHaveCount(0);
});

test('prolonged thumbnail status never shifts already revealed card text', async ({ page }, testInfo) => {
  await page.clock.install(); const gate = deferred();
  await setup(page, { count: 1, image: true, beforeRead: async path => { if (path.endsWith('/thumbnail')) await gate.promise; } });
  const card = cards(page), content = card.locator('.mm-project-card__content');
  await expect(content).toContainText('Projeto pronto 1');
  const before = await content.boundingBox(); await page.clock.fastForward(8_100);
  const status = card.locator('.mm-loading-status.is-prolonged'); await expect(status).toBeVisible();
  expect(await status.evaluate(element => element.closest('[aria-busy="true"]') === null)).toBe(true);
  expect(await content.boundingBox()).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('project-prolonged-media-stable-text.png'), fullPage: true });
  gate.release(); await expect(card.locator('.mm-skeleton')).toHaveCount(0);
});

test('sidebar keeps a nonempty authorized session count, then accepts an authoritative empty result', async ({ page }) => {
  const gate = deferred(); await setup(page, { count: 0, sessionCount: 3, beforeRead: async path => { if (path === '/api/projects') await gate.promise; } });
  const badge = page.locator('.mm-sidebar-nav').getByRole('button', { name: 'Todos os Projetos', exact: true }).locator('.mm-sidebar-count');
  await expect(badge).toHaveText('3');
  gate.release(); await expect(page.getByText('Nenhum projeto encontrado.', { exact: true })).toBeVisible();
  await expect(badge).toHaveText('0');
});

async function freezePresentationClock(page: Page) {
  const time = new Date('2026-01-01T12:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
}

test('Projects fast response preserves exact structure geometry and starts images before total260ms reveal', async ({ page }, testInfo) => {
  await freezePresentationClock(page);
  const gate = deferred(), image = deferred();
  const fixture = await setup(page, { count: 1, image: true, beforeRead: path => path === '/api/projects' ? gate.promise : path.endsWith('/thumbnail') ? image.promise : Promise.resolve() });
  const heading = page.locator('.mm-project-pages__heading h1 .mm-static-loading-text');
  await expect(heading).toHaveAttribute('data-loading-structure', 'pending');
  const geometry = await page.locator('.mm-project-pages__heading').boundingBox();
  expect(fixture.attempts.get('/api/projects')).toBe(1);
  gate.release();
  const rawCard = page.locator('.mm-project-card:not(.mm-project-skeleton)');
  await expect(rawCard).toHaveCount(1);
  await expect(rawCard).not.toBeVisible();
  await expect.poll(() => fixture.attempts.get('/api/projects/mapa-1/thumbnail')).toBe(1);
  const mountedCard = await rawCard.elementHandle();
  await page.screenshot({ path: testInfo.outputPath('projects-stage-0.png'), fullPage: true });
  await page.clock.runFor(79);
  await expect(heading).toHaveAttribute('data-loading-structure', 'pending');
  await page.clock.runFor(1);
  await expect(heading).not.toHaveAttribute('data-loading-structure', 'pending');
  expect(await page.locator('.mm-project-pages__heading').boundingBox()).toEqual(geometry);
  await expect(rawCard).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('projects-stage-80.png'), fullPage: true });
  await page.clock.runFor(179);
  await expect(rawCard).not.toBeVisible();
  await page.clock.runFor(1);
  await expect(rawCard).toBeVisible();
  expect(await mountedCard!.evaluate(element => element.isConnected)).toBe(true);
  await expect(rawCard.locator('.mm-project-card__preview')).toHaveAttribute('aria-busy', 'true');
  await expect(rawCard.locator('.mm-project-card__content [data-loading-structure="pending"]')).toHaveCount(0);
  image.release(); await expect(rawCard.locator('img.is-loaded')).toBeVisible();
});

test('Projects slow data has no response-relative hold and valid cached return bypasses both stages', async ({ page }) => {
  await freezePresentationClock(page);
  const initial = deferred(), refresh = deferred();
  await setup(page, { beforeRead: (path, attempt) => path === '/api/projects' ? attempt === 1 ? initial.promise : refresh.promise : Promise.resolve() });
  await expect(page.locator('.mm-project-pages__heading h1 .mm-static-loading-text')).toHaveAttribute('data-loading-structure', 'pending');
  await page.clock.runFor(1200);
  await expect(page.locator('.mm-project-pages__heading [data-loading-structure="pending"]')).toHaveCount(0);
  initial.release(); await expect(cards(page)).toHaveCount(4);
  await reopenAll(page);
  await expect(cards(page)).toHaveCount(4);
  await expect(page.locator('.mm-project-skeleton')).toHaveCount(0);
  await expect(page.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  await search(page).fill('Rascunho sem remount');
  refresh.release();
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue('Rascunho sem remount');
});

test('Projects reduced motion eliminates both artificial delays', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freezePresentationClock(page);
  const gate = deferred(); await setup(page, { beforeRead: path => path === '/api/projects' ? gate.promise : Promise.resolve() });
  await expect(page.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  gate.release(); await expect(cards(page)).toHaveCount(4);
  await expect(page.locator('.mm-project-skeleton')).toHaveCount(0);
});

test('Projects a newer section invalidates old presentation timers and ignores the late prior response', async ({ page }) => {
  await freezePresentationClock(page);
  const old = deferred(), latest = deferred();
  await setup(page, { count: 1, beforeRead: path => path === '/api/projects' ? old.promise : path === '/api/projects/recent' ? latest.promise : Promise.resolve() });
  await expect(page.locator('.mm-project-pages__heading h1 .mm-static-loading-text')).toHaveAttribute('data-loading-structure', 'pending');
  await page.clock.runFor(50);
  await page.locator('.mm-sidebar-nav').getByRole('button', { name: 'Recentes', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.mm-project-pages__heading h1')).toHaveText('Recentes');
  const heading = page.locator('.mm-project-pages__heading h1 .mm-static-loading-text');
  await expect(heading).toHaveAttribute('data-loading-structure', 'pending');
  old.release(); latest.release();
  await page.clock.runFor(30);
  await expect(heading).toHaveAttribute('data-loading-structure', 'pending');
  await page.clock.runFor(50);
  await expect(heading).not.toHaveAttribute('data-loading-structure', 'pending');
  await page.clock.runFor(179);
  await expect(cards(page)).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('.mm-project-pages__heading h1')).toHaveText('Recentes');
});

test('Projects initial access error immediately cancels title and content holds', async ({ page }) => {
  await freezePresentationClock(page);
  const gate = deferred(); await setup(page, { beforeRead: path => path === '/api/projects' ? gate.promise : Promise.resolve(), status: path => path === '/api/projects' ? 403 : 200 });
  await expect(page.locator('.mm-project-pages__heading [data-loading-structure="pending"]')).not.toHaveCount(0);
  gate.release();
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar os projetos');
  await expect(page.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  await expect(page.locator('.mm-project-skeleton')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('.mm-project-pages__footer')).toContainText('Contagem de projetos indisponível.');
});
