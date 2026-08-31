import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  expectedDatasetIdsFromRuntimeDatasets,
  expectedLayerIdsFromRuntimeConfig,
  inspectMapHydrationState,
} from "../src/pages/Kepler/map-url-loader/map-visual-readiness.ts";

function rootState({ layers = [], datasets = {} } = {}) {
  return {
    demo: {
      keplerGl: {
        map: {
          visState: {
            layers,
            datasets,
          },
        },
      },
    },
  };
}

test("readiness uses logical layer ids after runtime config hydration", () => {
  const ids = expectedLayerIdsFromRuntimeConfig({
    visState: {
      layers: [
        { id: "municipios", config: { isVisible: false } },
        { id: "leads", config: { isVisible: true } },
      ],
    },
  });

  assert.deepEqual(ids, ["municipios", "leads"]);
});

test("readiness derives expected dataset ids from Kepler runtime datasets", () => {
  const ids = expectedDatasetIdsFromRuntimeDatasets([
    { info: { id: "data-a" }, data: { fields: [], rows: [] } },
    { info: { id: "data-b" }, data: { fields: [], rows: [] } },
  ]);

  assert.deepEqual(ids, ["data-a", "data-b"]);
});

test("readiness remains pending while a dataset or layer is missing", () => {
  const missingDataset = inspectMapHydrationState(
    rootState({
      layers: [{ id: "layer-a" }],
      datasets: {},
    }),
    ["layer-a"],
    ["data-a"],
  );
  assert.equal(missingDataset.ready, false);
  assert.equal(missingDataset.phase, "waiting-datasets");
  assert.deepEqual(missingDataset.missingDatasetIds, ["data-a"]);

  const missingLayer = inspectMapHydrationState(
    rootState({
      layers: [],
      datasets: { "data-a": { id: "data-a" } },
    }),
    ["layer-a"],
    ["data-a"],
  );
  assert.equal(missingLayer.ready, false);
  assert.equal(missingLayer.phase, "waiting-layers");
  assert.deepEqual(missingLayer.missingLayerIds, ["layer-a"]);
});

test("hidden layers count as hydrated and do not create an infinite loading state", () => {
  const snapshot = inspectMapHydrationState(
    rootState({
      layers: [{ id: "layer-a", config: { isVisible: false } }],
      datasets: { "data-a": { id: "data-a" } },
    }),
    ["layer-a"],
    ["data-a"],
  );

  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.phase, "waiting-runtime");
  assert.deepEqual(snapshot.missingLayerIds, []);
  assert.deepEqual(snapshot.missingDatasetIds, []);
});

test("projects without layers can advance to runtime readiness", () => {
  const snapshot = inspectMapHydrationState(rootState(), [], []);
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.phase, "waiting-runtime");
});

test("central loader owns the loading presentation and panel stays hidden until ready", () => {
  const loader = readFileSync(
    new URL("../src/pages/Kepler/map-url-loader/index.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL(
      "../src/pages/Kepler/map-url-loader/map-visual-readiness.css",
      import.meta.url,
    ),
    "utf8",
  );
  const keplerRoot = readFileSync(
    new URL("../src/pages/Kepler/index.tsx", import.meta.url),
    "utf8",
  );

  assert.match(loader, /await waitForMaonoMapVisualReadiness\(/);
  assert.match(loader, /maono-map-central-loading/);
  assert.match(css, /data-map-loading="true"/);
  assert.match(css, /data-map-ready="false"/);
  assert.match(css, /maono-layer-panel__notice:has\(\.maono-layer-panel__loading\)/);
  assert.match(keplerRoot, /registerMaonoDeckRuntime\(deck\)/);
  assert.match(keplerRoot, /notifyMaonoMapRender\(\{ styleLoaded \}\)/);

  assert.doesNotMatch(
    css,
    /\.maono-map-runtime__map\s*\{/,
    "visual loading gate must not change map viewport geometry",
  );
});
