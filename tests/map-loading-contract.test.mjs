import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

const [
  projectsSection,
  preparedHook,
  prepareDestination,
  mapManagement,
  mapPanelProvider,
  mapUrlLoader,
  saveButton,
  createPanel,
  loadingActivity,
  loaderCss,
] = await Promise.all([
  readFile(
    new URL("src/pages/Projects/components/ProjectsSection.tsx", ROOT),
    "utf8",
  ),
  readFile(new URL("src/hooks/usePreparedNavigate.ts", ROOT), "utf8"),
  readFile(
    new URL(
      "src/pages/Kepler/map-panel/prepare-project-map-destination.ts",
      ROOT,
    ),
    "utf8",
  ),
  readFile(
    new URL("src/pages/Kepler/map-panel/MapManagementPage.tsx", ROOT),
    "utf8",
  ),
  readFile(
    new URL("src/pages/Kepler/map-panel/MapPanelProvider.tsx", ROOT),
    "utf8",
  ),
  readFile(
    new URL("src/pages/Kepler/map-url-loader/index.tsx", ROOT),
    "utf8",
  ),
  readFile(
    new URL("src/pages/Kepler/components/maono-save-button.tsx", ROOT),
    "utf8",
  ),
  readFile(
    new URL("src/pages/Kepler/components/project-create-panel.tsx", ROOT),
    "utf8",
  ),
  readFile(
    new URL("src/components/loading/useLoadingActivity.ts", ROOT),
    "utf8",
  ),
  readFile(
    new URL("src/components/loading/UniversalLoader.css", ROOT),
    "utf8",
  ),
]);

test("Projects resolve painel final antes de sair da tela de origem", () => {
  assert.match(projectsSection, /prepareProjectMapDestination/);
  assert.match(projectsSection, /route: "kepler"/);
  assert.match(projectsSection, /to: \(\) => destination/);
  assert.match(projectsSection, /beforeNavigate: async \(signal\)/);
  assert.doesNotMatch(projectsSection, /route: "mapManagement"/);
});

test("preparação consulta manage e depois o modo exato", () => {
  assert.match(
    prepareDestination,
    /fetchProjectMapNavigation\([\s\S]*projectSlug,[\s\S]*"manage"/,
  );
  assert.match(
    prepareDestination,
    /fetchProjectMapNavigation\([\s\S]*projectSlug,[\s\S]*mode,/,
  );
  assert.match(prepareDestination, /primeMapPanelContextHandoff/);
  assert.match(
    prepareDestination,
    /\/projects\/\$\{encodeURIComponent\(projectSlug\)\}\/\$\{/,
  );
});

test("prepared navigation executa prefetch e preparação em paralelo e suporta cancelamento", () => {
  assert.match(preparedHook, /Promise\.all\(/);
  assert.match(preparedHook, /preloadRouteModule\(route\)/);
  assert.match(preparedHook, /beforeNavigate\(abortController\.signal\)/);
  assert.match(preparedHook, /activeAbortControllerRef/);
  assert.match(preparedHook, /abortController\.signal\.aborted/);
  assert.match(preparedHook, /typeof to === "function" \? to\(\) : to/);
  assert.match(preparedHook, /navigate\(destination, \{ replace \}\)/);
  assert.match(preparedHook, /primeLoadingHandoff/);
});

test("/manage permanece compatível sem spinner próprio", () => {
  assert.match(mapManagement, /prepareProjectMapDestination/);
  assert.match(mapManagement, /route: "kepler"/);
  assert.match(
    mapManagement,
    /useLoadingActivity\(loading \|\| preparing\)/,
  );
  assert.doesNotMatch(mapManagement, /MapRedirectLoader/);
  assert.doesNotMatch(mapManagement, /maono-map-management__spinner/);
});

test("MapPanelProvider consome contexto preparado e não mostra copy de espera", () => {
  assert.match(mapPanelProvider, /consumeMapPanelContextHandoff/);
  assert.match(
    mapPanelProvider,
    /useLoadingActivity\(state\.status === "loading"\)/,
  );
  assert.match(mapPanelProvider, /consumedHandoffSignatureRef/);
  assert.doesNotMatch(mapPanelProvider, /Preparando o mapa/);
  assert.doesNotMatch(mapPanelProvider, /Validando contexto e permissões/);
});

test("hidratação mantém Universal Loader até visual readiness", () => {
  assert.match(mapUrlLoader, /useLoadingActivity\(isMapLoading\)/);
  assert.match(mapUrlLoader, /waitForMaonoMapVisualReadiness/);
  assert.match(mapUrlLoader, /loadCycleComplete/);
  assert.match(mapUrlLoader, /useCompleteLoadingHandoff/);
  assert.match(mapUrlLoader, /dispatch\(setLoadingMapStatus\(true\)\)/);
  assert.match(mapUrlLoader, /dispatch\(setLoadingMapStatus\(false\)\)/);
  assert.doesNotMatch(mapUrlLoader, /components\/Spinner/);
  assert.doesNotMatch(mapUrlLoader, /Os dados estão sendo carregados/);
  assert.doesNotMatch(mapUrlLoader, /maono-map-central-loading/);
});

test("save e create usam atividade universal sem rótulos de espera", () => {
  assert.match(saveButton, /useLoadingActivity\(saving\)/);
  assert.doesNotMatch(saveButton, /Salvando\.\.\./);
  assert.doesNotMatch(saveButton, /Criando\.\.\./);
  assert.match(saveButton, /Salvar na Maõno/);
  assert.match(saveButton, /Salvar como projeto/);

  assert.doesNotMatch(createPanel, /Criando projeto…/);
  assert.doesNotMatch(
    createPanel,
    /Preparando configuração e visualização do mapa…/,
  );
  assert.match(createPanel, /phase === "error" \? \(/);
  assert.match(createPanel, /Tentar novamente/);
});

test("adaptador booleano faz cleanup do token e overlay global cobre modais", () => {
  assert.match(loadingActivity, /useLayoutEffect/);
  assert.match(loadingActivity, /tokenRef/);
  assert.match(loadingActivity, /beginLoading\(\{ immediate: true \}\)/);
  assert.match(loadingActivity, /endLoading\(tokenRef\.current\)/);
  assert.match(loaderCss, /\.mm-loading-overlay \{[\s\S]*z-index: 120000/);
});
