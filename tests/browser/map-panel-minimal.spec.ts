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
test.use({ contextOptions: { reducedMotion: 'reduce' } });
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
});

type HintProbeWindow = Window & { __PANEL_HINT_PROBE__?: {
  data: { capabilities: Record<string, unknown>; entries: unknown[] };
  checkpoint: (phase: string) => void;
  stop: () => void;
} };

// Read-only, synthetic-fixture diagnostics. Keep first-hover evidence in CI even
// when the browser cannot expose a trace artifact immediately after failure.
test.afterEach(async ({ page }, testInfo) => {
  const data = await page.evaluate(() => {
    const probe = (window as HintProbeWindow).__PANEL_HINT_PROBE__;
    if (!probe) return null;
    probe.checkpoint('test-finished');
    probe.stop();
    return probe.data;
  }).catch(() => null);
  if (!data) return;
  const json = JSON.stringify(data, null, 2);
  await writeFile(testInfo.outputPath('panel-hint-pointer-diagnostic.json'), json);
  await testInfo.attach('panel-hint-pointer-diagnostic', { body: json, contentType: 'application/json' });
  if (testInfo.status !== testInfo.expectedStatus) {
    const concise = JSON.stringify({ browser: testInfo.project.name, title: testInfo.title, ...data }, (key, value: unknown) => {
      if (key === 'active' || key === 'portals') return undefined;
      if (key === 'rect' && value && typeof value === 'object') {
        const rect = value as Record<string, unknown>;
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      return value;
    });
    console.log(`PANEL_HINT_DIAGNOSTIC ${concise}`);
  }
});

async function startHintProbe(trigger: Locator, hasTouch: boolean) {
  await trigger.evaluate((element, requestedHasTouch) => {
    const runtime = window as HintProbeWindow;
    runtime.__PANEL_HINT_PROBE__?.stop();
    const entries: unknown[] = [];
    const frames = new Set<number>();
    let stopped = false;
    const describe = (target: EventTarget | null) => target instanceof Element
      ? { tag: target.tagName, class: target.getAttribute('class'), label: target.getAttribute('aria-label') }
      : String(target);
    const record = (phase: string, event?: Event) => {
      if (stopped) return;
      const pointer = event as PointerEvent | undefined;
      const scroll = element.closest('.maono-detail-view__scroll');
      const portals = Array.from(document.querySelectorAll('.maono-panel-hint__popover'));
      entries.push({ phase, time: performance.now(), event: event ? { type: event.type, target: describe(event.target),
        pointerType: pointer?.pointerType, isPrimary: pointer?.isPrimary, x: pointer?.clientX, y: pointer?.clientY } : null,
      trigger: { rect: element.getBoundingClientRect().toJSON(), expanded: element.getAttribute('aria-expanded'), focused: element === document.activeElement },
      scroll: scroll ? { rect: scroll.getBoundingClientRect().toJSON(), top: scroll.scrollTop } : null,
      active: describe(document.activeElement), portalCount: portals.length,
      portals: portals.map(portal => ({ rect: portal.getBoundingClientRect().toJSON(), visibility: getComputedStyle(portal).visibility })) });
      // Preserve the initial enter/scroll sequence even on a noisy failure.
      if (entries.length > 500) entries.splice(250, 1);
    };
    const onEvent = (event: Event) => {
      record('event', event);
      const first = requestAnimationFrame(() => {
        frames.delete(first); record('after-frame', event);
        const second = requestAnimationFrame(() => { frames.delete(second); record('after-second-frame', event); });
        frames.add(second);
      });
      frames.add(first);
    };
    const kinds = ['pointerover', 'pointerenter', 'pointermove', 'pointerout', 'pointerleave', 'mouseover', 'mouseenter', 'mousemove', 'mouseout', 'mouseleave', 'focusin', 'focusout', 'scroll'];
    for (const kind of kinds) document.addEventListener(kind, onEvent, true);
    const observer = new MutationObserver(() => record('aria-expanded-mutation'));
    observer.observe(element, { attributes: true, attributeFilter: ['aria-expanded'] });
    runtime.__PANEL_HINT_PROBE__ = {
      data: { capabilities: { requestedHasTouch, maxTouchPoints: navigator.maxTouchPoints, userAgent: navigator.userAgent,
        hover: matchMedia('(hover: hover)').matches, anyHover: matchMedia('(any-hover: hover)').matches,
        fine: matchMedia('(pointer: fine)').matches, anyFine: matchMedia('(any-pointer: fine)').matches }, entries },
      checkpoint: phase => record(phase),
      stop: () => { stopped = true; observer.disconnect(); for (const kind of kinds) document.removeEventListener(kind, onEvent, true); for (const frame of frames) cancelAnimationFrame(frame); },
    };
    record('before-scroll-into-view');
  }, hasTouch);
}

async function hintProbeCheckpoint(page: Page, phase: string, stop = false) {
  await page.evaluate(({ phase, stop }) => {
    const probe = (window as HintProbeWindow).__PANEL_HINT_PROBE__;
    probe?.checkpoint(phase);
    if (stop) probe?.stop();
  }, { phase, stop });
}

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

async function extentGuide(host: Locator, kind: 'layer' | 'filter', width: number) {
  const space = width <= 560 ? 10 : 12;
  const geometry = await host.evaluate(element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const guide = getComputedStyle(element, '::before');
    return {
      host: { left: box.left, top: box.top, bottom: box.bottom, height: box.height },
      position: style.position, paddingLeft: parseFloat(style.paddingLeft), paddingBottom: parseFloat(style.paddingBottom),
      guide: { content: guide.content, position: guide.position, top: parseFloat(guide.top), left: parseFloat(guide.left),
        bottom: parseFloat(guide.bottom), width: parseFloat(guide.width), height: parseFloat(guide.height),
        opacity: parseFloat(guide.opacity), color: guide.backgroundColor, pointerEvents: guide.pointerEvents },
      children: Array.from(element.children).map(child => child.getBoundingClientRect())
        .filter(child => child.width > 0 && child.height > 0)
        .map(child => ({ left: child.left, top: child.top, bottom: child.bottom })),
    };
  });
  expect(geometry.position).toBe('relative');
  expect(geometry.paddingLeft, 'controls stay inset beyond the 2px extent guide').toBe(space + 2);
  expect(geometry.guide).toMatchObject({ content: '""', position: 'absolute', top: 0, left: 0, width: 2,
    bottom: kind === 'layer' ? space : 0, opacity: 0.38, color: 'rgb(242, 199, 102)', pointerEvents: 'none' });
  expect(geometry.guide.height).toBeCloseTo(geometry.host.height - (kind === 'layer' ? space : 0), 0);
  expect(geometry.children.length).toBeGreaterThan(0);
  for (const child of geometry.children) {
    expect(child.left, 'content is indented, not overlaid by the decorative guide').toBeGreaterThanOrEqual(geometry.host.left + space + 2 - 0.5);
    expect(child.top).toBeGreaterThanOrEqual(geometry.host.top - 0.5);
    expect(child.bottom, 'the guide reaches the last body content').toBeLessThanOrEqual(geometry.host.top + geometry.guide.height + 0.5);
  }
  await cardless(host);
  return geometry;
}

async function layerExtentGuides(detail: Locator, width: number) {
  const sections = detail.locator('.maono-detail-section, .maono-progressive-section');
  expect(await sections.count()).toBeGreaterThanOrEqual(3);
  for (const section of await sections.all()) {
    const summary = section.locator(':scope > summary');
    const content = section.locator(':scope > .maono-detail-section__content, :scope > .maono-progressive-section__content');
    const wasOpen = await section.evaluate(element => (element as HTMLDetailsElement).open);
    if (!wasOpen) await summary.click();
    await expect(section).toHaveAttribute('open', '');
    await extentGuide(content, 'layer', width);
    const subtitle = summary.locator('small');
    if (await section.evaluate(element => element.classList.contains('maono-detail-section'))) {
      await expect(subtitle).toHaveCount(0);
    } else if (await subtitle.count()) {
      await expect(subtitle).toHaveCSS('padding-left', `${(width <= 560 ? 10 : 12) + 2}px`);
    }
    await summary.click();
    await expect(content).toBeHidden();
    expect(await content.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none');
    if (wasOpen) await summary.click();
  }
}

async function hintPortal(page: Page, trigger: Locator, text: string) {
  const tooltip = page.locator('.maono-panel-hint__popover[role="tooltip"]');
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(text);
  await expect(trigger).toHaveAttribute('aria-describedby', (await tooltip.getAttribute('id'))!);
  await expect(tooltip).toHaveCSS('position', 'fixed');
  expect(await tooltip.evaluate(element => element.parentElement === document.body)).toBe(true);
  const viewport = page.viewportSize()!;
  const box = (await tooltip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const occluded = await tooltip.evaluate(element => {
    const box = element.getBoundingClientRect();
    const failures: Array<{ x: number; y: number; hit: string | null }> = [];
    // A touch target may be only a few pixels from the exact center. Sample
    // the full interior densely, staying clear of the rounded 8px corners.
    for (let y = box.top + 8; y < box.bottom - 8; y += 12) {
      for (let x = box.left + 8; x < box.right - 8; x += 12) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !element.contains(hit)) failures.push({ x, y, hit: hit?.outerHTML.slice(0, 300) ?? null });
      }
    }
    return failures;
  });
  expect(occluded, 'all hint text stays above map tools and receives pointer/touch input').toEqual([]);
  expect(await tooltip.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  return tooltip;
}

type ChevronSample = { x: number; y: number; width: number; height: number; angle: number; phase: string };
type NativeChevronTransition = { property: string; duration: number | string; sampledAt: number };
type SampledChevron = SVGSVGElement & { __samples?: {
  values: ChevronSample[]; transitions: NativeChevronTransition[]; frame: number; stop: boolean; cleanup: () => void; settled: Promise<void> | null;
} };

async function rotateChevron(arrow: Locator, size: number, opened: boolean, motion: boolean, action: () => Promise<void>) {
  await expect(arrow).toHaveCount(1);
  expect(await arrow.evaluate(element => element.tagName.toLowerCase())).toBe('svg');
  await expect(arrow).toHaveCSS('width', `${size}px`);
  await expect(arrow).toHaveCSS('height', `${size}px`);
  await expect(arrow).toHaveCSS('flex-shrink', '0');
  await expect(arrow).toHaveCSS('transform-box', 'view-box');
  await expect(arrow).toHaveCSS('transition-duration', motion ? '0.16s' : '0s');
  const handle = (await arrow.elementHandle())!;
  const path = await handle.innerHTML();
  await arrow.evaluate((element, motion) => {
    const svg = element as SampledChevron;
    const samples = { values: [] as ChevronSample[], transitions: [] as NativeChevronTransition[], frame: 0, stop: false, cleanup: () => {}, settled: null as Promise<void> | null };
    svg.__samples = samples;
    const record = (phase: string) => {
      const box = svg.getBoundingClientRect();
      const owner = svg.closest('summary,button')!.getBoundingClientRect();
      const matrix = new DOMMatrix(getComputedStyle(svg).transform);
      samples.values.push({ x: box.x + box.width / 2 - owner.right, y: box.y + box.height / 2 - (owner.y + owner.height / 2),
        width: box.width, height: box.height, angle: Math.abs(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI), phase });
    };
    const sampleNativeTransition = () => {
      if (!motion || samples.transitions.length || samples.stop) return;
      const transition = svg.getAnimations().find(animation =>
        'transitionProperty' in animation && animation.transitionProperty === 'transform');
      if (!transition?.effect) return;
      const duration = transition.effect.getComputedTiming().duration;
      samples.transitions.push({ property: 'transform', duration: typeof duration === 'number' ? duration : String(duration), sampledAt: performance.now() });
      if (typeof duration !== 'number') return;
      // Sample the real browser-created CSS transition, not substitute CSS or
      // keyframes. Desktop WebKit can stall a frame longer than its 160ms run.
      transition.pause();
      for (const fraction of [0.25, 0.5, 0.75]) {
        transition.currentTime = duration * fraction;
        record(`native-transition-${fraction}`);
      }
      transition.finish();
      record('native-transition-finished');
      // Commit the finished native transition before testing a new full-length
      // reversal. An endpoint style alone can precede WebKit's paint cleanup.
      samples.settled = transition.finished.then(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          record('native-transition-settled');
          resolve();
        }));
      }));
    };
    svg.addEventListener('transitionrun', sampleNativeTransition);
    samples.cleanup = () => svg.removeEventListener('transitionrun', sampleNativeTransition);
    const sample = () => {
      if (samples.stop) return;
      record('frame');
      sampleNativeTransition();
      samples.frame = requestAnimationFrame(sample);
    };
    sample();
  }, motion);
  let samples: ChevronSample[] = [];
  let transitions: NativeChevronTransition[] = [];
  try {
    await action();
    await expect.poll(() => arrow.evaluate((element, opened) => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return Math.abs(matrix.a - (opened ? -1 : 1)) < 0.000001 && Math.abs(matrix.b) < 0.000001;
    }, opened)).toBe(true);
    await arrow.evaluate(async element => { await (element as SampledChevron).__samples!.settled; });
    await expect.poll(() => arrow.evaluate(element => element.getAnimations().filter(animation =>
      'transitionProperty' in animation && animation.transitionProperty === 'transform').length)).toBe(0);
  } finally {
    const captured = await arrow.evaluate(element => {
      const state = (element as SampledChevron).__samples!;
      state.stop = true; cancelAnimationFrame(state.frame); state.cleanup();
      return { values: state.values, transitions: state.transitions };
    });
    samples = captured.values;
    transitions = captured.transitions;
  }
  expect(await handle.evaluate(element => element.isConnected)).toBe(true);
  expect(await handle.innerHTML()).toBe(path);
  expect(samples.length).toBeGreaterThan(0);
  const first = samples[0];
  const endpoint = await arrow.evaluate(element => {
    const box = element.getBoundingClientRect();
    const owner = element.closest('summary,button')!.getBoundingClientRect();
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { x: box.x + box.width / 2 - owner.right, y: box.y + box.height / 2 - (owner.y + owner.height / 2), a: matrix.a, b: matrix.b };
  });
  expect(Math.abs(endpoint.x - first.x)).toBeLessThanOrEqual(0.6);
  expect(Math.abs(endpoint.y - first.y)).toBeLessThanOrEqual(0.6);
  expect(endpoint.a).toBeCloseTo(opened ? -1 : 1, 6);
  expect(endpoint.b).toBeCloseTo(0, 6);
  for (const sample of samples) {
    expect(Math.abs(sample.x - first.x), 'arrow rotation keeps its center fixed within the control').toBeLessThanOrEqual(0.6);
    expect(Math.abs(sample.y - first.y), 'arrow does not jump around its baseline').toBeLessThanOrEqual(0.6);
    expect(Math.abs(sample.width - sample.height), 'SVG footprint stays square throughout rotation').toBeLessThanOrEqual(0.6);
    expect(sample.width).toBeLessThanOrEqual(size * Math.SQRT2 + 0.6);
  }
  const intermediate = samples.filter(sample => sample.angle > 1 && sample.angle < 179);
  if (motion) {
    expect(transitions).toEqual([expect.objectContaining({ property: 'transform', duration: 160 })]);
    for (const fraction of [0.25, 0.5, 0.75]) {
      expect(intermediate.some(sample => sample.phase === `native-transition-${fraction}`), 'verify the actual native transition at each intermediate progress').toBe(true);
    }
  } else {
    expect(transitions).toEqual([]);
    expect(intermediate).toEqual([]);
  }
  return samples;
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

test('empty create panel has persistent search, tab counts and only Save in the footer', async ({ page }, testInfo) => {
  const fixture = await openMap(page, { create: true });
  await openLayers(page);
  await expect(panel(page).getByRole('searchbox', { name: 'Buscar camada', exact: true })).toBeVisible();
  await expect(panel(page).locator('.maono-layer-panel__header')).not.toContainText(/\d+ camadas?/);
  await expect(panel(page).locator('.maono-layer-panel__mode')).toHaveCount(0);
  await expect(panel(page)).not.toContainText(/Novo mapa|\bQuota\b|\bCota\b|19 restantes|98 MB/i);
  await expect(panel(page).getByRole('button', { name: 'Adicionar camada', exact: true })).toBeVisible();
  const footer = panel(page).locator('.maono-layer-panel__save-footer');
  await expect(footer.getByRole('button')).toHaveCount(1);
  await expect(footer.getByRole('button')).toHaveText('Salvar como projeto');
  await visualEvidence(page, testInfo, 'minimal-empty-layers');
  await openFilters(page);
  await expect(panel(page).locator('.maono-layer-panel__header')).not.toContainText(/\d+ camadas?/);
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
  await expect(header).not.toContainText(/\d+ camadas?/);
  const search = panel(page).getByRole('searchbox', { name: 'Buscar camada', exact: true });
  await search.fill('Camada 02');
  await expect(rows(page)).toHaveCount(1);
  await expect(header).not.toContainText(/\d+ camadas?/);
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
  await expect(header).not.toContainText(/\d+ camadas?/);
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
  await rows(page).first().dragTo(rows(page).nth(2), { sourcePosition: { x: 8, y: 18 }, targetPosition: { x: 50, y: 50 } });
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
  const originalAccent = await rows(page).first().locator('.maono-layer-row__swatch').evaluate(element => getComputedStyle(element).backgroundColor);
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
  await expect(detail.getByRole('button', { name: 'Sobre o agrupamento espacial', exact: true })).toBeFocused();
  await assertPinnedLayerChrome(page, pinnedBefore);
  await page.keyboard.press('Tab');
  await expect(detail.locator('.maono-point-spatial-grouping__switch input')).toBeFocused();
  await assertPinnedLayerChrome(page, pinnedBefore);
  await visualEvidence(page, testInfo, 'minimal-native-layer-detail');
  let vis = savedVisState(await saveMap(page, fixture));
  expect(vis.layers[0].config.color).toEqual([38, 127, 164]);
  expect(vis.layers[0].config.visConfig.opacity).toBeCloseTo(opacity / 100);
  expect(vis.layers[0].config.visConfig.radius).toBeCloseTo(radius);
  await detail.getByRole('combobox', { name: 'Raio orientado por campo', exact: true }).selectOption('value');
  await expect(detail.getByRole('slider', { name: 'Raio mínimo', exact: true })).toBeVisible();
  const minimum = await nudgeRange(detail.locator('.maono-style-range').filter({ hasText: /^Raio mínimo/ }).locator('input[type=range]'), 'Home', 4);
  vis = savedVisState(await saveMap(page, fixture));
  expect(vis.layers[0].visualChannels.sizeField).toMatchObject({ name: 'value' });
  expect(vis.layers[0].config.visConfig.radiusRange[0]).toBe(minimum);
  await detail.getByRole('button', { name: 'Voltar para a lista de camadas', exact: true }).click();
  await expect(rows(page).first().locator('.maono-layer-row__swatch')).toHaveCSS('background-color', originalAccent);
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
  await extentGuide(filterEditor(page).locator(':scope > .maono-detail-view__scroll'), 'filter', page.viewportSize()!.width);
  await expect(filterEditor(page).getByRole('button', { name: 'Desativar filtro category', exact: true })).toBeVisible();
  const originalFilterId = (await capture(page)).snapshot.filterIds[0];
  await expect(filterEditor(page).locator('.maono-filter-category__options label')).toHaveCount(3);
  await filterEditor(page).getByRole('checkbox', { name: 'B', exact: true }).check();
  await visualEvidence(page, testInfo, 'minimal-native-category');
  expect((await exportRows(page)).map(row => row.name)).toEqual(['Linha 4', 'Linha 5']);
  await filterEditor(page).locator('.maono-detail-view__visibility').click();
  await expect(filterEditor(page).locator('.maono-detail-view__visibility')).toHaveAttribute('aria-pressed', 'false');
  expect(await exportRows(page)).toHaveLength(6);
  const disabledSaved = savedVisState(await saveMap(page, fixture));
  expect(disabledSaved.filters[0]).toMatchObject({ id: originalFilterId, enabled: false, value: ['B'] });
  await expect(filterEditor(page).locator('.maono-detail-view__visibility')).toHaveAttribute('aria-pressed', 'false');
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
  await expect(filterEditor(page).locator('.maono-detail-view__visibility')).toHaveAttribute('aria-pressed', 'false');
  expect(await exportRows(page)).toHaveLength(6);
  expect((await capture(page)).snapshot.filterIds).toEqual([originalFilterId]);
  await filterEditor(page).locator('.maono-detail-view__visibility').click();
  expect((await exportRows(page)).map(row => row.category)).toEqual(['B', 'B']);
  const beforeSaveCount = fixture.saves.length;
  const expectedRevision = fixture.saves.at(-1)!.expectedConfigRevision + 1;
  const release = fixture.holdNextSave();
  const save = panel(page).locator('.maono-layer-panel__save-button');
  const loadsBefore = fixture.configLoads;
  const committed = page.waitForResponse(response => response.request().method() === 'PUT' && /\/save-operations\/[^/]+\/payload$/.test(new URL(response.url()).pathname));
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
  await expect(save).toBeEnabled();
  expect(fixture.configLoads).toBe(loadsBefore);
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
  await filterEditor(page).locator('.maono-detail-view__visibility').click();
  vis = savedVisState(await saveMap(page, fixture));
  expect(vis.filters[0]).toMatchObject({ type: 'range', enabled: false, value: [20, 50] });
  await expect(filterEditor(page).locator('.maono-detail-view__visibility')).toHaveAttribute('aria-pressed', 'false');
  // GPU range/time behavior is separately verified by native table tests; CSV
  // row count is deliberately not used as a proxy for rendered GPU filtering.
  await filterEditor(page).locator('.maono-detail-view__visibility').click();
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
  await filterEditor(page).locator('.maono-detail-view__visibility').click();
  vis = savedVisState(await saveMap(page, fixture));
  expect(vis.filters[0]).toMatchObject({ type: 'timeRange', enabled: false, value: preservedTimeValue });
  await expect(filterEditor(page).locator('.maono-detail-view__visibility')).toHaveAttribute('aria-pressed', 'false');
  await filterEditor(page).locator('.maono-detail-view__visibility').click();
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
  await filterEditor(page).locator('.maono-detail-view__visibility').click();
  expect(await exportRows(page)).toHaveLength(6);
  vis = savedVisState(await saveMap(page, fixture));
  expect(vis.filters[0]).toMatchObject({ type: 'select', enabled: false, value: true });
  await expect(filterEditor(page).locator('.maono-detail-view__visibility')).toHaveAttribute('aria-pressed', 'false');
  expect(await exportRows(page)).toHaveLength(6);
  await filterEditor(page).locator('.maono-detail-view__visibility').click();
  expect(await exportRows(page)).toHaveLength(3);
  await filterEditor(page).getByRole('radio', { name: 'Não / falso', exact: true }).check();
  expect((await exportRows(page)).map(row => row.name)).toEqual(['Linha 2', 'Linha 4', 'Linha 6']);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('dataset groups are cardless with stable sidebar identities and one rotating accordion chevron', async ({ page }, testInfo) => {
  const fixture = await openMap(page, { layerCount: 2, groups: true });
  await openLayers(page);
  const sidebarColors = await rows(page).locator('.maono-layer-row__swatch').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor));
  await openFilters(page);
  const groups = panel(page).locator('.maono-filter-group');
  await expect(groups).toHaveCount(2);
  await cardless(groups.first());
  await expect(groups.first().locator('.maono-filter-group__accent')).toHaveCSS('background-color', sidebarColors[0]);
  await expect(groups.nth(1).locator('.maono-filter-group__accent')).toHaveCSS('background-color', sidebarColors[1]);
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
  await extentGuide(filterEditor(page).locator(':scope > .maono-detail-view__scroll'), 'filter', page.viewportSize()!.width);
  await expect(panel(page).locator('.maono-filter-panel__toolbar')).toBeVisible();
  await filterEditor(page).getByRole('button', { name: 'Recolher condição', exact: true }).click();
  await expect(filterEditor(page)).toHaveCount(0);
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
    await layerExtentGuides(detail, viewport.width);
    await detail.locator('summary').filter({ hasText: 'Dimensão e agrupamento' }).click();
    await stableChromeAfterScroll(page, detail.locator('.maono-detail-view__scroll'), detail.locator('.maono-detail-view__header'));
    const detailChrome = await Promise.all(layerChrome(page).map(locator => locator.boundingBox()));
    const radius = detail.getByRole('slider', { name: 'Raio do ponto', exact: true });
    await radius.focus();
    await radius.press('Tab');
    await expect(detail.getByRole('button', { name: 'Sobre o agrupamento espacial', exact: true })).toBeFocused();
    await assertPinnedLayerChrome(page, detailChrome);
    await page.keyboard.press('Tab');
    await expect(detail.locator('.maono-point-spatial-grouping__switch input')).toBeFocused();
    await assertPinnedLayerChrome(page, detailChrome);
    await expectStableCanvas(page, canvas);
    await movePointerToMap(page);
    await page.screenshot({ path: testInfo.outputPath(`minimal-layer-detail-${viewport.width}x${viewport.height}.png`) });
    await openFilters(page);
    await panel(page).locator('.maono-filter-group__toggle').first().click();
    await panel(page).locator('.maono-filter-row__open').first().click();
    const filterGuide = await extentGuide(filterEditor(page).locator(':scope > .maono-detail-view__scroll'), 'filter', viewport.width);
    await testInfo.attach('inline-filter-guide', { body: JSON.stringify(filterGuide, null, 2), contentType: 'application/json' });
    await filterEditor(page).getByRole('button', { name: 'Recolher condição', exact: true }).click();
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
    await extentGuide(filterEditor(page).locator(':scope > .maono-detail-view__scroll'), 'filter', 320);
    await filterEditor(page).getByRole('checkbox', { name: 'A', exact: true }).tap();
    expect(await exportRows(page)).toHaveLength(3);
    await expect(panel(page).locator('.maono-layer-panel__save-button')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await movePointerToMap(page);
    await page.screenshot({ path: testInfo.outputPath('minimal-panel-mobile-inline.png') });
    expect(fixture.unexpectedWrites).toEqual([]);
  });
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 320, height: 480 }]) {
  test(`disclosure chevrons keep square SVGs centered through keyboard rotation and reduced motion at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
    const fixture = await openMap(page, { layerCount: 1 });
    const canvas = await canvasGeometry(page, true);
    await openLayers(page);
    const evidence: Array<{ label: string; phase: string; samples: ChevronSample[] }> = [];
    const add = panel(page).getByRole('button', { name: 'Adicionar camada', exact: true });
    const addArrow = add.locator(':scope > svg:last-child');
    await add.focus();
    evidence.push({ label: 'Adicionar camada', phase: 'open', samples: await rotateChevron(addArrow, 11, true, true, () => add.press('Enter')) });
    await expect(add).toHaveAttribute('aria-expanded', 'true');
    evidence.push({ label: 'Adicionar camada', phase: 'close', samples: await rotateChevron(addArrow, 11, false, true, () => page.keyboard.press('Escape')) });
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    await expect(add).toBeFocused();
    await rows(page).first().locator('.maono-layer-row__open').click();
    const detail = panel(page).locator('.maono-detail-view').filter({ has: page.locator('.maono-layer-style-editor') });
    const disclosures = ['Aparência', 'Dimensão e agrupamento', 'Avançado', 'Dados'].map(label => {
      const section = detail.locator('details').filter({ has: page.locator('summary strong', { hasText: new RegExp(`^${label}$`) }) });
      const summary = section.locator(':scope > summary');
      return { label, section, summary, arrow: summary.locator(':scope > svg'), size: label === 'Dados' ? 15 : 16 };
    });
    for (const item of disclosures) {
      await item.summary.scrollIntoViewIfNeeded();
      await item.summary.focus();
      evidence.push({ label: item.label, phase: 'open', samples: await rotateChevron(item.arrow, item.size, true, true, () => item.summary.press('Enter')) });
      await expect(item.section).toHaveAttribute('open', '');
      await expect(item.summary).toBeFocused();
      evidence.push({ label: item.label, phase: 'close', samples: await rotateChevron(item.arrow, item.size, false, true, () => item.summary.press('Space')) });
      await expect(item.section).not.toHaveAttribute('open', '');
      await expect(item.summary).toBeFocused();
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    for (const item of disclosures) {
      await item.summary.scrollIntoViewIfNeeded();
      evidence.push({ label: item.label, phase: 'reopen-reduced', samples: await rotateChevron(item.arrow, item.size, true, false, () => item.summary.press('Enter')) });
      await expect(item.section).toHaveAttribute('open', '');
      evidence.push({ label: item.label, phase: 'close-reduced', samples: await rotateChevron(item.arrow, item.size, false, false, () => item.summary.press('Enter')) });
      await expect(item.section).not.toHaveAttribute('open', '');
    }
    await detail.getByRole('button', { name: 'Voltar para a lista de camadas', exact: true }).click();
    evidence.push({ label: 'Adicionar camada', phase: 'reopen-reduced', samples: await rotateChevron(addArrow, 11, true, false, () => add.press('Enter')) });
    evidence.push({ label: 'Adicionar camada', phase: 'close-reduced', samples: await rotateChevron(addArrow, 11, false, false, () => page.keyboard.press('Escape')) });
    await expect(add).toBeFocused();
    await expectStableCanvas(page, canvas);
    await testInfo.attach('disclosure-chevron-geometry', { body: JSON.stringify({ viewport, evidence }, null, 2), contentType: 'application/json' });
    expect(fixture.saves).toEqual([]);
    expect(fixture.unexpectedWrites).toEqual([]);
  });
}

for (const viewport of [{ width: 1280, height: 480 }, { width: 320, height: 480 }]) {
  test.describe(`contextual panel help at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width === 320 });
    test('hover, keyboard and click/touch expose unclipped hints without collapsing the panel or moving the canvas', async ({ page }, testInfo) => {
      const fixture = await openMap(page, { layerCount: 1 });
      const canvas = await canvasGeometry(page, true);
      await openLayers(page);
      await rows(page).first().locator('.maono-layer-row__open').click();
      const detail = panel(page).locator('.maono-detail-view').filter({ has: page.locator('.maono-layer-style-editor') });
      const dimension = detail.locator('details').filter({ has: page.locator('summary strong', { hasText: /^Dimensão e agrupamento$/ }) });
      await dimension.locator('summary').click();
      const trigger = detail.getByRole('button', { name: 'Sobre o agrupamento espacial', exact: true });
      const explanation = 'Os agrupamentos são uma representação interna da mesma camada. A visibilidade, a ordem e o estilo lógico permanecem únicos no painel.';
      await expect(trigger).toBeVisible();
      await expect(detail.locator('.maono-point-spatial-grouping__description')).toHaveCount(0);
      await expect(page.locator('.maono-panel-hint__popover[role="tooltip"]')).toHaveCount(0);
      await startHintProbe(trigger, viewport.width === 320);
      await trigger.scrollIntoViewIfNeeded();
      await hintProbeCheckpoint(page, 'after-scroll-into-view');
      const chrome = await Promise.all(layerChrome(page).map(locator => locator.boundingBox()));

      await trigger.hover();
      await hintProbeCheckpoint(page, 'after-hover');
      const tooltip = await hintPortal(page, trigger, explanation);
      await hintProbeCheckpoint(page, 'first-hover-passed', true);
      await tooltip.hover();
      await expect(tooltip).toBeVisible();
      await movePointerToMap(page);
      await expect(tooltip).toHaveCount(0);

      // Reach the help through the real keyboard order rather than dispatching
      // synthetic component events. The focused range is immediately before it.
      const radius = detail.getByRole('slider', { name: 'Raio do ponto', exact: true });
      await radius.focus();
      await radius.press('Tab');
      await expect(trigger).toBeFocused();
      await hintPortal(page, trigger, explanation);
      await page.keyboard.press('Escape');
      await expect(tooltip).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(dimension).toHaveAttribute('open', '');
      await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'true');
      await assertPinnedLayerChrome(page, chrome);

      await trigger.press('Enter');
      await hintPortal(page, trigger, explanation);
      await movePointerToMap(page);
      await expect(tooltip).toBeVisible();
      await trigger.press('Enter');
      await expect(tooltip).toHaveCount(0);
      await trigger.press('Space');
      await hintPortal(page, trigger, explanation);
      await page.keyboard.press('Tab');
      await expect(tooltip).toHaveCount(0);
      await expect(detail.locator('.maono-point-spatial-grouping__switch input')).toBeFocused();
      await assertPinnedLayerChrome(page, chrome);

      const activate = async () => viewport.width === 320 ? trigger.tap() : trigger.click();
      await activate();
      await hintPortal(page, trigger, explanation);
      await activate();
      await expect(tooltip).toHaveCount(0);
      await activate();
      await hintPortal(page, trigger, explanation);
      await panel(page).locator('.maono-layer-panel__header').click();
      await expect(tooltip).toHaveCount(0);
      await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'true');
      await expectStableCanvas(page, canvas);

      await activate();
      await hintPortal(page, trigger, explanation);
      await page.screenshot({ path: testInfo.outputPath(`minimal-panel-grouping-hint-${viewport.width}x${viewport.height}.png`) });
      await page.keyboard.press('Escape');
      const advanced = detail.locator('details').filter({ has: page.locator('summary strong', { hasText: /^Avançado$/ }) });
      await advanced.locator('summary').click();
      const composition = detail.getByRole('button', { name: 'Sobre os modos de composição', exact: true });
      await expect(composition).toBeVisible();
      await composition.focus();
      await hintPortal(page, composition, 'Estes modos são globais e afetam a composição de todas as camadas.');
      await composition.press('Enter');
      if (viewport.width === 320) await tooltip.tap();
      else await tooltip.click();
      await expect(tooltip).toBeVisible();
      await expect(page.getByRole('region', { name: 'Configuração de tooltips', exact: true })).toHaveCount(0);
      const scroll = detail.locator('.maono-detail-view__scroll');
      expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await scroll.hover({ position: { x: 2, y: 2 } });
      await page.mouse.wheel(0, -1500);
      await expect(composition).not.toBeInViewport();
      await expect(tooltip).toHaveCount(0);
      await radius.focus();
      await composition.focus();
      await hintPortal(page, composition, 'Estes modos são globais e afetam a composição de todas as camadas.');
      await page.keyboard.press('Escape');
      await expect(tooltip).toHaveCount(0);
      await expect(advanced).toHaveAttribute('open', '');
      await expect(page.locator('.maono-map-panel-host')).toHaveAttribute('data-panel-open', 'true');
      await expectStableCanvas(page, canvas);
      expect(fixture.saves).toEqual([]);
      expect(fixture.unexpectedWrites).toEqual([]);
    });
  });
}

for (const conflictStatus of [202, 409]) test(`${conflictStatus} conflict preserves edited layer state and offers support without an impossible retry`, async ({ page }, testInfo) => {
  if (conflictStatus === 202) await page.setViewportSize({ width: 1280, height: 480 });
  const fixture = await openMap(page, { layerCount: 1 });
  await openLayers(page);
  await renameFirstLayer(page, 'Edição preservada');
  fixture.rejectSaves(conflictStatus);
  const save = panel(page).locator('.maono-layer-panel__save-button');
  await save.click();
  await expect.poll(() => fixture.saves.length).toBe(1);
  await expect(panel(page).locator('.maono-layer-panel__save-message[role=alert]')).toBeVisible();
  await expect(save).toHaveCount(0);
  await expect(rows(page).first().locator('.maono-layer-row__open strong')).toHaveText('Edição preservada');
  await expect(panel(page)).not.toContainText(/tentativa|7 dias|revisão|Referência:/);
  await expect(panel(page).getByRole('button', { name: 'Abrir central de chamados' })).toBeVisible();
  if (conflictStatus === 202) {
    const message = await panel(page).locator('.maono-layer-panel__save-message').boundingBox();
    const footer = await panel(page).locator('.maono-layer-panel__save-footer').boundingBox();
    expect(message!.height).toBeGreaterThan(30);
    expect(footer!.height).toBeLessThanOrEqual(241);
    await visualEvidence(page, testInfo, 'durable-save-terminal-actions');
  }
  const retained = await page.evaluate(async () => new Promise<any[]>((resolve, reject) => {
    const open = indexedDB.open('maono-explicit-save-operations');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('operations'), request = tx.objectStore('operations').getAll();
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
  expect(retained).toHaveLength(1);
  expect(retained[0].manifest.operationId).toBe(fixture.saves[0].operationId);
  expect(retained[0].serialized.body).not.toBeNull();
  expect(retained[0].expectedConfigRevision).toBe(fixture.saves[0].expectedConfigRevision);
  const failedId = fixture.saves[0].operationId;
  // The UI never discards a conflict or silently starts a different save.
  expect(fixture.manifests).toHaveLength(1);
  expect(fixture.operationState(failedId)).toBe('CONFLICT');
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('delayed receipt preserves the received operation and newer edits without requiring recovery choices', async ({ page }) => {
  const fixture = await openMap(page, { layerCount: 1 });
  await openLayers(page);
  await renameFirstLayer(page, 'Snapshot do clique');
  const before = await canvasGeometry(page, true);
  const loadsBefore = fixture.configLoads;
  const release = fixture.holdNextSave();
  const save = panel(page).locator('.maono-layer-panel__save-button');
  await save.click();
  await expect.poll(() => fixture.saves.length).toBe(1);
  await expect(save).toBeDisabled();
  await renameFirstLayer(page, 'Edição posterior mantida');
  await expect(save).toHaveText('Salvando…');
  await expect(panel(page)).not.toContainText(/tentativa|7 dias|revisão|Parar de esperar/);
  release();
  await expect.poll(() => fixture.revision).toBe(2);
  await expect(save).toBeEnabled();
  await expect(panel(page).locator('.maono-layer-panel__save-message')).toContainText('Há alterações ainda não salvas');
  expect(fixture.manifests).toHaveLength(1);
  expect(fixture.saves).toHaveLength(1);
  expect(savedVisState(fixture.saves[0]).layers[0].config.label).toBe('Snapshot do clique');
  await expect(rows(page).first().locator('.maono-layer-row__open strong')).toHaveText('Edição posterior mantida');
  expect((await capture(page)).snapshot.hasUnsavedChanges).toBe(true);
  expect(fixture.configLoads).toBe(loadsBefore);
  await expectStableCanvas(page, before);
  // Newer edits can build on this editor's own confirmed commit, without marking them clean early.
  const newerSave = await saveMap(page, fixture);
  expect(newerSave.expectedConfigRevision).toBe(2);
  expect(savedVisState(newerSave).layers[0].config.label).toBe('Edição posterior mantida');
  expect(fixture.revision).toBe(3);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test('viewer retains truthful counts and inspection without exposing mutation controls or Save', async ({ page }) => {
  const fixture = await openMap(page, { layerCount: 2, groups: true, viewer: true });
  await openLayers(page);
  await expect(panel(page).getByRole('searchbox', { name: 'Buscar camada', exact: true })).toBeVisible();
  await expect(panel(page).locator('.maono-layer-panel__header')).not.toContainText(/\d+ camadas?/);
  await expect(panel(page).locator('.maono-layer-panel__save-footer')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Adicionar camada', exact: true })).toHaveCount(0);
  await expect(rows(page).locator('.maono-layer-row__visibility')).toHaveCount(0);
  await rows(page).first().locator('.maono-layer-row__open').click();
  await expect(panel(page).locator('.maono-layer-inspector__notice')).toHaveText('Modo de visualização: a aparência permanece somente leitura.');
  await panel(page).locator('summary').filter({ hasText: 'Dimensão e agrupamento' }).click();
  await expect(panel(page).locator('.maono-point-spatial-grouping__notice')).toHaveText('Modo de visualização: as configurações permanecem somente leitura.');
  await expect(panel(page).locator('.maono-point-spatial-grouping__notice')).toBeVisible();
  await expect(page.locator('.maono-panel-hint__popover[role="tooltip"]')).toHaveCount(0);
  await openFilters(page);
  await expect(panel(page).getByRole('button', { name: 'Adicionar Filtro', exact: true })).toHaveCount(0);
  await panel(page).locator('.maono-filter-group__toggle').first().click();
  await panel(page).locator('.maono-filter-row__open').first().click();
  await expect(filterEditor(page).locator('.maono-detail-view__visibility')).toBeDisabled();
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

test('save support opens the actual organization ticket center and new-ticket form without leaving the editor', async ({ page, context }) => {
  const fixture = await openMap(page, { layerCount: 1 });
  fixture.rejectSaves(409);
  await openLayers(page);
  await panel(page).locator('.maono-layer-panel__save-button').click();
  await expect(panel(page).getByRole('button', { name: 'Abrir central de chamados' })).toBeVisible();
  // Page-specific map routes remain authoritative in the editor. The new tab
  // receives synthetic account/list data while running the real /projects app.
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') throw new Error(`Unexpected support write: ${route.request().method()} ${url.pathname}`);
    if (url.pathname === '/api/session') return route.fulfill({ json: {
      authenticated: true, user: { id: 1, name: 'Operador sintético QA', email: 'panel@example.test', role: 'super_admin', activeOrganizationId: 1 },
      organizations: [{ id: 1, name: 'Organização sintética QA', slug: 'qa-panel', active: true }],
      activeOrganization: { id: 1, name: 'Organização sintética QA', slug: 'qa-panel', active: true }, projects: [],
    } });
    if (url.pathname === '/api/organizations/1/tickets') return route.fulfill({ json: {
      ok: true, tickets: [], assignees: [],
      facets: { byStatus: { new: 0, open: 0, in_progress: 0, in_review: 0, closed: 0 }, overdue: 0 },
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1, hasMore: false },
      attachmentLimits: { maxFiles: 5, maxFileBytes: 83886080, maxTicketBytes: 157286400, chunkBytes: 8388608 },
    } });
    if (url.pathname === '/api/organizations/1/tickets/exports') return route.fulfill({ json: { ok: true, enabled: false, jobs: [], nextCursor: null } });
    if (/\/ticket-(notifications|feedback|knowledge|cases)$|\/tickets\/metrics$/.test(url.pathname)) return route.fulfill({ json: { ok: true, enabled: false, items: [], unread: 0, nextCursor: null } });
    return route.fulfill({ json: { ok: true, items: [], projects: [], users: [] } });
  });
  const popupPromise = page.waitForEvent('popup');
  await panel(page).getByRole('button', { name: 'Abrir central de chamados' }).click();
  const support = await popupPromise;
  await expect(support).toHaveURL(/\/projects\?cc_org=1/);
  await expect(support.getByRole('heading', { name: 'Central de Chamados', exact: true })).toBeVisible();
  await support.getByRole('button', { name: 'Novo chamado', exact: true }).first().click();
  await expect(support.getByRole('dialog', { name: 'Novo chamado', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/panel-synthetic\/edit/);
  expect(fixture.saves).toHaveLength(1);
  expect(fixture.unexpectedWrites).toEqual([]);
});
