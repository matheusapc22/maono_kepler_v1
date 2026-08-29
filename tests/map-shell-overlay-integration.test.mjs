import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isLayoutGeometryInvariant } from "../src/pages/Kepler/components/maono-map-shell/map-layout-debug.ts";

const files = {
  index: "../src/pages/Kepler/index.tsx",
  provider: "../src/pages/Kepler/map-panel/MapPanelProvider.tsx",
  shell: "../src/pages/Kepler/components/maono-map-shell/MaonoMapShell.tsx",
  runtime: "../src/pages/Kepler/components/maono-map-shell/MaonoMapRuntime.tsx",
  sidebar: "../src/pages/Kepler/components/maono-map-shell/MapSidebar.tsx",
  topbar: "../src/pages/Kepler/components/maono-map-shell/MapTopbar.tsx",
  panelHost: "../src/pages/Kepler/components/maono-map-shell/MapPanelHost.tsx",
  sidePanel: "../src/pages/Kepler/factories/side-panel.tsx",
  layoutDebug: "../src/pages/Kepler/components/maono-map-shell/map-layout-debug.ts",
  layerPanelCss: "../src/pages/Kepler/components/maono-layer-panel/maono-layer-panel.css",
  panelEvents: "../src/pages/Kepler/components/maono-map-shell/map-shell-events.ts",
  shellCss: "../src/pages/Kepler/components/maono-map-shell/maono-map-shell.css",
  shellTokens: "../src/pages/Kepler/components/maono-map-shell/maono-map-tokens.css",
  layerPanel: "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
  overlay: "../src/pages/Kepler/components/map-overlay/MapOverlayControls.tsx",
  overlayCss: "../src/pages/Kepler/components/map-overlay/map-overlay-controls.css",
  markerHook: "../src/pages/Kepler/components/map-overlay/useMapMarker.ts",
  markerProjection: "../src/pages/Kepler/components/map-overlay/marker-projection.ts",
  previewHook: "../src/pages/Kepler/components/map-overlay/useIsochronePreview.ts",
  legendFactory: "../src/pages/Kepler/factories/maono-map-legend-panel.tsx",
  popoverFactory: "../src/pages/Kepler/factories/maono-map-popover.tsx",
  popoverCss: "../src/pages/Kepler/factories/maono-map-popover.css",
  dialog: "../src/pages/Kepler/components/map-overlay/IsochroneDialog.tsx",
  api: "../src/pages/Kepler/map-panel/isochrone-api.ts",
  saveEvents: "../src/pages/Kepler/map-panel/map-save-events.ts",
  endpoint: "../functions/api/maps/isochrones.js",
  service: "../functions/_lib/isochrone-service.js",
  save: "../src/pages/Kepler/components/maono-save-button.tsx",
  migration: "../migrations/0017_map_isochrone_rate_limit.sql",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [
      key,
      await readFile(new URL(path, import.meta.url), "utf8"),
    ]),
  ),
);

test("runtime monta o shell sob flags e preserva o baseline", () => {
  assert.match(source.index, /replaceSidePanel/);
  assert.match(source.index, /replaceMapLegendPanel/);
  assert.match(source.index, /replaceMapPopover/);
  assert.match(source.index, /<MaonoMapRuntime>/);
  assert.match(source.runtime, /if \(!customMapShellEnabled \|\| !context\)/);
  assert.match(source.runtime, /return <>\{children\}<\/>/);
  assert.match(source.runtime, /map_save_succeeded/);
  assert.match(source.runtime, /markClean\(\)/);
  assert.doesNotMatch(source.index, /<MapOverlayControls \/>/);
  assert.match(source.index, /<ScreenshotWrapper/);
  assert.match(source.index, /<PointClusterSettingsPanel/);
  assert.match(source.index, /<MapUrlLoader \/>/);
  assert.match(source.index, /<MaonoSaveButton \/>/);
  assert.match(source.index, /<MapPanelProvider>/);
  assert.match(source.index, /<MapPanelAccessGate>/);
  assert.match(source.index, /<KeplerEngineAdapterProvider>/);
  assert.match(source.shell, /maono-map-runtime/);
  assert.match(source.overlay, /customMapOverlayEnabled/);
  assert.match(source.runtime, /<MapOverlayControls \/>/);
  assert.doesNotMatch(source.runtime, /NativeMapOverlaysRuntime/);
});

test("flags frontend customizadas são opt-in e desligadas por padrão", () => {
  for (const flag of [
    "VITE_MAONO_LAYER_MANAGER_V1",
    "VITE_MAONO_MAP_SHELL_V1",
    "VITE_MAONO_MAP_OVERLAY_V1",
  ]) {
    assert.match(source.provider, new RegExp(`${flag} \\?\\? "false"`));
  }

  assert.doesNotMatch(
    source.provider,
    /VITE_MAONO_(?:LAYER_MANAGER|MAP_SHELL|MAP_OVERLAY)_V1 \?\? "true"/,
  );
  assert.match(source.provider, /\.toLowerCase\(\) === "true"/);
});

test("sidebar usa capabilities sem replicar modos ou a subfunção Filtros", () => {
  assert.match(source.runtime, /context\?\.capabilities\.openLayerPanel/);
  assert.match(source.sidebar, /capabilities\.viewLayers/);
  assert.match(source.sidebar, /capabilities\.createLayer/);
  assert.match(source.runtime, /context\.capabilities\.viewFilters/);
  assert.doesNotMatch(source.sidebar, /capabilities\.viewFilters/);
  assert.doesNotMatch(source.sidebar, /context\.availablePanels/);
  assert.doesNotMatch(source.sidebar, /ModeNavigationItem|availableModeItems/);
  assert.doesNotMatch(source.sidebar, /name="filters"/);
  assert.doesNotMatch(source.sidebar, /name="viewer"|name="editor"|name="create"/);
  assert.doesNotMatch(source.sidebar, /user\?\.role/);
  assert.doesNotMatch(source.sidebar, /checkAdminUser/);
  assert.doesNotMatch(source.runtime, /checkAdminUser/);
  assert.match(source.provider, /VITE_MAONO_MAP_SHELL_V1/);
  assert.match(source.provider, /VITE_MAONO_MAP_OVERLAY_V1/);
});

test("topbar mantém modo, status e usuário sem seletor de projeto", () => {
  assert.match(source.topbar, /modeLabel\(context\.mode\)/);
  assert.match(source.topbar, /user\?\.name/);
  assert.match(source.topbar, /hasUnsavedChanges/);
  assert.match(source.topbar, /maono-map-topbar__account/);
  assert.doesNotMatch(source.topbar, /activeOrganization\?\.name/);
  assert.doesNotMatch(source.topbar, /context\.organization\?\.name/);
  assert.doesNotMatch(source.topbar, /context\.project\?\.name/);
  assert.doesNotMatch(source.topbar, /maono-map-topbar__project/);
  assert.doesNotMatch(source.topbar, /maono-map-topbar__back/);
  assert.doesNotMatch(source.topbar, />EN</);
  assert.doesNotMatch(source.topbar, />JD</);
  assert.doesNotMatch(source.topbar, /Bell/);
});

test("sidebar abre Camadas e Filtros permanece na navegação interna do painel", () => {
  assert.match(source.panelEvents, /maono:map-panel-tab-request/);
  assert.match(source.panelEvents, /maono:map-panel-tab-changed/);
  assert.match(source.runtime, /requestMaonoMapPanelTab/);
  assert.match(source.layerPanel, /MAONO_MAP_PANEL_TAB_REQUEST_EVENT/);
  assert.match(source.layerPanel, /notifyMaonoMapPanelTabChanged/);
  assert.match(source.layerPanel, /id="maono-layers-tab"/);
  assert.match(source.layerPanel, /id="maono-filters-tab"/);
  assert.match(source.sidebar, /onPanelTabSelect\("layers"\)/);
  assert.doesNotMatch(source.sidebar, /onPanelTabSelect\("filters"\)/);
  assert.match(source.panelHost, /aria-controls="maono-map-engine-panel"/);
  assert.match(source.layerPanel, /id="maono-map-engine-panel"/);
});

test("controles promovem centralização, tooltip, legenda e marcador por fronteiras próprias", () => {
  assert.match(source.overlay, /useKeplerEngineAdapter/);
  assert.match(source.overlay, /commands\.fitFilteredData\(\)/);
  assert.match(source.overlay, /commands\.fitVisibleData\(\)/);
  assert.match(source.overlay, /commands\.setTooltipFields/);
  assert.match(source.overlay, /commands\.toggleLegend\(\)/);
  assert.match(source.overlay, /state\.legendVisible/);
  assert.match(source.overlay, /useMapMarker/);
  assert.match(source.overlay, /useIsochronePreview/);
  assert.doesNotMatch(source.overlay, /WebMercatorViewport/);
  assert.match(source.markerProjection, /WebMercatorViewport/);
  assert.match(source.markerHook, /screenToMarkerOrigin/);

  for (const directAccess of [
    /useDispatch/,
    /@kepler\.gl\/actions/,
    /@kepler\.gl\/processors/,
    /processGeojson/,
    /interactionConfigChange/,
    /toggleMapControl/,
  ]) {
    assert.doesNotMatch(source.overlay, directAccess);
  }
});

test("isócronas usam somente o proxy autenticado", () => {
  assert.match(source.api, /\/api\/maps\/isochrones/);
  assert.match(source.api, /credentials:\s*"include"/);
  assert.match(source.endpoint, /generateIsochrone/);
  assert.match(source.endpoint, /readBoundedJsonBody/);
  assert.match(source.endpoint, /application\/json/);
  assert.match(source.endpoint, /ISOCHRONE_CROSS_ORIGIN_FORBIDDEN/);
  assert.match(source.endpoint, /Retry-After/);
  assert.match(source.endpoint, /Cache-Control/);
  assert.match(source.endpoint, /range_label/);
  assert.match(source.endpoint, /mode_label/);
  assert.match(source.service, /GEOAPIFY_API_KEY/);
  assert.match(source.service, /requireSession/);
  assert.match(source.service, /ISOCHRONE_RATE_LIMITED/);
  assert.match(source.service, /MAX_PROVIDER_COORDINATES/);
  assert.match(source.service, /ISOCHRONE_PROVIDER_GEOMETRY_TOO_COMPLEX/);
  assert.doesNotMatch(source.service, /0\.75/);
  assert.match(source.migration, /map_analysis_rate_limits/);

  for (const frontend of [
    source.overlay,
    source.previewHook,
    source.api,
    source.shell,
  ]) {
    assert.doesNotMatch(frontend, /api\.geoapify\.com/);
    assert.doesNotMatch(frontend, /apiKey=/i);
    assert.doesNotMatch(frontend, /GEOAPIFY_API_KEY/);
  }
});

test("Manter prévia promove a análise sem acionar o salvamento global", () => {
  assert.match(
    source.previewHook,
    /commands\.markLayerPersistent\(preview\.dataId,\s*"isochrone"\)/,
  );
  assert.doesNotMatch(
    source.previewHook,
    /dispatchMapSaveRequest|MAONO_MAP_SAVE_RESULT_EVENT|saveRequestId/,
  );
  assert.match(source.previewHook, /commands\.addGeoJsonLayer/);
  assert.match(source.previewHook, /commandsRef\.current\.removeTransientLayer/);
  assert.match(source.overlay, /isochrone\.keep/);
  assert.match(source.save, /transientDatasetIdsRef\.current\.size > 0/);
  assert.match(source.save, /serializeProjectConfig/);
  assert.doesNotMatch(
    source.overlay,
    /Salvar no projeto|dispatchMapSaveRequest|requestIsochrone|AbortController/,
  );
});

test("painel do shell é estruturalmente único e não reduz o viewport medido", () => {
  assert.match(
    source.runtime,
    /<MapPanelHost[\s\S]*<MaonoLayerPanel \/>[\s\S]*<\/MapPanelHost>/,
  );
  assert.doesNotMatch(source.sidePanel, /MaonoLayerPanel/);
  assert.match(source.sidePanel, /customMapShellEnabled/);
  assert.match(source.sidePanel, /shellHostedLayerPanelActive/);
  assert.match(source.sidePanel, /return null/);
  assert.match(source.sidePanel, /return <DefaultSidePanel \{\.\.\.props\} \/>/);
  assert.match(source.panelHost, /maono-map-panel-host__panel/);
  assert.match(
    source.shellCss,
    /\.maono-map-panel-host__panel\s*\{[\s\S]*position: absolute;/,
  );
  assert.doesNotMatch(
    source.layerPanelCss.slice(0, 700),
    /flex:\s*0\s+0\s+340px|width:\s*340px/,
  );
});

test("invariante geométrica aceita apenas variação de até um pixel", () => {
  const baseline = { width: 1000, height: 700, x: 80, y: 0 };
  assert.equal(
    isLayoutGeometryInvariant(
      baseline,
      { width: 999, height: 700.5, x: 80.5, y: 1 },
    ),
    true,
  );
  assert.equal(
    isLayoutGeometryInvariant(
      baseline,
      { width: 998.9, height: 700, x: 80, y: 0 },
    ),
    false,
  );
});

test("instrumentação cobre a cadeia geométrica e só ativa por opt-in", () => {
  for (const selector of [
    ".maono-map-runtime",
    ".maono-map-runtime__workspace",
    ".maono-map-runtime__map",
    ".maono-kepler-screenshot-root",
    ".maono-kepler-container",
    ".maono-kepler-panel-group",
    ".maono-kepler-viewport",
    ".kepler-gl",
    ".map-container",
    ".mapboxgl-map",
    ".mapboxgl-canvas",
    ".maono-layer-panel",
  ]) {
    assert.ok(
      source.layoutDebug.includes(selector),
      `instrumentação não inclui ${selector}`,
    );
  }
  assert.match(source.layoutDebug, /maonoLayoutDebug/);
  assert.match(source.layoutDebug, /maono:layout-debug/);
  assert.match(source.layoutDebug, /getComputedStyle/);
  assert.match(source.layoutDebug, /getBoundingClientRect/);
});

test("tema visual usa dourado Maõno e overlays sob controle Maõno", () => {
  assert.match(source.shellTokens, /#c5a059/i);
  assert.match(source.overlayCss, /#c5a059/i);
  assert.match(source.legendFactory, /#c5a059/i);
  assert.match(source.legendFactory, /MapLegendPanelFactory/);
  assert.match(source.legendFactory, /MapLegend/);
  assert.match(source.popoverCss, /#c5a059/i);
  assert.match(source.popoverCss, /\.maono-map-tooltip/);
  assert.match(source.popoverFactory, /MapPopoverFactory\.deps/);
  assert.match(source.popoverFactory, /createPortal/);
  assert.match(source.popoverFactory, /maono-map-tooltip/);
  assert.doesNotMatch(source.popoverFactory, /NativeMapPopover/);
  assert.doesNotMatch(source.popoverFactory, /\.map-popover/);
  assert.match(source.shellCss, /@media \(max-width: 820px\)/);
  assert.match(source.overlayCss, /@media \(max-width: 820px\)/);
  assert.match(source.shellCss, /prefers-reduced-motion/);
});
