import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workflow, config, browserSpec, packageSource] = await Promise.all([
  readFile(new URL("../.github/workflows/product-reliability-ux-phase0.yml", import.meta.url), "utf8"),
  readFile(new URL("../playwright.config.ts", import.meta.url), "utf8"),
  readFile(new URL("./browser/loading-runtime.spec.ts", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("browser gate roda uma vez no Product Reliability UX e usa Chromium local", () => {
  assert.match(workflow, /Install Chromium for loading acceptance/);
  assert.equal((workflow.match(/npm run test:reliability-browser/g) || []).length, 1);
  assert.equal(JSON.parse(packageSource).scripts["test:reliability-browser"], "playwright test --project=chromium");
  assert.match(config, /testDir: "\.\/tests\/browser"/);
  assert.match(config, /name: "chromium"/);
  assert.match(config, /webServer:/);
});

test("runtime acceptance cobre hit-test, Auth cleanup e save local", () => {
  assert.match(browserSpec, /elementFromPoint/);
  assert.match(browserSpec, /__MAONO_LOADING_DEBUG__/);
  assert.match(browserSpec, /mm-loading-overlay--viewport/);
  assert.match(browserSpec, /Cancelar espera/);
});
