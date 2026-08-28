import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [bufferHook, markerHook, controller, updater, menu] = await Promise.all([
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
]);

test("primeiro Multibuffer não altera o viewport escolhido pelo usuário", () => {
  const firstItemBlock =
    bufferHook.match(/if \(firstItem\) \{[\s\S]*?\n          \} else \{/s)?.[0] || "";

  assert.match(firstItemBlock, /commands\.addGeoJsonLayer/);
  assert.match(firstItemBlock, /centerMap:\s*false/);
});

test("placement libera interação nativa e diferencia pan de clique", () => {
  assert.match(markerHook, /visualOverlay\.style\.pointerEvents = "none"/);
  assert.match(markerHook, /const placementSurface = mapSurface\(\)/);
  assert.match(markerHook, /window\.addEventListener\("pointerdown"/);
  assert.match(markerHook, /window\.addEventListener\("pointermove"/);
  assert.match(markerHook, /Math\.hypot/);
  assert.match(markerHook, /> 6/);
  assert.match(markerHook, /current\.moved/);
  assert.match(markerHook, /new CustomEvent\(MAONO_MAP_PLACEMENT_POINT_EVENT/);
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

test("launcher de análise não oferece marcador sem finalidade", () => {
  assert.match(menu, /Criar isócrona/);
  assert.match(menu, /Criar buffer/);
  assert.doesNotMatch(menu, /Adicionar marcador/);
  assert.doesNotMatch(menu, /ToolGlyph kind="marker"/);
});
