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
  shellLayout,
  shellTokens,
  layerPanel,
  layerPanelCss,
  sidePanelFactory,
  loadDataModalFactory,
  mapManagementPage,
  mapManagementCss,
  layoutDebug,
  backButton,
  mapPanelProvider,
  basemapController,
  basemapPanel,
  basemapPanelCss,
  shellPanels,
] = await Promise.all([
  source("index.tsx"),
  source("components/maono-map-shell/MaonoMapRuntime.tsx"),
  source("components/maono-map-shell/MapSidebar.tsx"),
  source("components/maono-map-shell/MapTopbar.tsx"),
  source("components/maono-map-shell/MapPanelHost.tsx"),
  source("components/maono-map-shell/MaonoMapShell.tsx"),
  source("components/maono-map-shell/maono-map-shell.css"),
  source("components/maono-map-shell/maono-map-layout-contract.css"),
  source("components/maono-map-shell/maono-map-tokens.css"),
  source("components/maono-layer-panel/MaonoLayerPanel.tsx"),
  source("components/maono-layer-panel/maono-layer-panel.css"),
  source("factories/side-panel.tsx"),
  source("factories/load-data-modal.ts"),
  source("map-panel/MapManagementPage.tsx"),
  source("map-panel/map-management-page.css"),
  source("components/maono-map-shell/map-layout-debug.ts"),
  source("components/back-to-projects-button.tsx"),
  source("map-panel/MapPanelProvider.tsx"),
  source("engine-adapter/basemap-controller.ts"),
  source("components/maono-map-shell/MaonoBasemapPanel.tsx"),
  source("components/maono-map-shell/maono-basemap-panel.css"),
  source("components/maono-map-shell/map-shell-panels.ts"),
]);
const appRoutes = await readFile(
  new URL("../src/Routes.tsx", import.meta.url),
  "utf8",
);

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
    `${runtime}\n${sidePanelFactory}`.match(/<MaonoLayerPanel \/>/g)?.length,
    1,
  );
});

test("modal nativo de dados não é renderizado durante a hidratação", () => {
  assert.match(loadDataModalFactory, /HydrationSafeLoadDataModal/);
  assert.match(loadDataModalFactory, /if \(props\.isMapLoading\)\s*\{\s*return null;/);
  assert.match(loadDataModalFactory, /React\.createElement\(LoadDataModal, props\)/);
  assert.match(loadDataModalFactory, /\.\.\.state\.demo\.app/);
  assert.match(loadDataModalFactory, /\)\(HydrationSafeLoadDataModal\)/);
});

test("rota manage prioriza editor, cai para viewer e não considera create", () => {
  assert.match(
    mapManagementPage,
    /const destination = context\.availablePanels\.editor\.allowed[\s\S]*\? "edit"[\s\S]*context\.availablePanels\.viewer\.allowed[\s\S]*\? "view"/,
  );
  assert.doesNotMatch(mapManagementPage, /availablePanels\.create\.allowed/);
  assert.match(mapManagementPage, /return <MapRedirectLoader \/>/);
  assert.match(mapManagementPage, /\{ replace: true \}/);
  assert.doesNotMatch(mapManagementPage, /Abrir editor/);
  assert.doesNotMatch(mapManagementPage, /Abrir visualizador/);
  assert.doesNotMatch(mapManagementPage, /Gerenciar mapa/);
  assert.doesNotMatch(mapManagementPage, /Escolha como deseja abrir este projeto/);
  assert.match(mapManagementCss, /\.maono-map-management__spinner/);
  assert.match(mapManagementCss, /border-top-color:\s*#c5a059/i);
  assert.match(mapManagementCss, /height:\s*76px/);
  assert.match(mapManagementCss, /width:\s*76px/);
});

test("create de projeto existente é somente redirect de compatibilidade", () => {
  assert.match(appRoutes, /path="\/projects\/:projectSlug\/create"/);
  assert.match(appRoutes, /DeprecatedProjectCreateRedirect/);
  assert.match(
    appRoutes,
    /\/projects\/\$\{encodeURIComponent\(projectSlug\)\}\/manage/,
  );
  assert.match(mapPanelProvider, /const isNewMap = location\.pathname === "\/maps\/new\/create"/);

  const createRouteStart = appRoutes.indexOf(
    'path="/projects/:projectSlug/create"',
  );
  const nextRouteStart = appRoutes.indexOf("<Route", createRouteStart + 10);
  const createRouteBlock = appRoutes.slice(createRouteStart, nextRouteStart);
  assert.doesNotMatch(createRouteBlock, /KeplerApp/);
});

test("sidebar contém ferramentas capability-aware, incluindo mapa base", () => {
  for (const capability of ["openLayerPanel", "viewLayers", "viewMap", "createLayer"]) {
    assert.match(sidebar, new RegExp(`capabilities\\.${capability}`));
  }

  assert.match(sidebar, /onOpenBasemap/);
  assert.match(sidebar, /MapShellIcon name="basemap"/);
  assert.match(sidebar, /aria-label="Mapa base"/);
  assert.match(runtime, /context\.capabilities\.viewFilters/);
  assert.doesNotMatch(sidebar, /capabilities\.viewFilters/);
  assert.doesNotMatch(sidebar, /context\.availablePanels/);
  assert.doesNotMatch(sidebar, /ModeNavigationItem|availableModeItems/);
  assert.doesNotMatch(sidebar, /name="filters"/);
  assert.doesNotMatch(sidebar, /name="viewer"|name="editor"|name="create"/);
  assert.doesNotMatch(sidebar, />Visualizar</);
  assert.doesNotMatch(sidebar, />Editar</);
  assert.doesNotMatch(sidebar, />Criar</);
  assert.doesNotMatch(sidebar, /user\?\.role/);
  assert.doesNotMatch(sidebar, /checkAdminUser/);
  assert.doesNotMatch(sidebar, /localStorage/);
});

test("mapa base Maõno está disponível em view, editor e create sem ampliar persistência", () => {
  assert.match(runtime, /context\?\.capabilities\.viewMap/);
  assert.match(runtime, /basemapController\.available/);
  assert.match(runtime, /setActivePanel\("basemap"\)/);
  assert.match(runtime, /<MaonoBasemapPanel/);
  assert.match(shellPanels, /"layers" \| "basemap"/);
  assert.match(basemapController, /capabilities\.viewMap/);
  assert.match(basemapController, /mapStyleChange\(normalized\)/);
  assert.match(basemapController, /wrapTo\(KEPLER_MAP_ID/);
  assert.match(basemapController, /context\.capabilities\.saveMap \? "project" : "session"/);
  assert.doesNotMatch(basemapController, /editLayerStyle/);
  assert.match(basemapPanel, /mode === "viewer"/);
  assert.match(basemapPanel, /somente para esta sessão/);
  assert.match(basemapPanel, /mode === "create"/);
  assert.match(basemapPanel, /será incluído na configuração do novo mapa/);
  assert.match(basemapPanelCss, /\.maono-basemap-panel__option\.is-selected/);
});

test("seletor Maõno reutiliza as miniaturas oficiais de mapa base do Kepler", () => {
  assert.match(basemapController, /getApplicationConfig/);
  assert.match(basemapController, /readValue\(style, "icon"\)/);
  assert.match(basemapController, /previewUrl: resolveBasemapPreviewUrl\(style\)/);
  assert.match(basemapController, /getApplicationConfig\(\)\.cdnUrl/);
  assert.match(basemapPanel, /style\.previewUrl/);
  assert.match(basemapPanel, /<img/);
  assert.match(basemapPanel, /src=\{style\.previewUrl\}/);
  assert.match(basemapPanel, /loading="lazy"/);
  assert.match(basemapPanel, /event\.currentTarget\.hidden = true/);
  assert.match(basemapPanelCss, /\.maono-basemap-panel__preview img/);
  assert.match(basemapPanelCss, /object-fit:\s*cover/);
});

test("topbar informa o modo atual sem transformá-lo em seletor", () => {
  assert.match(topbar, /modeLabel\(context\.mode\)/);
  assert.match(topbar, /user\?\.name/);
  assert.match(topbar, /hasUnsavedChanges/);
  assert.match(topbar, /maono-map-topbar__account/);
  assert.doesNotMatch(topbar, /availablePanels/);
  assert.doesNotMatch(topbar, /viewerRoute|editorRoute/);
  assert.doesNotMatch(topbar, /maono-map-topbar__project/);
  assert.doesNotMatch(topbar, /maono-map-topbar__back/);
  assert.doesNotMatch(topbar, /activeOrganization\?\.name/);
  assert.doesNotMatch(topbar, />EN</);
  assert.doesNotMatch(topbar, />JD</);
  assert.doesNotMatch(topbar, /Bell/);
});

test("Filtros permanecem exclusivamente como subfunção do painel de Camadas", () => {
  assert.match(runtime, /requestMaonoMapPanelTab/);
  assert.match(layerPanel, /MAONO_MAP_PANEL_TAB_REQUEST_EVENT/);
  assert.match(layerPanel, /notifyMaonoMapPanelTabChanged/);
  assert.match(layerPanel, /id="maono-layers-tab"/);
  assert.match(layerPanel, /id="maono-filters-tab"/);
  assert.match(sidebar, /onPanelTabSelect\("layers"\)/);
  assert.doesNotMatch(sidebar, /onPanelTabSelect\("filters"\)/);
  assert.match(panelHost, /aria-controls=\{controlsId\}/);
  assert.match(shellPanels, /"maono-map-engine-panel"/);
  assert.match(shellPanels, /"maono-basemap-panel"/);
  assert.match(layerPanel, /id="maono-map-engine-panel"/);
});

test("layout usa docking no desktop e overlay opaco em telas menores", () => {
  assert.match(shellTokens, /#c5a059/i);
  assert.match(shellCss, /\.maono-map-panel-host\s*\{[\s\S]*position: absolute;[\s\S]*inset: 0;/);
  assert.match(shellCss, /\.maono-map-panel-host__panel\s*\{[\s\S]*position: absolute;/);
  assert.match(shellLayout, /@media \(min-width: 1021px\)/);
  assert.match(
    shellLayout,
    /\.maono-map-runtime--panel-open \.maono-map-runtime__map\s*\{[\s\S]*left:\s*var\(--maono-map-panel-width\)/,
  );
  assert.match(shellLayout, /@media \(max-width: 1020px\)/);
  assert.match(shellLayout, /\.maono-map-panel-host__backdrop\s*\{[\s\S]*pointer-events:\s*auto/);
  assert.match(shellLayout, /\.maono-map-panel-host__panel\s*\{[\s\S]*background:\s*var\(--maono-map-panel\)/);
  assert.match(shellCss, /@media \(max-width: 820px\)/);
  assert.match(shellCss, /prefers-reduced-motion/);
  assert.match(shellCss, /:focus-visible/);
  assert.match(shellCss, /--maono-map-panel-width/);
  assert.doesNotMatch(shellLayout, /\bzoom\s*:/i);
  assert.doesNotMatch(shellLayout, /transform:\s*scale\(/i);
  assert.doesNotMatch(
    shellCss,
    /\.maono-map-runtime(?:--panel-collapsed)? \.maono-layer-panel[\s\S]{0,300}flex-basis/,
  );
  assert.doesNotMatch(layerPanelCss.slice(0, 700), /flex:\s*0\s+0\s+340px/);
});

test("cadeia ScreenshotWrapper → viewport medido possui dimensões estáveis", () => {
  assert.match(index, /className="maono-kepler-screenshot-root"/);
  assert.doesNotMatch(index, /className="h-screen"/);
  assert.match(index, /className="maono-kepler-container"/);
  assert.match(index, /className="maono-kepler-panel-group/);
  assert.match(index, /className="maono-kepler-map-panel"/);
  assert.match(index, /function useParentElementSize/);
  assert.match(index, /new ResizeObserver\(scheduleMeasure\)/);
  assert.match(index, /<MeasuredKeplerViewport/);
  assert.doesNotMatch(index, /<AutoSizer/);
  assert.match(shellCss, /\.maono-kepler-screenshot-root[\s\S]*height: 100%/);
  assert.match(shellCss, /\.maono-kepler-viewport[\s\S]*position: absolute/);
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
