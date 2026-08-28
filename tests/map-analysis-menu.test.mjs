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
});

test("S02.02 botão inferior abre a máquina em vez de iniciar placement diretamente", () => {
  assert.match(overlay, /onClick=\{toolController\.toggleToolMenu\}/);
  assert.match(overlay, /aria-haspopup="menu"/);
  assert.match(overlay, /aria-expanded=\{toolController\.menuOpen\}/);
  assert.match(controller, /dispatch\(\{ type: "OPEN_TOOL_MENU" \}\)/);

  const buttonBlock =
    overlay.match(
      /className=\{toolController\.active[\s\S]*?<OverlayIcon name="marker" \/>[\s\S]*?<\/button>/,
    )?.[0] || "";
  assert.doesNotMatch(buttonBlock, /marker\.startPlacement/);
});

test("S02.03 submenu Buffer oferece somente Single ou Multi antes do ponto", () => {
  const bufferBlock =
    menu.match(/state\.menu === "buffer"[\s\S]*?state\.menu === "isochrone"/)?.[0] || "";

  assert.match(bufferBlock, /Buffer único/);
  assert.match(bufferBlock, /Multibuffers/);
  assert.match(bufferBlock, /onSelectBufferMode\("single"\)/);
  assert.match(bufferBlock, /onSelectBufferMode\("multi"\)/);
  assert.match(bufferBlock, />\s*Posicionar\s*</);
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

test("menu respeita capabilities para Buffer, Isócrona e marcador", () => {
  assert.match(menu, /canBuffer \?/);
  assert.match(menu, /canIsochrone \?/);
  assert.match(menu, /canPlaceMarker \?/);
  assert.match(overlay, /canBuffer=\{bufferCapabilityEnabled\}/);
  assert.match(overlay, /canIsochrone=\{isochroneCapabilityEnabled\}/);
  assert.match(overlay, /canPlaceMarker=\{analysisMarkerCapabilityEnabled\}/);
});

test("S02.05 feedback mantém botão ativo e identifica ferramenta selecionada", () => {
  assert.match(overlay, /className=\{toolController\.active \? "is-active" : ""\}/);
  assert.match(overlay, /data-active-analysis-tool=\{toolController\.state\.tool \?\? "none"\}/);
  assert.match(overlay, /data-analysis-tool=\{placementTool\}/);
  assert.match(styles, /data-analysis-tool="buffer"/);
  assert.match(styles, /origem do buffer/);
  assert.match(styles, /data-analysis-tool="isochrone"/);
  assert.match(styles, /origem da isócrona/);
});

test("Gate S02 Single: menu -> Buffer -> Single -> placement sem ponto prévio", () => {
  const selecting = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
    {
      type: "SET_PRELIMINARY_OPTIONS",
      options: { kind: "buffer", insertionMode: "single" },
    },
  );

  assert.equal(selecting.mode, "selectingTool");
  assert.equal(selecting.pendingPoint, null);

  const placing = mapToolReducer(selecting, { type: "START_PLACEMENT" });
  assert.equal(placing.mode, "placingPoint");
  assert.equal(placing.tool, "buffer");
  assert.equal(placing.pendingPoint, null);
});

test("Gate S02 Multi: sessão nasce antes do placement e nenhum ponto é criado pelo menu", () => {
  const selecting = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
    {
      type: "SET_PRELIMINARY_OPTIONS",
      options: { kind: "buffer", insertionMode: "multi" },
    },
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

  assert.equal(selecting.pendingPoint, null);
  assert.equal(placing.mode, "placingPoint");
  assert.equal(placing.pendingPoint, null);
  assert.deepEqual(placing.session, session);
  assert.match(controller, /createMultiBufferSession/);
  assert.match(controller, /startPlacement\(\)/);
});
