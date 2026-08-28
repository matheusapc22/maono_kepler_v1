import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createInitialMapToolState,
  mapToolReducer,
} from "../src/pages/Kepler/components/map-overlay/analysis-tools/map-tool-state.ts";
import { mapToolConfigurationTarget } from "../src/pages/Kepler/components/map-overlay/analysis-tools/useMapToolController.ts";

const [overlay, markerHook, controller, styles] = await Promise.all([
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/MapOverlayControls.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/useMapMarker.ts",
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
      "../src/pages/Kepler/components/map-overlay/analysis-tools/analysis-tool-menu.css",
      import.meta.url,
    ),
    "utf8",
  ),
]);

const VALID_POINT = { longitude: -46.6333, latitude: -23.5505 };

function reduce(initial, ...actions) {
  return actions.reduce(mapToolReducer, initial);
}

function placeBuffer(point = VALID_POINT) {
  return reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
    {
      type: "SET_PRELIMINARY_OPTIONS",
      options: { kind: "buffer", insertionMode: "single" },
    },
    { type: "START_PLACEMENT" },
    { type: "POINT_PLACED", point },
  );
}

test("S03.01 placeAt devolve coordenada e não abre menu automaticamente", () => {
  const placeAtBlock =
    markerHook.match(/const placeAt = useCallback\([\s\S]*?\n  \);/)?.[0] || "";

  assert.match(placeAtBlock, /return next/);
  assert.match(placeAtBlock, /setMenuOpen\(false\)/);
  assert.doesNotMatch(placeAtBlock, /setMenuOpen\(true\)/);
  assert.doesNotMatch(overlay, /completeLegacyPlacement/);
});

test("S03.02 controller integra POINT_PLACED e publica pendingPoint", () => {
  assert.match(controller, /const pointPlaced = useCallback/);
  assert.match(controller, /type: "POINT_PLACED"/);
  assert.match(controller, /nextState\.mode !== "configuring"/);
  assert.match(controller, /pendingPoint:/);

  const configured = placeBuffer();
  assert.equal(configured.mode, "configuring");
  assert.deepEqual(configured.pendingPoint, VALID_POINT);
  assert.equal(mapToolConfigurationTarget(configured), "buffer");
});

test("S03.03 Buffer e Isócrona só abrem pelo target do controller", () => {
  assert.match(overlay, /toolController\.configurationTarget === "buffer"/);
  assert.match(overlay, /buffer\.openDialog\(\)/);
  assert.match(overlay, /toolController\.configurationTarget === "isochrone"/);
  assert.match(overlay, /isochrone\.openDialog\(\)/);
  assert.match(overlay, /const analysisOrigin = toolController\.pendingPoint/);
  assert.match(controller, /nextState\.tool === "marker"/);
  assert.match(controller, /dispatch\(\{ type: "ANALYSIS_CREATED" \}\)/);

  const markerMenu =
    overlay.match(/marker\.menuOpen \? \([\s\S]*?\) : null/)?.[0] || "";
  assert.doesNotMatch(markerMenu, /buffer\.openDialog|isochrone\.openDialog/);
  assert.doesNotMatch(markerMenu, /Criar buffers|Criar isócronas/);
});

test("Gate S03: target de configuração exige coordenada válida", () => {
  const placing = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
    {
      type: "SET_PRELIMINARY_OPTIONS",
      options: { kind: "buffer", insertionMode: "single" },
    },
    { type: "START_PLACEMENT" },
  );

  const invalidAttempt = mapToolReducer(placing, {
    type: "POINT_PLACED",
    point: { longitude: 999, latitude: -23 },
  });
  assert.equal(invalidAttempt, placing);
  assert.equal(mapToolConfigurationTarget(invalidAttempt), null);

  const impossibleConfig = {
    mode: "configuring",
    tool: "isochrone",
    preliminaryOptions: null,
    pendingPoint: { longitude: Number.NaN, latitude: -23.5 },
    session: null,
    configurationStatus: "editing",
  };
  assert.equal(mapToolConfigurationTarget(impossibleConfig), null);

  const validConfig = mapToolReducer(placing, {
    type: "POINT_PLACED",
    point: VALID_POINT,
  });
  assert.equal(mapToolConfigurationTarget(validConfig), "buffer");
});

test("S03.04 texto e cursor do placement são parametrizados por ferramenta", () => {
  assert.match(overlay, /function placementPrompt/);
  assert.match(overlay, /data-placement-label=\{placementLabel\}/);
  assert.match(overlay, /data-analysis-tool=\{placementTool\}/);
  assert.match(styles, /content: attr\(data-placement-label\)/);
  assert.match(markerHook, /PLACEMENT_CURSORS/);
  assert.match(markerHook, /marker:/);
  assert.match(markerHook, /buffer:/);
  assert.match(markerHook, /isochrone:/);
  assert.match(markerHook, /startPlacement = useCallback/);
});

test("S03.05 Escape do placement pertence ao controller", () => {
  assert.match(controller, /handlePlacementEscape/);
  assert.match(controller, /event\.key !== "Escape"/);
  assert.match(controller, /cancelTool\(\)/);

  const independentMarkerEscape =
    markerHook.match(/event\.key === "Escape"|event\.key !== "Escape"/);
  assert.equal(independentMarkerEscape, null);

  assert.match(overlay, /onClose=\{closeBufferConfiguration\}/);
  assert.match(overlay, /onClose=\{closeIsochroneConfiguration\}/);
  assert.match(overlay, /toolController\.cancelPendingPoint\(\)/);
});

test("submissão e preview continuam vinculados ao pendingPoint validado", () => {
  assert.match(overlay, /toolController\.submitConfiguration\(\)/);
  assert.match(overlay, /toolController\.analysisCreated/);
  assert.match(controller, /type: "SUBMIT_CONFIGURATION"/);
  assert.match(controller, /type: "ANALYSIS_CREATED"/);
});
