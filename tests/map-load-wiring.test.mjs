import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("S07 está conectada ao bootstrap, loader e boundary de navegação", () => {
  const main = source("src/main.tsx");
  const loader = source("src/pages/Kepler/map-url-loader/index.tsx");
  const navigation = source("functions/api/projects/[slug]/map-navigation.js");

  assert.match(main, /installMapLoadObservability\(\)/);
  assert.match(loader, /CONFIG_VALIDATED/);
  assert.match(loader, /MIGRATED/);
  assert.match(loader, /ENGINE_HYDRATION_STARTED/);
  assert.match(navigation, /getOrCreateCorrelationId/);
  assert.match(navigation, /X-Correlation-Id/);
});

test("S07 não introduz persistência D1 para telemetria", () => {
  const endpoint = source("functions/api/observability/map-load.js");
  const runtime = source("src/pages/Kepler/observability/map-load-runtime.ts");

  assert.doesNotMatch(endpoint, /\.prepare\s*\(/);
  assert.doesNotMatch(endpoint, /INSERT\s+INTO/i);
  assert.match(runtime, /keepalive:\s*true/);
  assert.match(runtime, /sendBeacon/);
});
