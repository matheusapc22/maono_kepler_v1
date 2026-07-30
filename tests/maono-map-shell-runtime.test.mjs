import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../src/pages/Kepler/", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

const [
  index,
  runtime,
  sidebar,
  topbar,
  panelHost,
  shell,
  shellCss,
  shellTokens,
  layerPanel,
  backButton,
] = await Promise.all([
  source("index.tsx"),
  source("components/maono-map-shell/MaonoMapRuntime.tsx"),
  source("components/maono-map-shell/MapSidebar.tsx"),
  source("components/maono-map-shell/MapTopbar.tsx"),
  source("components/maono-map-shell/MapPanelHost.tsx"),
  source("components/maono-map-shell/MaonoMapShell.tsx"),
  source("components/maono-map-shell/maono-map-shell.css"),
  source("components/maono-map-shell/maono-map-tokens.css"),
  source("components/maono-layer-panel/MaonoLayerPanel.tsx"),
  source("components/back-to-projects-button.tsx"),
]);

test("runtime Maõno é montado dentro dos providers seguros", () => {
  assert.match(index, /<MapPanelProvider>/);
  assert.match(index, /<MapPanelAccessGate>/);
  assert.match(index, /<KeplerEngineAdapterProvider>/);
  assert.match(index, /<MaonoMapRuntime>/);
  assert.match(index, /replaceSidePanel/);
  assert.match(runtime, /customMapShellEnabled/);
  assert.match(runtime, /return <>\{children\}<\/>/);
  assert.match(runtime, /map_save_succeeded/);
  assert.match(runtime, /markClean\(\)/);
  assert.match(shell, /maono-map-runtime--panel-open/);
});

test("ações da sidebar são capability-aware e não consultam role", () => {
  for (const capability of [
    "openLayerPanel",
    "viewLayers",
    "viewFilters",
    "createLayer",
  ]) {
    assert.match(
      `${runtime}\n${sidebar}`,
      new RegExp(`capabilities\\.${capability}`),
    );
  }

  assert.match(sidebar, /context\.availablePanels/);
  assert.doesNotMatch(sidebar, /user\?\.role/);
  assert.doesNotMatch(sidebar, /checkAdminUser/);
  assert.doesNotMatch(sidebar, /localStorage/);
});

test("topbar substitui placeholders por dados reais", () => {
  assert.match(topbar, /activeOrganization\?\.name/);
  assert.match(topbar, /context\.project\?\.name/);
  assert.match(topbar, /context\.mode/);
  assert.match(topbar, /user\?\.name/);
  assert.match(topbar, /hasUnsavedChanges/);
  assert.doesNotMatch(topbar, />EN</);
  assert.doesNotMatch(topbar, />JD</);
  assert.doesNotMatch(topbar, /Bell/);
});

test("Camadas e Filtros sincronizam sidebar e painel", () => {
  assert.match(runtime, /requestMaonoMapPanelTab/);
  assert.match(layerPanel, /MAONO_MAP_PANEL_TAB_REQUEST_EVENT/);
  assert.match(layerPanel, /notifyMaonoMapPanelTabChanged/);
  assert.match(panelHost, /aria-controls="maono-map-engine-panel"/);
  assert.match(layerPanel, /id="maono-map-engine-panel"/);
});

test("layout possui fallback móvel, foco e movimento reduzido", () => {
  assert.match(shellTokens, /#c5a059/i);
  assert.match(shellCss, /@media \(max-width: 820px\)/);
  assert.match(shellCss, /prefers-reduced-motion/);
  assert.match(shellCss, /:focus-visible/);
  assert.match(shellCss, /--maono-map-panel-width/);
});

test("botão legado de retorno desaparece quando o shell está ativo", () => {
  assert.match(backButton, /useOptionalMapPanel/);
  assert.match(backButton, /customMapShellEnabled/);
  assert.match(backButton, /return null/);
});
