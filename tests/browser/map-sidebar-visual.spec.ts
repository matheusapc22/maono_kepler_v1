import { expect, test, type Page } from '@playwright/test';
import { mapPixelDifference as pixelDifference, settledMapColor } from './fixtures/map-pixel-difference';
import {
  capture, filterEditor, openFilters, openLayers, openMap, panel, rail, ready, rows,
  savedVisState, saveMap, seedConfig,
} from './fixtures/map-panel-minimal';

// Built application, native renderer and reducer. Only synthetic HTTP/storage
// fixtures are substituted; this is not remote persistence acceptance.
test.use({ contextOptions: { reducedMotion: 'reduce' } });
test.setTimeout(90_000);
const detail = (page: Page) => panel(page).locator('.maono-detail-view').filter({ has: page.locator('.maono-layer-style-editor') });
const opacityInput = (page: Page) => detail(page).getByRole('spinbutton', { name: 'Opacidade em porcentagem', exact: true });
async function openFirst(page: Page) {
  await openLayers(page);
  await rows(page).first().locator('.maono-layer-row__open').click();
}
async function commitOpacity(page: Page, value: string) {
  await opacityInput(page).fill(value);
  await opacityInput(page).press('Enter');
}

test('Visual Maõno: rail order, disabled research folder, repeated tools and keyboard collapse', async ({ page }, testInfo) => {
  await openMap(page, { layerCount: 3 });
  await openLayers(page);
  const tools = rail(page).locator('nav > button, nav > a');
  expect(await tools.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual([
    'Camadas', 'Mapa base', 'Pesquisas salvas', 'Adicionar dados', 'Voltar ao início',
  ]);
  await expect(rail(page).getByRole('button', { name: 'Pesquisas salvas', exact: true })).toBeDisabled();
  const layerButton = rail(page).getByRole('button', { name: 'Camadas', exact: true });
  const initial = await layerButton.boundingBox();
  await layerButton.click();
  await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'false');
  await expect(rail(page).locator('.is-active')).toHaveCount(0);
  await layerButton.focus();
  await layerButton.press('Enter');
  await expect(layerButton).toHaveAttribute('aria-expanded', 'true');
  expect(await layerButton.boundingBox()).toEqual(initial);
  const base = rail(page).getByRole('button', { name: 'Mapa base', exact: true });
  await base.click();
  await expect(base).toHaveAttribute('aria-expanded', 'true');
  await expect(rail(page).locator('.is-active')).toHaveCount(1);
  await page.mouse.move(0, 0);
  // Assert the settled active state before sampling it; WebKit can return the
  // first transition frame even after React has set aria-expanded.
  await expect(base).toHaveCSS('color', 'rgb(197, 160, 89)');
  await expect(base).toHaveCSS('background-color', 'rgb(10, 15, 24)');
  const activeAppearance = await base.evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(activeAppearance.color).toBe('rgb(197, 160, 89)');
  expect(activeAppearance.background).toBe('rgb(10, 15, 24)');
  await base.hover();
  await expect(base).toHaveCSS('color', activeAppearance.color);
  await expect(base).toHaveCSS('background-color', activeAppearance.background);
  await expect(base.locator('.maono-map-sidebar__connector-edge')).toHaveCSS('stroke', 'rgb(22, 31, 48)');
  await page.screenshot({ path: testInfo.outputPath('visual-rail-basemap.png') });
  await rail(page).getByRole('button', { name: 'Adicionar dados', exact: true }).click();
  await expect(rail(page).locator('.is-active')).toHaveCount(1);
  await expect(page.locator('#map-add-data-sidebar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'false');
  await openLayers(page);
  await page.screenshot({ path: testInfo.outputPath('visual-rail-layers.png') });
});

test('Visual Maõno: compact inspector, exact 37% real-render change and synthetic save/reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seed = seedConfig(1);
  seed.config.visState.layers[0].config.visConfig.radius = 50;
  const fixture = await openMap(page, { seed });
  await openFirst(page);
  await expect(panel(page).locator('.maono-layer-panel__header > div > span')).toHaveCount(0);
  await expect(panel(page).getByRole('tab', { name: /^Camadas/ }).locator('span')).toHaveText('1');
  await expect(detail(page).locator('.maono-detail-view__identity small')).toHaveText('point');
  await expect(detail(page).locator('.maono-layer-essential')).toHaveCount(0);
  await expect(detail(page)).not.toContainText(/Formato, opacidade e cor principal|Paletas, escalas e contorno|Tamanho dos símbolos e comportamento por zoom|Composição global do mapa|Colorir por coluna/);
  const eye = detail(page).locator('.maono-detail-view__visibility');
  await expect(eye).toHaveText('');
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await expect(eye).toHaveCSS('color', 'rgb(157, 169, 186)');
  await eye.click();
  await page.mouse.move(0, 0);
  await expect(eye).toHaveCSS('color', 'rgb(242, 199, 102)');
  await expect(eye).toHaveCSS('border-width', '0px');
  await expect(eye).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const headings = detail(page).locator('.maono-detail-card > header strong, .maono-detail-section > summary strong');
  await expect(headings).toHaveText(['Essencial', 'Aparência', 'Dimensão e agrupamento', 'Avançado']);
  for (const heading of await headings.all()) await expect(heading).toHaveCSS('color', 'rgb(242, 199, 102)');
  await commitOpacity(page, '100');
  const clip = { x: 610, y: 80, width: 650, height: 700 };
  const opaque = await settledMapColor(page, clip, [197, 160, 89]);
  await commitOpacity(page, '37');
  await expect(detail(page).getByRole('slider', { name: 'Opacidade', exact: true })).toHaveValue('37');
  await expect.poll(async () => pixelDifference(page, opaque, await page.screenshot({ clip }))).toBeGreaterThan(30);
  const translucent = await page.screenshot({ clip });
  await testInfo.attach('actual-render-opacity-100', { body: opaque, contentType: 'image/png' });
  await testInfo.attach('actual-render-opacity-37', { body: translucent, contentType: 'image/png' });
  expect(fixture.saves).toHaveLength(0);
  await opacityInput(page).fill('');
  await expect(opacityInput(page)).toHaveValue('');
  await opacityInput(page).press('Tab');
  await expect(opacityInput(page)).toHaveValue('37');
  await commitOpacity(page, '150');
  await expect(opacityInput(page)).toHaveValue('100');
  await commitOpacity(page, '-5');
  await expect(opacityInput(page)).toHaveValue('0');
  await commitOpacity(page, '37');
  await opacityInput(page).focus();
  await opacityInput(page).press('ArrowUp');
  await opacityInput(page).press('ArrowDown');
  await opacityInput(page).press('Enter');
  await expect(opacityInput(page)).toHaveValue('37');
  await detail(page).locator('summary').filter({ hasText: 'Dimensão e agrupamento' }).click();
  const radius = detail(page).getByRole('spinbutton', { name: 'Raio do ponto em px', exact: true });
  await radius.fill('23.7'); await radius.press('Enter');
  await expect(detail(page).getByRole('slider', { name: 'Raio do ponto', exact: true })).toHaveValue('23.7');
  expect(fixture.saves).toHaveLength(0);
  const saved = savedVisState(await saveMap(page, fixture));
  expect(saved.layers[0].config.visConfig).toMatchObject({ opacity: 0.37, radius: 23.7 });
  await page.screenshot({ path: testInfo.outputPath('visual-layer-inspector.png') });
  await page.reload(); await ready(page); await openFirst(page);
  await expect(opacityInput(page)).toHaveValue('37');
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('Visual Maõno: identities survive reorder, hide, duplicate and reload; filters reuse only unique identity', async ({ page }, testInfo) => {
  const fixture = await openMap(page, { layerCount: 3, groups: true });
  await openLayers(page);
  const colors = async () => rows(page).evaluateAll(elements => Object.fromEntries(elements.map(element => [
    element.querySelector('.maono-layer-row__open strong')!.textContent!,
    getComputedStyle(element.querySelector('.maono-layer-row__swatch')!).backgroundColor,
  ])));
  const before = await colors();
  expect(new Set(Object.values(before)).size).toBe(3);
  await rows(page).first().getByRole('button', { name: /^Ocultar / }).click();
  await rows(page).first().dragTo(rows(page).nth(2), { sourcePosition: { x: 8, y: 18 }, targetPosition: { x: 50, y: 55 } });
  expect(await colors()).toEqual(before);
  await openFilters(page);
  const groups = panel(page).locator('.maono-filter-group');
  const filterColors = await groups.evaluateAll(elements => Object.fromEntries(elements.map(element => [
    element.querySelector('.maono-filter-group__toggle strong')!.textContent!,
    getComputedStyle(element.querySelector('.maono-filter-group__accent')!).backgroundColor,
  ])));
  expect(filterColors).toEqual(before);
  await groups.first().locator('.maono-filter-group__toggle').click();
  await groups.first().locator('.maono-filter-row__open').click();
  const filterEye = filterEditor(page).locator('.maono-detail-view__visibility');
  await expect(filterEye).toHaveAttribute('aria-pressed', 'true');
  await filterEye.click(); await expect(filterEye).toHaveAttribute('aria-pressed', 'false');
  await expect(filterEye).toHaveCSS('color', 'rgb(157, 169, 186)');
  await filterEye.click();
  await page.mouse.move(0, 0);
  await expect(filterEye).toHaveCSS('color', 'rgb(242, 199, 102)');
  await expect(filterEye).toHaveCSS('border-width', '0px');
  await expect(filterEye).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const filterHeadings = filterEditor(page).locator('.maono-filter-essential > header strong, .maono-filter-value-section > header strong');
  await expect(filterHeadings).toHaveText(['Essencial', 'Valor do filtro']);
  for (const heading of await filterHeadings.all()) await expect(heading).toHaveCSS('color', 'rgb(242, 199, 102)');
  await expect(filterEditor(page).locator('.maono-detail-view__identity small')).not.toContainText(' · ');
  await page.screenshot({ path: testInfo.outputPath('visual-filter-inspector.png') });
  await openLayers(page);
  await rows(page).first().getByRole('button', { name: /^Ações de / }).click();
  await page.getByRole('menuitem', { name: 'Duplicar', exact: true }).click();
  await detail(page).getByRole('button', { name: 'Voltar para a lista de camadas', exact: true }).click();
  await expect(rows(page)).toHaveCount(4);
  const after = await colors();
  for (const [name, color] of Object.entries(before)) expect(after[name]).toBe(color);
  expect(new Set(Object.values(after)).size).toBe(4);
  await openFilters(page);
  const shared = groups.filter({ has: page.locator('.maono-filter-group__toggle strong', { hasText: /^Dados 2$/ }) });
  await expect(shared).toHaveCount(1);
  await expect(shared).not.toHaveAttribute('data-layer-id', /.+/);
  await saveMap(page, fixture);
  await page.reload(); await ready(page); await openLayers(page);
  expect(await colors()).toEqual(after);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('Visual Maõno: Home preserves dirty map on cancel and goes to canonical Projects on confirm', async ({ page }) => {
  const fixture = await openMap(page, { layerCount: 1 });
  await openFirst(page);
  await commitOpacity(page, '37');
  await expect.poll(async () => (await capture(page)).snapshot.hasUnsavedChanges).toBe(true);
  const url = page.url();
  page.once('dialog', dialog => dialog.dismiss());
  await rail(page).getByRole('link', { name: 'Voltar ao início', exact: true }).click();
  expect(page.url()).toBe(url);
  await expect(opacityInput(page)).toHaveValue('37');
  page.once('dialog', dialog => dialog.dismiss());
  await rail(page).getByRole('link', { name: 'Maõno Maps — Projetos', exact: true }).click();
  expect(page.url()).toBe(url);
  await expect(opacityInput(page)).toHaveValue('37');
  page.once('dialog', dialog => dialog.accept());
  await rail(page).getByRole('link', { name: 'Voltar ao início', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  expect(fixture.saves).toHaveLength(0);
});


test('Visual Maõno: clean Home exits without unnecessary confirmation', async ({ page }) => {
  await openMap(page, { layerCount: 1 });
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await expect.poll(async () => (await capture(page)).snapshot.hasUnsavedChanges).toBe(false);
  await rail(page).getByRole('link', { name: 'Voltar ao início', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  expect(dialogs).toEqual([]);
});
