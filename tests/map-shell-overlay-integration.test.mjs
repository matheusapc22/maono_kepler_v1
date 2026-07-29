import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  index: "../src/pages/Kepler/index.tsx",
  provider:
    "../src/pages/Kepler/map-panel/MapPanelProvider.tsx",
  shell:
    "../src/pages/Kepler/components/maono-map-shell/MaonoMapShell.tsx",
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

test("baseline preserva o runtime seguro sem a UI incompleta", () => {
  assert.doesNotMatch(source.index, /replaceSidePanel/);
  assert.doesNotMatch(source.index, /<MaonoMapShell>/);
  assert.doesNotMatch(source.index, /<MapOverlayControls \/>/);
  assert.match(source.index, /<ScreenshotWrapper/);
  assert.match(source.index, /<PointClusterSettingsPanel/);
  assert.match(source.index, /<MapUrlLoader \/>/);
  assert.match(source.index, /<MaonoSaveButton \/>/);
  assert.match(source.index, /<MapPanelProvider>/);
  assert.match(source.index, /<MapPanelAccessGate>/);
  assert.match(source.shell, /customMapShellEnabled/);
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

test("shell usa capabilities e contexto sem decisão por role bruta", () => {
  assert.match(source.shell, /context\?\.capabilities\?\.openLayerPanel/);
  assert.match(source.shell, /availablePanels\?\.viewer/);
  assert.match(source.shell, /availablePanels\?\.editor/);
  assert.doesNotMatch(source.shell, /user\?\.role/);
  assert.doesNotMatch(source.shell, /checkAdminUser/);
  assert.match(source.provider, /VITE_MAONO_MAP_SHELL_V1/);
  assert.match(source.provider, /VITE_MAONO_MAP_OVERLAY_V1/);
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
