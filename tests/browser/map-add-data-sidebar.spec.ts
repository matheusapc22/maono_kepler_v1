import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tableFromArrays, tableToIPC, Utf8, vectorFromArray } from 'apache-arrow';

// Real application, Redux ingestion, and WebGL; every account, dataset, and
// service response below is synthetic. No production API or catalog is used.
// Run with the map-shell/layer-manager/overlay feature flags enabled. The
// parent runner owns the dev/compiled-preview server and browser resources.
test.use({ reducedMotion: 'reduce' });
test.setTimeout(60_000);

const require = createRequire(import.meta.url);
const style = JSON.parse(readFileSync(new URL('./fixtures/map-fidelity-style.json', import.meta.url), 'utf8'));
const organization = { id: 1, name: 'Organização sintética QA', slug: 'qa-add-data', active: true };
const rows = [
  { name: 'Ponto sintético A', latitude: -23.5505, longitude: -46.6333, value: 10 },
  { name: 'Ponto sintético B', latitude: -23.5605, longitude: -46.6433, value: 20 },
];
const csv = 'name,latitude,longitude,value\nPonto sintetico A,-23.5505,-46.6333,10\nPonto sintetico B,-23.5605,-46.6433,20\n';
const geojson = { type: 'FeatureCollection', features: rows.map(({ latitude, longitude, ...properties }) => ({
  type: 'Feature', properties, geometry: { type: 'Point', coordinates: [longitude, latitude] },
})) };

type EngineCapture = {
  raw: { datasetIds: string[]; layerIds: string[]; layerTypes: string[] };
  snapshot: { datasetIds: string[]; layerIds: string[]; ready: boolean; hasUnsavedChanges: boolean };
};
type TestWindow = Window & {
  __MAONO_ENGINE_DEBUG__?: { capture(label?: string): EngineCapture };
  __MAONO_MAP_LAYOUT_DEBUG__?: { capture(label: string): { check: {
    styleLoaded: boolean; validCanvasCount: number; contextAvailable: boolean;
  } } };
  __ADD_DATA_QA_CANVASES__?: HTMLCanvasElement[];
};
type FixtureOptions = {
  importData?: boolean;
  remoteGate?: Promise<void>;
  remoteStatus?: number;
};

async function openMap(page: Page, options: FixtureOptions = {}) {
  const requests: string[] = [];
  const writes: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(url.href);
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 405, json: { ok: false, error: 'Synthetic suite forbids account mutations' } });
    }
    if (url.pathname === '/api/session') return route.fulfill({ json: {
      authenticated: true,
      user: { id: 1, name: 'Operador sintético QA', email: 'add-data@example.test', role: 'super_admin', activeOrganizationId: 1 },
      organizations: [organization], activeOrganization: organization, projects: [],
    } });
    if (url.pathname === '/api/maps/new/context') return route.fulfill({ json: { ok: true, context: {
      policyVersion: 1, requestedMode: 'create', mode: 'create', assignedMode: 'create', defaultPanel: 'create', allowed: true,
      project: null, organization, availablePanels: { viewer: false, editor: false, create: true },
      capabilities: {
        openCreateWorkspace: true, createProject: true, initializeMap: true, saveMap: true,
        viewMap: true, openLayerPanel: true, viewLayers: true, viewFilters: true,
        editLayers: true, editStyle: true, manageFilters: true, createLayer: true,
        placeAnalysisMarker: true, toggleLegend: true, configureTooltips: true,
        addData: options.importData ?? true, importData: options.importData ?? true,
      },
      features: { mapPanelModes: true, mapCreateRoute: true, maonoMapShell: true, maonoLayerManager: true, maonoMapOverlay: true },
    } } });
    // Same-origin URL fixtures exercise the real fetch -> File -> loadFiles path.
    if (url.pathname === '/__qa/add-data/remote.csv') {
      if (options.remoteGate) await options.remoteGate;
      return route.fulfill({ status: options.remoteStatus ?? 200, contentType: 'text/csv', body: options.remoteStatus ? 'Synthetic import failure' : csv });
    }
    if (url.pathname === '/__qa/add-data/tiles/metadata.json') return route.fulfill({ json: {
      tilejson: '2.2.0', name: 'Tileset sintético QA', description: 'Generated fixture, not a catalog item',
      format: 'pbf', minzoom: 0, maxzoom: 1, bounds: [-47, -24, -46, -23], center: [-46.63, -23.55, 1],
      tiles: [`${url.origin}/__qa/add-data/tiles/{z}/{x}/{y}.pbf`],
      vector_layers: [{ id: 'qa', fields: { value: 'Number' }, minzoom: 0, maxzoom: 1 }],
    } });
    // Empty protobuf is a valid empty MVT; actual map/dataset creation remains native.
    if (/^\/__qa\/add-data\/tiles\/\d+\/\d+\/\d+\.pbf$/.test(url.pathname)) {
      return route.fulfill({ contentType: 'application/vnd.mapbox-vector-tile', body: Buffer.alloc(0) });
    }
    // Serve the exact installed parser runtime locally through route fulfillment;
    // no external network and no replacement parser are used for Parquet.
    if (url.href === 'https://unpkg.com/parquet-wasm@0.6.1/esm/parquet_wasm_bg.wasm') {
      return route.fulfill({ contentType: 'application/wasm', body: readFileSync(require.resolve('parquet-wasm/esm/parquet_wasm_bg.wasm')) });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, items: [], projects: [] } });
    if (url.href.includes('svg-icons.json')) return route.fulfill({ json: { svgIcons: [] } });
    if ((url.hostname === 'basemaps.cartocdn.com' && /^\/gl\/[^/]+\/style\.json$/.test(url.pathname)) ||
        (url.hostname === 'api.mapbox.com' && /^\/styles\/v1\//.test(url.pathname))) return route.fulfill({ json: style });
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  await page.goto('/maps/new/create?maonoLayoutDebug=1&maonoEngineDebug=1');
  await expect(page.locator('.maono-map-runtime')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.maono-map-runtime')).toHaveAttribute('data-map-ready', 'true');
  await expect.poll(() => page.evaluate(() => {
    const windowWithDebug = window as TestWindow;
    const check = windowWithDebug.__MAONO_MAP_LAYOUT_DEBUG__?.capture('add-data-ready').check;
    return Boolean(check?.styleLoaded && check.validCanvasCount > 0 && check.contextAvailable && windowWithDebug.__MAONO_ENGINE_DEBUG__);
  }), { message: 'the real map has a live WebGL canvas and loaded synthetic style' }).toBe(true);
  await page.evaluate(() => {
    (window as TestWindow).__ADD_DATA_QA_CANVASES__ = Array.from(document.querySelectorAll<HTMLCanvasElement>('.maono-kepler-viewport canvas'));
  });
  return { requests, writes };
}

const sidebar = (page: Page) => page.locator('aside#map-add-data-sidebar');
const rail = (page: Page) => page.locator('.maono-map-sidebar');
const openButton = (page: Page) => rail(page).getByRole('button', { name: 'Adicionar dados', exact: true });
const tab = (page: Page, name: string) => sidebar(page).getByRole('tab', { name, exact: true });
const fileInput = (page: Page) => sidebar(page).locator('input[type=file]').first();
const urlSubmit = (page: Page) => sidebar(page).getByRole('button', { name: /^(Busca|Buscar|Fetch|Carregar(?: dados)?|Importar(?: dados)?)$/i });

async function capture(page: Page) {
  return page.evaluate(() => {
    const debug = (window as TestWindow).__MAONO_ENGINE_DEBUG__;
    if (!debug) throw new Error('Engine debug API is unavailable');
    return debug.capture('add-data-assertion');
  });
}
async function expectNoModal(page: Page) {
  await expect(page.locator('.ReactModal__Overlay, .modal--wrapper')).toHaveCount(0);
  await expect(page.locator('.maono-map-topbar')).toHaveCount(0);
  await expect(page.locator('.maono-map-panel-host__backdrop')).toHaveCount(0);
}
async function openData(page: Page) {
  await openButton(page).click();
  await expect(sidebar(page)).toBeVisible();
  await expect(page.locator('.maono-map-panel-host__panel')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(tab(page, 'Dados Maõno')).toHaveAttribute('aria-selected', 'true');
  await expectNoModal(page);
}
async function geometry(page: Page) {
  return page.locator('.maono-kepler-viewport').evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const canvases = Array.from(element.querySelectorAll<HTMLCanvasElement>('canvas')).map(canvas => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, internalWidth: canvas.width, internalHeight: canvas.height };
    });
    return { x, y, width, height, canvases };
  });
}
async function expectStableCanvas(page: Page, before: Awaited<ReturnType<typeof geometry>>) {
  const after = await geometry(page);
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(before[key] - after[key]), `map ${key}`).toBeLessThanOrEqual(1);
  expect(after.canvases).toHaveLength(before.canvases.length);
  expect(after.canvases.length).toBeGreaterThan(0);
  for (const [index, canvas] of before.canvases.entries()) {
    for (const key of ['x', 'y', 'width', 'height', 'internalWidth', 'internalHeight'] as const) {
      expect(Math.abs(canvas[key] - after.canvases[index][key]), `canvas ${index} ${key}`).toBeLessThanOrEqual(1);
    }
  }
  expect(await page.evaluate(() => {
    const saved = (window as TestWindow).__ADD_DATA_QA_CANVASES__ ?? [];
    const current = Array.from(document.querySelectorAll('.maono-kepler-viewport canvas'));
    return saved.length > 0 && saved.length === current.length && saved.every((canvas, index) => canvas === current[index] && canvas.isConnected);
  }), 'opening the sidebar must not remount the map canvases').toBe(true);
}
async function expectImported(page: Page, count = 1) {
  await expect.poll(async () => (await capture(page)).raw.datasetIds.length, { message: 'native parser creates real Kepler datasets' }).toBe(count);
  await expect.poll(async () => (await capture(page)).raw.layerIds.length, { message: 'native ingestion creates map layers' }).toBeGreaterThan(0);
  await expect(sidebar(page)).toBeHidden();
  await expect(page.locator('.ReactModal__Overlay, .modal--wrapper')).toHaveCount(0);
}

for (const viewport of [
  { width: 1440, height: 900 }, { width: 1280, height: 720 },
  { width: 1021, height: 768 }, { width: 1020, height: 768 },
  { width: 821, height: 768 }, { width: 820, height: 768 }, { width: 390, height: 844 },
]) {
  test(`data sidebar preserves map geometry and has no backdrop at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { writes } = await openMap(page);
    const before = await geometry(page);
    const overlay = page.locator('.maono-map-overlay__buttons');
    const overlayBefore = await overlay.boundingBox();
    await openData(page);
    await expectStableCanvas(page, before);
    const box = await sidebar(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(sidebar(page).getByRole('button', { name: 'Fechar painel', exact: true })).toBeVisible();
    await expect(overlay).toBeVisible();
    const overlayAfter = await overlay.boundingBox();
    expect(Math.abs(overlayBefore!.x - overlayAfter!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayBefore!.y - overlayAfter!.y)).toBeLessThanOrEqual(1);
    await tab(page, 'Arquivos').click();
    await expect(fileInput(page)).toHaveCount(1);
    await expectStableCanvas(page, before);
    await page.screenshot({ path: testInfo.outputPath('add-data-files.png') });
    await sidebar(page).getByRole('button', { name: 'Fechar painel', exact: true }).click();
    await expect(sidebar(page)).toBeHidden();
    await expectStableCanvas(page, before);
    await openData(page);
    await page.keyboard.press('Escape');
    await expect(sidebar(page)).toBeHidden();
    await expectStableCanvas(page, before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(writes).toEqual([]);
    await testInfo.attach('canvas-geometry', { body: JSON.stringify({ viewport, before, after: await geometry(page) }), contentType: 'application/json' });
  });
}

test('empty Maõno catalog and search do not create data or make catalog requests', async ({ page }) => {
  const { requests, writes } = await openMap(page);
  const baseline = requests.length;
  await openData(page);
  await expect(sidebar(page).getByRole('tab')).toHaveText(['Dados Maõno', 'Arquivos', 'Tileset', 'URL']);
  const search = sidebar(page).getByRole('searchbox');
  await search.fill('synthetic-unavailable-dataset');
  await expect(sidebar(page)).toContainText(/nenhum|em breve|indisponível|não.*disponív/i);
  await expect(sidebar(page).locator('input[type=file]')).toHaveCount(0);
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  expect(requests.slice(baseline).filter(url => /catalog|sample|dataset/i.test(new URL(url).pathname))).toEqual([]);
  expect(writes).toEqual([]);
});

test('layer-menu entrypoint, switching panels, and repeated reopen use the same sidebar', async ({ page }) => {
  await openMap(page);
  await rail(page).getByRole('button', { name: 'Camadas', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar camada', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Importar novo dado', exact: true }).click();
  await expect(sidebar(page)).toBeVisible();
  await expect(tab(page, 'Dados Maõno')).toHaveAttribute('aria-selected', 'true');
  await expectNoModal(page);
  await tab(page, 'URL').click();
  await rail(page).getByRole('button', { name: 'Mapa base', exact: true }).click();
  await expect(sidebar(page)).toBeHidden();
  await expect(page.locator('.maono-basemap-panel')).toBeVisible();
  for (let cycle = 0; cycle < 2; cycle++) {
    await openData(page);
    await tab(page, 'Tileset').click();
    await sidebar(page).getByRole('button', { name: 'Fechar painel', exact: true }).click();
    await expect(sidebar(page)).toBeHidden();
  }
});

test('keyboard can open, switch tabs, choose a file, and dismiss the sidebar', async ({ page }) => {
  await openMap(page);
  await openButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(sidebar(page)).toBeVisible();
  await tab(page, 'Dados Maõno').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Arquivos')).toBeFocused();
  await expect(tab(page, 'Arquivos')).toHaveAttribute('aria-selected', 'true');
  const browse = sidebar(page).getByRole('button', { name: /selecionar|escolher|procurar|browse/i });
  await browse.focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles([]);
  await page.keyboard.press('Escape');
  await expect(sidebar(page)).toBeHidden();
  await expect(openButton(page)).toBeFocused();
  expect((await capture(page)).raw.datasetIds).toEqual([]);
});

test('only sidebar content scrolls while header, search, and tabs remain fixed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await openMap(page);
  await openData(page);
  await tab(page, 'Arquivos').click();
  const fixed = sidebar(page).locator('.maono-map-data-sidebar__fixed');
  const scroll = sidebar(page).locator('.maono-map-data-sidebar__scroll');
  const before = await fixed.boundingBox();
  expect(await scroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const after = await fixed.boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(after!.height).toBe(before!.height);
  await expect(sidebar(page).getByRole('button', { name: 'Fechar painel', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('map remains draggable in its exposed area while the data sidebar stays open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMap(page);
  await openData(page);
  const before = await geometry(page);
  const runtime = page.locator('.maono-map-runtime');
  const viewportBefore = await runtime.getAttribute('data-map-viewport');
  // Below the right-side toolbar and far to the right of the left panel.
  const x = before.x + before.width - 190;
  const y = before.y + before.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 110, y - 40, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => runtime.getAttribute('data-map-viewport')).not.toBe(viewportBefore);
  await expect(sidebar(page)).toBeVisible();
  await expectNoModal(page);
  await expectStableCanvas(page, before);
});

async function scrollbarAppearance(locator: Locator) {
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

test('data sidebar and actual Projects sidebar share the same native scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  const { writes } = await openMap(page);
  await openData(page);
  await tab(page, 'Arquivos').click();
  const source = sidebar(page).locator('.maono-map-data-sidebar__scroll');
  const appearance = await scrollbarAppearance(source);
  expect(['thin', '5px']).toContain(appearance.width);
  expect(appearance.token.toLowerCase()).toBe('#333a46');
  expect(appearance.color).toContain('rgb(51, 58, 70)');
  await page.goto('/projects');
  const projectsNav = page.locator('.mm-sidebar-nav');
  await expect(projectsNav).toBeVisible();
  expect(await scrollbarAppearance(projectsNav)).toEqual(appearance);
  expect(await scrollbarAppearance(page.locator('.mm-projects-main'))).toEqual(appearance);
  expect(writes).toEqual([]);
});

function fixture(format: 'csv' | 'json' | 'geojson' | 'arrow' | 'parquet') {
  let buffer: Buffer;
  if (format === 'csv') buffer = Buffer.from(csv);
  else if (format === 'json') buffer = Buffer.from(JSON.stringify(rows));
  else if (format === 'geojson') buffer = Buffer.from(JSON.stringify(geojson));
  else {
    const arrow = tableFromArrays({
      // Parquet's schema serialization supports plain Utf8, while Arrow's
      // inferred string arrays are Dictionary<Utf8>. Keep this valid fixture
      // within the native Parquet loader's supported schema, without replacing it.
      name: format === 'parquet'
        ? vectorFromArray(rows.map(row => row.name), new Utf8())
        : rows.map(row => row.name),
      latitude: new Float64Array(rows.map(row => row.latitude)),
      longitude: new Float64Array(rows.map(row => row.longitude)), value: new Float64Array(rows.map(row => row.value)),
    });
    if (format === 'arrow') buffer = Buffer.from(tableToIPC(arrow, 'stream'));
    else {
      const wasm = require('parquet-wasm/node') as typeof import('parquet-wasm/node');
      buffer = Buffer.from(wasm.writeParquet(wasm.Table.fromIPCStream(tableToIPC(arrow, 'stream'))));
    }
  }
  return { name: `synthetic-${format}.${format}`, mimeType: 'application/octet-stream', buffer };
}

for (const format of ['csv', 'json', 'geojson', 'arrow', 'parquet'] as const) {
  test(`Arquivos imports synthetic ${format.toUpperCase()} with the native parser`, async ({ page }) => {
    const { writes } = await openMap(page);
    const before = await geometry(page);
    await openData(page);
    await tab(page, 'Arquivos').click();
    await fileInput(page).setInputFiles(fixture(format));
    await expectImported(page);
    await expectStableCanvas(page, before);
    expect(writes).toEqual([]);
  });
}

test('native drag and drop imports a generated CSV into the same map store', async ({ page }) => {
  await openMap(page);
  await openData(page);
  await tab(page, 'Arquivos').click();
  const transfer = await page.evaluateHandle(content => {
    const data = new DataTransfer();
    data.items.add(new File([content], 'synthetic-dropped.csv', { type: 'text/csv' }));
    return data;
  }, csv);
  try {
    const dropTarget = sidebar(page).locator('.file-uploader__file-drop');
    await dropTarget.dispatchEvent('dragenter', { dataTransfer: transfer });
    await dropTarget.dispatchEvent('dragover', { dataTransfer: transfer });
    // First hover changes FileDrop's frame from document to its mounted
    // element; its native effect resets drag state once during that handoff.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await dropTarget.dispatchEvent('dragover', { dataTransfer: transfer });
    await expect(dropTarget.locator('.file-drop-target')).toHaveClass(/file-drop-dragging-over-target/);
    await dropTarget.dispatchEvent('drop', { dataTransfer: transfer });
    await expectImported(page);
  } finally {
    await transfer.dispose();
  }
});

test('unsupported extension stays in the panel and does not create a dataset', async ({ page }) => {
  await openMap(page);
  await openData(page);
  await tab(page, 'Arquivos').click();
  await fileInput(page).setInputFiles({ name: 'synthetic-unsupported.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('not executable; synthetic QA') });
  await expect(sidebar(page)).toContainText(/synthetic-unsupported\.exe|não suport|not support/i);
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  await expect(sidebar(page)).toBeVisible();
  await expectNoModal(page);
});

test('malformed JSON reports a native parser error and supports reopening for retry', async ({ page }) => {
  await openMap(page);
  await openData(page);
  await tab(page, 'Arquivos').click();
  await fileInput(page).setInputFiles({ name: 'synthetic-malformed.json', mimeType: 'application/json', buffer: Buffer.from('{"broken": [') });
  await expect(page.locator('.notification-item').first()).toBeVisible();
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  // Kepler completes its failed-file batch and dismisses Add Data. Retain
  // that ingestion behavior while verifying the real error and empty store.
  await expect(sidebar(page)).toBeHidden();
  await expect(page.locator('.ReactModal__Overlay, .modal--wrapper')).toHaveCount(0);
  await openData(page);
  await tab(page, 'Arquivos').click();
  await fileInput(page).setInputFiles(fixture('csv'));
  await expectImported(page);
});

test('URL validation rejects invalid text without fetching or mutating data', async ({ page }) => {
  const { requests } = await openMap(page);
  await openData(page);
  await tab(page, 'URL').click();
  const baseline = requests.length;
  await sidebar(page).getByPlaceholder('Url', { exact: true }).fill('not-a-url');
  await urlSubmit(page).click();
  await expect(sidebar(page)).toContainText(/URL válida|URL inválida/i);
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  expect(requests.slice(baseline).filter(url => /not-a-url/.test(url))).toEqual([]);
  await expectNoModal(page);
});

test('URL keeps the authorized sidebar during fetch and uses the native CSV pipeline', async ({ page }) => {
  let finishFetch!: () => void;
  const remoteGate = new Promise<void>(resolve => { finishFetch = resolve; });
  const { requests } = await openMap(page, { remoteGate });
  await openData(page);
  await tab(page, 'URL').click();
  const remoteUrl = new URL('/__qa/add-data/remote.csv', page.url()).href;
  await sidebar(page).getByPlaceholder('Url', { exact: true }).fill(remoteUrl);
  try {
    await urlSubmit(page).click();
    await expect.poll(() => requests.filter(url => url === remoteUrl).length).toBe(1);
    await expect(sidebar(page)).toBeVisible();
    await expect(tab(page, 'URL')).toHaveAttribute('aria-selected', 'true');
    await expectNoModal(page);
  } finally {
    finishFetch();
  }
  await expectImported(page);
});

test('URL failure leaves a usable panel with visible error and no dataset', async ({ page }) => {
  await openMap(page, { remoteStatus: 503 });
  await openData(page);
  await tab(page, 'URL').click();
  await sidebar(page).getByPlaceholder('Url', { exact: true }).fill(new URL('/__qa/add-data/remote.csv', page.url()).href);
  await urlSubmit(page).click();
  await expect(sidebar(page)).toBeVisible();
  await expect(page.locator('.notification-item, #map-add-data-sidebar [role=alert]').first()).toBeVisible();
  await expect(urlSubmit(page)).toBeEnabled();
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  await expectNoModal(page);
});

test('dismissing a pending URL request never resurrects the data sidebar', async ({ page }) => {
  let finishFetch!: () => void;
  const remoteGate = new Promise<void>(resolve => { finishFetch = resolve; });
  const { requests } = await openMap(page, { remoteGate });
  await openData(page);
  await tab(page, 'URL').click();
  const remoteUrl = new URL('/__qa/add-data/remote.csv', page.url()).href;
  await sidebar(page).getByPlaceholder('Url', { exact: true }).fill(remoteUrl);
  try {
    await urlSubmit(page).click();
    await expect.poll(() => requests.filter(url => url === remoteUrl).length).toBe(1);
    await sidebar(page).getByRole('button', { name: 'Fechar painel', exact: true }).click();
    await expect(sidebar(page)).toBeHidden();
  } finally {
    finishFetch();
  }
  // Native Close dismisses the UI; it has never promised to abort ingestion.
  await expectImported(page);
  await openData(page);
  await expect(tab(page, 'Dados Maõno')).toHaveAttribute('aria-selected', 'true');
});

test('Tileset retains native validation and creates a real vector-tile dataset', async ({ page }, testInfo) => {
  const { writes } = await openMap(page);
  await openData(page);
  await tab(page, 'Tileset').click();
  const add = sidebar(page).getByRole('button', { name: /adicionar.*tileset|add.*tileset/i });
  await expect(add).toBeDisabled();
  const origin = new URL(page.url()).origin;
  await sidebar(page).locator('#tileset-name').fill('Tileset sintético QA');
  // Setting metadata first avoids the native form's speculative metadata URL.
  await sidebar(page).locator('#tile-metadata').fill(`${origin}/__qa/add-data/tiles/metadata.json`);
  await sidebar(page).locator('#tile-url').fill(`${origin}/__qa/add-data/tiles/{z}/{x}/{y}.pbf`);
  await expect(add).toBeEnabled();
  await expect(sidebar(page).locator('#json-pretty')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('add-data-tileset.png') });
  await add.click();
  await expectImported(page);
  await expect.poll(async () => (await capture(page)).raw.layerTypes).toContain('vectorTile');
  expect(writes).toEqual([]);
});

test('importData denial hides both import entrypoints even when createLayer is allowed', async ({ page }) => {
  await openMap(page, { importData: false });
  await expect(openButton(page)).toHaveCount(0);
  await rail(page).getByRole('button', { name: 'Camadas', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar camada', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Importar novo dado', exact: true })).toHaveCount(0);
  await expect(sidebar(page)).toHaveCount(0);
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  await expect(page.locator('.ReactModal__Overlay, .modal--wrapper')).toHaveCount(0);
});


test('Database toggles the same panel off and reopens on Dados Maõno', async ({ page }) => {
  await openMap(page);
  const before = await geometry(page);
  const url = page.url();
  for (let cycle = 0; cycle < 2; cycle++) {
    await openData(page);
    await expect(openButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(openButton(page)).toHaveClass(/is-active/);
    await tab(page, 'Arquivos').click();
    await openButton(page).click();
    await expect(sidebar(page)).toBeHidden();
    await expect(openButton(page)).toHaveAttribute('aria-expanded', 'false');
    await expectStableCanvas(page, before);
    expect(page.url()).toBe(url);
  }
});
