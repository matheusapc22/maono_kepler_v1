import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createInitialMapToolState,
  mapToolReducer,
} from "../src/pages/Kepler/components/map-overlay/analysis-tools/map-tool-state.ts";

const [menu, controller, overlay, styles] = await Promise.all([
  readFile(
    new URL(
      "../src/pages/Kepler/components/map-overlay/analysis-tools/AnalysisToolMenu.tsx",
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
      "../src/pages/Kepler/components/map-overlay/analysis-tools/analysis-tool-menu.css",
      import.meta.url,
    ),
    "utf8",
  ),
]);

function reduce(initial, ...actions) {
  return actions.reduce(mapToolReducer, initial);
}

test("S02.01 cria AnalysisToolMenu acessível e separado do marcador", () => {
  assert.match(menu, /function AnalysisToolMenu|export default function AnalysisToolMenu/);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /aria-label="Adicionar análise"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /Escape/);
  assert.match(menu, /ArrowDown/);
  assert.match(menu, /pointerdown/);
  assert.doesNotMatch(menu, /Remover marcador/);
  assert.doesNotMatch(menu, /Adicionar marcador/);
});

test("S02.02 botão inferior abre a máquina e, durante placement, pode sair do modo pin", () => {
  assert.match(overlay, /placementModeActive[\s\S]*?toolController\.exitPlacement[\s\S]*?: toolController\.toggleToolMenu/);
  assert.match(overlay, /aria-haspopup="menu"/);
  assert.match(overlay, /aria-expanded=\{toolController\.menuOpen\}/);
  assert.match(controller, /dispatch\(\{ type: "OPEN_TOOL_MENU" \}\)/);
  assert.match(controller, /const exitPlacement = useCallback/);

  const buttonBlock =
    overlay.match(
      /className=\{toolController\.active[\s\S]*?<OverlayIcon name="marker" \/>[\s\S]*?<\/button>/,
    )?.[0] || "";
  assert.doesNotMatch(buttonBlock, /marker\.startPlacement/);
});

test("S02.03 submenu Buffer possui somente Cancelar/Posicionar e uma sessão multiorigem", () => {
  const bufferBlock =
    menu.match(/state\.menu === "buffer"[\s\S]*?state\.menu === "isochrone"/)?.[0] || "";

  assert.match(bufferBlock, /data-analysis-submenu="buffer"/);
  assert.match(bufferBlock, /primeira origem/);
  assert.match(bufferBlock, /novas origens na mesma sessão/);
  assert.match(bufferBlock, />\s*Cancelar\s*</);
  assert.match(bufferBlock, />\s*Posicionar\s*</);
  assert.doesNotMatch(bufferBlock, /Buffer único/);
  assert.doesNotMatch(bufferBlock, /Multibuffers/);
  assert.doesNotMatch(bufferBlock, /type="radio"/);
  assert.doesNotMatch(bufferBlock, /onSelectBufferMode/);
  assert.doesNotMatch(bufferBlock, /raio|ranges?|quilômetro|metros?\b/i);
});

test("S02.04 submenu Isócrona é extensível e não solicita parâmetros espaciais", () => {
  const isochroneBlock =
    menu.match(/state\.menu === "isochrone"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(isochroneBlock, /data-analysis-submenu="isochrone"/);
  assert.match(isochroneBlock, /configuração da análise/);
  assert.match(isochroneBlock, />\s*Posicionar\s*</);
  assert.doesNotMatch(
    isochroneBlock,
    /ranges?|intervalo|quilômetro|minutos?|distância|tempo\b/i,
  );
});

test("menu respeita capabilities de Buffer/Isócrona e não oferece marcador avulso", () => {
  assert.match(menu, /canBuffer \?/);
  assert.match(menu, /canIsochrone \?/);
  assert.doesNotMatch(menu, /Adicionar marcador/);
  assert.doesNotMatch(menu, /ToolGlyph kind="marker"/);
  assert.match(overlay, /canBuffer=\{bufferCapabilityEnabled\}/);
  assert.match(overlay, /canIsochrone=\{isochroneCapabilityEnabled\}/);
  assert.match(overlay, /analysisMarkerCapabilityEnabled/);
});

test("S02.05 feedback mantém botão ativo e identifica ferramenta selecionada", () => {
  assert.match(overlay, /className=\{toolController\.active \? "is-active" : ""\}/);
  assert.match(overlay, /data-active-analysis-tool=\{toolController\.state\.tool \?\? "none"\}/);
  assert.match(overlay, /data-analysis-tool=\{placementTool\}/);
  assert.match(overlay, /data-placement-label=\{placementLabel\}/);
  assert.match(styles, /content: attr\(data-placement-label\)/);
  assert.match(overlay, /origem do buffer/);
  assert.match(overlay, /origem da isócrona/);
});

test("Gate S02 Buffer: seleção assume multi automaticamente e sessão nasce antes do placement", () => {
  const selecting = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
  );
  const session = {
    kind: "buffer",
    id: "buffer-session-s02",
    insertionMode: "multi",
    dataId: null,
  };
  const placing = mapToolReducer(selecting, {
    type: "START_PLACEMENT",
    session,
  });

  assert.equal(selecting.mode, "selectingTool");
  assert.deepEqual(selecting.preliminaryOptions, {
    kind: "buffer",
    insertionMode: "multi",
  });
  assert.equal(selecting.pendingPoint, null);
  assert.equal(placing.mode, "placingPoint");
  assert.equal(placing.pendingPoint, null);
  assert.deepEqual(placing.session, session);
  assert.match(controller, /createMultiBufferSession/);
  assert.match(controller, /startPlacement\(nextState\.tool\)/);
});
