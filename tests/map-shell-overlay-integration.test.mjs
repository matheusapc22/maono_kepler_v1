import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  index: "../src/pages/Kepler/index.tsx",
  provider:
    "../src/pages/Kepler/map-panel/MapPanelProvider.tsx",
  context:
    "../src/pages/Kepler/map-panel/MapPanelContext.tsx",
  shell:
    "../src/pages/Kepler/components/maono-map-shell/MaonoMapShell.tsx",
  sidebar:
    "../src/pages/Kepler/components/maono-map-shell/Sidebar.tsx",
  shellCss:
    "../src/pages/Kepler/components/maono-map-shell/maono-map-shell.css",
  overlay:
    "../src/pages/Kepler/components/map-overlay/MapOverlayControls.tsx",
  overlayCss:
    "../src/pages/Kepler/components/map-overlay/map-overlay-controls.css",
  api:
    "../src/pages/Kepler/map-panel/isochrone-api.ts",
  endpoint: "../functions/api/maps/isochrones.js",
  service: "../functions/_lib/isochrone-service.js",
  save:
    "../src/pages/Kepler/components/maono-save-button.tsx",
  migration:
    "../migrations/0017_map_isochrone_rate_limit.sql",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [
      key,
      await readFile(new URL(path, import.meta.url), "utf8"),
    ]),
  ),
);

test("shell Maõno permanece opt-in e é montado pelo gate seguro", () => {
  assert.doesNotMatch(source.index, /replaceSidePanel/);
  assert.doesNotMatch(source.index, /<MapOverlayControls \/>/);
  assert.match(source.index, /<ScreenshotWrapper/);
  assert.match(source.index, /<PointClusterSettingsPanel/);
  assert.match(source.index, /<MapUrlLoader \/>/);
  assert.match(source.index, /<MaonoSaveButton \/>/);
  assert.match(source.index, /<MapPanelProvider>/);
  assert.match(source.index, /<MapPanelAccessGate>/);
  assert.match(source.provider, /import MaonoMapShell/);
  assert.match(source.provider, /<MaonoMapShell>\{children\}<\/MaonoMapShell>/);
  assert.match(source.shell, /if \(!customMapShellEnabled\)/);
  assert.match(source.overlay, /customMapOverlayEnabled/);
});

test("flags frontend customizadas são opt-in e desligadas por padrão", () => {
  for (const flag of [
    "VITE_MAONO_LAYER_MANAGER_V1",
    "VITE_MAONO_MAP_SHELL_V1",
    "VITE_MAONO_MAP_OVERLAY_V1",
  ]) {
    assert.match(
      source.provider,
      new RegExp(`${flag} \\?\\? "false"`),
    );
  }

  assert.doesNotMatch(
    source.provider,
    /VITE_MAONO_(?:LAYER_MANAGER|MAP_SHELL|MAP_OVERLAY)_V1 \?\? "true"/,
  );
  assert.match(source.provider, /\.toLowerCase\(\) === "true"/);
});

test("navegação usa sessão, capabilities e permissões atuais", () => {
  assert.match(source.shell, /context\?\.capabilities\?\.openLayerPanel/);
  assert.match(source.shell, /availablePanels\?\.viewer/);
  assert.match(source.shell, /availablePanels\?\.editor/);
  assert.match(source.shell, /PERMISSION\.DOCUMENT_VIEW/);
  assert.match(source.shell, /PERMISSION\.USERS_VIEW/);
  assert.match(source.shell, /normalizeRole\(user\?\.role\) === "super_admin"/);
  assert.doesNotMatch(source.sidebar, /@maono:token/);
  assert.doesNotMatch(source.sidebar, /maonoApi\.getMe/);
  assert.doesNotMatch(source.shell, /Bearer\s/);
  assert.match(source.provider, /VITE_MAONO_MAP_SHELL_V1/);
});

test("tema da navegação é funcional e persistido sem credenciais", () => {
  assert.match(source.shell, /maono-map-shell-theme/);
  assert.match(source.shell, /handleToggleTheme/);
  assert.match(source.sidebar, /onToggleTheme/);
  assert.match(source.shellCss, /maono-map-shell--light/);
  assert.doesNotMatch(source.shell, /@maono:token/);
});

test("menu preserva ferramentas e rotas conforme disponibilidade", () => {
  for (const item of [
    "layers",
    "analytics",
    "data",
    "files",
    "users",
    "home",
    "organizations",
  ]) {
    assert.match(source.sidebar, new RegExp(`"${item}"`));
  }

  assert.match(source.sidebar, /canOpenViewer/);
  assert.match(source.sidebar, /canOpenEditor/);
  assert.match(source.shell, /toggleModal\("addData"\)/);
  assert.match(source.shell, /\/projects\?section=files/);
  assert.match(source.shell, /\/projects\?section=users/);
});

test("controles promovem centralização, tooltip, legenda e marcador", () => {
  assert.match(source.overlay, /focusVisibleData/);
  assert.match(source.overlay, /interactionConfigChange/);
  assert.match(
    source.overlay,
    /toggleMapControl\("mapLegend",\s*0\)/,
  );
  assert.match(source.overlay, /setPlacingMarker/);
  assert.match(source.overlay, /WebMercatorViewport/);
});

test("isócronas usam somente o proxy autenticado", () => {
  assert.match(source.api, /\/api\/maps\/isochrones/);
  assert.match(source.api, /credentials:\s*"include"/);
  assert.match(source.endpoint, /generateIsochrone/);
  assert.match(source.service, /GEOAPIFY_API_KEY/);
  assert.match(source.service, /requireSession/);
  assert.match(source.service, /ISOCHRONE_RATE_LIMITED/);
  assert.match(source.migration, /map_analysis_rate_limits/);

  for (const frontend of [
    source.overlay,
    source.api,
    source.shell,
    source.sidebar,
  ]) {
    assert.doesNotMatch(frontend, /api\.geoapify\.com/);
    assert.doesNotMatch(frontend, /apiKey=/i);
    assert.doesNotMatch(frontend, /GEOAPIFY_API_KEY/);
  }
});

test("salvar prévia reutiliza o fluxo oficial do projeto", () => {
  assert.match(source.overlay, /maono:save-map/);
  assert.match(source.save, /maono:save-map/);
  assert.match(source.save, /handleExternalSaveRequest/);
});

test("tema visual usa dourado Maõno e possui fallback responsivo", () => {
  assert.match(source.shellCss, /#c5a059/i);
  assert.match(source.overlayCss, /#c5a059/i);
  assert.match(source.shellCss, /@media \(max-width: 820px\)/);
  assert.match(source.overlayCss, /@media \(max-width: 820px\)/);
});
