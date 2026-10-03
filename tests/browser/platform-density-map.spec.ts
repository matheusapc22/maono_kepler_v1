import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Real app route + Kepler runtime with synthetic APIs and a local empty style.
// This is geometry/accessibility coverage, not authenticated backend acceptance.
const style = JSON.parse(readFileSync(new URL('./fixtures/map-fidelity-style.json', import.meta.url), 'utf8'));
test.use({ reducedMotion: 'reduce' });

const organization = { id: 1, name: 'Organização de demonstração', slug: 'fixture', active: true };
async function openMap(page: Page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/session') return route.fulfill({ json: {
      authenticated: true, user: { id: 1, name: 'Operador de demonstração', email: 'qa@example.test', role: 'super_admin', activeOrganizationId: 1 },
      organizations: [organization], activeOrganization: organization, projects: [],
    } });
    if (url.pathname === '/api/maps/new/context') return route.fulfill({ json: { ok: true, context: {
      policyVersion: 1, requestedMode: 'create', mode: 'create', assignedMode: 'create', defaultPanel: 'create', allowed: true,
      project: null, organization, availablePanels: { viewer: false, editor: false, create: true },
      capabilities: { openCreateWorkspace: true, createProject: true, initializeMap: true, saveMap: true, viewMap: true, openLayerPanel: true, viewLayers: true, viewFilters: true, editLayers: true, editStyle: true, manageFilters: true, placeAnalysisMarker: true, toggleLegend: true },
      features: { mapPanelModes: true, mapCreateRoute: true, maonoMapShell: true, maonoLayerManager: true, maonoMapOverlay: true },
    } } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, items: [], projects: [] } });
    if (url.href.includes('svg-icons.json')) return route.fulfill({ json: { svgIcons: [] } });
    if ((url.hostname === 'basemaps.cartocdn.com' && /^\/gl\/[^/]+\/style\.json$/.test(url.pathname)) || (url.hostname === 'api.mapbox.com' && /^\/styles\/v1\//.test(url.pathname))) return route.fulfill({ json: style });
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  await page.goto('/maps/new/create?maonoLayoutDebug=1');
  await expect(page.locator('.maono-map-runtime')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.maono-map-sidebar').getByRole('button', { name: 'Camadas', exact: true })).toBeEnabled();
  await expect(page.locator('.maono-kepler-viewport')).toBeVisible();
  await expect(page.locator('.maono-map-runtime')).toHaveAttribute('data-map-ready', 'true');
  await expect.poll(() => page.evaluate(() => {
    const debug = (window as Window & { __MAONO_MAP_LAYOUT_DEBUG__?: { capture: (reason: string) => { check: { styleLoaded: boolean; validCanvasCount: number; contextAvailable: boolean } } } }).__MAONO_MAP_LAYOUT_DEBUG__;
    const check = debug?.capture('density-readiness').check;
    return Boolean(check?.styleLoaded && check.validCanvasCount > 0 && check.contextAvailable);
  }), { message: 'real WebGL canvas has nonzero dimensions and loaded local style' }).toBe(true);
}
async function geometry(page: Page) {
  return page.locator('.maono-kepler-viewport').evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const canvasRects = Array.from(element.querySelectorAll<HTMLCanvasElement>('canvas')).map(canvas => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, internalWidth: canvas.width, internalHeight: canvas.height };
    });
    return { x, y, width, height, canvasRects };
  });
}
async function expectInvariant(page: Page, before: Awaited<ReturnType<typeof geometry>>) {
  const after = await geometry(page);
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(before[key] - after[key]), key).toBeLessThanOrEqual(1);
  expect(after.canvasRects).toHaveLength(before.canvasRects.length);
  expect(before.canvasRects.length).toBeGreaterThan(0);
  for (const [index, canvas] of before.canvasRects.entries()) {
    for (const key of ['x', 'y', 'width', 'height', 'internalWidth', 'internalHeight'] as const) {
      expect(Math.abs(canvas[key] - after.canvasRects[index][key]), `canvas ${index} ${key}`).toBeLessThanOrEqual(1);
    }
  }
}

for (const viewport of [
  { width: 1440, height: 900 }, { width: 1280, height: 720 },
  { width: 1021, height: 768 }, { width: 1020, height: 768 },
  { width: 821, height: 768 }, { width: 820, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`compact map: stable canvas and reachable panels at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openMap(page);
    const rail = page.locator('.maono-map-sidebar');
    const before = await geometry(page);
    const overlayButton = page.locator('.maono-map-overlay__buttons > button').first();
    await expect(overlayButton).toBeVisible();
    await expect(overlayButton).toHaveCSS('width', viewport.width > 820 ? '40px' : '44px');
    expect(before.width).toBeGreaterThan(250);
    expect(before.height).toBeGreaterThan(300);
    if (viewport.width > 820) await expect(rail).toHaveCSS('width', '64px');
    else {
      await expect(rail).toHaveCSS('height', '64px');
      const button = await rail.getByRole('button', { name: 'Camadas', exact: true }).boundingBox();
      expect(button!.width).toBeGreaterThanOrEqual(44);
      expect(button!.height).toBeGreaterThanOrEqual(44);
    }
    for (let cycle = 0; cycle < 2; cycle++) {
      await rail.getByRole('button', { name: 'Camadas', exact: true }).click();
      await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'true');
      await expectInvariant(page, before);
      const panel = page.locator('.maono-map-panel-host__panel');
      await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
      const box = await panel.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      if (viewport.width > 820) await expect(panel).toHaveCSS('width', '408px');
      await page.locator('.maono-layer-panel__tabs').getByRole('tab', { name: /Filtros/ }).click();
      await expectInvariant(page, before);
      await page.keyboard.press('Escape');
      await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'false');
      await expectInvariant(page, before);
    }
    await rail.getByRole('button', { name: 'Mapa base', exact: true }).click();
    await expect(page.locator('.maono-basemap-panel')).toBeVisible();
    await expectInvariant(page, before);
    await page.screenshot({ path: testInfo.outputPath('compact-map-basemap.png') });
    await page.keyboard.press('Escape');
    await expectInvariant(page, before);
    const account = page.locator('.maono-map-topbar__account-trigger');
    await account.click();
    await expect(page.locator('.maono-map-topbar__account-menu')).toBeVisible();
    const menu = await page.locator('.maono-map-topbar__account-menu').boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.maono-map-topbar__account-menu')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('compact-map-collapsed.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await testInfo.attach('canvas-geometry', { body: JSON.stringify({ viewport, before, after: await geometry(page) }), contentType: 'application/json' });
  });
}
