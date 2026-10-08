import { isLocalBrowserBlob } from '../helpers/local-browser-url.mjs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Same real map / synthetic API and local style approach as map-add-data-sidebar.
// No Maõno catalog entries are invented; the only dataset is a native CSV upload.
// The parent runner owns the compiled preview and map feature flags.
test.use({ contextOptions: { reducedMotion: 'reduce' } });
test.setTimeout(60_000);

const style = JSON.parse(readFileSync(new URL('./fixtures/map-fidelity-style.json', import.meta.url), 'utf8'));
const organization = { id: 1, name: 'Organização sintética QA', slug: 'qa-scrollbars', active: true };
const csv = 'name,latitude,longitude,value\n' + Array.from({ length: 36 }, (_, index) =>
  `Categoria sintética ${String(index + 1).padStart(2, '0')},${-23.55 - index / 1000},${-46.63 - index / 1000},${index + 1}`,
).join('\n');
type Capture = { raw: { datasetIds: string[]; layerIds: string[] } };
type TestWindow = Window & {
  __MAONO_ENGINE_DEBUG__?: { capture(label: string): Capture };
  __MAONO_MAP_LAYOUT_DEBUG__?: { capture(label: string): { check: {
    styleLoaded: boolean; validCanvasCount: number; contextAvailable: boolean;
  } } };
  __SCROLLBAR_QA_CANVASES__?: HTMLCanvasElement[];
};

async function openMap(page: Page) {
  const writes: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 405, json: { ok: false, error: 'Synthetic suite forbids account mutations' } });
    }
    if (url.pathname === '/api/session') return route.fulfill({ json: {
      authenticated: true,
      user: { id: 1, name: 'Operador sintético QA', email: 'scrollbars@example.test', role: 'super_admin', activeOrganizationId: 1 },
      organizations: [organization], activeOrganization: organization, projects: [],
    } });
    if (url.pathname === '/api/maps/new/context') return route.fulfill({ json: { ok: true,
      policyVersion: 1, requestedMode: 'create', mode: 'create', assignedMode: 'create', defaultPanel: 'create', allowed: true,
      project: null, organization, availablePanels: { viewer: false, editor: false, create: true },
      capabilities: {
        openCreateWorkspace: true, createProject: true, initializeMap: true, saveMap: true,
        viewMap: true, openLayerPanel: true, viewLayers: true, viewFilters: true, inspectLayer: true,
        editLayers: true, editStyle: true, editLayerStyle: true, manageFilters: true, editFilters: true,
        createLayer: true, placeAnalysisMarker: true, toggleLegend: true, configureTooltips: true,
        addData: true, importData: true,
      },
      features: { mapPanelModes: true, mapCreateRoute: true, maonoMapShell: true, maonoLayerManager: true, maonoMapOverlay: true },
    } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, items: [], projects: [] } });
    if (url.href.includes('svg-icons.json')) return route.fulfill({ json: { svgIcons: [] } });
    if ((url.hostname === 'basemaps.cartocdn.com' && /^\/gl\/[^/]+\/style\.json$/.test(url.pathname)) ||
        (url.hostname === 'api.mapbox.com' && /^\/styles\/v1\//.test(url.pathname))) return route.fulfill({ json: style });
    if (isLocalBrowserBlob(url, page.url())) return route.continue();
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  await page.goto('/maps/new/create?maonoLayoutDebug=1&maonoEngineDebug=1');
  await expect(page.locator('.maono-map-runtime')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.maono-map-runtime')).toHaveAttribute('data-map-ready', 'true');
  await expect.poll(() => page.evaluate(() => {
    const debug = window as TestWindow;
    const check = debug.__MAONO_MAP_LAYOUT_DEBUG__?.capture('scrollbar-ready').check;
    return Boolean(check?.styleLoaded && check.validCanvasCount > 0 && check.contextAvailable && debug.__MAONO_ENGINE_DEBUG__);
  })).toBe(true);
  await page.evaluate(() => {
    (window as TestWindow).__SCROLLBAR_QA_CANVASES__ = Array.from(document.querySelectorAll<HTMLCanvasElement>('.maono-kepler-viewport canvas'));
  });
  return { writes };
}

const rail = (page: Page) => page.locator('.maono-map-sidebar');
const dataPanel = (page: Page) => page.locator('#map-add-data-sidebar');
async function capture(page: Page) {
  return page.evaluate(() => {
    const debug = (window as TestWindow).__MAONO_ENGINE_DEBUG__;
    if (!debug) throw new Error('Real engine debug capture is required');
    return debug.capture('scrollbar-state').raw;
  });
}
async function appearance(locator: Locator) {
  return locator.evaluate(element => ({
    color: CSS.supports('scrollbar-color', 'red transparent')
      ? getComputedStyle(element).getPropertyValue('scrollbar-color')
      : getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
    width: CSS.supports('scrollbar-width', 'thin')
      ? getComputedStyle(element).getPropertyValue('scrollbar-width')
      : getComputedStyle(element, '::-webkit-scrollbar').width,
    token: getComputedStyle(element).getPropertyValue('--mm-border-strong').trim(),
  }));
}
async function expectProjectsAppearance(locator: Locator, expected?: Awaited<ReturnType<typeof appearance>>) {
  await expect(locator).toBeVisible();
  const actual = await appearance(locator);
  expect(['thin', '5px']).toContain(actual.width);
  expect(actual.token.toLowerCase()).toBe('#333a46');
  expect(actual.color).toContain('rgb(51, 58, 70)');
  if (expected) expect(actual).toEqual(expected);
  return actual;
}
async function geometry(page: Page) {
  return page.locator('.maono-kepler-viewport').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      canvases: Array.from(element.querySelectorAll<HTMLCanvasElement>('canvas')).map(canvas => {
        const box = canvas.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, internalWidth: canvas.width, internalHeight: canvas.height };
      }),
    };
  });
}
async function expectStableCanvas(page: Page, before: Awaited<ReturnType<typeof geometry>>) {
  const after = await geometry(page);
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(before[key] - after[key]), `map ${key}`).toBeLessThanOrEqual(1);
  expect(after.canvases).toHaveLength(before.canvases.length);
  expect(after.canvases.length).toBeGreaterThan(0);
  before.canvases.forEach((canvas, index) => {
    for (const key of ['x', 'y', 'width', 'height', 'internalWidth', 'internalHeight'] as const) {
      expect(Math.abs(canvas[key] - after.canvases[index][key]), `canvas ${index} ${key}`).toBeLessThanOrEqual(1);
    }
  });
  expect(await page.evaluate(() => {
    const saved = (window as TestWindow).__SCROLLBAR_QA_CANVASES__ ?? [];
    const current = Array.from(document.querySelectorAll('.maono-kepler-viewport canvas'));
    return saved.length > 0 && saved.length === current.length && saved.every((canvas, index) => canvas === current[index] && canvas.isConnected);
  }), 'left panel navigation must not remount the map').toBe(true);
}
async function expectNativeWheel(page: Page, locator: Locator) {
  await expect.poll(() => locator.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await locator.evaluate(element => { element.scrollTop = 0; });
  await locator.hover();
  await page.mouse.wheel(0, 220);
  await expect.poll(() => locator.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
}
async function openDataFiles(page: Page) {
  await rail(page).getByRole('button', { name: 'Adicionar dados', exact: true }).click();
  await expect(dataPanel(page)).toBeVisible();
  await expect(dataPanel(page).getByRole('tab', { name: 'Dados Maõno', exact: true })).toHaveAttribute('aria-selected', 'true');
  await dataPanel(page).getByRole('tab', { name: 'Arquivos', exact: true }).click();
}

for (const viewport of [{ width: 1280, height: 480 }, { width: 390, height: 480 }]) {
  test(`basemap and data use Projects scrollbars without moving the live map at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { writes } = await openMap(page);
    const before = await geometry(page);
    const engineBefore = await capture(page);
    const viewportBefore = await page.locator('.maono-map-runtime').getAttribute('data-map-viewport');
    const overlayBefore = await page.locator('.maono-map-overlay__buttons').boundingBox();
    await rail(page).getByRole('button', { name: 'Mapa base', exact: true }).click();
    const basemaps = page.locator('.maono-basemap-panel__styles');
    const expected = await expectProjectsAppearance(basemaps);
    await expectNativeWheel(page, basemaps);
    expect(await appearance(basemaps)).toEqual(expected); // Projects hover behavior is unchanged.
    await expectStableCanvas(page, before);
    await page.screenshot({ path: testInfo.outputPath('map-basemap-scrollbar.png') });
    await openDataFiles(page);
    await expectProjectsAppearance(dataPanel(page).locator('.maono-map-data-sidebar__scroll'), expected);
    await expectNativeWheel(page, dataPanel(page).locator('.maono-map-data-sidebar__scroll'));
    await expectProjectsAppearance(page.locator('.maono-map-sidebar__nav'), expected);
    await expectStableCanvas(page, before);
    expect(await capture(page)).toEqual(engineBefore);
    await expect(page.locator('.maono-map-runtime')).toHaveAttribute('data-map-viewport', viewportBefore!);
    expect(await page.locator('.maono-map-overlay__buttons').boundingBox()).toEqual(overlayBefore);
    // The map document and right-side tool rail are outside the shared CSS scope.
    expect(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('scrollbar-width'))).not.toBe('thin');
    await page.goto('/projects');
    await expectProjectsAppearance(page.locator('.mm-sidebar-nav'), expected);
    await expectProjectsAppearance(page.locator('.mm-projects-main'), expected);
    expect(writes).toEqual([]);
  });
}

test('layer, filter and nested category scroll owners share the same native scrollbar', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  const { writes } = await openMap(page);
  await openDataFiles(page);
  await dataPanel(page).locator('input[type=file]').first().setInputFiles({ name: 'scrollbar-synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect.poll(async () => (await capture(page)).datasetIds.length).toBe(1);
  await expect.poll(async () => (await capture(page)).layerIds.length).toBeGreaterThan(0);
  await expect(dataPanel(page)).toBeHidden();
  const before = await geometry(page);
  await rail(page).getByRole('button', { name: 'Camadas', exact: true }).click();
  const expected = await expectProjectsAppearance(page.locator('.maono-layer-list-region'));
  await page.getByRole('button', { name: 'Adicionar camada', exact: true }).click();
  await expectProjectsAppearance(page.locator('.maono-add-layer__datasets'), expected);
  await page.getByRole('button', { name: 'Fechar menu', exact: true }).click();
  await page.locator('.maono-layer-row__open').first().click();
  await expectProjectsAppearance(page.locator('.maono-detail-view__scroll'), expected);
  await expectNativeWheel(page, page.locator('.maono-detail-view__scroll'));
  await page.getByRole('tab', { name: /^Filtros/ }).click();
  await expectProjectsAppearance(page.locator('.maono-filter-list-region'), expected);
  await page.locator('.maono-filter-panel').getByRole('button', { name: 'Adicionar Filtro', exact: true }).click();
  // The native select is wrapped in a label that also contains option text.
  // Its combobox accessible name excludes that text; an exact label-text
  // query does not. Target the real control's stable accessible contract.
  await page.getByRole('combobox', { name: '2. Propriedade', exact: true }).selectOption('name');
  await page.getByRole('button', { name: 'Criar filtro', exact: true }).click();
  const categories = page.locator('.maono-filter-category__options');
  await expectProjectsAppearance(page.locator('.maono-filter-list-region'), expected);
  await expectProjectsAppearance(categories, expected);
  // Inline conditions share the collection scroll owner; all categories remain available.
  await expectNativeWheel(page, page.locator('.maono-filter-list-region'));
  const stateAfterFilter = await capture(page);
  await expectStableCanvas(page, before);
  await page.screenshot({ path: testInfo.outputPath('map-filter-nested-scrollbar.png') });
  await rail(page).getByRole('button', { name: 'Mapa base', exact: true }).click();
  await expectProjectsAppearance(page.locator('.maono-basemap-panel__styles'), expected);
  await expectStableCanvas(page, before);
  expect(await capture(page)).toEqual(stateAfterFilter);
  expect(writes).toEqual([]);
});

test('forced colors restore native scrollbar appearance throughout the left sidebar', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit does not emulate forced-colors mode');
  await page.setViewportSize({ width: 390, height: 480 });
  await page.emulateMedia({ forcedColors: 'active' });
  const { writes } = await openMap(page);
  await rail(page).getByRole('button', { name: 'Mapa base', exact: true }).click();
  for (const selector of ['.maono-map-sidebar__nav', '.maono-basemap-panel__styles']) {
    await expect(page.locator(selector)).toHaveCSS('scrollbar-color', 'auto');
    await expect(page.locator(selector)).toHaveCSS('scrollbar-width', 'auto');
  }
  await expectNativeWheel(page, page.locator('.maono-basemap-panel__styles'));
  await openDataFiles(page);
  await expect(dataPanel(page).locator('.maono-map-data-sidebar__scroll')).toHaveCSS('scrollbar-color', 'auto');
  await expect(dataPanel(page).locator('.maono-map-data-sidebar__scroll')).toHaveCSS('scrollbar-width', 'auto');
  expect(writes).toEqual([]);
});
