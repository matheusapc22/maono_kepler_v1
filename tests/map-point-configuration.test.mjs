import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createInitialMapToolState,
  isMapToolStateValid,
  mapToolReducer,
} from "../src/pages/Kepler/components/map-overlay/analysis-tools/map-tool-state.ts";
import { withWorkspaceEditingParity } from "../functions/_lib/project-map-workspace-capabilities.js";

const [
  overlay,
  markerHook,
  controller,
  styles,
  placementStyles,
  markerContextMenu,
  pointWorkflow,
  pointDatasetCommand,
  mapRuntime,
  mapNavigationEndpoint,
  newMapContextEndpoint,
  mapCapabilities,
] = await Promise.all([
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
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/map-placement-mode.css",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/MarkerContextMenu.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/change-requests/PointFromPinWorkflow.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/engine-adapter/usePointDatasetCommand.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/maono-map-shell/MaonoMapRuntime.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../functions/api/projects/[slug]/map-navigation.js",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../functions/api/maps/new/context.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/map-panel/map-panel-capabilities.ts",
      import.meta.url,
    ),
    "utf8",
  ),
]);

const VALID_POINT = { longitude: -46.6333, latitude: -23.5505 };
const BUFFER_SESSION = {
  kind: "buffer",
  id: "buffer-session-s03",
  insertionMode: "multi",
  dataId: null,
};

function reduce(initial, ...actions) {
  return actions.reduce(mapToolReducer, initial);
}

function placeBuffer(point = VALID_POINT) {
  return reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
    { type: "START_PLACEMENT", session: BUFFER_SESSION },
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
  assert.equal(isMapToolStateValid(configured), true);
});

test("S03.03 Buffer e Isócrona só abrem pelo target do controller", () => {
  assert.match(controller, /export function mapToolConfigurationTarget/);
  assert.match(controller, /!isMapToolStateValid\(state\)/);
  assert.match(controller, /state\.mode !== "configuring"/);
  assert.match(controller, /state\.tool === "buffer" \|\| state\.tool === "isochrone"/);

  assert.match(overlay, /toolController\.configurationTarget === "buffer"/);
  assert.match(overlay, /buffer\.openDialog\(\)/);
  assert.match(overlay, /toolController\.configurationTarget === "isochrone"/);
  assert.match(overlay, /isochrone\.openDialog\(\)/);
  assert.match(overlay, /const analysisPendingPoint = toolController\.pendingPoint/);
  assert.match(controller, /nextState\.tool === "marker"/);
  assert.match(controller, /dispatch\(\{ type: "ANALYSIS_CREATED" \}\)/);

  assert.match(overlay, /<MarkerContextMenu/);
  assert.doesNotMatch(markerContextMenu, /buffer\.openDialog|isochrone\.openDialog/);
  assert.doesNotMatch(markerContextMenu, /Criar buffers|Criar isócronas/);
  assert.doesNotMatch(markerContextMenu, /Buffer|Isócrona|isochrone/);
});

test("Gate S03: configuração impossível não passa pelas invariantes", () => {
  const placing = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
    { type: "START_PLACEMENT", session: BUFFER_SESSION },
  );

  const invalidAttempt = mapToolReducer(placing, {
    type: "POINT_PLACED",
    point: { longitude: 999, latitude: -23 },
  });
  assert.equal(invalidAttempt, placing);
  assert.equal(invalidAttempt.mode, "placingPoint");
  assert.equal(invalidAttempt.pendingPoint, null);

  const impossibleConfig = {
    mode: "configuring",
    tool: "isochrone",
    preliminaryOptions: null,
    pendingPoint: { longitude: Number.NaN, latitude: -23.5 },
    session: null,
    configurationStatus: "editing",
  };
  assert.equal(isMapToolStateValid(impossibleConfig), false);

  const validConfig = mapToolReducer(placing, {
    type: "POINT_PLACED",
    point: VALID_POINT,
  });
  assert.equal(validConfig.mode, "configuring");
  assert.equal(validConfig.tool, "buffer");
  assert.deepEqual(validConfig.pendingPoint, VALID_POINT);
  assert.equal(isMapToolStateValid(validConfig), true);
});

test("Gate S03: overlay exige target e pendingPoint antes de openDialog", () => {
  const openingEffect =
    overlay.match(/useEffect\(\(\) => \{\s*if \(!toolController\.pendingPoint\) return;[\s\S]*?\n  \}, \[/)?.[0] || "";

  assert.match(openingEffect, /!toolController\.pendingPoint/);
  assert.match(openingEffect, /configurationTarget === "buffer"/);
  assert.match(openingEffect, /buffer\.openDialog\(\)/);
  assert.match(openingEffect, /configurationTarget === "isochrone"/);
  assert.match(openingEffect, /isochrone\.openDialog\(\)/);
});

test("S03.04 texto varia por ferramenta e cursor de placement é sempre um pin estável", () => {
  assert.match(overlay, /function placementPrompt/);
  assert.match(overlay, /data-placement-label=\{placementLabel\}/);
  assert.match(overlay, /data-analysis-tool=\{placementTool\}/);
  assert.match(styles, /content: attr\(data-placement-label\)/);

  assert.match(markerHook, /data-maono-map-placement/);
  assert.match(markerHook, /root\.setAttribute/);
  assert.doesNotMatch(markerHook, /applyPlacementCursor/);
  assert.doesNotMatch(markerHook, /schedulePlacementCursor/);
  assert.match(placementStyles, /:root\[data-maono-map-placement\]/);
  assert.match(placementStyles, /#default-deckgl-overlay-wrapper/);
  assert.match(placementStyles, /#default-deckgl-overlay/);
  assert.match(placementStyles, /fill='%23C5A059'/);
  assert.match(placementStyles, /crosshair !important/);
  assert.match(markerHook, /startPlacement = useCallback/);
});

test("S03.05 Escape e botão de saída do placement pertencem ao controller", () => {
  assert.match(controller, /handlePlacementEscape/);
  assert.match(controller, /event\.key !== "Escape"/);
  assert.match(controller, /const exitPlacement = useCallback/);
  assert.match(controller, /return exitPlacement\(\)/);
  assert.match(overlay, /Sair do modo pin/);
  assert.match(overlay, /toolController\.exitPlacement/);

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

test("PR3 Viewer recebe paridade local, camada de pontos e bloqueia importação/SAVE", () => {
  const context = withWorkspaceEditingParity({
    mode: "viewer",
    capabilities: {
      previewBuffer: true,
      previewIsochrone: true,
      createLayer: false,
      addData: false,
      importData: true,
      saveMap: true,
    },
  });

  for (const capability of [
    "configureTooltips",
    "editLayers",
    "editStyle",
    "editLayerStyle",
    "createLayer",
    "createPoint",
    "removeLayer",
    "duplicateLayer",
    "reorderLayers",
    "manageFilters",
    "editFilters",
    "placeAnalysisMarker",
    "persistBuffer",
    "persistIsochrone",
  ]) {
    assert.equal(context.capabilities[capability], true, capability);
  }
  assert.equal(context.capabilities.addData, true);
  assert.equal(context.capabilities.importData, false);
  assert.equal(context.capabilities.saveMap, false);
  assert.equal(context.capabilities.requestProjectChange, true);
  assert.equal(context.capabilities.editMetadata, false);
  assert.equal(context.capabilities.updateThumbnail, false);
});

test("PR3 Editor/Create preservam importação, SAVE e Pin independente de análise", () => {
  for (const mode of ["editor", "create"]) {
    const context = withWorkspaceEditingParity({
      mode,
      capabilities: {
        createLayer: true,
        saveMap: true,
        placeAnalysisMarker: false,
      },
    });
    assert.equal(context.capabilities.createLayer, true);
    assert.equal(context.capabilities.addData, true);
    assert.equal(context.capabilities.importData, true);
    assert.equal(context.capabilities.createPoint, true);
    assert.equal(context.capabilities.saveMap, true);
    assert.equal(context.capabilities.placeAnalysisMarker, true);
  }
  assert.match(mapNavigationEndpoint, /withWorkspaceEditingParity/);
  assert.match(newMapContextEndpoint, /withWorkspaceEditingParity/);
  assert.match(mapRuntime, /context\?\.capabilities\.importData !== true/);
});

test("Add Data genérico permanece fail-closed por importData", () => {
  assert.match(mapCapabilities, /command === "openAddDataModal" \? "importData" : capability/);
  assert.match(mapCapabilities, /requiredCapability/);
});

test("PR3 Marker expõe Criar ponto e workflow usa posição atual do marcador", () => {
  assert.match(markerContextMenu, /Criar ponto/);
  assert.match(markerContextMenu, /MAONO_CREATE_POINT_FROM_MARKER_EVENT/);
  assert.match(pointWorkflow, /querySelector<HTMLElement>\("\.maono-map-marker"\)/);
  assert.match(pointWorkflow, /screenToMarkerOrigin/);
  assert.match(pointWorkflow, /Point-from-Pin/);
  assert.match(pointWorkflow, /\.maono-buffer-dialog, \.maono-isochrone-dialog/);
  assert.match(mapRuntime, /<PointFromPinWorkflow \/>/);
});

test("PR3 Viewer serializa point.create enquanto Editor/Create atualizam somente dataset alvo", () => {
  assert.match(pointWorkflow, /new ViewerWorkingCopyStore/);
  assert.match(pointWorkflow, /type: "point\.create"/);
  assert.match(pointWorkflow, /submitProjectChangeRequest/);
  assert.match(pointWorkflow, /completeSubmission/);
  assert.match(pointWorkflow, /context\?\.capabilities\.addData === true/);

  assert.match(pointDatasetCommand, /replaceDataInMap/);
  assert.match(pointDatasetCommand, /datasetToReplaceId: dataId/);
  assert.match(pointDatasetCommand, /keepExistingConfig: true/);
  assert.match(pointDatasetCommand, /addDataToMap/);
  assert.match(pointDatasetCommand, /input\.target\.createNew \? "addData" : "editLayers"/);
});

test("PR3 bloqueia submit Viewer se houver mutação local não serializada", () => {
  assert.match(pointWorkflow, /untrackedViewerChanges = viewerEnabled && engineState\.hasUnsavedChanges/);
  assert.match(pointWorkflow, /ainda não possuem contrato de Change Request/);
  assert.match(pointWorkflow, /untrackedViewerChanges \|\|/);
});
