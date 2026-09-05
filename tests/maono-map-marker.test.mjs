import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { withWorkspaceEditingParity } from "../functions/_lib/project-map-workspace-capabilities.js";
import {
  markerOriginToScreen,
  normalizeLongitude,
  screenToMarkerOrigin,
} from "../src/pages/Kepler/components/map-overlay/marker-projection.ts";

const [overlay, markerHook, controller, placementCss] = await Promise.all([
  readFile(new URL("../src/pages/Kepler/components/map-overlay/MapOverlayControls.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/useMapMarker.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/analysis-tools/useMapToolController.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/map-placement-mode.css", import.meta.url), "utf8"),
]);

const [markerContextMenu, analysisToolMenu, mapSidebar, addLayerMenu] = await Promise.all([
  readFile(new URL("../src/pages/Kepler/components/map-overlay/MarkerContextMenu.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/map-overlay/analysis-tools/AnalysisToolMenu.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/maono-map-shell/MapSidebar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/components/maono-layer-panel/AddLayerMenu.tsx", import.meta.url), "utf8"),
]);

const [pointWorkflow, pointDatasetCommand] = await Promise.all([
  readFile(new URL("../src/pages/Kepler/change-requests/PointFromPinWorkflow.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/engine-adapter/usePointDatasetCommand.ts", import.meta.url), "utf8"),
]);

const viewport = { longitude: -46.63, latitude: -23.55, zoom: 8, bearing: 0, pitch: 0, width: 1000, height: 700 };
const canvas = { left: 100, top: 50, width: 1000, height: 700 };

test("normalização de longitude usa o intervalo -180/180", () => {
  assert.equal(normalizeLongitude(181), -179);
  assert.equal(normalizeLongitude(-181), 179);
  assert.equal(normalizeLongitude(540), 180);
});

test("projeção do marcador faz round-trip entre mapa e tela", () => {
  const origin = { latitude: -23.55, longitude: -46.63 };
  const screen = markerOriginToScreen(origin, canvas, viewport);
  assert.ok(screen);
  const restored = screenToMarkerOrigin(screen.left, screen.top, canvas, viewport);
  assert.ok(restored);
  assert.ok(Math.abs(restored.latitude - origin.latitude) < 1e-6);
  assert.ok(Math.abs(restored.longitude - origin.longitude) < 1e-6);
});

test("marcador não observa mais todas as mutações do document.body", () => {
  assert.doesNotMatch(markerHook, /new MutationObserver/);
  assert.doesNotMatch(markerHook, /observe\(document\.body/);
  assert.match(markerHook, /ResizeObserver/);
  assert.match(markerHook, /maono:map-runtime/);
  assert.match(markerHook, /sameCanvasRect/);
});

test("descoberta prioriza a superfície DeckGL e mantém fallbacks MapLibre, Mapbox e Maõno", () => {
  assert.match(markerHook, /#default-deckgl-overlay-wrapper/);
  assert.match(markerHook, /#default-deckgl-overlay/);
  assert.match(markerHook, /\.maplibregl-canvas/);
  assert.match(markerHook, /\.mapboxgl-canvas/);
  assert.match(markerHook, /\.maono-kepler-viewport canvas/);
  assert.match(markerHook, /\.maono-kepler-viewport/);
  assert.match(markerHook, /function mapSurfaces\(\)/);
  assert.match(markerHook, /getBoundingClientRect/);
});

test("cursor pin fica estável por estado CSS sem disputar pointermove com getCursor do DeckGL", () => {
  assert.match(markerHook, /useLayoutEffect/);
  assert.match(markerHook, /data-maono-map-placement/);
  assert.match(markerHook, /root\.setAttribute/);
  assert.match(markerHook, /root\.removeAttribute/);
  assert.doesNotMatch(markerHook, /applyPlacementCursor/);
  assert.doesNotMatch(markerHook, /schedulePlacementCursor/);
  assert.doesNotMatch(markerHook, /setProperty\("cursor"/);
  assert.match(placementCss, /:root\[data-maono-map-placement\]/);
  assert.match(placementCss, /#default-deckgl-overlay-wrapper/);
  assert.match(placementCss, /#default-deckgl-overlay/);
  assert.match(placementCss, /\.maplibregl-canvas/);
  assert.match(placementCss, /\.mapboxgl-canvas/);
  assert.match(placementCss, /fill='%23C5A059'/);
  assert.match(placementCss, /crosshair !important/);
  assert.match(overlay, /map-placement-mode\.css/);
});

test("placement preserva interação nativa de zoom/pan e só aceita clique sem arrasto", () => {
  assert.match(markerHook, /visualOverlay\.style\.pointerEvents = "none"/);
  assert.match(markerHook, /window\.addEventListener\("pointerdown"/);
  assert.match(markerHook, /window\.addEventListener\("pointermove"/);
  assert.match(markerHook, /window\.addEventListener\("pointerup"/);
  assert.match(markerHook, /Math\.hypot/);
  assert.match(markerHook, /> 6/);
  assert.match(markerHook, /current\.moved/);
  assert.match(markerHook, /MAONO_MAP_PLACEMENT_POINT_EVENT/);
  assert.match(controller, /MAONO_MAP_PLACEMENT_POINT_EVENT/);
  assert.match(controller, /pointPlaced\(point\)/);
});

test("modo pin possui saída explícita por botão e Escape sem descartar Buffer já criado", () => {
  const placeAtBlock = markerHook.match(/const placeAt = useCallback\([\s\S]*?\n  \);/)?.[0] || "";
  assert.match(placeAtBlock, /setMenuOpen\(false\)/);
  assert.doesNotMatch(placeAtBlock, /setMenuOpen\(true\)/);
  assert.doesNotMatch(markerHook, /event\.key === "Escape"/);
  assert.match(controller, /const exitPlacement = useCallback/);
  assert.match(controller, /session\?\.dataId/);
  assert.match(controller, /return finishMulti\(\)/);
  assert.match(controller, /handlePlacementEscape/);
  assert.match(controller, /return exitPlacement\(\)/);
  assert.match(controller, /event\.key !== "Escape"/);
  assert.match(overlay, /Modo pin ativo/);
  assert.match(overlay, /Sair do modo pin/);
  assert.match(overlay, /toolController\.exitPlacement/);
});

test("overlay visual mantém projeção e pointer state fora do componente", () => {
  assert.doesNotMatch(overlay, /WebMercatorViewport/);
  assert.doesNotMatch(overlay, /draggingPointerRef/);
  assert.match(overlay, /useMapMarker/);
  assert.match(markerHook, /ArrowLeft/);
  assert.match(markerHook, /setPointerCapture/);
});

test("Viewer pode criar camada de pontos, mas não importar dados genéricos", () => {
  const viewer = withWorkspaceEditingParity({ mode: "viewer", capabilities: { createLayer: false, addData: false, importData: true } });
  assert.equal(viewer.capabilities.createLayer, true);
  assert.equal(viewer.capabilities.addData, true);
  assert.equal(viewer.capabilities.importData, false);
  assert.match(mapSidebar, /canImportData = capabilities\.importData === true/);
  assert.doesNotMatch(mapSidebar, /canImportData = capabilities\.createLayer/);
  assert.match(addLayerMenu, /canImportData = context\?\.capabilities\.importData === true/);
  assert.match(addLayerMenu, /\{canImportData \? \(/);
  assert.match(addLayerMenu, /Importar novo dado/);
  assert.match(pointWorkflow, /context\?\.capabilities\.addData === true/);
});

test("hotfix Point-from-Pin é capability explícita e Criar ponto fica acessível pelo menu nas três rotas", () => {
  for (const mode of ["viewer", "editor", "create"]) {
    const context = withWorkspaceEditingParity({ mode, capabilities: {} });
    assert.equal(context.capabilities.createPoint, true, mode);
    assert.equal(context.capabilities.placeAnalysisMarker, true, mode);
  }

  assert.match(overlay, /canPlaceMarker=\{analysisMarkerCapabilityEnabled\}/);
  assert.match(overlay, /onStartMarkerPlacement=\{toolController\.startMarkerPlacement\}/);
  assert.match(analysisToolMenu, /canPlaceMarker = false/);
  assert.match(analysisToolMenu, /onStartMarkerPlacement/);
  assert.match(analysisToolMenu, /\{canPlaceMarker && onStartMarkerPlacement \? \(/);
  assert.match(analysisToolMenu, /onClick=\{onStartMarkerPlacement\}/);
  assert.match(analysisToolMenu, /<ToolGlyph kind="marker" \/>/);
  assert.match(analysisToolMenu, /Criar ponto/);
  assert.match(analysisToolMenu, /Escolher posição no mapa/);

  assert.match(markerContextMenu, /capabilities\.createPoint === true/);
  assert.match(markerContextMenu, /if \(!open\)/);
  assert.match(markerContextMenu, /data-quick-action="create-point"/);
  assert.match(markerContextMenu, /Criar ponto/);
  assert.match(markerContextMenu, /MAONO_CREATE_POINT_FROM_MARKER_EVENT/);
});

test("Novo ponto pode ser atribuído a camada de pontos existente e preserva o dataset escolhido", () => {
  assert.match(pointWorkflow, /engineState\.layers\.flatMap/);
  assert.match(pointWorkflow, /\["point", "cluster", "heatmap"\]\.includes\(managedType\)/);
  assert.match(pointWorkflow, /key: layer\.id/);
  assert.match(pointWorkflow, /dataId,/);
  assert.match(pointWorkflow, /layerId: layer\.id/);
  assert.match(pointWorkflow, /setTargetKey\(targets\[0\]\?\.key \|\| ""\)/);
  assert.match(pointWorkflow, /<span>Camada \*<\/span>/);
  assert.match(pointWorkflow, /value=\{targetKey\}/);
  assert.match(pointWorkflow, /targetLayerId: target\.layerId/);
  assert.match(pointWorkflow, /targetDataId: target\.dataId/);
  assert.match(pointDatasetCommand, /const dataId = String\(input\.target\.dataId \|\| ""\)\.trim\(\)/);
  assert.match(pointDatasetCommand, /rows\.push\(nextRow\(headers, \{ \.\.\.input, latitude, longitude \}\)\)/);
  assert.match(pointDatasetCommand, /replaceDataInMap/);
  assert.match(pointDatasetCommand, /datasetToReplaceId: dataId/);
  assert.match(pointDatasetCommand, /autoCreateLayers: false/);
  assert.match(pointDatasetCommand, /layerId: input\.target\.layerId/);
});
