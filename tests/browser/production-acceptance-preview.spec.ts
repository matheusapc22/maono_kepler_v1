import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installPanelFixture, openLayers } from './fixtures/map-panel-minimal';
import { saveAndCapture, readPngEvidence, verifyNegativePreviewCases, installBrowserWriteGuard } from '../../scripts/acceptance/preview-browser.mjs';

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
