import { expect, test, type Locator, type Page } from '@playwright/test';
import { build } from 'esbuild';

// Production LayerList and insertion helper mounted with synthetic callback state.
// This lightweight fixture does not claim integrated Kepler rendering or persistence.
let javascript = '';
let stylesheet = '';
const initialIds = ['a', 'b', 'c', 'd'];
const row = (page: Page, id: string) => page.locator(`.maono-layer-row[data-layer-id="${id}"]`);
const order = (page: Page) => page.locator('.maono-layer-row').evaluateAll(elements => elements.map(element => element.getAttribute('data-layer-id')));

test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: `
      import { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import LayerList from './src/pages/Kepler/components/maono-layer-panel/LayerList';
      import { reorderLayerIdsAtTarget } from './src/pages/Kepler/components/maono-layer-panel/layer-drop-order';
      import './src/pages/Kepler/components/maono-layer-panel/maono-layer-panel.css';
      import './src/pages/Kepler/components/maono-layer-panel/map-panel-minimal.css';
      const initial = ['a', 'b', 'c', 'd'];
      const accents = new Map([['a', '#f2c766'], ['b', '#cbd0d6'], ['c', '#ffffff'], ['d', '#c5a059']]);
      const noop = () => {};
      function Fixture() {
        const [ids, setIds] = useState(initial);
        const [commands, setCommands] = useState([]);
        const [canReorder, setCanReorder] = useState(true);
        const [search, setSearch] = useState('');
        return <>
          <main className="maono-map-runtime"><div className="maono-layer-panel">
            <LayerList layers={ids.map(id => ({ id, label: 'Camada ' + id, type: 'point', isVisible: true }))}
              sidebarAccents={accents} selectedLayerId={null} search={search}
              canInspect canToggle canRename canDuplicate canRemove canReorder={canReorder}
              onOpen={noop} onToggle={noop} onRename={() => true} onDuplicate={noop} onRemove={noop} onMove={noop} onMoveTo={noop}
              onReorder={(source, target, position) => {
                const next = reorderLayerIdsAtTarget(ids, source, target, position);
                if (next) { setCommands(items => [...items, next]); setIds(next); }
              }} />
          </div></main>
          <button id="reset" onClick={() => { setIds(initial); setCommands([]); setCanReorder(true); setSearch(''); }}>Reset</button>
          <button id="permission" onClick={() => setCanReorder(value => !value)}>Permission</button>
          <button id="search" onClick={() => setSearch(value => value ? '' : 'Camada')}>Search</button>
          <div id="outside" style={{ width: 200, height: 80 }}>Outside</div>
          <output id="commands">{JSON.stringify(commands)}</output>
        </>;
      }
      createRoot(document.getElementById('root')).render(<Fixture />);
    `, loader: 'tsx', sourcefile: 'layer-reorder-fixture.tsx', resolveDir: process.cwd() },
    bundle: true, write: false, outfile: 'layer-reorder-fixture.js', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  javascript = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  stylesheet = result.outputFiles.find(file => file.path.endsWith('.css'))!.text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent(`<style>${stylesheet}\nbody{margin:0;background:#101217;color:#eee}.maono-layer-panel{width:360px;height:auto}.maono-layer-list-region{overflow:visible}</style><div id="root"></div>`);
  await page.addScriptTag({ content: javascript });
  await expect(page.locator('.maono-layer-row')).toHaveCount(4);
});

async function position(target: Locator, side: 'before' | 'after') {
  const box = (await target.boundingBox())!;
  return { x: 50, y: box.height * (side === 'before' ? .25 : .75) };
}

async function dragHover(page: Page, source: Locator, target: Locator, side: 'before' | 'after') {
  const grip = (await source.locator('.maono-layer-row__grip').boundingBox())!;
  const box = (await target.boundingBox())!;
  const at = await position(target, side);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 10, grip.y + grip.height / 2 + 10, { steps: 3 });
  await page.mouse.move(box.x + at.x, box.y + at.y, { steps: 6 });
  await page.mouse.move(box.x + at.x, box.y + at.y);
}

test('every grip source and row edge produces its exact insertion order, including adjacent no-ops and self-drops', async ({ page }) => {
  test.setTimeout(90_000);
  for (const source of initialIds) for (const target of initialIds) for (const side of ['before', 'after'] as const) {
    await page.locator('#reset').click();
    await row(page, source).locator('.maono-layer-row__grip').dragTo(row(page, target), { targetPosition: await position(row(page, target), side) });
    const expected = source === target ? initialIds : initialIds.flatMap(id => id === source ? [] : id !== target ? [id]
      : side === 'before' ? [source, target] : [target, source]);
    await expect.poll(() => order(page), { message: `${source} ${side} ${target}` }).toEqual(expected);
    await expect(page.locator('#commands')).toHaveText(JSON.stringify(expected.join() === initialIds.join() ? [] : [expected]));
    await expect(page.locator('.is-drag-target, .is-dragging')).toHaveCount(0);
  }
});

test('the live indicator changes at the midpoint without moving rows, including below the last row', async ({ page }) => {
  const target = row(page, 'd');
  const before = await target.boundingBox();
  const identity = await row(page, 'c').locator('.maono-layer-row__swatch').evaluate(element => getComputedStyle(element).backgroundColor);
  await dragHover(page, row(page, 'c'), target, 'before');
  await expect(target).toHaveAttribute('data-drop-position', 'before');
  expect(await target.boundingBox()).toEqual(before);
  expect(await target.evaluate(element => getComputedStyle(element, '::after').top)).toBe('0px');
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + box.height * .75);
  await page.mouse.move(box.x + 51, box.y + box.height * .75);
  await expect(target).toHaveAttribute('data-drop-position', 'after');
  expect(await target.boundingBox()).toEqual(before);
  expect(await target.evaluate(element => ({ bottom: getComputedStyle(element, '::after').bottom, height: getComputedStyle(element, '::after').height, pointerEvents: getComputedStyle(element, '::after').pointerEvents }))).toEqual({ bottom: '0px', height: '2px', pointerEvents: 'none' });
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(['a', 'b', 'd', 'c']);
  expect(await row(page, 'c').locator('.maono-layer-row__swatch').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(identity);

  await dragHover(page, row(page, 'c'), row(page, 'a'), 'after');
  const first = (await row(page, 'a').boundingBox())!;
  await page.mouse.move(first.x + 50, first.y + first.height * .25);
  await page.mouse.move(first.x + 51, first.y + first.height * .25);
  await expect(row(page, 'a')).toHaveAttribute('data-drop-position', 'before');
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(['c', 'a', 'b', 'd']);
});

test('cancel, outside, external, search and permission-gated drops leave order and state clean', async ({ page }) => {
  await dragHover(page, row(page, 'a'), row(page, 'd'), 'after');
  await expect(row(page, 'd')).toHaveAttribute('data-drop-position', 'after');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.is-drag-target, .is-dragging')).toHaveCount(0);
  expect(await order(page)).toEqual(initialIds);
  await dragHover(page, row(page, 'a'), row(page, 'd'), 'after');
  await page.locator('#outside').hover();
  await expect(page.locator('.is-drag-target')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.is-dragging')).toHaveCount(0);
  expect(await order(page)).toEqual(initialIds);

  // Even a matching text/plain ID does not authorize an unrelated external drag.
  await row(page, 'd').evaluate(element => {
    const dataTransfer = new DataTransfer(); dataTransfer.setData('text/plain', 'a');
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientY: rect.bottom - 2 }));
  });
  expect(await order(page)).toEqual(initialIds);
  for (const control of ['permission', 'search']) {
    await page.locator(`#${control}`).click();
    await expect(page.locator('.maono-layer-row[draggable="true"]')).toHaveCount(0);
    await expect(page.locator('.maono-layer-row__grip')).toHaveCount(0);
    await page.locator(`#${control}`).click();
  }
  await expect(page.locator('#commands')).toHaveText('[]');
  await expect(page.locator('.is-drag-target, .is-dragging')).toHaveCount(0);
});
