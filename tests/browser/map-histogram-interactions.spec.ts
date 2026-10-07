import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";

let javascript = "";
let stylesheet = "";

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { Provider, useSelector } from 'react-redux';
        import { createStore } from 'redux';
        import FilterValueEditor from './src/pages/Kepler/components/maono-layer-panel/filters/FilterValueEditor';
        import './src/pages/Kepler/components/maono-layer-panel/filters/advanced-filters.css';
        const base = 1700000000000;
        const numericValues = [...Array.from({length:100},(_,i)=>i+1),1000000];
        const timeValues = Array.from({length:101},(_,i)=>base+i*10000);
        const filters = [
          { id:'numeric', dataId:['numeric-data'], name:['value'], type:'range', domain:[0,1000000], value:[10,10000], step:1, enabled:true },
          { id:'temporal', dataId:['time-data'], name:['value'], type:'timeRange', domain:[base,base+1000000], value:[base+123456,base+456789], enabled:true },
          { id:'constant', dataId:['constant-data'], name:['value'], type:'range', domain:[5,5], value:[5,5], step:1, enabled:true }
        ];
        const dataset = (id, values) => ({ id, fields:[{name:'value',type:'number'}], allData:values.map(value=>[value]), allIndexes:values.map((_,i)=>i), filteredIndex:values.map((_,i)=>i) });
        const initial = { demo:{keplerGl:{map:{visState:{ filters, datasets:{'numeric-data':dataset('numeric-data',numericValues),'time-data':dataset('time-data',timeValues),'constant-data':dataset('constant-data',[5,5])} }}}}, updates:[0,0,0] };
        const store = createStore((state=initial,action) => action.type !== 'range' ? state : ({ ...state,
          updates:state.updates.map((count,i)=>i===action.index?count+1:count),
          demo:{keplerGl:{map:{visState:{ ...state.demo.keplerGl.map.visState,
            filters:state.demo.keplerGl.map.visState.filters.map((filter,i)=>i===action.index?{...filter,value:action.value}:filter)
          }}}}
        }));
        function Fixture() {
          const state=useSelector(value=>value);
          const [editable,setEditable]=useState(true);
          const [submits,setSubmits]=useState(0);
          const [parentPointers,setParentPointers]=useState(0);
          return <form onSubmit={event=>{event.preventDefault();setSubmits(value=>value+1)}}>
            <div className="fixtures" onPointerDown={()=>setParentPointers(value=>value+1)}>
              {state.demo.keplerGl.map.visState.filters.map((filter,index)=><section key={filter.id} data-testid={filter.id}>
                <FilterValueEditor filter={{...filter,index,compatible:true}} editable={editable}
                  onChange={value=>store.dispatch({type:'range',index,value})}/>
                <output className="applied">{JSON.stringify(filter.value)}</output>
                <output className="updates">{state.updates[index]}</output>
                <output className="filtered">{(index===0?numericValues:index===1?timeValues:[5,5]).filter(value=>value>=filter.value[0]&&value<=filter.value[1]).length}</output>
              </section>)}
            </div>
            <button id="disable" type="button" onClick={()=>setEditable(false)}>Somente leitura</button>
            <button type="submit">Salvar</button><output id="submits">{submits}</output><output id="parentPointers">{parentPointers}</output>
          </form>;
        }
        createRoot(document.getElementById('root')).render(<Provider store={store}><Fixture/></Provider>);
      `,
      loader: "tsx",
      sourcefile: "histogram-interactions-fixture.tsx",
      resolveDir: process.cwd(),
    },
    bundle: true, write: false, outfile: "histogram-interactions-fixture.js", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  javascript = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  stylesheet = result.outputFiles.find(file => file.path.endsWith(".css"))!.text;
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.setContent(`<style>${stylesheet}body{margin:40px;background:#101217;color:#eee}.fixtures{display:grid;grid-template-columns:400px 400px;gap:40px 60px}section{width:400px}input{max-width:180px}output{display:block}.maono-filter-histogram__plot{margin:20px 12px}</style><div id="root"></div>`);
  await page.addScriptTag({ content: javascript });
  await page.evaluate(() => {
    document.addEventListener("pointerdown", event => {
      const plot = (event.target as Element).closest(".maono-filter-histogram__plot");
      if (plot) plot.setAttribute("data-native-pointer-id", String(event.pointerId));
    }, true);
  });
  await expect(page.getByTestId("numeric").locator(".maono-filter-histogram__meta")).toContainText("escala log");
});

async function range(editor: Locator): Promise<[number, number]> {
  return JSON.parse((await editor.locator(".applied").textContent())!);
}
async function box(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result!;
}
async function beginBandDrag(page: Page, editor: Locator) {
  const plot = editor.locator(".maono-filter-histogram__plot");
  const selection = await box(editor.locator(".maono-filter-histogram__selection"));
  const plotBox = await box(plot);
  const start = { x: selection.x + selection.width / 2, y: selection.y + selection.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(plot).toHaveAttribute("data-dragging", "window");
  return { plot, plotBox, selection, start };
}
async function expectNumericSync(editor: Locator) {
  const applied = await range(editor);
  await expect(editor.getByRole("spinbutton", { name: "Mínimo", exact: true })).toHaveValue(String(applied[0]));
  await expect(editor.getByRole("spinbutton", { name: "Máximo", exact: true })).toHaveValue(String(applied[1]));
  return applied;
}

test("native mouse moves the LOG band with fixed visual width and publishes values before pointerup", async ({ page }) => {
  const editor = page.getByTestId("numeric");
  const initial = await range(editor);
  const initialFiltered = await editor.locator(".filtered").textContent();
  const { selection, start, plot, plotBox } = await beginBandDrag(page, editor);
  await page.mouse.move(start.x + plotBox.width * 0.1, start.y + 130, { steps: 8 });
  const next = await expectNumericSync(editor);
  expect(next[0]).toBeGreaterThan(initial[0]);
  expect(next[1]).toBeGreaterThan(initial[1]);
  expect(await editor.locator(".filtered").textContent()).not.toEqual(initialFiltered);
  const moved = await box(editor.locator(".maono-filter-histogram__selection"));
  expect(moved.width).toBeCloseTo(selection.width, 1);
  expect(moved.x - selection.x).toBeCloseTo(plotBox.width * 0.1, 0);
  await expect(plot).toHaveAttribute("data-dragging", "window");
  await page.mouse.up();
  await expect(plot).not.toHaveAttribute("data-dragging");
  expect(await range(editor)).toEqual(next);
  await expect(page.locator("#parentPointers")).toHaveText("0");
  await expect(page.locator("#submits")).toHaveText("0");
});

test("captured mouse clamps at both domain edges and returns continuously", async ({ page }) => {
  const editor = page.getByTestId("numeric");
  const { selection, start, plotBox } = await beginBandDrag(page, editor);
  await page.mouse.move(plotBox.x + plotBox.width + 200, start.y, { steps: 8 });
  expect((await expectNumericSync(editor))[1]).toEqual(1000000);
  expect((await box(editor.locator(".maono-filter-histogram__selection"))).width).toBeCloseTo(selection.width, 1);
  await page.mouse.move(0, start.y, { steps: 8 });
  expect((await expectNumericSync(editor))[0]).toEqual(0);
  expect((await box(editor.locator(".maono-filter-histogram__selection"))).width).toBeCloseTo(selection.width, 1);
  await page.mouse.move(start.x, start.y);
  const restored = await expectNumericSync(editor);
  expect(restored[0]).toBeCloseTo(10, 8);
  expect(restored[1]).toBeCloseTo(10000, 8);
  await page.mouse.up();
});

test("circular handles resize independently; keyboard band and handles never submit", async ({ page }) => {
  const editor = page.getByTestId("numeric");
  const minimum = editor.getByRole("slider", { name: "Limite mínimo do filtro", exact: true });
  const maximum = editor.getByRole("slider", { name: "Limite máximo do filtro", exact: true });
  const plot = await box(editor.locator(".maono-filter-histogram__plot"));
  for (const [handle, index, delta] of [[minimum, 0, 0.08], [maximum, 1, -0.08]] as const) {
    const before = await range(editor);
    const marker = await box(handle);
    await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
    await page.mouse.down();
    await page.mouse.move(marker.x + marker.width / 2 + plot.width * delta, marker.y + marker.height / 2, { steps: 6 });
    const next = await expectNumericSync(editor);
    expect(next[index]).not.toEqual(before[index]);
    expect(next[index === 0 ? 1 : 0]).toEqual(before[index === 0 ? 1 : 0]);
    await page.mouse.up();
  }
  const beforeKeys = await range(editor);
  await minimum.focus();
  await minimum.press("ArrowRight");
  expect(await range(editor)).toEqual([beforeKeys[0] + 1, beforeKeys[1]]);
  await maximum.focus();
  await maximum.press("ArrowLeft");
  expect(await range(editor)).toEqual([beforeKeys[0] + 1, beforeKeys[1] - 1]);
  const band = editor.getByRole("slider", { name: "Intervalo selecionado do filtro", exact: true });
  const bandWidth = (await box(band)).width;
  await band.focus();
  await band.press("Home");
  expect((await range(editor))[0]).toEqual(0);
  await band.press("End");
  expect((await range(editor))[1]).toEqual(1000000);
  expect((await box(band)).width).toBeCloseTo(bandWidth, 1);
  await expect(page.locator("#submits")).toHaveText("0");
});

test("pointer cancellation and real lost capture keep the latest applied value and allow a new drag", async ({ page }) => {
  const editor = page.getByTestId("numeric");
  for (const cancellation of ["cancel", "lost-capture"]) {
    const { plot, plotBox, start } = await beginBandDrag(page, editor);
    await page.mouse.move(start.x + plotBox.width * 0.03, start.y, { steps: 3 });
    const latest = await range(editor);
    await plot.evaluate((element, mode) => {
      // Mouse's primary pointer is observed from the real capture, not guessed.
      const pointerId = Number(element.getAttribute("data-native-pointer-id"));
      if (!element.hasPointerCapture(pointerId)) throw new Error("No native pointer capture");
      if (mode === "cancel") element.dispatchEvent(new PointerEvent("pointercancel", { bubbles:true, pointerId, clientX:0, clientY:0 }));
      else element.releasePointerCapture(pointerId);
    }, cancellation);
    await page.mouse.move(start.x + plotBox.width * 0.06, start.y);
    await expect(plot).not.toHaveAttribute("data-dragging");
    expect(await range(editor)).toEqual(latest);
    await page.mouse.up();
  }
});

test("temporal dragging preserves exact timestamps and visual width despite formatted inputs", async ({ page }) => {
  const editor = page.getByTestId("temporal");
  const before = await range(editor);
  const { selection, start, plotBox } = await beginBandDrag(page, editor);
  await page.mouse.move(start.x + plotBox.width * 0.071, start.y + 130, { steps: 5 });
  const after = await range(editor);
  expect(after[0]).toBeGreaterThan(before[0]);
  expect(after[1] - after[0]).toBeCloseTo(before[1] - before[0], 2);
  expect((await box(editor.locator(".maono-filter-histogram__selection"))).width).toBeCloseTo(selection.width, 1);
  await page.mouse.up();
  for (const input of await editor.locator('input[type="datetime-local"]').all()) {
    await input.focus();
    await input.blur();
  }
  expect(await range(editor)).toEqual(after);
});

test("native touchscreen uses capture and live synchronization without scrolling", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Native touch injection uses Chromium CDP; mouse and keyboard run on every engine");
  const editor = page.getByTestId("numeric");
  const band = await box(editor.locator(".maono-filter-histogram__selection"));
  const plot = await box(editor.locator(".maono-filter-histogram__plot"));
  const before = await range(editor);
  const client = await page.context().newCDPSession(page);
  const start = { x: band.x + band.width / 2, y: band.y + band.height / 2 };
  await client.send("Input.dispatchTouchEvent", { type:"touchStart", touchPoints:[start] });
  for (let index=1; index<=5; index++) await client.send("Input.dispatchTouchEvent", { type:"touchMove", touchPoints:[{x:start.x + plot.width * 0.02 * index, y:start.y}] });
  const after = await expectNumericSync(editor);
  expect(after[0]).toBeGreaterThan(before[0]);
  expect((await box(editor.locator(".maono-filter-histogram__selection"))).width).toBeCloseTo(band.width, 1);
  await client.send("Input.dispatchTouchEvent", { type:"touchEnd", touchPoints:[] });
  await expect(editor.locator(".maono-filter-histogram__plot")).not.toHaveAttribute("data-dragging");
  expect(await page.evaluate(()=>window.scrollY)).toEqual(0);
  const movedBand = await box(editor.locator(".maono-filter-histogram__selection"));
  const secondStart = {x:movedBand.x + movedBand.width / 2, y:start.y};
  await client.send("Input.dispatchTouchEvent", { type:"touchStart", touchPoints:[secondStart] });
  await client.send("Input.dispatchTouchEvent", { type:"touchMove", touchPoints:[{x:secondStart.x + plot.width * 0.03, y:start.y}] });
  const beforeCancel = await range(editor);
  await client.send("Input.dispatchTouchEvent", { type:"touchCancel", touchPoints:[] });
  await expect(editor.locator(".maono-filter-histogram__plot")).not.toHaveAttribute("data-dragging");
  expect(await range(editor)).toEqual(beforeCancel);
  await client.detach();
});


test("secondary buttons and unrelated pointers cannot hijack a drag; no-motion clicks preserve precision", async ({ page }) => {
  const editor = page.getByTestId("numeric");
  const band = editor.locator(".maono-filter-histogram__selection");
  const initial = await range(editor);
  await band.click({ button:"right" });
  await expect(editor.locator(".maono-filter-histogram__plot")).not.toHaveAttribute("data-dragging");
  const { plot, start } = await beginBandDrag(page, editor);
  await plot.dispatchEvent("pointermove", {pointerId:999,clientX:0,clientY:0});
  await plot.dispatchEvent("pointerup", {pointerId:999,clientX:0,clientY:0});
  expect(await range(editor)).toEqual(initial);
  await expect(plot).toHaveAttribute("data-dragging", "window");
  await page.mouse.move(start.x, start.y);
  await page.mouse.up();
  expect(await range(editor)).toEqual(initial);
  await expect(editor.locator(".updates")).toHaveText("0");
});


test("editing the temporal maximum into the minimum's minute cannot invert exact timestamps", async ({ page }) => {
  const editor = page.getByTestId("temporal");
  const inputs = editor.locator('input[type="datetime-local"]');
  const initial = await range(editor);
  const originalMaximum = await inputs.nth(1).inputValue();
  await inputs.nth(1).fill(await inputs.nth(0).inputValue());
  await inputs.nth(1).blur();
  expect(await range(editor)).toEqual(initial);
  await expect(inputs.nth(1)).toHaveValue(originalMaximum);
  await expect(editor.locator(".updates")).toHaveText("0");
});


test("constant-valued data keeps its padded histogram visible without editing past the true domain", async ({ page }) => {
  const editor = page.getByTestId("constant");
  const band = editor.getByRole("slider", {name:"Intervalo selecionado do filtro",exact:true});
  await expect(band).toHaveAttribute("aria-disabled", "true");
  await expect(editor.getByRole("slider", {name:"Limite mínimo do filtro",exact:true})).toBeDisabled();
  await expect(editor.getByRole("slider", {name:"Limite máximo do filtro",exact:true})).toBeDisabled();
  await expect(editor.locator(".maono-filter-histogram__bars > span")).toHaveCount(1);
  const marker = await box(band);
  await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await page.mouse.down();
  await page.mouse.move(marker.x + 60, marker.y + marker.height / 2);
  await page.mouse.up();
  expect(await range(editor)).toEqual([5,5]);
  await expect(editor.locator(".updates")).toHaveText("0");
});
