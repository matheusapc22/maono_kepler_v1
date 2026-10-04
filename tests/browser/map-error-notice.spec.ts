import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { installPanelFixture, PROJECT_SLUG, ready } from './fixtures/map-panel-minimal';

// Compiled React routes with synthetic transport only. No production credentials,
// database changes, CSS injection or replacement application components.
test.setTimeout(90_000);
const project = `/api/projects/${PROJECT_SLUG}`;
const storageMessage = 'O armazenamento desta organização precisa de verificação. Procure o suporte para continuar.';
const notice = (page: Page) => page.locator('.maono-map-notice');
const loadFailure = { ok: false, error: { code: 'ORGANIZATION_STORAGE_NOT_READY', category: 'STORAGE', retryable: false, message: 'private-provider-diagnostic' } };

async function expectReadable(action: Locator) {
  await expect(action).toBeVisible();
  const result = await action.evaluate(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const luminance = (value: string) => {
      const channels = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(c => {
        const n = c / 255;
        return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    // Transparent secondary links use the shared card's opaque background.
    const bg = style.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(element.closest('.maono-map-notice')!).backgroundColor : style.backgroundColor;
    const fgLum = luminance(style.color), bgLum = luminance(bg);
    return { contrast: (Math.max(fgLum, bgLum) + .05) / (Math.min(fgLum, bgLum) + .05),
      text: element.textContent?.trim(), height: rect.height, left: rect.left, right: rect.right,
      viewport: innerWidth, clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
      font: parseFloat(style.fontSize), textFill: style.webkitTextFillColor, color: style.color };
  });
  expect(result.text?.length).toBeGreaterThan(8);
  expect(result.contrast).toBeGreaterThanOrEqual(4.5);
  expect(result.height).toBeGreaterThanOrEqual(44);
  expect(result.font).toBeGreaterThanOrEqual(14);
  expect(result.left).toBeGreaterThanOrEqual(0);
  expect(result.right).toBeLessThanOrEqual(result.viewport);
  expect(result.clipped).toBe(false);
  expect(result.textFill).toBe(result.color);
}

async function expectNoticeFits(page: Page, testInfo: TestInfo, label: string) {
  await expect(notice(page)).toBeVisible();
  const fit = await notice(page).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: innerWidth, height: innerHeight, contentOverflow: element.scrollWidth > element.clientWidth + 1 };
  });
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.width);
  expect(fit.top).toBeGreaterThanOrEqual(0);
  expect(fit.bottom).toBeLessThanOrEqual(fit.height);
  expect(fit.contentOverflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath(`${label}.png`) });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 1024, height: 768 }, { width: 360, height: 800 }, { width: 320, height: 568 }]) {
  test(`map notice has readable retry and recovers without floating Requests at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const fixture = await installPanelFixture(page);
    let retry = false, requests = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**${project}/config-stream?*`, async route => {
      requests += 1;
      if (!retry) return route.fulfill({ status: 409, json: loadFailure });
      await pending;
      return route.fallback();
    });
    await page.goto(`${fixture.path}?maonoLayoutDebug=1&maonoEngineDebug=1`);
    await expect(notice(page)).toContainText(storageMessage);
    await expect(notice(page)).not.toContainText('private-provider-diagnostic');
    await expect(notice(page)).toHaveAccessibleName('Erro ao carregar o projeto');
    await expect(page.getByRole('link', { name: 'Solicitações', exact: true })).toHaveCount(0);
    const action = notice(page).getByRole('button', { name: 'Tentar carregar novamente', exact: true });
    await expectReadable(action);
    await action.click({ trial: true });
    expect(await notice(page).evaluate(element => {
      const rect = element.getBoundingClientRect();
      return [[rect.left + 8, rect.top + 8], [rect.right - 8, rect.bottom - 8]].every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
    })).toBe(true);
    await expectNoticeFits(page, testInfo, `map-load-error-${viewport.width}`);
    // The real retry handler must start one new load; pending work removes the
    // stale alert so repeated keyboard input cannot issue another retry.
    const before = requests;
    retry = true;
    await action.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(action).toBeFocused();
    expect(await action.evaluate(e => getComputedStyle(e).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect.poll(() => requests).toBe(before + 1);
    await expect(notice(page)).toHaveCount(0);
    await page.keyboard.press('Enter');
    expect(requests).toBe(before + 1);
    release();
    await ready(page);
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Solicitações', exact: true })).toHaveCount(0);
    expect(fixture.unexpectedWrites).toEqual([]);
  });
}

for (const variant of ['viewer', 'replacement'] as const) {
  test(`map access notice preserves ${variant} destination and safe permission message`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const fixture = await installPanelFixture(page, { viewer: true });
    const destination = `/projects/${PROJECT_SLUG}/view`;
    await page.route(`**${project}/map-navigation?*`, route => route.fulfill({ status: 403, headers: { 'X-Correlation-Id': 'notice-synthetic-reference-2026' }, json: {
      ok: false, error: { code: 'MAP_EDITOR_FORBIDDEN', category: 'PERMISSION', retryable: false,
        details: variant === 'viewer' ? { fallbackPanel: 'viewer' } : { replacementRoute: destination } },
    } }));
    await page.goto(`/projects/${PROJECT_SLUG}/edit?maonoLayoutDebug=1&maonoEngineDebug=1`);
    await expect(notice(page)).toHaveAccessibleName('Acesso não disponível');
    await expect(notice(page)).toContainText('Você não possui permissão para editar este mapa.');
    await expect(notice(page).locator('.maono-map-notice__reference')).toHaveCount(0);
    const primary = notice(page).getByRole('link', { name: variant === 'viewer' ? 'Abrir visualizador' : 'Abrir rota atribuída' });
    await expect(primary).toHaveAttribute('href', destination);
    const back = notice(page).getByRole('link', { name: 'Voltar aos projetos' });
    await expect(back).toHaveAttribute('href', '/projects');
    await expectReadable(primary);
    await expectReadable(back);
    await expectNoticeFits(page, testInfo, `map-access-${variant}`);
    await page.unroute(`**${project}/map-navigation?*`);
    await primary.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    await expect(page.locator('.maono-map-runtime')).toHaveAttribute('data-map-mode', 'viewer');
    await expect(page.locator('.maono-map-runtime')).toHaveAttribute('data-map-ready', 'true');
    await expect(page.locator('.maono-map-runtime')).toHaveAttribute('data-map-loading', 'false');
    await expect(notice(page)).toHaveCount(0);
    expect(fixture.unexpectedWrites).toEqual([]);
  });
}

test('storage access failure keeps its support reference and scrolls on a short screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 220 });
  const fixture = await installPanelFixture(page);
  await page.route(`**${project}/map-navigation?*`, route => route.fulfill({ status: 503, headers: { 'X-Correlation-Id': 'notice-synthetic-reference-2026' }, json: loadFailure }));
  await page.goto(fixture.path);
  await expect(notice(page)).toHaveAccessibleName('Não foi possível abrir o mapa');
  await expect(notice(page)).toContainText(storageMessage);
  await expect(notice(page).locator('.maono-map-notice__reference')).toContainText('Referência:');
  const back = notice(page).getByRole('link', { name: 'Voltar aos projetos' });
  await back.scrollIntoViewIfNeeded();
  await expectReadable(back);
  const result = await back.evaluate(element => {
    const viewport = element.closest('.maono-map-notice-viewport')!;
    const rect = element.getBoundingClientRect();
    return { scrollable: viewport.scrollHeight > viewport.clientHeight, top: rect.top, bottom: rect.bottom, height: innerHeight };
  });
  expect(result.scrollable).toBe(true);
  expect(result.top).toBeGreaterThanOrEqual(0);
  expect(result.bottom).toBeLessThanOrEqual(result.height);
  await page.screenshot({ path: testInfo.outputPath('map-access-short-screen.png') });
});

test('map management failure uses shared notice and returns to projects', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installPanelFixture(page);
  await page.route(`**${project}/map-navigation?*`, route => route.fulfill({ status: 404, json: {
    ok: false, error: { code: 'PROJECT_NOT_FOUND', category: 'PROJECT', retryable: false },
  } }));
  await page.goto(`/projects/${PROJECT_SLUG}/manage`);
  await expect(notice(page)).toHaveAccessibleName('Não foi possível abrir o mapa');
  const back = notice(page).getByRole('link', { name: 'Voltar aos projetos' });
  await expectReadable(back);
  await expectNoticeFits(page, testInfo, 'map-management-error');
  await back.click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(notice(page)).toHaveCount(0);
});

test('Requests route remains available after removing the map shortcut', async ({ page }) => {
  await installPanelFixture(page);
  await page.route(`**${project}/change-requests/inbox?*`, route => route.fulfill({ json: {
    ok: true, project: { name: 'Mapa sintético QA', slug: PROJECT_SLUG }, items: [], pagination: { page: 1, limit: 25, hasMore: false },
  } }));
  await page.goto(`/projects/${PROJECT_SLUG}/requests`);
  await expect(page.getByRole('heading', { name: 'Solicitações de alteração' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir Editor' })).toHaveAttribute('href', `/projects/${PROJECT_SLUG}/edit`);
});
