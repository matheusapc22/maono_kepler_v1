import { expect, test } from "@playwright/test";
import { build } from "esbuild";

// Mounted production components with synthetic callback state. Full Kepler
// rendering and save/reload remain covered by map-panel-minimal.spec.ts.
let javascript = "";
let stylesheet = "";

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { Provider } from 'react-redux';
        import { createStore } from 'redux';
        import LayerStyleEditor from './src/pages/Kepler/components/maono-layer-panel/LayerStyleEditor';
        import FilterValueEditor from './src/pages/Kepler/components/maono-layer-panel/filters/FilterValueEditor';
        import { normalizeKeplerLayers } from './src/pages/Kepler/engine-adapter/selectors';
        import './src/pages/Kepler/components/maono-layer-panel/maono-layer-panel.css';
        import './src/pages/Kepler/components/maono-layer-panel/map-panel-detail-minimal.css';

        const initial = normalizeKeplerLayers(['geojson', 'point', 'cluster', 'heatmap'].map(type => ({
          id: type, type, config: { label: type, dataId: 'numeric-data',
            ...(type === 'point' ? { sizeField: { name: 'value' } } : {}),
            visConfig: { opacity: 0.2, stroked: true, filled: true, thickness: 2,
              strokeOpacity: 0.8, radius: 10, radiusRange: [0, 50], clusterRadius: 40, heatmapRadius: 20 }
          }
        })));
        const store = createStore(() => ({ demo: { keplerGl: { map: { visState: { filters: [], datasets: {} } } } } }));
        function Fixture() {
          const [layers, setLayers] = useState(initial);
          const [range, setRange] = useState([-20, 75]);
          const [submits, setSubmits] = useState(0);
          const [changes, setChanges] = useState([]);
          const filter = { id: 'numeric-filter', index: 0, compatible: true, type: 'range', domain: [-100, 100], value: range, step: 0.1 };
          return <Provider store={store}><form onSubmit={event => { event.preventDefault(); setSubmits(count => count + 1); }}>
            <main className="maono-layer-panel maono-detail-view">
              {layers.map(layer => <section key={layer.id} data-testid={layer.id}>
                <LayerStyleEditor layer={layer} dataset={null} layerBlending="normal" overlayBlending="normal"
                  onChange={change => {
                    setChanges(items => [...items, { layerId: layer.id, ...change }]);
                    setLayers(items => items.map(item => item.id !== layer.id ? item : { ...item,
                      style: { ...item.style, [change.kind]: change.value } }));
                  }} />
              </section>)}
              <section data-testid="filter"><FilterValueEditor filter={filter} editable onChange={setRange} /></section>
            </main>
            <button type="button" id="outside">Fora</button>
            <button type="button" id="reset" onClick={() => { setLayers(initial); setRange([-20, 75]); }}>Restaurar</button>
            <button type="button" id="legacy" onClick={() => setLayers(initial.map(layer => ({ ...layer, style: { ...layer.style, opacity: 0.375, strokeWidth: 1.55 } })))}>Carregar valores precisos</button>
            <button type="submit">Salvar mapa</button>
            <output id="submits">{submits}</output>
            <output id="range">{JSON.stringify(range)}</output>
            <output id="changes">{JSON.stringify(changes)}</output>
          </form></Provider>;
        }
        createRoot(document.getElementById('root')).render(<Fixture />);
      `,
      loader: "tsx",
      sourcefile: "numeric-controls-fixture.tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    outfile: "numeric-controls-fixture.js",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  javascript = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  stylesheet = result.outputFiles.find(file => file.path.endsWith(".css"))!.text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent(`<style>body{background:#101217;color:#eee}.maono-layer-panel{width:320px;height:auto}${stylesheet}</style><div id="root"></div>`);
  await page.addScriptTag({ content: javascript });
  await expect(page.getByTestId("geojson").getByRole("spinbutton", { name: "Opacidade em porcentagem", exact: true })).toHaveValue("20");
  await page.locator("details").evaluateAll(elements => elements.forEach(element => { (element as HTMLDetailsElement).open = true; }));
});

test("opacity text, slider, arrows and engine callback stay synchronized without implicit save", async ({ page }) => {
  const editor = page.getByTestId("geojson");
  const input = editor.getByRole("spinbutton", { name: "Opacidade em porcentagem", exact: true });
  const slider = editor.getByRole("slider", { name: "Opacidade", exact: true });
  await input.fill("37");
  await expect(slider).toHaveValue("37");
  await expect(page.locator("#changes")).toHaveText("[]");
  await input.press("Enter");
  await expect(page.locator("#changes")).toHaveText(JSON.stringify([{ layerId: "geojson", kind: "opacity", value: 0.37 }]));
  await expect(page.locator("#submits")).toHaveText("0");

  await input.focus();
  await input.press("ArrowUp");
  await expect(input).toHaveValue("38");
  await expect(slider).toHaveValue("38");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("37");
  await input.blur();
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(input).toHaveValue("38");
  await expect(slider).toHaveValue("38");
  await expect(page.locator("#changes")).toContainText('"value":0.38');
  await page.locator("#reset").click();
  await expect(input).toHaveValue("20");
  await expect(slider).toHaveValue("20");
});

test("clearing, invalid drafts, limits and blur never accidentally apply zero", async ({ page }) => {
  const editor = page.getByTestId("geojson");
  const input = editor.getByRole("spinbutton", { name: "Opacidade em porcentagem", exact: true });
  const slider = editor.getByRole("slider", { name: "Opacidade", exact: true });
  await input.fill("");
  await expect(input).toHaveValue("");
  await expect(slider).toHaveValue("20");
  await input.press("Enter");
  await expect(input).toHaveValue("20");
  await expect(page.locator("#changes")).toHaveText("[]");
  await input.fill("");
  await input.press("-");
  await input.press("Enter");
  await expect(input).toHaveValue("20");
  await expect(page.locator("#changes")).toHaveText("[]");
  for (const [text, normalized] of [["-5", "0"], ["105", "100"], ["0", "0"], ["100", "100"]]) {
    await input.fill(text);
    await expect(input).toHaveValue(text);
    await input.blur();
    await expect(input).toHaveValue(normalized);
    await expect(slider).toHaveValue(normalized);
  }
  await expect(page.locator("#submits")).toHaveText("0");
});

test("legacy and typed off-step decimals remain exact until a stepped slider adjustment", async ({ page }) => {
  await page.locator("#legacy").click();
  const editor = page.getByTestId("geojson");
  const opacity = editor.getByRole("spinbutton", { name: "Opacidade em porcentagem", exact: true });
  const slider = editor.getByRole("slider", { name: "Opacidade", exact: true });
  const thickness = editor.getByRole("spinbutton", { name: "Espessura em px", exact: true });
  const thicknessSlider = editor.getByRole("slider", { name: "Espessura", exact: true });
  await expect(opacity).toHaveValue("37.5");
  await expect(slider).toHaveValue("37.5");
  await expect(thickness).toHaveValue("1.55");
  await expect(thicknessSlider).toHaveValue("1.55");
  await opacity.focus();
  await opacity.blur();
  await slider.focus();
  await slider.blur();
  await thicknessSlider.focus();
  await thicknessSlider.blur();
  await expect(page.locator("#changes")).toHaveText("[]");
  await opacity.press("ArrowUp");
  await expect(opacity).toHaveValue("38.5");
  await expect(slider).toHaveValue("38.5");
  await opacity.fill("37.5");
  await opacity.press("Enter");
  await expect(slider).toHaveValue("37.5");
  await thickness.fill("1.55");
  await thickness.press("Enter");
  await expect(thicknessSlider).toHaveValue("1.55");
  await thicknessSlider.press("ArrowRight");
  await expect(thicknessSlider).toHaveValue("1.65");
  await expect(thickness).toHaveValue("1.65");
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await slider.press("End");
  await expect(slider).toHaveValue("100");
  await slider.press("Enter");
  await expect(page.locator("#submits")).toHaveText("0");
});

test("every supported physical slider accepts renderer precision and bounded input", async ({ page }) => {
  const controls = [
    { layer: "geojson", label: "Espessura", value: "1.5", min: "0", max: "100" },
    { layer: "geojson", label: "Raio de pontos GeoJSON", value: "12.3", min: "0", max: "100" },
    { layer: "point", label: "Raio mínimo", value: "2.3", min: "0", max: "500" },
    { layer: "point", label: "Raio máximo", value: "52.3", min: "0", max: "500" },
    { layer: "cluster", label: "Raio de agregação", value: "42.3", min: "1", max: "500" },
    { layer: "heatmap", label: "Raio do mapa de calor", value: "22.3", min: "0", max: "100" },
  ];
  for (const control of controls) {
    const editor = page.getByTestId(control.layer);
    const input = editor.getByRole("spinbutton", { name: `${control.label} em px`, exact: true });
    const slider = editor.getByRole("slider", { name: control.label, exact: true });
    await expect(input).toHaveAttribute("step", "0.1");
    await expect(input).toHaveAttribute("min", control.min);
    await expect(input).toHaveAttribute("max", control.max);
    await input.fill(control.value);
    await expect(slider).toHaveValue(control.value);
    await input.press("ArrowUp");
    await expect(input).toHaveValue(String(Number((Number(control.value) + 0.1).toFixed(1))));
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(input).toHaveValue(control.value);
    await expect(slider).toHaveValue(control.value);
    await input.fill("-1");
    await input.blur();
    await expect(input).toHaveValue(control.min);
    await input.fill("999");
    await input.press("Enter");
    await expect(input).toHaveValue(control.max);
  }
  const stroke = page.getByTestId("geojson").getByRole("spinbutton", { name: "Opacidade do contorno em porcentagem" });
  await stroke.fill("13");
  await stroke.press("Enter");
  await expect(page.locator("#changes")).toContainText('"kind":"strokeOpacity","value":0.13');
  await expect(page.locator("#submits")).toHaveText("0");
});

test("numeric filter min/max preserve empty drafts, negative decimals and ordering", async ({ page }) => {
  const editor = page.getByTestId("filter");
  const minimum = editor.getByRole("spinbutton", { name: "Mínimo", exact: true });
  const maximum = editor.getByRole("spinbutton", { name: "Máximo", exact: true });
  await minimum.fill("");
  await expect(minimum).toHaveValue("");
  await minimum.press("Enter");
  await expect(minimum).toHaveValue("-20");
  await expect(page.locator("#range")).toHaveText("[-20,75]");
  await minimum.fill("-12.5");
  await minimum.press("ArrowUp");
  await expect(minimum).toHaveValue("-12.4");
  await minimum.press("ArrowDown");
  await minimum.press("Enter");
  await expect(page.locator("#range")).toHaveText("[-12.5,75]");
  await maximum.fill("");
  await maximum.blur();
  await expect(maximum).toHaveValue("75");
  await maximum.fill("-90");
  await maximum.press("Enter");
  await expect(maximum).toHaveValue("-12.5");
  await expect(page.locator("#range")).toHaveText("[-12.5,-12.5]");
  await editor.getByRole("button", { name: "Restaurar domínio completo" }).click();
  await expect(minimum).toHaveValue("-100");
  await expect(maximum).toHaveValue("100");
  await expect(page.locator("#submits")).toHaveText("0");
});
