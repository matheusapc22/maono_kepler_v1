import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [bufferHook, markerHook, controller, updater, menu, stateMachine] = await Promise.all([
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/useBufferPreview.ts",
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
      "../src/pages/Kepler/engine-adapter/multibuffer-dataset-updater.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/analysis-tools/AnalysisToolMenu.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/analysis-tools/map-tool-state.ts",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("primeiro Buffer da sessão não altera o viewport escolhido pelo usuário", () => {
  const firstItemBlock =
    bufferHook.match(/if \(firstItem\) \{[\s\S]*?\n          \} else \{/s)?.[0] || "";

  assert.match(firstItemBlock, /commands\.addGeoJsonLayer/);
  assert.match(firstItemBlock, /centerMap:\s*false/);
});

test("placement libera interação nativa, diferencia pan de clique e usa cursor pin", () => {
  assert.match(markerHook, /visualOverlay\.style\.pointerEvents = "none"/);
  assert.match(markerHook, /const placementSurface = mapSurface\(\)/);
  assert.match(markerHook, /window\.addEventListener\("pointerdown"/);
  assert.match(markerHook, /window\.addEventListener\("pointermove"/);
  assert.match(markerHook, /Math\.hypot/);
  assert.match(markerHook, /> 6/);
  assert.match(markerHook, /current\.moved/);
  assert.match(markerHook, /new CustomEvent\(MAONO_MAP_PLACEMENT_POINT_EVENT/);
  assert.match(markerHook, /buffer:\s*PLACEMENT_PIN_CURSOR/);
  assert.match(markerHook, /isochrone:\s*PLACEMENT_PIN_CURSOR/);
  assert.match(controller, /MAONO_MAP_PLACEMENT_POINT_EVENT/);
  assert.match(controller, /pointPlaced\(point\)/);
});

test("segundo e próximos buffers substituem dados sem criar nova layer nem recenter", () => {
  assert.match(updater, /replaceDataInMap/);
  assert.match(updater, /datasetToReplaceId:\s*dataId/);
  assert.match(updater, /id:\s*dataId/);
  assert.match(updater, /centerMap:\s*false/);
  assert.match(updater, /keepExistingConfig:\s*true/);
  assert.match(updater, /autoCreateLayers:\s*false/);
  assert.doesNotMatch(updater, /addDataToMap/);
});

test("launcher de análise mantém apenas Isócrona e Buffer", () => {
  assert.match(menu, /Criar isócrona/);
  assert.match(menu, /Criar buffer/);
  assert.doesNotMatch(menu, /Adicionar marcador/);
  assert.doesNotMatch(menu, /ToolGlyph kind="marker"/);
});

test("Buffer não possui mais escolha Single/Multi e assume sessão multiorigem", () => {
  const bufferBlock =
    menu.match(/state\.menu === "buffer"[\s\S]*?state\.menu === "isochrone"/)?.[0] || "";

  assert.doesNotMatch(bufferBlock, /Buffer único/);
  assert.doesNotMatch(bufferBlock, /type="radio"/);
  assert.doesNotMatch(bufferBlock, /onSelectBufferMode/);
  assert.match(bufferBlock, />\s*Cancelar\s*</);
  assert.match(bufferBlock, />\s*Posicionar\s*</);
  assert.match(stateMachine, /export type BufferInsertionMode = "multi"/);
  assert.match(stateMachine, /action\.tool === "buffer"[\s\S]*?insertionMode: "multi"/);
  assert.doesNotMatch(stateMachine, /BufferInsertionMode = "single" \| "multi"/);
});
