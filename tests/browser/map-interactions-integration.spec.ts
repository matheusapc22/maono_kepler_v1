import { expect, test } from '@playwright/test';
import { mapPixelDifference, mapColorPixelCounts, settledMapColor } from './fixtures/map-pixel-difference';
import { capture, filterEditor, openFilters, openLayers, openMap, panel, ready, rows, savedVisState, saveMap, seedConfig } from './fixtures/map-panel-minimal';

// Actual compiled map/reducer/filter/serializer. Only account/HTTP storage are
// synthetic; this is neither remote acceptance nor a simulated renderer.
test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });
test.setTimeout(90_000);
const mapClip = { x: 600, y: 80, width: 700, height: 700 };
const GOLD = [197, 160, 89], BLUE = [50, 140, 200];

test('Visual Maõno interactions: a log band preserves display width and filters the native map before pointerup', async ({ page }, testInfo) => {
  const seed = seedConfig(1);
  const data = seed.datasets[0].data;
  data.fields.push({ name: 'value', type: 'real', format: '', analyzerType: 'FLOAT' });
  data.allData = Array.from({ length: 32 }, (_, i) => [-47 + (i % 8) * .6, -22 + Math.floor(i / 8) * .8, `Ponto ${i}`, i + 1]);
  data.allData.push([-45, -20.5, 'Extremo', 1_000_000]);
  Object.assign(seed.config.visState.layers[0].config.visConfig, { radius: 30, opacity: 1, outline: false });
  seed.config.visState.filters = [{ id: 'log-range', dataId: [data.id], name: ['value'], type: 'range', value: [5, 100], enlarged: false, plotType: 'histogram', animationWindow: 'free', yAxis: null, speed: 1 }];
  const fixture = await openMap(page, { seed });
  await openFilters(page);
  await panel(page).locator('.maono-filter-group__toggle').click();
  await panel(page).locator('.maono-filter-row__open').click();
  const editor = filterEditor(page);
  await expect(editor.locator('.maono-filter-histogram__meta')).toContainText('escala log');
  const band = editor.locator('.maono-filter-histogram__selection');
  const plot = editor.locator('.maono-filter-histogram__plot');
  const initial = (await band.boundingBox())!;
  const plotBox = (await plot.boundingBox())!;
  const before = await settledMapColor(page, mapClip, GOLD);
  const [goldBefore] = await mapColorPixelCounts(page, before, [GOLD]);
  await expect.poll(async () => (await capture(page)).snapshot.hasUnsavedChanges).toBe(false);
  const startX = initial.x + initial.width / 2;
  const y = initial.y + initial.height / 2;
  await page.mouse.move(startX, y); await page.mouse.down();
  await page.mouse.move(startX + plotBox.width * .1, y, { steps: 8 });
  // These assertions run while the button is still held: preview and the real
  // filter must both be live, not postponed until pointerup or Save.
  await expect.poll(async () => Number(await editor.getByRole('spinbutton', { name: 'Mínimo', exact: true }).inputValue())).toBeGreaterThan(5);
  await expect.poll(async () => Number(await editor.getByRole('spinbutton', { name: 'Máximo', exact: true }).inputValue())).toBeGreaterThan(100);
  expect(Math.abs((await band.boundingBox())!.width - initial.width)).toBeLessThanOrEqual(1);
  await expect.poll(async () => (await capture(page)).snapshot.hasUnsavedChanges).toBe(true);
  await expect.poll(async () => {
    const [goldNow] = await mapColorPixelCounts(page, await page.screenshot({ clip: mapClip }), [GOLD]);
    return goldBefore - goldNow;
  }).toBeGreaterThan(30);
  await page.mouse.up();
  const inputs = ['Mínimo', 'Máximo'].map(name => editor.getByRole('spinbutton', { name, exact: true }));
  const displayedValues = await Promise.all(inputs.map(input => input.inputValue()));
  // Firefox's native number-input property rounds a long decimal to 15
  // significant digits, while the controlled value attribute and range handles
  // retain the full IEEE number. A fresh Firefox mount can show all digits.
  // Accept only those two exact native representations; state, handles and
  // persistence must retain every digit, without a numeric tolerance.
  const values = await Promise.all(inputs.map(input => input.getAttribute('value').then(value => Number(value))));
  const nativeRepresentations = (value: number) => [String(value), String(Number(value.toPrecision(15)))];
  displayedValues.forEach((text, index) => expect(nativeRepresentations(values[index])).toContain(text));
  expect(await editor.locator('.maono-filter-histogram__handle').evaluateAll(handles => handles.map(handle => Number(handle.getAttribute('aria-valuenow'))))).toEqual(values);
  expect(fixture.saves).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('visual-filter-log-band.png') });
  expect(savedVisState(await saveMap(page, fixture)).filters[0].value).toEqual(values);
  await page.reload(); await ready(page); await openFilters(page);
  await panel(page).locator('.maono-filter-group__toggle').click();
  await panel(page).locator('.maono-filter-row__open').click();
  const restoredInputs = ['Mínimo', 'Máximo'].map(name => filterEditor(page).getByRole('spinbutton', { name, exact: true }));
  expect(await Promise.all(restoredInputs.map(input => input.getAttribute('value').then(value => Number(value))))).toEqual(values);
  const restoredDisplays = await Promise.all(restoredInputs.map(input => input.inputValue()));
  restoredDisplays.forEach((text, index) => expect(nativeRepresentations(values[index])).toContain(text));
  expect(await filterEditor(page).locator('.maono-filter-histogram__handle').evaluateAll(handles => handles.map(handle => Number(handle.getAttribute('aria-valuenow'))))).toEqual(values);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('Visual Maõno interactions: penultimate-to-last insertion changes the real renderer and saves exact layer order', async ({ page }, testInfo) => {
  const seed = seedConfig(2);
  for (const layer of seed.config.visState.layers) Object.assign(layer.config.visConfig, { radius: 50, opacity: 1, outline: false });
  const fixture = await openMap(page, { seed });
  await openLayers(page);
  const before = await settledMapColor(page, mapClip, GOLD);
  const [goldBefore, blueBefore] = await mapColorPixelCounts(page, before, [GOLD, BLUE]);
  expect(goldBefore).toBeGreaterThan(30);
  expect(blueBefore).toBeLessThan(goldBefore * .1);
  const source = rows(page).nth(0), target = rows(page).nth(1);
  const grip = (await source.locator('.maono-layer-row__grip').boundingBox())!;
  const box = (await target.boundingBox())!;
  await page.mouse.move(grip.x + 5, grip.y + 5); await page.mouse.down();
  await page.mouse.move(grip.x + 15, grip.y + 15, { steps: 3 });
  await page.mouse.move(box.x + 50, box.y + box.height * .75, { steps: 8 });
  await page.mouse.move(box.x + 51, box.y + box.height * .75);
  await expect(target).toHaveAttribute('data-drop-position', 'after');
  expect(await target.evaluate(element => getComputedStyle(element, '::after').bottom)).toBe('0px');
  await page.screenshot({ path: testInfo.outputPath('visual-layer-drop-after-last.png') });
  await page.mouse.up();
  await expect(rows(page).locator('.maono-layer-row__open strong')).toHaveText(['Camada 02', 'Camada 01']);
  const after = await settledMapColor(page, mapClip, BLUE);
  const [goldAfter, blueAfter] = await mapColorPixelCounts(page, after, [GOLD, BLUE]);
  expect(blueAfter).toBeGreaterThan(30);
  expect(goldAfter).toBeLessThan(blueAfter * .1);
  expect(await mapPixelDifference(page, before, after)).toBeGreaterThan(30);
  const saved = savedVisState(await saveMap(page, fixture));
  expect(saved.layers.map((layer: { id: string }) => layer.id)).toEqual(['qa-layer-1', 'qa-layer-0']);
  const restored = rows(page).first();
  await rows(page).last().locator('.maono-layer-row__grip').dragTo(restored, { targetPosition: { x: 50, y: 10 } });
  await expect(rows(page).locator('.maono-layer-row__open strong')).toHaveText(['Camada 01', 'Camada 02']);
  const restoredPixels = await settledMapColor(page, mapClip, GOLD);
  const [goldRestored, blueRestored] = await mapColorPixelCounts(page, restoredPixels, [GOLD, BLUE]);
  expect(goldRestored).toBeGreaterThan(30);
  expect(blueRestored).toBeLessThan(goldRestored * .1);
  expect(await mapPixelDifference(page, before, restoredPixels)).toBeLessThanOrEqual(3);
  expect(savedVisState(await saveMap(page, fixture)).layers.map((layer: { id: string }) => layer.id)).toEqual(['qa-layer-0', 'qa-layer-1']);
  expect(fixture.unexpectedWrites).toEqual([]);
});
