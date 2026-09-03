import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getMaonoMapVisualReadinessDiagnostics,
  registerMaonoDeckRuntime,
  registerMaonoMapRuntime,
  resetMaonoMapVisualReadinessRuntime,
} from "../src/pages/Kepler/map-url-loader/map-visual-readiness.ts";

const keplerSource = readFileSync(
  new URL("../src/pages/Kepler/index.tsx", import.meta.url),
  "utf8",
);
const loaderSource = readFileSync(
  new URL("../src/pages/Kepler/map-url-loader/index.tsx", import.meta.url),
  "utf8",
);

test("editor no longer uses an unremovable WeakSet listener registry", () => {
  assert.doesNotMatch(keplerSource, /observedMapInstances\s*=\s*new WeakSet/);
  assert.match(keplerSource, /releaseObservedMaonoMapListeners/);
  assert.match(keplerSource, /map\.off\?\.\("style\.load", handleStyleLoad\)/);
  assert.match(keplerSource, /map\.off\?\.\("render", handleRender\)/);
  assert.match(keplerSource, /map\.off\?\.\("error", handleError\)/);
});

test("App teardown releases Maono map/deck runtime references", () => {
  assert.match(keplerSource, /releaseMaonoRuntimeObservers\(\)/);
  assert.match(keplerSource, /registerMaonoDeckRuntime\(null\)/);
  assert.match(keplerSource, /resetMaonoMapVisualReadinessRuntime\(\)/);
});

test("visual readiness runtime registry can return to an empty baseline", () => {
  registerMaonoMapRuntime({ triggerRepaint() {} });
  registerMaonoDeckRuntime({ redraw() {} });

  let diagnostics = getMaonoMapVisualReadinessDiagnostics();
  assert.equal(diagnostics.mapRuntimeAttached, true);
  assert.equal(diagnostics.deckRuntimeAttached, true);

  resetMaonoMapVisualReadinessRuntime();
  diagnostics = getMaonoMapVisualReadinessDiagnostics();
  assert.equal(diagnostics.mapRuntimeAttached, false);
  assert.equal(diagnostics.deckRuntimeAttached, false);
  assert.equal(diagnostics.mapRuntimeListenerCount, 0);
  assert.equal(diagnostics.deckRuntimeListenerCount, 0);
  assert.equal(diagnostics.mapRenderListenerCount, 0);
});

test("project switch/unmount unloads prior Kepler datasets and clustering state", () => {
  assert.match(loaderSource, /import \{ addDataToMap, removeDataset, toggleModal \}/);
  assert.match(loaderSource, /function releaseKeplerDatasets\(/);
  assert.match(loaderSource, /dispatch\(removeDataset\(datasetId\)\)/);
  assert.match(loaderSource, /releaseKeplerDatasets\(store, dispatch\);/);
  assert.match(loaderSource, /loadPointClusterState\(undefined\);/);
});
