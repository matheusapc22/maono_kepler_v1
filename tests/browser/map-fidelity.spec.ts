import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const names = ["map-point-basic", "map-point-cluster-v1-legacy", "map-point-cluster-v2-current", "map-filters-smart-histogram", "map-geojson-polygon", "map-isochrone-persisted"];
const golden = async (name: string) => JSON.parse(await readFile(new URL(`../fixtures/maps/golden/${name}.kepler.json`, import.meta.url), "utf8"));
function expectedReopenedConfig(saved: any, name: string) {
  const expected = structuredClone(saved.config);
  if (name === "map-filters-smart-histogram") {
    // The unversioned C0 fixture uses the old Kepler filter shape. Its first
    // versioned reopen applies the documented FilterSchemaV1 migration.
    // Assert that exact migration; every other field still compares exactly.
    for (const filter of expected.config.visState.filters) {
      expect(filter.enlarged).toBe(false);
      expect(filter.plotType).toBe("histogram");
      delete filter.enlarged;
      filter.plotType = { type: "histogram" };
    }
  }
  return expected;
}
const frame = (page: Page) => page.evaluate(() => (window as any).__MAP_FIDELITY__.frame());
async function mount(page: Page, saved: any) {
  await page.evaluate((value) => (window as any).__MAP_FIDELITY__.mount(value), saved);
  try {
    await expect.poll(() => page.evaluate(() => (window as any).__MAP_FIDELITY__.ready())).toBe(true);
  } catch (error) {
    console.log(await page.evaluate(() => (window as any).__MAP_FIDELITY__.diagnostics()));
    throw error;
  }
}
async function paintedFrame(page: Page) {
  await expect.poll(async () => (await frame(page)).paintedPixels).toBeGreaterThan(0);
  // Read consecutive settled frames. Equality is exact; no pixel tolerance.
  let previous = await frame(page);
  await expect.poll(async () => {
    const current = await frame(page);
    const equal = current.hash === previous.hash;
    previous = current;
    return equal;
  }).toBe(true);
  return previous;
}

test.beforeEach(async ({ page }) => {
  // Real provider/API calls are forbidden by the fixture contract.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    // Kepler preloads this unused icon catalogue even for point/GeoJSON maps.
    if (url.href === "https://studio-public-data.foursquare.com/statics/keplergl/icons/svg-icons.json") {
      return route.fulfill({ json: { svgIcons: [] } });
    }
    if (url.origin !== "http://127.0.0.1:4173" || url.pathname.startsWith("/api/")) {
      throw new Error(`Unexpected external/API request in local viewer: ${url.origin}${url.pathname}`);
    }
    await route.continue();
  });
  await page.goto("/tests/browser/fixtures/map-fidelity.html");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__MAP_FIDELITY__))).toBe(true);
});

for (const name of names) test(`${name}: real WebGL and saved state survive a fresh viewer`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const input = await golden(name);
  await mount(page, input);
  const before = await paintedFrame(page);
  const saved = await page.evaluate(() => (window as any).__MAP_FIDELITY__.serialize());
  const config = saved.config.config;
  expect(config.mapState).toMatchObject(input.config.mapState);
  const logical = input.config.visState.layers.filter((layer: any) => !layer.id.startsWith("maono-cluster-"));
  expect(config.visState.layers.map((layer: any) => layer.id)).toEqual(logical.map((layer: any) => layer.id));
  for (const layer of logical) {
    // The schema omits unbound (null) columns; every actual binding is required.
    const columns = Object.fromEntries(Object.entries(layer.config.columns).filter(([, value]) => value !== null));
    expect(config.visState.layers.find((value: any) => value.id === layer.id)).toMatchObject({
      id: layer.id, type: layer.type,
      config: { dataId: layer.config.dataId, visConfig: layer.config.visConfig, columns },
    });
  }
  expect(config.visState.filters.map(({ id, value, name, type }: any) => ({ id, value, name, type })))
    .toEqual(input.config.visState.filters.map(({ id, value, name, type }: any) => ({ id, value, name, type })));
  expect(saved.datasets.map((dataset: any) => dataset.data.allData)).toEqual(input.datasets.map((dataset: any) => dataset.data.allData));
  await page.screenshot({ path: testInfo.outputPath("before.png") });
  await mount(page, saved);
  const after = await paintedFrame(page);
  const reopened = await page.evaluate(() => (window as any).__MAP_FIDELITY__.serialize());
  // Kepler info.created_at is export time; map content must be identical.
  for (const key of ["datasets", "maono"]) expect(reopened[key]).toEqual(saved[key]);
  expect(reopened.config).toEqual(expectedReopenedConfig(saved, name));
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("reopened.png") });
  const evidence = JSON.stringify({ synthetic: true, name, before, after, configComparison: name === "map-filters-smart-histogram" ? "exact-with-explicit-Kepler-legacy-filter-migration" : "exact" }, null, 2);
  await writeFile(testInfo.outputPath("frame-evidence.json"), evidence);
  await testInfo.attach("frame-evidence", { body: evidence, contentType: "application/json" });
});

test("negative controls: visibility and cluster zoom change the actual framebuffer", async ({ page }) => {
  expect(await page.evaluate(() => (window as any).__MAP_FIDELITY__.featureEnabled)).toBe(true);
  await mount(page, await golden("map-point-cluster-v2-current"));
  const clustered = await paintedFrame(page);
  expect(clustered.layers.some((id: string) => id.includes("maono-cluster-runtime"))).toBe(true);
  await page.evaluate(() => (window as any).__MAP_FIDELITY__.zoom(14));
  await expect.poll(async () => (await frame(page)).layers.some((id: string) => id.includes("maono-cluster-runtime"))).toBe(false);
  const points = await paintedFrame(page);
  expect(points.hash).not.toBe(clustered.hash);
  await page.evaluate(() => (window as any).__MAP_FIDELITY__.visible(false));
  await expect.poll(async () => (await frame(page)).paintedPixels).toBe(0);
  expect((await frame(page)).hash).not.toBe(points.hash);
});
