import { expect, test, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { canvasGeometry, expectStableCanvas, openLayers, openMap, panel, rows, saveMap } from './fixtures/map-panel-minimal';

// Built React/Kepler and real PNG/network bytes; domain accounts/storage remain synthetic.
test.setTimeout(90_000);

async function attachPng(testInfo: TestInfo, name: string, bytes: Buffer) {
  const path = testInfo.outputPath(name);
  await writeFile(path, bytes);
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('explicit map save publishes a PNG bound to the exact JSON receipt without reloading the editor', async ({ page }, testInfo) => {
  const fixture = await openMap(page, { layerCount: 1 });
  await openLayers(page);
  const canvas = await canvasGeometry(page, true), loads = fixture.configLoads;
  const saved = await saveMap(page, fixture);
  await expect.poll(() => fixture.previews.uploads.length, { timeout: 20_000 }).toBe(1);
  const preview = fixture.previews.uploads[0];
  expect(preview.manifest.saveOperationId).toBe(saved.operationId);
  expect(preview.manifest.revision).toBe(2);
  expect(preview.manifest.configChecksum).toBe(fixture.manifests[0].contentHash);
  expect(preview.receipt.imageChecksum).toBe(preview.manifest.imageChecksum);
  expect(preview.bytes.length).toBe(preview.manifest.sizeBytes);
  await attachPng(testInfo, 'published-preview.png', preview.bytes);
  await attachPng(testInfo, 'mounted-map.png', await page.locator('.maono-kepler-viewport').screenshot());
  await expect(panel(page).locator('.maono-layer-panel__save-message')).toContainText('Projeto salvo.');
  expect(fixture.saves).toHaveLength(1);
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.configLoads).toBe(loads);
  await expectStableCanvas(page, canvas);
});

test('a failed PNG upload preserves the confirmed map receipt and live editor', async ({ page }) => {
  const fixture = await openMap(page, { layerCount: 1 });
  fixture.previews.rejectUploads(503);
  await openLayers(page);
  const canvas = await canvasGeometry(page, true), loads = fixture.configLoads;
  const saved = await saveMap(page, fixture);
  await expect.poll(() => fixture.previews.attempts, { timeout: 20_000 }).toBeGreaterThan(0);
  // The client must observe 503 and query the same operation before assertions.
  await expect.poll(() => fixture.previews.checks.some(check => check.attempts > 0)).toBe(true);
  expect(fixture.operationState(saved.operationId)).toBe('PUBLISHED');
  expect(fixture.revision).toBe(2);
  expect(fixture.saves).toHaveLength(1);
  expect(fixture.previews.uploads).toEqual([]);
  await expect(panel(page).locator('.maono-layer-panel__save-button')).toBeEnabled();
  await expect(panel(page).locator('.maono-layer-panel__save-message')).toContainText('Projeto salvo.');
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.configLoads).toBe(loads);
  await expectStableCanvas(page, canvas);
});

test('a clustering-only edit publishes the new policy and a changed PNG without moving the camera or replacing data', async ({ page }, testInfo) => {
  const fixture = await openMap(page, { layerCount: 1 });
  await openLayers(page);
  await rows(page).first().locator('.maono-layer-row__open').click();
  const detail = panel(page).locator('.maono-detail-view').filter({ has: page.locator('.maono-layer-style-editor') });
  await detail.locator('summary').filter({ hasText: 'Dimensão e agrupamento' }).click();
  const grouping = detail.getByRole('region', { name: 'Agrupamento espacial', exact: true });
  const enabled = grouping.locator('.maono-point-spatial-grouping__switch input');
  await expect(enabled).not.toBeChecked();
  const original = await saveMap(page, fixture);
  await expect.poll(() => fixture.previews.uploads.length, { timeout: 20_000 }).toBe(1);
  const before = fixture.previews.uploads[0];
  const canvas = await canvasGeometry(page, true), loads = fixture.configLoads;

  await grouping.locator('.maono-point-spatial-grouping__switch').click();
  await expect(enabled).toBeChecked();
  await grouping.getByRole('spinbutton', { name: 'Exibir pontos a partir do zoom', exact: true }).fill('24');
  await grouping.getByRole('spinbutton', { name: 'Tamanho do agrupamento', exact: true }).fill('120');
  // Use the public controls and save immediately. A separate deterministic
  // renderer regression holds the old Deck frame across this extension edit.
  const saved = await saveMap(page, fixture);
  await expect.poll(() => fixture.previews.uploads.length, { timeout: 20_000 }).toBe(2);
  const after = fixture.previews.uploads[1];
  expect(saved.config.maono.pointClustering.layers['qa-layer-0']).toMatchObject({ enabled: true, clusterMaxZoom: 24, clusterSize: 120 });
  expect(saved.config.config).toEqual(original.config.config);
  expect(saved.config.datasets).toEqual(original.config.datasets);
  expect(after.manifest.saveOperationId).toBe(saved.operationId);
  expect(after.manifest.revision).toBe(3);
  expect(after.manifest.configChecksum).toBe(fixture.manifests[1].contentHash);
  expect(after.manifest.editGeneration).toBeGreaterThan(before.manifest.editGeneration);
  expect(after.receipt.imageChecksum).not.toBe(before.receipt.imageChecksum);
  expect(after.bytes).not.toEqual(before.bytes);
  const changedPixels = await page.evaluate(async images => {
    const decode = async (bytes: number[]) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      try {
        const image = new Image();
        const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Synthetic PNG failed to decode')); });
        image.src = url;
        await loaded;
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return { width: canvas.width, height: canvas.height, rgba: context.getImageData(0, 0, canvas.width, canvas.height).data };
      } finally { URL.revokeObjectURL(url); }
    };
    const before = await decode(images.before), after = await decode(images.after);
    if (before.width !== after.width || before.height !== after.height) throw new Error('Synthetic preview dimensions changed');
    let changed = 0;
    for (let offset = 0; offset < before.rgba.length; offset += 4) {
      if ([0, 1, 2, 3].some(channel => before.rgba[offset + channel] !== after.rgba[offset + channel])) changed++;
    }
    return changed;
  }, { before: Array.from(before.bytes), after: Array.from(after.bytes) });
  expect(changedPixels).toBeGreaterThan(0);
  await attachPng(testInfo, 'ungrouped-preview.png', before.bytes);
  await attachPng(testInfo, 'grouped-preview.png', after.bytes);
  await expect(panel(page).locator('.maono-layer-panel__save-footer')).toHaveAttribute('data-preview-state', 'READY');
  await expect(panel(page).locator('.maono-layer-panel__save-message')).toHaveText('Projeto salvo.');
  expect(fixture.configLoads).toBe(loads);
  await expectStableCanvas(page, canvas);
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('preview replacement fences old uploads while historical receipts retain the original PNG', async ({ page }) => {
  const fixture = await openMap(page, { layerCount: 1 });
  await openLayers(page);
  await saveMap(page, fixture);
  await expect.poll(() => fixture.previews.uploads.length, { timeout: 20_000 }).toBe(1);
  const original = fixture.previews.uploads[0];
  const request = async (method: string, suffix = '', body?: unknown, bytes?: number[]) => page.evaluate(async input => {
    const response = await fetch(`/api/projects/panel-synthetic/thumbnail${input.suffix}`, {
      method: input.method,
      headers: input.bytes ? { 'Content-Type': 'image/png' } : input.body ? { 'Content-Type': 'application/json' } : undefined,
      body: input.bytes ? new Blob([new Uint8Array(input.bytes)], { type: 'image/png' }) : input.body ? JSON.stringify(input.body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }, { method, suffix, body, bytes });
  const replacement = { ...original.manifest, operationId: `pv2:${randomUUID()}` };
  expect((await request('POST', '', replacement)).status).toBe(201);
  const display = (await request('GET', '/status')).data;
  expect(display).toMatchObject({ thumbnailStatus: 'READY', jobState: 'WAITING_CAPTURE', artifactId: original.receipt.artifactId });
  const newer = { ...replacement, operationId: `pv2:${randomUUID()}` };
  expect((await request('POST', '', newer)).status).toBe(201);
  const superseded = await request('PUT', `?operationId=${encodeURIComponent(replacement.operationId)}`, undefined, Array.from(original.bytes));
  expect(superseded.status).toBe(409);
  expect(superseded.data.operation.state).toBe('SUPERSEDED');
  const release = fixture.previews.holdNextUpload();
  const first = request('PUT', `?operationId=${encodeURIComponent(newer.operationId)}`, undefined, Array.from(original.bytes));
  try {
    await expect.poll(() => fixture.previews.operationState(newer.operationId)).toBe('RECEIVING');
    const repeated = await request('PUT', `?operationId=${encodeURIComponent(newer.operationId)}`, undefined, Array.from(original.bytes));
    expect(repeated.status).toBe(409);
    expect(repeated.data.error.code).toBe('PROJECT_PREVIEW_UPLOAD_BUSY');
  } finally { release(); }
  expect((await first).status).toBe(200);
  expect(fixture.previews.uploads.filter(value => value.manifest.operationId === newer.operationId)).toHaveLength(1);
  const replay = await request('PUT', `?operationId=${encodeURIComponent(original.manifest.operationId)}`, undefined, Array.from(original.bytes));
  expect(replay.status).toBe(200);
  expect(replay.data.operation.receipt).toEqual(original.receipt);
  const historicalBytes = await page.evaluate(async artifactId => {
    const response = await fetch(`/api/projects/panel-synthetic/thumbnail?artifactId=${encodeURIComponent(artifactId)}`);
    if (!response.ok) throw new Error('Historical synthetic PNG was not available');
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }, original.receipt.artifactId);
  expect(Buffer.from(historicalBytes)).toEqual(original.bytes);
  expect(fixture.previews.uploads).toHaveLength(2);
  await saveMap(page, fixture);
  const stale = { ...replacement, operationId: `pv2:${randomUUID()}` };
  const rejected = await request('POST', '', stale);
  expect(rejected.status).toBe(409);
  expect(rejected.data.error.code).toBe('PROJECT_PREVIEW_SUPERSEDED');
  expect(fixture.previews.manifests.some(value => value.operationId === stale.operationId)).toBe(false);
  expect(fixture.revision).toBe(3);
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('a late historical PNG receipt cannot replace the newer save confirmation in the same edit generation', async ({ page }) => {
  const fixture = await openMap(page, { layerCount: 1 });
  await openLayers(page);
  const release = fixture.previews.holdNextReadyStatus();
  let firstPreviewId = '';
  try {
    await saveMap(page, fixture);
    await expect.poll(() => fixture.previews.heldReadyStatuses.length, { timeout: 20_000 }).toBe(1);
    firstPreviewId = fixture.previews.heldReadyStatuses[0];
    await saveMap(page, fixture);
    await expect.poll(() => fixture.previews.uploads.length, { timeout: 20_000 }).toBe(2);
    expect(fixture.previews.uploads[0].manifest.editGeneration).toBe(fixture.previews.uploads[1].manifest.editGeneration);
    await expect(panel(page).locator('.maono-layer-panel__save-footer')).toHaveAttribute('data-preview-state', 'READY');
  await expect(panel(page).locator('.maono-layer-panel__save-message')).toHaveText('Projeto salvo.');
  } finally { release(); }
  // Wait until A's real status response has been processed and its local spool
  // removed, then let React paint its callback. Merely releasing HTTP is too early.
  await expect.poll(() => page.evaluate(async operationId => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open('maono-project-preview-spool');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('previews');
      const request = tx.objectStore('previews').getAll();
      tx.oncomplete = () => { db.close(); resolve(!request.result.some(row => row.manifest.operationId === operationId)); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), firstPreviewId)).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(panel(page).locator('.maono-layer-panel__save-footer')).toHaveAttribute('data-preview-state', 'READY');
  await expect(panel(page).locator('.maono-layer-panel__save-message')).toHaveText('Projeto salvo.');
  expect(fixture.revision).toBe(3);
  expect(fixture.saves).toHaveLength(2);
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
