import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Test-only transport fixtures. The application, CSV parser, reducer, selectors,
// filter controls, serializer, save bridge and hydrator are never replaced.
// No production hostname, session, credentials or data is used.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/maps/golden/${name}.kepler.json`, import.meta.url), 'utf8'));
const style = JSON.parse(readFileSync(new URL('./map-fidelity-style.json', import.meta.url), 'utf8'));
export const PROJECT_SLUG = 'panel-synthetic';
export const PROJECT_NAME = 'Mapa de teste';
export const ORGANIZATION_NAME = 'Organização sintética QA';
const projectPath = `/api/projects/${PROJECT_SLUG}`;
const organization = { id: 1, name: ORGANIZATION_NAME, slug: 'qa-panel', active: true };
export const CSV_ROWS = [
  ['Linha 1', -23.551, -46.631, 'A', 10, '2026-01-01T12:00:00Z', true],
  ['Linha 2', -23.552, -46.632, 'A', 20, '2026-01-02T12:00:00Z', false],
  ['Linha 3', -23.553, -46.633, 'A', 30, '2026-01-03T12:00:00Z', true],
  ['Linha 4', -23.554, -46.634, 'B', 40, '2026-01-04T12:00:00Z', false],
  ['Linha 5', -23.555, -46.635, 'B', 50, '2026-01-05T12:00:00Z', true],
  ['Linha 6', -23.556, -46.636, 'C', 60, '2026-01-06T12:00:00Z', false],
];
export const CSV = ['name,latitude,longitude,category,value,observed_at,eligible', ...CSV_ROWS.map(row => row.join(','))].join('\n');
export type SavedConfig = Record<string, any>;
export type SaveRequest = { config: SavedConfig; expectedConfigRevision: number; [key: string]: any };
type Capture = { raw: { datasetIds: string[]; layerIds: string[]; filterTypes: string[] }; snapshot: { filterIds: string[]; hasUnsavedChanges: boolean } };
type QAWindow = Window & {
  __MAONO_ENGINE_DEBUG__?: { capture(label: string): Capture };
  __MAONO_MAP_LAYOUT_DEBUG__?: { capture(label: string): { check: { styleLoaded: boolean; validCanvasCount: number; contextAvailable: boolean } } };
  __PANEL_QA_CANVASES__?: HTMLCanvasElement[];
};

export function seedConfig(layerCount = 0, groups = false): SavedConfig {
  if (!layerCount) return fixture('map-empty');
  const saved = fixture('map-point-basic');
  const template = saved.config.visState.layers[0];
  const dataset = saved.datasets[0];
  saved.datasets = groups ? Array.from({ length: layerCount }, (_, index) => ({
    ...structuredClone(dataset), data: { ...structuredClone(dataset.data), id: `qa-data-${index}`, label: `Dados ${index + 1}` },
  })) : [dataset];
  saved.config.visState.layers = Array.from({ length: layerCount }, (_, index) => ({
    ...structuredClone(template), id: `qa-layer-${index}`, config: {
      ...structuredClone(template.config), label: `Camada ${String(index + 1).padStart(2, '0')}`,
      dataId: groups ? `qa-data-${index}` : dataset.data.id,
      color: index % 2 ? [50, 140, 200] : [197, 160, 89],
    },
  }));
  saved.config.visState.layerOrder = saved.config.visState.layers.map((layer: any) => layer.id);
  saved.config.visState.filters = groups ? saved.datasets.map((entry: any, index: number) => ({
    id: `qa-filter-${index}`, dataId: [entry.data.id], name: ['name'], type: 'multiSelect', value: [],
    enlarged: false, plotType: 'histogram', animationWindow: 'free', yAxis: null, speed: 1,
  })) : [];
  return saved;
}

export async function installPanelFixture(page: Page, options: { layerCount?: number; groups?: boolean; create?: boolean; viewer?: boolean } = {}) {
  let saved = seedConfig(options.layerCount, options.groups);
  let revision = 1;
  let saveStatus = 200;
  let nextSaveGate: Promise<void> | undefined;
  const saves: SaveRequest[] = [];
  const unexpectedWrites: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === '/api/session') return route.fulfill({ json: {
      authenticated: true, user: { id: 1, name: 'Operador sintético QA', email: 'panel@example.test', role: 'super_admin', activeOrganizationId: 1 },
      organizations: [organization], activeOrganization: organization,
      projects: [{ id: 1, slug: PROJECT_SLUG, name: PROJECT_NAME, organizationId: 1 }],
    } });
    if (url.pathname === `${projectPath}/map-navigation` || url.pathname === '/api/maps/new/context') {
      const mode = options.create ? 'create' : options.viewer ? 'viewer' : 'editor';
      return route.fulfill({ json: { ok: true, context: {
        policyVersion: 1, requestedMode: mode, mode, assignedMode: options.create ? null : mode, defaultPanel: mode, allowed: true, version: revision,
        project: options.create ? null : { id: 1, slug: PROJECT_SLUG, name: PROJECT_NAME, configRevision: revision, accessLevel: 'owner' },
        organization, availablePanels: { viewer: true, editor: !options.viewer, create: !options.viewer },
        capabilities: {
          viewMap: true, openLayerPanel: true, viewLayers: true, viewFilters: true, inspectLayer: true,
          ...(!options.viewer ? {
            openCreateWorkspace: true, createProject: true, initializeMap: true, saveMap: true,
            editLayers: true, editStyle: true, editLayerStyle: true, manageFilters: true, editFilters: true,
            createLayer: true, removeLayer: true, duplicateLayer: true, reorderLayers: true, toggleLayerVisibility: true,
            placeAnalysisMarker: true, toggleLegend: true, configureTooltips: true, addData: true, importData: true,
          } : {}),
        },
        limits: { projects: { used: 1, limit: 20, remaining: 19 }, storageMb: { used: 2, limit: 100, remaining: 98 } },
        features: { mapPanelModes: true, mapCreateRoute: true, maonoMapShell: true, maonoLayerManager: true, maonoMapOverlay: true },
      } } });
    }
    if (url.pathname === `${projectPath}/config-stream`) {
      const bytes = Buffer.byteLength(JSON.stringify(saved));
      return route.fulfill({ headers: { 'X-Maono-Config-Transport': 'direct', 'X-Maono-Config-Revision': String(revision) }, json: {
        downloadUrl: `https://panel-fixture.example.test/config-${revision}.json`, projectId: 1, revision, sizeBytes: bytes,
      } });
    }
    if (url.hostname === 'panel-fixture.example.test') return route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify(saved),
    });
    if (url.pathname === `${projectPath}/config` && method === 'PUT') {
      const body = request.postDataJSON() as SaveRequest;
      saves.push(body);
      const gate = nextSaveGate;
      nextSaveGate = undefined;
      if (gate) await gate;
      if (saveStatus !== 200) return route.fulfill({ status: saveStatus, json: { ok: false, error: {
        code: 'PROJECT_VERSION_CONFLICT', category: 'CONFLICT', retryable: false, message: 'A revisão sintética mudou. Recarregue antes de salvar.',
      } } });
      saved = structuredClone(body.config);
      revision += 1;
      return route.fulfill({ json: { ok: true, configRevision: revision, project: { id: 1, slug: PROJECT_SLUG, configRevision: revision } } });
    }
    if (url.pathname.startsWith(`${projectPath}/thumbnail`)) return route.fulfill({ json: {
      ok: true, status: 'READY', thumbnailStatus: 'READY', revision, configRevision: revision, thumbnailRevision: revision, thumbnailAttempts: 1,
    } });
    if (url.pathname === '/api/observability/map-load' && method === 'POST') return route.fulfill({ json: { ok: true } });
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      unexpectedWrites.push(`${method} ${url.pathname}`);
      return route.fulfill({ status: 405, json: { ok: false, error: 'Unexpected synthetic mutation' } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, items: [], projects: [] } });
    if (url.href.includes('svg-icons.json')) return route.fulfill({ json: { svgIcons: [] } });
    if ((url.hostname === 'basemaps.cartocdn.com' && /^\/gl\/[^/]+\/style\.json$/.test(url.pathname)) ||
        (url.hostname === 'api.mapbox.com' && /^\/styles\/v1\//.test(url.pathname))) return route.fulfill({ json: style });
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  return {
    saves, unexpectedWrites, errors,
    path: options.create ? '/maps/new/create' : `/projects/${PROJECT_SLUG}/${options.viewer ? 'view' : 'edit'}`,
    rejectSaves(status = 409) { saveStatus = status; },
    holdNextSave() {
      let release!: () => void;
      nextSaveGate = new Promise<void>(resolve => { release = resolve; });
      return release;
    },
  };
}

export async function ready(page: Page) {
  await expect(page.locator('.maono-map-runtime')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 });
  await expect(page.locator('.maono-map-runtime')).toHaveAttribute('data-map-loading', 'false', { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => {
    const runtime = window as QAWindow;
    const check = runtime.__MAONO_MAP_LAYOUT_DEBUG__?.capture('minimal-panel-ready').check;
    return Boolean(check?.styleLoaded && check.validCanvasCount > 0 && check.contextAvailable && runtime.__MAONO_ENGINE_DEBUG__);
  })).toBe(true);
}
export async function openMap(page: Page, options: Parameters<typeof installPanelFixture>[1] = {}) {
  const fixture = await installPanelFixture(page, options);
  await page.goto(`${fixture.path}?maonoLayoutDebug=1&maonoEngineDebug=1`);
  await ready(page);
  return fixture;
}
export const panel = (page: Page) => page.locator('#maono-map-engine-panel');
export const rail = (page: Page) => page.locator('.maono-map-sidebar');
export const rows = (page: Page) => panel(page).locator('.maono-layer-row');
export const filterEditor = (page: Page) => panel(page).locator('.maono-filter-detail--inline');
export async function openLayers(page: Page) {
  if (await page.locator('.maono-map-panel-host').getAttribute('data-panel-open') !== 'true' ||
      await page.locator('.maono-map-panel-host').getAttribute('data-active-panel') !== 'layers') {
    await rail(page).getByRole('button', { name: 'Camadas', exact: true }).click();
  }
  await panel(page).getByRole('tab', { name: /^Camadas/ }).click();
  await expect(panel(page)).toBeVisible();
}
export async function openFilters(page: Page) {
  await openLayers(page);
  await panel(page).getByRole('tab', { name: /^Filtros/ }).click();
}
export async function capture(page: Page) {
  return page.evaluate(() => {
    const debug = (window as QAWindow).__MAONO_ENGINE_DEBUG__;
    if (!debug) throw new Error('The native engine debug metadata is unavailable');
    return debug.capture('minimal-panel-assertion');
  });
}
export async function importCsv(page: Page, name = 'panel-native.csv', csv = CSV) {
  const initial = (await capture(page)).raw.datasetIds.length;
  await rail(page).getByRole('button', { name: 'Adicionar dados', exact: true }).click();
  const sidebar = page.locator('#map-add-data-sidebar');
  await sidebar.getByRole('tab', { name: 'Arquivos', exact: true }).click();
  await sidebar.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect.poll(async () => (await capture(page)).raw.datasetIds.length).toBe(initial + 1);
  await expect(sidebar).toBeHidden();
}
export function savedVisState(save: SaveRequest) {
  return save.config.config?.config?.visState ?? save.config.config?.visState;
}
export async function saveMap(page: Page, fixture: Awaited<ReturnType<typeof installPanelFixture>>) {
  const count = fixture.saves.length;
  const button = panel(page).locator('.maono-layer-panel__save-button');
  const activeTab = await panel(page).getAttribute('data-active-tab');
  const editor = filterEditor(page);
  const filterField = await editor.count() ? await editor.getByRole('combobox', { name: 'Propriedade', exact: true }).inputValue() : null;
  const filterGroup = filterField ? await editor.evaluate(element => element.closest('.maono-filter-group')?.querySelector('.maono-filter-group__toggle strong')?.textContent ?? '') : null;
  const layerTitle = panel(page).locator('.maono-detail-view:not(.maono-filter-detail) .maono-detail-view__identity > strong');
  const layerName = await layerTitle.count() ? await layerTitle.innerText() : null;
  const openSections = await panel(page).locator('.maono-detail-view details[open] > summary strong').allTextContents();
  await expect(button).toBeEnabled();
  const committed = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `${projectPath}/config`);
  const rehydrated = page.waitForResponse(response => new URL(response.url()).pathname === `${projectPath}/config-stream`);
  await button.click();
  await expect.poll(() => fixture.saves.length).toBe(count + 1);
  expect((await committed).status()).toBe(200);
  await rehydrated;
  await ready(page);
  // Successful save increments context.version and rehydrates/remounts the map
  // in the baseline application as well. Verify committed state, then reopen
  // the previous editor using its real UI; do not fake a stable revision or
  // require a transient local toast to survive that existing remount.
  if (activeTab === 'filters') {
    await openFilters(page);
    if (filterField && filterGroup) {
      await panel(page).getByRole('button', { name: filterGroup, exact: true }).click();
      const exactField = new RegExp(`^${filterField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      await panel(page).locator('.maono-filter-row__open').filter({ has: page.locator('strong', { hasText: exactField }) }).click();
      await expect(editor).toBeVisible();
    }
  } else {
    await openLayers(page);
    if (layerName) {
      await panel(page).getByTitle(`Configurar ${layerName}`, { exact: true }).click();
      for (const title of openSections) await panel(page).locator('summary').filter({ hasText: title }).click();
    }
  }
  await expect(button).toBeEnabled();
  return fixture.saves.at(-1)!;
}
export async function canvasGeometry(page: Page, remember = false) {
  return page.locator('.maono-kepler-viewport').evaluate((element, shouldRemember) => {
    const canvases = Array.from(element.querySelectorAll<HTMLCanvasElement>('canvas'));
    if (shouldRemember) (window as QAWindow).__PANEL_QA_CANVASES__ = canvases;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, canvases: canvases.map(canvas => {
      const box = canvas.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, internalWidth: canvas.width, internalHeight: canvas.height };
    }) };
  }, remember);
}
export async function expectStableCanvas(page: Page, before: Awaited<ReturnType<typeof canvasGeometry>>) {
  const after = await canvasGeometry(page);
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(before[key] - after[key]), `viewport ${key}`).toBeLessThanOrEqual(1);
  expect(after.canvases).toEqual(before.canvases);
  expect(await page.evaluate(() => {
    const before = (window as QAWindow).__PANEL_QA_CANVASES__ ?? [];
    const after = Array.from(document.querySelectorAll('.maono-kepler-viewport canvas'));
    return before.length > 0 && before.length === after.length && before.every((canvas, i) => canvas === after[i] && canvas.isConnected);
  }), 'the same live map canvases survive panel interactions').toBe(true);
}
