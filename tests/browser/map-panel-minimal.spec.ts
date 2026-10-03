import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import {
  canvasGeometry, capture, expectStableCanvas, filterEditor, importCsv, openFilters,
  openLayers, openMap, ORGANIZATION_NAME, panel, PROJECT_NAME, ready, rows,
  savedVisState, saveMap,
} from './fixtures/map-panel-minimal';

// Compiled application + native Redux/WebGL. All HTTP/account/storage responses
// are synthetic test-local fixtures. This suite does not claim production or
// backend persistence acceptance and does not install a production test hook.
// The parent runner provides map-shell/layer-manager/overlay build-time flags.
test.use({ reducedMotion: 'reduce' });
test.setTimeout(90_000);

async function movePointerToMap(page: Page) {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(viewport.width - 28, Math.min(80, viewport.height / 4));
}

async function visualEvidence(page: Page, testInfo: TestInfo, name: string) {
  await movePointerToMap(page);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  const fonts = await page.evaluate(() => {
    const selectors = ['body', '.maono-layer-panel__header strong', '.maono-layer-row__open strong', '.maono-layer-panel__tabs button', '.maono-layer-panel__save-button',
      '.maono-filter-add-button', '.maono-filter-category__options strong', '.maono-filter-range__numbers input'];
    function fontRules(element: Element) {
      const matches: Array<{ sheet: string; selector: string; font: string; family: string }> = [];
      function walk(rules: CSSRuleList, sheet: string) {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && (rule.style.font || rule.style.fontFamily)) {
            try { if (element.matches(rule.selectorText)) matches.push({ sheet, selector: rule.selectorText, font: rule.style.font, family: rule.style.fontFamily }); } catch { /* vendor selector */ }
          } else if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules, sheet);
        }
      }
      for (const sheet of Array.from(document.styleSheets)) {
        try { walk(sheet.cssRules, sheet.href ?? 'inline'); } catch { /* cross-origin stylesheet */ }
      }
      return matches;
    }
    return selectors.flatMap(selector => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const style = getComputedStyle(element);
      return [{ selector, family: style.fontFamily, size: style.fontSize, weight: style.fontWeight,
        parentFamily: element.parentElement ? getComputedStyle(element.parentElement).fontFamily : null,
        matchedFontRules: fontRules(element) }];
    });
  });
  const path = testInfo.outputPath(`${name}-fonts.json`);
  const platformFonts: Record<string, unknown> = {};
  if (testInfo.project.name === 'chromium') {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('DOM.enable');
      await client.send('CSS.enable');
      const { root } = await client.send('DOM.getDocument');
      for (const font of fonts) {
        const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: font.selector });
        if (nodeId) platformFonts[font.selector] = (await client.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
      }
    } finally { await client.detach(); }
  }
  await writeFile(path, JSON.stringify({ computed: fonts, rendered: platformFonts }, null, 2));
  await testInfo.attach(`${name}-fonts`, { path, contentType: 'application/json' });
}

async function addFilter(page: Page, field: string, datasetLabel?: string) {
  const before = (await capture(page)).snapshot.filterIds.length;
  await panel(page).getByRole('button', { name: 'Adicionar Filtro', exact: true }).click();
  if (datasetLabel) await panel(page).getByRole('combobox', { name: '1. Base de dados', exact: true }).selectOption({ label: datasetLabel });
  await panel(page).getByRole('combobox', { name: '2. Propriedade', exact: true }).selectOption(field);
  await panel(page).getByRole('button', { name: 'Criar filtro', exact: true }).click();
  await expect.poll(async () => (await capture(page)).snapshot.filterIds.length).toBe(before + 1);
  await expect(filterEditor(page)).toBeVisible();
  await expect(filterEditor(page).getByRole('combobox', { name: 'Propriedade', exact: true })).toHaveValue(field);
  await expect(panel(page).getByRole('button', { name: 'Adicionar Filtro', exact: true })).toBeVisible();
  expect(await filterEditor(page).evaluate(element => Boolean(element.closest('.maono-filter-group__rows')))).toBe(true);
}

async function exportRows(page: Page) {
  await filterEditor(page).getByRole('button', { name: /^Ações de / }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Exportar resultados (CSV)', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const text = (await readFile(path!, 'utf8')).replace(/^\uFEFF/, '');
  // Fixtures deliberately have no quoted/newline-bearing cells. Production's
  // actual CSV serializer supplies these records, including filtered indexes.
  const [header, ...records] = text.trim().split(/\r?\n/).map(line => line.split(','));
  return records.map(record => Object.fromEntries(header.map((name, index) => [name, record[index]])));
}

async function removeFilter(page: Page) {
  await filterEditor(page).getByRole('button', { name: /^Ações de / }).click();
  await page.getByRole('menuitem', { name: 'Remover filtro', exact: true }).click();
  await expect(filterEditor(page)).toHaveCount(0);
}

async function renameFirstLayer(page: Page, name: string) {
  await rows(page).first().getByRole('button', { name: /^Ações de / }).click();
  await page.getByRole('menuitem', { name: 'Renomear', exact: true }).click();
  const input = rows(page).first().getByRole('textbox');
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press('Enter');
  await expect(rows(page).first().locator('.maono-layer-row__open strong')).toHaveText(name);
}

async function setNativeColor(locator: Locator, value: string) {
  // Native color-picker chrome differs across engines. Dispatch the standard
  // input events on the real controlled HTML input; never call engine actions.
  await locator.evaluate((element, next) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(locator).toHaveValue(value);
}

async function nudgeRange(locator: Locator, from: 'Home' | 'End', steps: number) {
  await expect(locator).toBeVisible();
  await locator.focus();
  await locator.press(from);
  for (let index = 0; index < steps; index++) await locator.press(from === 'Home' ? 'ArrowRight' : 'ArrowLeft');
  await locator.press('Tab');
  return Number(await locator.inputValue());
}

async function cardless(locator: Locator) {
  await expect(locator).toHaveCSS('box-shadow', 'none');
  await expect(locator).toHaveCSS('border-radius', '0px');
  // A subtle row separator is permitted; a surrounding card outline is not.
  for (const edge of ['top', 'left', 'right']) await expect(locator).toHaveCSS(`border-${edge}-width`, '0px');
}

async function stableChromeAfterScroll(page: Page, scroll: Locator, toolbar: Locator) {
  const fixed = [panel(page).locator('.maono-layer-panel__header'), panel(page).locator('.maono-layer-panel__tabs'), toolbar, panel(page).locator('.maono-layer-panel__save-footer')];
  const before = await Promise.all(fixed.map(locator => locator.boundingBox()));
  expect(await scroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await scroll.hover();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  for (let index = 0; index < fixed.length; index++) {
    expect(await fixed[index].boundingBox()).toEqual(before[index]);
    await expect(fixed[index]).toBeInViewport();
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

const layerChrome = (page: Page) => [
  panel(page).locator('.maono-layer-panel__header'),
  panel(page).locator('.maono-layer-panel__tabs'),
  panel(page).locator('.maono-detail-view__header'),
  panel(page).locator('.maono-layer-panel__save-footer'),
];
async function assertPinnedLayerChrome(page: Page, before: Array<Awaited<ReturnType<Locator['boundingBox']>>>) {
  const fixed = layerChrome(page);
  for (let index = 0; index < fixed.length; index++) {
    expect(await fixed[index].boundingBox()).toEqual(before[index]);
    await expect(fixed[index]).toBeInViewport();
  }
  for (const locator of [panel(page), panel(page).locator('.maono-layer-panel__body'), page.locator('.maono-map-panel-host__panel')]) {
    expect(await locator.evaluate(element => element.scrollTop), 'only the detail content may scroll, including during keyboard focus').toBe(0);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => {
    for (let element = document.activeElement?.parentElement; element; element = element.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight) return element.className;
    }
    return null;
  })).toContain('maono-detail-view__scroll');
}

test('empty create panel has persistent search, project-layer count and only Save in the footer', async ({ page }, testInfo) => {
  const fixture = await openMap(page, { create: true });
  await openLayers(page);
  await expect(panel(page).getByRole('searchbox', { name: 'Buscar camada', exact: true })).toBeVisible();
  await expect(panel(page).locator('.maono-layer-panel__header')).toContainText('0 camadas');
  await expect(panel(page).locator('.maono-layer-panel__mode')).toHaveCount(0);
  await expect(panel(page)).not.toContainText(/Novo mapa|\bQuota\b|\bCota\b|19 restantes|98 MB/i);
  await expect(panel(page).getByRole('button', { name: 'Adicionar camada', exact: true })).toBeVisible();
  const footer = panel(page).locator('.maono-layer-panel__save-footer');
  await expect(footer.getByRole('button')).toHaveCount(1);
  await expect(footer.getByRole('button')).toHaveText('Salvar mapa');
  await visualEvidence(page, testInfo, 'minimal-empty-layers');
  await openFilters(page);
  await expect(panel(page).locator('.maono-layer-panel__header')).toContainText('0 camadas');
  await expect(panel(page).locator('.maono-filter-panel__toolbar')).toHaveText('Adicionar Filtro');
  await expect(panel(page).locator('.maono-collection-heading')).toHaveCount(0);
  await visualEvidence(page, testInfo, 'minimal-empty-filters');
  expect(fixture.saves).toEqual([]);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('search, eye, rename portal and HTML drag-and-drop mutate actual layers and survive save/reopen', async ({ page }, testInfo) => {
  const fixture = await openMap(page, { layerCount: 3 });
  await openLayers(page);
  const header = panel(page).locator('.maono-layer-panel__header');
  await expect(header).toContainText(`${PROJECT_NAME} - ${ORGANIZATION_NAME}`);
  await expect(header).toContainText('3 camadas');
  const search = panel(page).getByRole('searchbox', { name: 'Buscar camada', exact: true });
  await search.fill('Camada 02');
  await expect(rows(page)).toHaveCount(1);
  await expect(header).toContainText('3 camadas');
  await expect(rows(page).first()).toHaveAttribute('draggable', 'false');
  await search.fill('ausente');
  await expect(panel(page)).toContainText('Nenhuma camada encontrada');
  await panel(page).getByRole('button', { name: 'Limpar busca', exact: true }).click();
  await expect(rows(page)).toHaveCount(3);
  await cardless(rows(page).nth(1));
  const children = await rows(page).first().evaluate(element => Array.from(element.children).map(child => child.className));
  expect(children.indexOf('maono-layer-row__grip')).toBeLessThan(children.indexOf('maono-layer-row__visibility'));
  expect(children.indexOf('maono-layer-row__visibility')).toBeLessThan(children.indexOf('maono-layer-row__swatch'));
  await rows(page).first().getByRole('button', { name: /^Ocultar / }).click();
  await expect(rows(page).first().getByRole('button', { name: /^Mostrar / })).toHaveAttribute('aria-pressed', 'false');
  await expect(header).toContainText('3 camadas');
  await rows(page).first().getByRole('button', { name: /^Ações de / }).click();
  const menu = page.getByRole('menu', { name: 'Ações de Camada 01', exact: true });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(element => element.parentElement === document.body)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'true');
  await rows(page).first().getByRole('button', { name: /^Ações de / }).click();
  await page.getByRole('menuitem', { name: 'Renomear', exact: true }).click();
  await rows(page).first().getByRole('textbox').fill('Rascunho cancelado');
  await rows(page).first().getByRole('textbox').press('Escape');
  await expect(rows(page).first().locator('.maono-layer-row__open strong')).toHaveText('Camada 01');
  await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'true');
  await renameFirstLayer(page, 'Camada renomeada');
  await rows(page).first().dragTo(rows(page).nth(2), { sourcePosition: { x: 8, y: 18 }, targetPosition: { x: 50, y: 18 } });
  await expect(rows(page).locator('.maono-layer-row__open strong')).toHaveText(['Camada 02', 'Camada 03', 'Camada renomeada']);
  await visualEvidence(page, testInfo, 'minimal-populated-layers');
  const saved = savedVisState(await saveMap(page, fixture));
  // Native Kepler Schema serializes layers in layerOrder, rather than persisting
  // a second potentially divergent layerOrder array.
  expect(saved.layers.map((layer: any) => layer.id)).toEqual(['qa-layer-1', 'qa-layer-2', 'qa-layer-0']);
  expect(saved.layers.at(-1).config).toMatchObject({ label: 'Camada renomeada', isVisible: false });
  await page.reload();
  await ready(page);
  await openLayers(page);
  await expect(rows(page).locator('.maono-layer-row__open strong')).toHaveText(['Camada 02', 'Camada 03', 'Camada renomeada']);
  await expect(rows(page).last().getByRole('button', { name: 'Mostrar Camada renomeada', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('native layer interiors preserve color, opacity, radius and numeric field edits', async ({ page }, testInfo) => {
  const fixture = await openMap(page);
  await importCsv(page);
  await openLayers(page);
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().locator('.maono-layer-row__open').click();
  const detail = panel(page).locator('.maono-detail-view').filter({ has: page.locator('.maono-layer-style-editor') });
  await expect(detail).toBeVisible();
  const originalName = await detail.locator('.maono-detail-view__identity > strong').innerText();
  await detail.getByRole('button', { name: /^Ações de / }).click();
  await page.getByRole('menuitem', { name: 'Renomear', exact: true }).click();
  await detail.getByRole('textbox', { name: 'Nome da camada', exact: true }).fill('Nome cancelado');
  await detail.getByRole('textbox', { name: 'Nome da camada', exact: true }).press('Escape');
  await expect(detail.locator('.maono-detail-view__identity > strong')).toHaveText(originalName);
  await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'true');
  const pinnedBefore = await Promise.all(layerChrome(page).map(locator => locator.boundingBox()));
  await setNativeColor(detail.getByLabel('Cor fixa', { exact: true }), '#267fa4');
  // The visible label and explicit accessible name must identify the same real
  // input. Keyboard events and serialization then prove native behavior.
  await expect(detail.getByRole('slider', { name: 'Opacidade', exact: true })).toBeVisible();
  const opacity = await nudgeRange(detail.locator('.maono-style-range').filter({ hasText: /^Opacidade/ }).locator('input[type=range]').first(), 'End', 7);
  await detail.locator('summary').filter({ hasText: 'Dimensão e agrupamento' }).click();
  await expect(detail.getByRole('slider', { name: 'Raio do ponto', exact: true })).toBeVisible();
  const radius = await nudgeRange(detail.locator('.maono-style-range').filter({ hasText: /^Raio do ponto/ }).locator('input[type=range]'), 'Home', 9);
  await expect(detail.locator('.maono-point-spatial-grouping__switch input')).toBeFocused();
  await assertPinnedLayerChrome(page, pinnedBefore);
  await visualEvidence(page, testInfo, 'minimal-native-layer-detail');
  let vis = savedVisState(await saveMap(page, fixture));
  expect(vis.layers[0].config.color).toEqual([38, 127, 164]);
  expect(vis.layers[0].config.visConfig.opacity).toBeCloseTo(opacity);
  expect(vis.layers[0].config.visConfig.radius).toBeCloseTo(radius);
  await detail.getByRole('combobox', { name: 'Raio orientado por campo', exact: true }).selectOption('value');
  await expect(detail.getByRole('slider', { name: 'Raio mínimo', exact: true })).toBeVisible();
  const minimum = await nudgeRange(detail.locator('.maono-style-range').filter({ hasText: /^Raio mínimo/ }).locator('input[type=range]'), 'Home', 4);
  vis = savedVisState(await saveMap(page, fixture));
  expect(vis.layers[0].visualChannels.sizeField).toMatchObject({ name: 'value' });
  expect(vis.layers[0].config.visConfig.radiusRange[0]).toBe(minimum);
  await detail.getByRole('button', { name: 'Voltar para a lista de camadas', exact: true }).click();
  await expect(rows(page).first().locator('.maono-layer-row__swatch')).toHaveCSS('background-color', 'rgb(38, 127, 164)');
  await panel(page).getByRole('button', { name: 'Adicionar camada', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.maono-add-layer__menu')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Adicionar camada', exact: true })).toBeFocused();
  await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'true');
  await panel(page).getByRole('button', { name: 'Adicionar camada', exact: true }).click();
  await page.locator('.maono-add-layer__datasets').getByRole('menuitem').first().click();
  await expect.poll(async () => (await capture(page)).raw.layerIds.length).toBe(2);
  expect((await capture(page)).raw.datasetIds).toHaveLength(1);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('inline category filter changes native CSV population, toggles, saves once and reopens unchanged', async ({ page }, testInfo) => {
  const fixture = await openMap(page);
  await importCsv(page);
  await openFilters(page);
  await addFilter(page, 'category');
  await expect(filterEditor(page).getByRole('switch', { name: 'Filtro category', exact: true })).toBeVisible();
  const originalFilterId = (await capture(page)).snapshot.filterIds[0];
  await expect(filterEditor(page).locator('.maono-filter-category__options label')).toHaveCount(3);
  await filterEditor(page).getByRole('checkbox', { name: 'B', exact: true }).check();
  await visualEvidence(page, testInfo, 'minimal-native-category');
  expect((await exportRows(page)).map(row => row.name)).toEqual(['Linha 4', 'Linha 5']);
  await filterEditor(page).getByRole('switch').click();
  await expect(filterEditor(page).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(await exportRows(page)).toHaveLength(6);
  const disabledSaved = savedVisState(await saveMap(page, fixture));
  expect(disabledSaved.filters[0]).toMatchObject({ id: originalFilterId, enabled: false, value: ['B'] });
  await expect(filterEditor(page).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(filterEditor(page).getByRole('checkbox', { name: 'B', exact: true })).toBeChecked();
  expect(await exportRows(page)).toHaveLength(6);
  // Changing another CPU filter must not resurrect the disabled category.
  await addFilter(page, 'eligible');
  await filterEditor(page).getByRole('radio', { name: 'Sim / verdadeiro', exact: true }).check();
  expect((await exportRows(page)).map(row => row.name)).toEqual(['Linha 1', 'Linha 3', 'Linha 5']);
  await filterEditor(page).getByRole('radio', { name: 'Não / falso', exact: true }).check();
  expect((await exportRows(page)).map(row => row.name)).toEqual(['Linha 2', 'Linha 4', 'Linha 6']);
  await removeFilter(page);
  await panel(page).locator('.maono-filter-row__open').filter({ has: page.locator('strong', { hasText: /^category$/ }) }).click();
  await expect(filterEditor(page).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(await exportRows(page)).toHaveLength(6);
  expect((await capture(page)).snapshot.filterIds).toEqual([originalFilterId]);
  await filterEditor(page).getByRole('switch').click();
  expect((await exportRows(page)).map(row => row.category)).toEqual(['B', 'B']);
  const beforeSaveCount = fixture.saves.length;
  const expectedRevision = fixture.saves.at(-1)!.expectedConfigRevision + 1;
  const release = fixture.holdNextSave();
  const save = panel(page).locator('.maono-layer-panel__save-button');
  const committed = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/config'));
  const rehydrated = page.waitForResponse(response => response.url().includes('/config-stream?'));
  await save.click();
  try {
    await expect.poll(() => fixture.saves.length).toBe(beforeSaveCount + 1);
    await expect(save).toBeDisabled();
    // A physical repeat click and keyboard activation target the same disabled
    // action; neither may start another real serializer/request invocation.
    const box = await save.boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.keyboard.press('Enter');
    expect(fixture.saves).toHaveLength(beforeSaveCount + 1);
  } finally { release(); }
  expect((await committed).status()).toBe(200);
  await rehydrated;
  await ready(page);
  expect(fixture.saves.at(-1)!.expectedConfigRevision).toBe(expectedRevision);
  expect(savedVisState(fixture.saves.at(-1)!).filters).toEqual(expect.arrayContaining([expect.objectContaining({ id: originalFilterId, name: ['category'], type: 'multiSelect', value: ['B'] })]));
  await page.reload();
  await ready(page);
  await openFilters(page);
  await panel(page).locator('.maono-filter-group__toggle').click();
  await panel(page).locator('.maono-filter-row__open').click();
  await expect(filterEditor(page).getByRole('checkbox', { name: 'B', exact: true })).toBeChecked();
  expect((await exportRows(page)).map(row => row.name)).toEqual(['Linha 4', 'Linha 5']);
  await removeFilter(page);
  await expect.poll(async () => (await capture(page)).snapshot.filterIds.length).toBe(0);
  await addFilter(page, 'category');
  expect(await exportRows(page)).toHaveLength(6);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('inline numeric, temporal and boolean controls commit native values, reset and rebind fields', async ({ page }) => {
  const fixture = await openMap(page);
  await importCsv(page);
  await openFilters(page);
  await addFilter(page, 'value');
  await expect(filterEditor(page).locator('.maono-filter-histogram')).toBeVisible();
  await filterEditor(page).getByRole('spinbutton', { name: 'Mínimo', exact: true }).fill('20');
  await filterEditor(page).getByRole('spinbutton', { name: 'Mínimo', exact: true }).press('Tab');
  await filterEditor(page).getByRole('spinbutton', { name: 'Máximo', exact: true }).fill('50');
  await filterEditor(page).getByRole('spinbutton', { name: 'Máximo', exact: true }).press('Tab');
  let vis = savedVisState(await saveMap(page, fixture));
  expect(vis.filters[0]).toMatchObject({ type: 'range', name: ['value'], value: [20, 50] });
  await filterEditor(page).getByRole('switch').click();
  vis = savedVisState(await saveMap(page, fixture));
  expect(vis.filters[0]).toMatchObject({ type: 'range', enabled: false, value: [20, 50] });
  await expect(filterEditor(page).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  // GPU range/time behavior is separately verified by native table tests; CSV
  // row count is deliberately not used as a proxy for rendered GPU filtering.
  await filterEditor(page).getByRole('switch').click();
  await filterEditor(page).getByRole('button', { name: 'Restaurar domínio completo', exact: true }).click();
  await expect(filterEditor(page).getByRole('spinbutton', { name: 'Mínimo', exact: true })).toHaveValue('10');
  await expect(filterEditor(page).getByRole('spinbutton', { name: 'Máximo', exact: true })).toHaveValue('60');
  await filterEditor(page).getByRole('combobox', { name: 'Propriedade', exact: true }).selectOption('observed_at');
  const from = filterEditor(page).getByLabel('De', { exact: true });
  const to = filterEditor(page).getByLabel('Até', { exact: true });
  await expect(from).toBeVisible();
  const original = await from.inputValue();
  const next = original.replace('2026-01-01', '2026-01-02');
  expect(next).not.toBe(original);
  await from.fill(next);
  await from.press('Tab');
  const expected = await from.evaluate(element => new Date((element as HTMLInputElement).value).getTime());
  vis = savedVisState(await saveMap(page, fixture));
  expect(vis.filters[0]).toMatchObject({ type: 'timeRange', name: ['observed_at'] });
  expect(vis.filters[0].value[0]).toBe(expected);
  expect(vis.filters[0].value[1]).toBeGreaterThan(expected);
  const preservedTimeValue = vis.filters[0].value;
  await filterEditor(page).getByRole('switch').click();
  vis = savedVisState(await saveMap(page, fixture));
  expect(vis.filters[0]).toMatchObject({ type: 'timeRange', enabled: false, value: preservedTimeValue });
  await expect(filterEditor(page).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await filterEditor(page).getByRole('switch').click();
  await filterEditor(page).getByRole('button', { name: 'Restaurar período completo', exact: true }).click();
  await expect(from).toHaveValue(original);
  await expect(to).not.toHaveValue('');
  await filterEditor(page).getByRole('combobox', { name: 'Propriedade', exact: true }).selectOption('category');
  await filterEditor(page).getByRole('checkbox', { name: 'C', exact: true }).check();
  expect((await exportRows(page)).map(row => row.name)).toEqual(['Linha 6']);
  await filterEditor(page).getByRole('combobox', { name: 'Propriedade', exact: true }).selectOption('eligible');
  await filterEditor(page).getByRole('radio', { name: 'Sim / verdadeiro', exact: true }).check();
  expect((await exportRows(page)).map(row => row.name)).toEqual(['Linha 1', 'Linha 3', 'Linha 5']);
  vis = savedVisState(await saveMap(page, fixture));
  expect(vis.filters[0]).toMatchObject({ type: 'select', name: ['eligible'], value: true });
  await filterEditor(page).getByRole('switch').click();
  expect(await exportRows(page)).toHaveLength(6);
  vis = savedVisState(await saveMap(page, fixture));
  expect(vis.filters[0]).toMatchObject({ type: 'select', enabled: false, value: true });
  await expect(filterEditor(page).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(await exportRows(page)).toHaveLength(6);
  await filterEditor(page).getByRole('switch').click();
  expect(await exportRows(page)).toHaveLength(3);
  await filterEditor(page).getByRole('radio', { name: 'Não / falso', exact: true }).check();
  expect((await exportRows(page)).map(row => row.name)).toEqual(['Linha 2', 'Linha 4', 'Linha 6']);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('dataset groups are cardless with truthful layer colors and one rotating accordion chevron', async ({ page }, testInfo) => {
  const fixture = await openMap(page, { layerCount: 2, groups: true });
  await openFilters(page);
  const groups = panel(page).locator('.maono-filter-group');
  await expect(groups).toHaveCount(2);
  await cardless(groups.first());
  await expect(groups.first().locator('.maono-filter-group__accent')).toHaveCSS('background-color', 'rgb(197, 160, 89)');
  await expect(groups.nth(1).locator('.maono-filter-group__accent')).toHaveCSS('background-color', 'rgb(50, 140, 200)');
  await visualEvidence(page, testInfo, 'minimal-grouped-filters');
  const firstToggle = groups.first().locator('.maono-filter-group__toggle');
  const chevron = await firstToggle.locator('.maono-filter-group__chevron').elementHandle();
  expect(chevron).not.toBeNull();
  const shape = await chevron!.innerHTML();
  await firstToggle.click();
  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
  expect(await chevron!.evaluate(element => element.isConnected)).toBe(true);
  expect(await chevron!.innerHTML()).toBe(shape);
  await expect.poll(() => chevron!.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).b)).toBe(1);
  await groups.nth(1).locator('.maono-filter-group__toggle').click();
  await expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(groups.nth(1).locator('.maono-filter-group__toggle')).toHaveAttribute('aria-expanded', 'true');
  await firstToggle.click();
  await groups.first().locator('.maono-filter-row__open').click();
  await expect(filterEditor(page)).toBeVisible();
  await expect(panel(page).locator('.maono-filter-panel__toolbar')).toBeVisible();
  await filterEditor(page).getByRole('button', { name: 'Recolher condição', exact: true }).click();
  await expect(groups.first().locator('.maono-filter-row')).toBeVisible();
  // Add a second real layer against Dados 1. Its filter group must switch to
  // dataset identity with a neutral marker, instead of choosing an arbitrary layer.
  await openLayers(page);
  await panel(page).getByRole('button', { name: 'Adicionar camada', exact: true }).click();
  await page.locator('.maono-add-layer__datasets').getByRole('menuitem').filter({ hasText: 'Dados 1' }).click();
  await openFilters(page);
  const shared = groups.filter({ has: page.locator('.maono-filter-group__toggle strong', { hasText: /^Dados 1$/ }) });
  await expect(shared).toHaveCount(1);
  await expect(shared).not.toHaveAttribute('data-layer-id', /.+/);
  const accent = shared.locator('.maono-filter-group__accent');
  expect(await accent.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(197, 160, 89)');
  expect(fixture.unexpectedWrites).toEqual([]);
});

for (const viewport of [{ width: 1280, height: 480 }, { width: 320, height: 480 }]) {
  test(`only list scrolls with fixed chrome and unchanged live canvas at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const fixture = await openMap(page, { layerCount: 28, groups: true });
    const canvas = await canvasGeometry(page, true);
    await openLayers(page);
    const tabGeometry = await panel(page).getByRole('tab').evaluateAll(elements => elements.map(element => {
      const button = element.getBoundingClientRect();
      const icon = element.querySelector('svg')!.getBoundingClientRect();
      const badge = element.querySelector('span')!.getBoundingClientRect();
      return { label: element.textContent, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        button: { left: button.left, right: button.right }, icon: { left: icon.left, right: icon.right }, badge: { left: badge.left, right: badge.right } };
    }));
    await testInfo.attach('tab-geometry', { body: JSON.stringify({ viewport, tabs: tabGeometry }, null, 2), contentType: 'application/json' });
    for (const tab of tabGeometry) {
      expect(tab.scrollWidth, `${tab.label} has no horizontal overflow`).toBeLessThanOrEqual(tab.clientWidth + 1);
      for (const item of [tab.icon, tab.badge]) {
        expect(item.left, `${tab.label} icon/badge left`).toBeGreaterThanOrEqual(tab.button.left);
        expect(item.right, `${tab.label} icon/badge right`).toBeLessThanOrEqual(tab.button.right);
      }
    }
    await stableChromeAfterScroll(page, panel(page).locator('.maono-layer-list-region'), panel(page).locator('.maono-layer-panel__toolbar'));
    await rows(page).last().getByRole('button', { name: /^Ações de / }).click();
    const menu = page.getByRole('menu', { name: 'Ações de Camada 28', exact: true });
    await expect(menu).toBeInViewport();
    const menuBox = await menu.boundingBox();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press('Escape');
    await rows(page).last().locator('.maono-layer-row__open').click();
    const detail = panel(page).locator('.maono-detail-view').filter({ has: page.locator('.maono-layer-style-editor') });
    await detail.locator('summary').filter({ hasText: 'Dimensão e agrupamento' }).click();
    await stableChromeAfterScroll(page, detail.locator('.maono-detail-view__scroll'), detail.locator('.maono-detail-view__header'));
    const detailChrome = await Promise.all(layerChrome(page).map(locator => locator.boundingBox()));
    const radius = detail.getByRole('slider', { name: 'Raio do ponto', exact: true });
    await radius.focus();
    await radius.press('Tab');
    await expect(detail.locator('.maono-point-spatial-grouping__switch input')).toBeFocused();
    await assertPinnedLayerChrome(page, detailChrome);
    await expectStableCanvas(page, canvas);
    await movePointerToMap(page);
    await page.screenshot({ path: testInfo.outputPath(`minimal-layer-detail-${viewport.width}x${viewport.height}.png`) });
    await openFilters(page);
    await stableChromeAfterScroll(page, panel(page).locator('.maono-filter-list-region'), panel(page).locator('.maono-filter-panel__toolbar'));
    await expectStableCanvas(page, canvas);
    const handle = page.locator('.maono-map-panel-host__handle');
    const icon = await handle.locator('svg').elementHandle();
    const shape = await icon!.innerHTML();
    await expect(handle).toHaveCSS('width', '28px');
    await expect(handle).toHaveCSS('height', '52px');
    for (let index = 0; index < 2; index++) {
      await handle.click();
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      expect(await icon!.evaluate(element => element.isConnected)).toBe(true);
      expect(await icon!.innerHTML()).toBe(shape);
      await expectStableCanvas(page, canvas);
      await handle.focus();
      await page.keyboard.press('Enter');
      await expect(handle).toHaveAttribute('aria-expanded', 'true');
      expect(await icon!.innerHTML()).toBe(shape);
      await expectStableCanvas(page, canvas);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await movePointerToMap(page);
    await page.screenshot({ path: testInfo.outputPath(`minimal-panel-filters-${viewport.width}x${viewport.height}.png`) });
    expect(fixture.unexpectedWrites).toEqual([]);
  });
}

test.describe('320px touch viewport', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 568 } });
  test('layer interiors, menu and inline filter controls remain reachable by touch', async ({ page }, testInfo) => {
    const fixture = await openMap(page);
    await importCsv(page);
    await openLayers(page);
    await rows(page).first().locator('.maono-layer-row__open').tap();
    await expect(panel(page).getByLabel('Cor fixa', { exact: true })).toBeVisible();
    await panel(page).locator('.maono-detail-view__header').getByRole('button', { name: /^Ações de / }).tap();
    await expect(page.getByRole('menu')).toBeInViewport();
    await page.getByRole('menuitem', { name: 'Renomear', exact: true }).tap();
    await panel(page).getByRole('textbox', { name: 'Nome da camada', exact: true }).fill('Camada móvel');
    await panel(page).getByRole('textbox', { name: 'Nome da camada', exact: true }).press('Enter');
    await openFilters(page);
    await addFilter(page, 'category');
    await filterEditor(page).getByRole('checkbox', { name: 'A', exact: true }).tap();
    expect(await exportRows(page)).toHaveLength(3);
    await expect(panel(page).locator('.maono-layer-panel__save-button')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await movePointerToMap(page);
    await page.screenshot({ path: testInfo.outputPath('minimal-panel-mobile-inline.png') });
    expect(fixture.unexpectedWrites).toEqual([]);
  });
});

test('409 preserves edited layer state and feedback while allowing a later authorized retry', async ({ page }) => {
  const fixture = await openMap(page, { layerCount: 1 });
  await openLayers(page);
  await renameFirstLayer(page, 'Edição preservada');
  fixture.rejectSaves();
  const save = panel(page).locator('.maono-layer-panel__save-button');
  await save.click();
  await expect.poll(() => fixture.saves.length).toBe(1);
  await expect(panel(page).locator('.maono-layer-panel__save-message[role=alert]')).toBeVisible();
  await expect(save).toBeEnabled();
  await expect(rows(page).first().locator('.maono-layer-row__open strong')).toHaveText('Edição preservada');
  fixture.rejectSaves(200);
  const retry = await saveMap(page, fixture);
  expect(savedVisState(retry).layers[0].config.label).toBe('Edição preservada');
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('viewer retains truthful counts and inspection without exposing mutation controls or Save', async ({ page }) => {
  const fixture = await openMap(page, { layerCount: 2, groups: true, viewer: true });
  await openLayers(page);
  await expect(panel(page).getByRole('searchbox', { name: 'Buscar camada', exact: true })).toBeVisible();
  await expect(panel(page).locator('.maono-layer-panel__header')).toContainText('2 camadas');
  await expect(panel(page).locator('.maono-layer-panel__save-footer')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Adicionar camada', exact: true })).toHaveCount(0);
  await expect(rows(page).locator('.maono-layer-row__visibility')).toHaveCount(0);
  await openFilters(page);
  await expect(panel(page).getByRole('button', { name: 'Adicionar Filtro', exact: true })).toHaveCount(0);
  await panel(page).locator('.maono-filter-group__toggle').first().click();
  await panel(page).locator('.maono-filter-row__open').first().click();
  await expect(filterEditor(page).getByRole('switch')).toBeDisabled();
  await expect(filterEditor(page).getByRole('checkbox')).toHaveCount(0);
  expect(fixture.saves).toEqual([]);
  expect(fixture.unexpectedWrites).toEqual([]);
});

for (const keepSourcePopulated of [false, true]) {
  test(`cross-dataset rebind keeps selected condition visible when old group becomes ${keepSourcePopulated ? 'populated' : 'empty'}`, async ({ page }) => {
    const fixture = await openMap(page, { layerCount: 2, groups: true });
    await openFilters(page);
    if (keepSourcePopulated) await addFilter(page, 'name', 'Dados 1');
    else {
      await panel(page).locator('.maono-filter-group[data-layer-id="qa-layer-0"] .maono-filter-group__toggle').click();
      await panel(page).locator('.maono-filter-group[data-layer-id="qa-layer-0"] .maono-filter-row__open').click();
    }
    const ids = (await capture(page)).snapshot.filterIds;
    await filterEditor(page).getByRole('combobox', { name: 'Base de dados', exact: true }).selectOption('qa-data-1');
    const destination = panel(page).locator('.maono-filter-group[data-layer-id="qa-layer-1"]');
    await expect(destination.locator('.maono-filter-group__toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(destination.locator('.maono-filter-detail--inline')).toBeVisible();
    await expect(filterEditor(page).getByRole('combobox', { name: 'Base de dados', exact: true })).toHaveValue('qa-data-1');
    await expect(panel(page).locator('.maono-filter-group[data-layer-id="qa-layer-0"]')).toHaveCount(keepSourcePopulated ? 1 : 0);
    expect((await capture(page)).snapshot.filterIds).toEqual(ids);
    await destination.locator('.maono-filter-group__toggle').click();
    await expect(destination.locator('.maono-filter-group__toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(filterEditor(page)).toHaveCount(0);
    await destination.locator('.maono-filter-group__toggle').click();
    await expect(destination.locator('.maono-filter-detail--inline')).toBeVisible();
    const vis = savedVisState(await saveMap(page, fixture));
    expect(vis.filters.filter((filter: any) => filter.dataId.includes('qa-data-1'))).toHaveLength(2);
    expect(fixture.unexpectedWrites).toEqual([]);
  });
}
