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
  layerPanelCss,
  sidePanelFactory,
  layoutDebug,
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
  source("components/maono-layer-panel/maono-layer-panel.css"),
  source("factories/side-panel.tsx"),
  source("components/maono-map-shell/map-layout-debug.ts"),
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

test("runtime é a única fonte efetiva de panelOpen", () => {
  assert.match(runtime, /const \[panelOpen, setPanelOpen\] = useState\(initiallyOpenPanel\)/);
  assert.equal(
    [runtime, panelHost, shell, sidePanelFactory, layerPanel]
      .join("\n")
      .match(/useState\([^)]*panelOpen|useState\(initiallyOpenPanel\)/g)?.length,
    1,
  );
  assert.match(runtime, /event\.key === "Escape"/);
  assert.match(runtime, /onClose=\{\(\) => setPanelOpen\(false\)\}/);
  assert.match(panelHost, /onClick=\{onClose\}/);
  assert.match(panelHost, /onClick=\{onToggle\}/);
});

test("painel funcional é hospedado pelo shell e não pela factory do Kepler", () => {
  assert.match(
    runtime,
    /<MapPanelHost[\s\S]*<MaonoLayerPanelErrorBoundary[\s\S]*<MaonoLayerPanel \/>[\s\S]*<\/MapPanelHost>/,
  );
  assert.match(panelHost, /children: ReactNode/);
  assert.match(panelHost, /maono-map-panel-host__panel/);
  assert.doesNotMatch(sidePanelFactory, /MaonoLayerPanel/);
  assert.match(sidePanelFactory, /shellHostedLayerPanelActive/);
  assert.match(sidePanelFactory, /return null/);
  assert.match(sidePanelFactory, /return <DefaultSidePanel \{\.\.\.props\} \/>/);
  assert.equal(
    `${runtime}
${sidePanelFactory}`.match(/<MaonoLayerPanel \/>/g)?.length,
    1,
  );
});

test("ações da sidebar são capability-aware e não consultam role", () => {
  for (const capability of [
    "openLayerPanel",
    "viewLayers",
    "viewFilters",
    "createLayer",
  ]) {
    assert.match(
      `${runtime}
${sidebar}`,
      new RegExp(`capabilities\.${capability}`),
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

test("layout usa overlay em todos os breakpoints sem flex-basis no painel", () => {
  assert.match(shellTokens, /#c5a059/i);
  assert.match(shellCss, /\.maono-map-panel-host\s*\{[\s\S]*position: absolute;[\s\S]*inset: 0;/);
  assert.match(shellCss, /\.maono-map-panel-host__panel\s*\{[\s\S]*position: absolute;/);
  assert.match(shellCss, /@media \(max-width: 820px\)/);
  assert.match(shellCss, /prefers-reduced-motion/);
  assert.match(shellCss, /:focus-visible/);
  assert.match(shellCss, /--maono-map-panel-width/);
  assert.doesNotMatch(
    shellCss,
    /\.maono-map-runtime(?:--panel-collapsed)? \.maono-layer-panel[\s\S]{0,300}flex-basis/,
  );
  assert.doesNotMatch(layerPanelCss.slice(0, 700), /flex:\s*0\s+0\s+340px/);
});

test("cadeia ScreenshotWrapper → AutoSizer possui dimensões estáveis e debug removível", () => {
  assert.match(index, /className="maono-kepler-screenshot-root"/);
  assert.doesNotMatch(index, /className="h-screen"/);
  assert.match(index, /className="maono-kepler-container"/);
  assert.match(index, /className="maono-kepler-panel-group/);
  assert.match(index, /className="maono-kepler-map-panel"/);
  assert.match(index, /<AutoSizer className="maono-kepler-autosizer">/);
  assert.match(shellCss, /\.maono-kepler-screenshot-root[\s\S]*height: 100%/);
  assert.match(layoutDebug, /getBoundingClientRect\(\)/);
  assert.match(layoutDebug, /window\.innerWidth/);
  assert.match(layoutDebug, /window\.innerHeight/);
  assert.match(layoutDebug, /maonoLayoutDebug/);
  assert.match(layoutDebug, /MutationObserver/);
});

test("botão legado de retorno desaparece quando o shell está ativo", () => {
  assert.match(backButton, /useOptionalMapPanel/);
  assert.match(backButton, /customMapShellEnabled/);
  assert.match(backButton, /return null/);
});
