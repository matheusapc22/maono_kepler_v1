import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEFAULT_MAP_STYLES } from '@kepler.gl/constants';
import { getBaseMapLibrary } from '@kepler.gl/utils/dist/map-style-utils/mapbox-utils.js';
import { installPanelFixture, openLayers } from './fixtures/map-panel-minimal';
import { saveAndCapture, readPngEvidence, verifyNegativePreviewCases, installBrowserWriteGuard } from '../../scripts/acceptance/preview-browser.mjs';
import { verifyOwnedProjectEditorAccess } from '../../scripts/acceptance/suites/durable-project-preview.mjs';

const require = createRequire(import.meta.url);

// Exercise the selected real SDKs with a source-bearing offline style. Every
// request is fulfilled locally or aborted; no provider receives data or a token.
// The integrated fixture below still covers React/Kepler and actual PNG capture.
test('registered basemap selects MapLibre and Mapbox startup remains blocked by the write guard', async ({ browser }) => {
  const seed = JSON.parse(readFileSync(new URL('../../scripts/acceptance/fixtures/preview-points.kepler.json', import.meta.url), 'utf8'));
  const registeredStyle = DEFAULT_MAP_STYLES.find(style => style.id === seed.config.mapStyle.styleType)!;
  expect(registeredStyle.id).toBe('dark-matter');
  expect(getBaseMapLibrary(registeredStyle)).toBe('maplibre');
  for (const styleType of ['dark', registeredStyle.id]) {
    const library = getBaseMapLibrary(DEFAULT_MAP_STYLES.find(style => style.id === styleType)!);
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      const unexpectedFallback: string[] = [], writes: string[] = [];
      const base = 'http://127.0.0.1:4187';
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === base && url.pathname === '/__sdk_startup__') return route.fulfill({ contentType: 'text/html',
          body: '<html><body><div id="map" style="height:540px;width:960px"></div></body></html>' });
        if (url.origin === base && url.pathname.endsWith('.pbf') && route.request().method() === 'GET') {
          return route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
        }
        unexpectedFallback.push(`${route.request().method()} ${url.origin}${url.pathname}`);
        return route.abort();
      });
      page.on('request', request => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          const url = new URL(request.url());
          writes.push(`${request.method()} ${url.origin}${url.pathname}`);
        }
      });
      const guard = await installBrowserWriteGuard(page, { baseUrl: base, assertAdmission() {} }, { slug: 'sdk-synthetic' });
      await page.goto(`${base}/__sdk_startup__`);
      await page.addScriptTag({ path: require.resolve(`${library}-gl/dist/${library}-gl.js`) });
      const start = () => page.evaluate(async ({ library, seed, base }) => {
        const sdk = (window as any)[library === 'mapbox' ? 'mapboxgl' : 'maplibregl'];
        const points = seed.datasets[0].data.allData.map((row: any[]) => ({ type: 'Feature', properties: {},
          geometry: { type: 'Point', coordinates: row.slice(0, 2) } }));
        await new Promise<void>((resolve, reject) => {
          const map = new sdk.Map({ container: 'map', accessToken: 'pk.synthetic-local-only',
            center: [seed.config.mapState.longitude, seed.config.mapState.latitude], zoom: seed.config.mapState.zoom,
            style: { version: 8, sources: {
              basemap: { type: 'vector', tiles: [`${base}/tiles/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 0 },
              points: { type: 'geojson', data: { type: 'FeatureCollection', features: points } },
            }, layers: [
              { id: 'background', type: 'background', paint: { 'background-color': '#182029' } },
              { id: 'basemap', type: 'fill', source: 'basemap', 'source-layer': 'land', paint: { 'fill-color': '#182029' } },
              { id: 'points', type: 'circle', source: 'points', paint: { 'circle-color': '#ee22bb', 'circle-radius': 10 } },
            ] },
          });
          map.on('load', () => { (window as any).__SDK_STARTUP_MAP__ = map; resolve(); });
          map.on('error', (event: any) => reject(new Error(event.error?.message || 'Local SDK startup failed')));
        });
      }, { library, seed, base });
      if (library === 'mapbox') {
        await expect(guard.run(async () => {
          const telemetry = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).hostname === 'events.mapbox.com');
          await Promise.all([start(), telemetry]);
          // Request events precede route dispatch; wait for the actual denial.
          await expect.poll(() => { try { guard(); return false; } catch { return true; } }).toBe(true);
          guard();
        })).rejects.toMatchObject({ code: 'PNG_BROWSER_WRITE_OUT_OF_SCOPE',
          message: expect.stringContaining('method=POST; target=MAPBOX_TELEMETRY; reason=OUT_OF_SCOPE') });
        expect(writes).toContain('POST https://events.mapbox.com/events/v2');
      } else {
        await guard.run(start);
        expect(await page.evaluate(() => (window as any).__SDK_STARTUP_MAP__.getSource('points').serialize().data.features.length)).toBe(3);
        await expect.poll(() => page.evaluate(() => (window as any).__SDK_STARTUP_MAP__.queryRenderedFeatures({ layers: ['points'] }).length)).toBe(3);
        guard();
        expect(writes).toEqual([]);
      }
      expect(unexpectedFallback).toEqual([]);
    } finally { await context.close(); }
  }
});

// Exercise the exact production acceptance browser assertions with built
// React/Kepler and real browser PNG bytes. Accounts, backend and storage below
// are local HTTP fixtures: passing CI is NOT integrated Production evidence.
async function localScenario(page: Page) {
  const seed = JSON.parse(readFileSync(new URL('../../scripts/acceptance/fixtures/preview-points.kepler.json', import.meta.url), 'utf8'));
  const fixture = await installPanelFixture(page, { seed });
  const records: Record<string, unknown>[] = [];
  const ctx = { baseUrl: 'http://127.0.0.1:4187', organizationId: 1,
    assertAdmission() {}, requestTimeoutMs: (ms: number) => Math.min(ms, 30_000), pause: (ms: number) => page.waitForTimeout(Math.min(ms, 50)),
    record: (id: string, status: string, details: object) => records.push({ id, status, ...details }),
    api: async (_profile: string, path: string, options: any = {}) => page.evaluate(async ({ path, method, json, body, binary, headers }) => {
      const response = await fetch(path, { method: method || 'GET', headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: json ? JSON.stringify(json) : binary ? new Uint8Array(body) : body });
      return { status: response.status, body: await response.json() };
    }, { path, method: options.method, json: options.json, binary: Buffer.isBuffer(options.body), body: Buffer.isBuffer(options.body) ? Array.from(options.body) : options.body, headers: options.headers }),
  };
  const project = { id: 1, slug: 'panel-synthetic' };
  const checkGuard = await installBrowserWriteGuard(page, ctx, project);
  const open = async () => {
    await page.goto(fixture.path);
    await page.locator('.maono-map-runtime[data-map-ready="true"][data-map-loading="false"]').waitFor();
    await openLayers(page);
  };
  return { fixture, records, ctx, project, open, checkGuard };
}

test('registered PNG acceptance assertions observe capture, refresh, ordering and isolated failure', async ({ page }) => {
  const { fixture, records, ctx, project, open, checkGuard } = await localScenario(page);
  await open();
  const navigation = await ctx.api('creator', `/api/projects/${encodeURIComponent(project.slug)}/map-navigation?mode=editor`);
  expect(navigation.status).toBe(200);
  expect(navigation.body).not.toHaveProperty('context');
  verifyOwnedProjectEditorAccess(navigation.body, project, ctx.organizationId);
  const first = await saveAndCapture(page, ctx, project, 1);
  expect(first.image.fixtureColorPixels).toBeGreaterThanOrEqual(10);
  await open();
  expect((await readPngEvidence(page, ctx, project, first.receipt)).imageChecksum).toBe(first.receipt.imageChecksum);
  const second = await saveAndCapture(page, ctx, project, 2);
  expect(second.preview.editorSessionId).not.toBe(first.preview.editorSessionId);
  await verifyNegativePreviewCases(page, ctx, project, first, second);
  expect(records.map(row => row.id)).toEqual(['PNG-ORDER', 'PNG-FAILURE']);
  expect(fixture.revision).toBe(3);
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
  checkGuard();
});


test('invalid PNG cannot pass failure isolation when only the historical image remains readable', async ({ page }) => {
  const { fixture, records, ctx, project, open } = await localScenario(page);
  await open();
  const first = await saveAndCapture(page, ctx, project, 1);
  const second = await saveAndCapture(page, ctx, project, 2);
  let corruptReads = 0;
  await page.route('**/api/projects/panel-synthetic/thumbnail?*', async route => {
    const current = fixture.previews.uploads.at(-1);
    const pending = fixture.previews.manifests.at(-1);
    if (route.request().method() === 'GET' && fixture.previews.uploads.length === 3 &&
        pending && fixture.previews.operationState(pending.operationId) === 'FAILED_FINAL' &&
        new URL(route.request().url()).searchParams.get('artifactId') === current?.receipt.artifactId) {
      corruptReads++;
      return route.fulfill({ contentType: 'image/png', body: Buffer.from('synthetic-corrupt-current-fallback') });
    }
    return route.fallback();
  });
  await expect(verifyNegativePreviewCases(page, ctx, project, first, second)).rejects.toThrow();
  expect(corruptReads).toBe(1);
  expect(records.map(row => row.id)).toEqual(['PNG-ORDER']);
  // The old second capture still reads successfully. It cannot stand in for
  // proof of the current replacement artifact after the failure.
  expect((await readPngEvidence(page, ctx, project, second.receipt)).imageChecksum).toBe(second.receipt.imageChecksum);
});
