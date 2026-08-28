import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  appendBufferSessionResult,
  bufferSessionFeatureCount,
  bufferSessionOriginCount,
  bufferSessionRadiusCount,
  createBufferSession,
} from "../src/pages/Kepler/components/map-overlay/analysis-tools/buffer-session.ts";
import {
  createInitialMapToolState,
  mapToolReducer,
} from "../src/pages/Kepler/components/map-overlay/analysis-tools/map-tool-state.ts";

const [hook, controller, overlay, updater, sessionSource] = await Promise.all([
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/useBufferPreview.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/analysis-tools/useMapToolController.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/MapOverlayControls.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/engine-adapter/multibuffer-dataset-updater.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/analysis-tools/buffer-session.ts",
      import.meta.url,
    ),
    "utf8",
  ),
]);

const ORIGIN_A = { longitude: -46.6333, latitude: -23.5505 };
const ORIGIN_B = { longitude: -46.62, latitude: -23.56 };
const ORIGIN_C = { longitude: -46.61, latitude: -23.57 };

function polygon(seed) {
  return {
    type: "Polygon",
    coordinates: [[
      [seed, -23.5],
      [seed + 0.001, -23.5],
      [seed + 0.001, -23.499],
      [seed, -23.5],
    ]],
  };
}

function result({ range, unit, radiusMeters, seed }) {
  return {
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            maono_analysis: "radial_buffer",
            analysis_label: "Buffer radial",
            radius_label: `${range} ${unit}`,
            radius_m: radiusMeters,
            input_unit: unit,
          },
          geometry: polygon(seed),
        },
      ],
    },
    metadata: {
      analysis: "radial_buffer",
      ranges: [range],
      inputUnit: unit,
      rangesMeters: [radiusMeters],
      featureCount: 1,
      engine: "test",
      segmentsPerQuadrant: 8,
      antimeridianSplitCount: 0,
      crs: {
        source: "EPSG:4326",
        output: "EPSG:4326",
        distanceMode: "geodesic",
      },
      canPersist: true,
    },
  };
}

test("Gate S04: A=500m, B=1km e C=250m ficam em um dataset com 3 features independentes", () => {
  let session = createBufferSession("buffer-session-gate-s04");
  const dataId = session.dataId;

  session = appendBufferSessionResult(session, {
    origin: ORIGIN_A,
    result: result({ range: 500, unit: "m", radiusMeters: 500, seed: -46.63 }),
  });
  session = appendBufferSessionResult(session, {
    origin: ORIGIN_B,
    result: result({ range: 1, unit: "km", radiusMeters: 1000, seed: -46.62 }),
  });
  session = appendBufferSessionResult(session, {
    origin: ORIGIN_C,
    result: result({ range: 250, unit: "m", radiusMeters: 250, seed: -46.61 }),
  });

  assert.equal(session.dataId, dataId);
  assert.equal(bufferSessionFeatureCount(session), 3);
  assert.equal(bufferSessionOriginCount(session), 3);
  assert.equal(bufferSessionRadiusCount(session), 3);
  assert.equal(session.items.length, 3);

  assert.deepEqual(
    session.items.map((item) => item.origin),
    [ORIGIN_A, ORIGIN_B, ORIGIN_C],
  );
  assert.deepEqual(
    session.geojson.features.map((feature) => feature.properties.radius_m),
    [500, 1000, 250],
  );

  const featureIds = session.geojson.features.map(
    (feature) => feature.properties.maono_buffer_feature_id,
  );
  const itemIds = session.geojson.features.map(
    (feature) => feature.properties.maono_buffer_item_id,
  );
  assert.equal(new Set(featureIds).size, 3);
  assert.equal(new Set(itemIds).size, 3);

  assert.deepEqual(
    session.geojson.features.map((feature) => [
      feature.properties.origin_longitude,
      feature.properties.origin_latitude,
    ]),
    [
      [ORIGIN_A.longitude, ORIGIN_A.latitude],
      [ORIGIN_B.longitude, ORIGIN_B.latitude],
      [ORIGIN_C.longitude, ORIGIN_C.latitude],
    ],
  );
});

test("S04.01 useBufferPreview recebe pendingPoint explicitamente e não depende de marker.origin", () => {
  assert.match(hook, /pendingPoint:\s*MapToolPoint \| null/);
  assert.match(hook, /origin:\s*pendingPoint/);
  assert.doesNotMatch(hook, /marker\.origin/);
  assert.match(overlay, /pendingPoint:\s*analysisPendingPoint/);
});

test("S04.04/S04.05 primeiro item preserva viewport e seguintes substituem o mesmo dataset", () => {
  assert.match(hook, /const firstItem = baseSession\.items\.length === 0/);
  assert.match(hook, /commands\.addGeoJsonLayer\(\{/);
  assert.match(hook, /dataId:\s*nextSession\.dataId/);
  assert.match(hook, /updateMultiBufferDataset\(\{/);
  assert.match(hook, /label:\s*"Buffer"/);

  const firstItemBlock =
    hook.match(/if \(firstItem\) \{[\s\S]*?\n\s*\} else \{/s)?.[0] || "";
  assert.match(firstItemBlock, /centerMap:\s*false/);

  assert.match(updater, /replaceDataInMap/);
  assert.match(updater, /datasetToReplaceId:\s*dataId/);
  assert.match(updater, /keepExistingConfig:\s*true/);
  assert.match(updater, /centerMap:\s*false/);
  assert.match(updater, /autoCreateLayers:\s*false/);
  assert.doesNotMatch(updater, /addDataToMap/);
  assert.doesNotMatch(updater, /visState|layers:\s*\[/);
});

test("S04.06 features recebem IDs, origem e raio individual", () => {
  for (const field of [
    "maono_buffer_session_id",
    "maono_buffer_item_id",
    "maono_buffer_feature_id",
    "origin_longitude",
    "origin_latitude",
    "radius_m",
  ]) {
    assert.match(sessionSource, new RegExp(field));
  }
});

test("S04.07 Buffer selecionado já nasce multi e ANALYSIS_CREATED grava dataId", () => {
  const sessionRef = {
    kind: "buffer",
    id: "buffer-session-state",
    insertionMode: "multi",
    dataId: null,
  };
  let state = createInitialMapToolState();
  for (const action of [
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
    { type: "START_PLACEMENT", session: sessionRef },
    { type: "POINT_PLACED", point: ORIGIN_A },
    { type: "SUBMIT_CONFIGURATION" },
    {
      type: "ANALYSIS_CREATED",
      preview: { kind: "buffer", dataId: "maono_analysis_buffer_buffer-session-state" },
    },
  ]) {
    state = mapToolReducer(state, action);
  }

  assert.equal(state.mode, "reviewing");
  assert.equal(state.preliminaryOptions.insertionMode, "multi");
  assert.equal(state.session.dataId, "maono_analysis_buffer_buffer-session-state");

  state = mapToolReducer(state, { type: "CONTINUE_MULTI" });
  assert.equal(state.mode, "placingPoint");
  assert.equal(state.pendingPoint, null);
  assert.equal(state.session.dataId, "maono_analysis_buffer_buffer-session-state");
  assert.match(controller, /dispatch\(continueAction\)/);
  assert.match(controller, /startPlacement\("buffer"\)/);
});

test("S04.08 expõe finalização da sessão somente depois da primeira layer", () => {
  assert.match(controller, /canFinishMulti/);
  assert.match(controller, /multiBufferSession\?\.dataId/);
  assert.match(controller, /type: "FINISH_MULTI"/);
  assert.match(overlay, /Finalizar Multibuffers/);
  assert.match(overlay, /toolController\.canFinishMulti/);
});
