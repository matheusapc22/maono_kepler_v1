import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

const [
  login,
  projects,
  preparedNavigate,
  loadingProvider,
  loadingHandoff,
  loadingActivity,
  projectsSection,
  mapManagement,
  mapPanelProvider,
  mapUrlLoader,
  organizationSwitcher,
  review,
  inbox,
  adminFiles,
  dropbox,
  sampleViewer,
  routes,
] = await Promise.all([
  readFile(new URL("src/pages/Login.tsx", ROOT), "utf8"),
  readFile(new URL("src/pages/Projects.tsx", ROOT), "utf8"),
  readFile(new URL("src/hooks/usePreparedNavigate.ts", ROOT), "utf8"),
  readFile(
    new URL("src/components/loading/LoadingProvider.tsx", ROOT),
    "utf8",
  ),
  readFile(
    new URL("src/components/loading/loading-handoff-controller.ts", ROOT),
    "utf8",
  ),
  readFile(
    new URL("src/components/loading/useLoadingActivity.ts", ROOT),
    "utf8",
  ),
  readFile(
    new URL("src/pages/Projects/components/ProjectsSection.tsx", ROOT),
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
    new URL(
      "src/pages/Projects/components/OrganizationWorkspaceSwitcher.tsx",
      ROOT,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "src/pages/Kepler/change-requests/ChangeRequestReviewPage.tsx",
      ROOT,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "src/pages/Kepler/change-requests/EditorRequestInboxPage.tsx",
      ROOT,
    ),
    "utf8",
  ),
  readFile(new URL("src/pages/AdminFiles.tsx", ROOT), "utf8"),
  readFile(new URL("src/pages/AdminDropboxBrowser.tsx", ROOT), "utf8"),
  readFile(
    new URL(
      "src/pages/Kepler/components/load-data-modal/sample-data-viewer.tsx",
      ROOT,
    ),
    "utf8",
  ),
  readFile(new URL("src/Routes.tsx", ROOT), "utf8"),
]);

test("Login transfere o mesmo loading até Projects concluir a primeira carga", () => {
  assert.match(login, /handoffKey: "login-projects"/);
  assert.match(login, /authenticatedRedirectPending/);
  assert.match(
    login,
    /useLoadingActivity\([\s\S]*session\.loading && !initialBootActive,[\s\S]*label: "session-bootstrap"/,
  );
  assert.match(
    login,
    /useInitialBootReadiness\(bootCanCompleteOnLogin\)/,
  );
  assert.doesNotMatch(login, /LoadingOverlay/);
  assert.doesNotMatch(login, /Entrando\.\.\./);

  assert.match(
    projects,
    /useCompleteLoadingHandoff\([\s\S]*"login-projects"/,
  );
  assert.match(projects, /loginProjectsReady/);
  assert.match(projects, /projectContextIsCurrent/);
  assert.match(projects, /!projectsLoading/);
});

test("prepared navigation transfere token para owner do LoadingProvider", () => {
  assert.match(preparedNavigate, /handoffLoading/);
  assert.match(preparedNavigate, /cancelLoadingHandoff/);
  assert.match(preparedNavigate, /let handedOff = false/);
  assert.match(preparedNavigate, /activeLoadingTokenRef\.current = null/);
  assert.match(preparedNavigate, /if \(!handedOff\)/);

  assert.match(loadingProvider, /LoadingHandoffController/);
  assert.match(loadingProvider, /controller\.owns\(token\)/);
  assert.match(loadingProvider, /cancelOutsideLocation/);
  assert.match(loadingProvider, /handoffController\.cancelAll\(\)/);
  assert.match(loadingHandoff, /class LoadingHandoffController/);
  assert.match(loadingHandoff, /state: "handed-off"/);
  assert.match(loadingHandoff, /state = "claimed"/);
  assert.doesNotMatch(loadingHandoff, /setTimeout/);
});

test("atividade booleana entra antes do paint e força visibilidade imediata", () => {
  assert.match(loadingActivity, /useLayoutEffect/);
  assert.match(
    loadingActivity,
    /beginLoading\(\{[\s\S]*immediate,[\s\S]*metadata:/,
  );
  assert.match(loadingActivity, /immediate = true/);
  assert.match(loadingActivity, /label = metadata\?\.label/);
  assert.doesNotMatch(loadingActivity, /useEffect/);
});

test("Projects transfere loading até visual readiness do mapa", () => {
  assert.match(projects, /handoffKey: "map:\/maps\/new\/create"/);
  assert.match(
    projectsSection,
    /handoffKey: \(resolvedDestination\) =>[\s\S]*map:/,
  );
  assert.match(
    mapManagement,
    /handoffKey: \(resolvedDestination\) =>[\s\S]*map:/,
  );
  assert.match(
    mapPanelProvider,
    /useCompleteLoadingHandoff\([\s\S]*map:\$\{location\.pathname\}/,
  );
  assert.match(
    mapPanelProvider,
    /state\.status === "blocked"[\s\S]*state\.status === "error"[\s\S]*isNewMap && state\.status === "ready"/,
  );
  assert.match(mapUrlLoader, /loadCycleComplete/);
  assert.match(
    mapUrlLoader,
    /useCompleteLoadingHandoff\([\s\S]*map:\$\{location\.pathname\}/,
  );
  assert.match(mapUrlLoader, /waitForMaonoMapVisualReadiness/);
});

test("troca de organização mantém Universal Loader até projetos do novo contexto", () => {
  assert.match(projects, /organizationTransitionPending/);
  assert.match(projects, /organizationTransitionActive/);
  assert.match(
    projects,
    /active=\{organizationTransitionActive\}[\s\S]*scope="container"/,
  );
  assert.match(organizationSwitcher, /<UniversalLoader/);
  assert.doesNotMatch(
    organizationSwitcher,
    /Validando acesso e atualizando projetos/,
  );
  assert.doesNotMatch(projects, /Trocando organização e atualizando permissões/);
});

test("Change Requests usam loader local/inline sem copy de espera", () => {
  assert.match(
    review,
    /active=\{loading\}[\s\S]*scope="container"/,
  );
  assert.match(review, /<UniversalLoader/);
  assert.doesNotMatch(review, /Carregando revisão-base/);
  assert.doesNotMatch(review, /Processando…/);

  assert.match(inbox, /useLoadingActivity\(loading\)/);
  assert.match(inbox, /scope="container"/);
  assert.doesNotMatch(inbox, /Carregando solicitações…/);
  assert.doesNotMatch(inbox, /Carregando sessão…/);
});

test("Admin usa loaders universais e mantém rótulos estáveis", () => {
  assert.match(adminFiles, /useLoadingActivity\(loading\)/);
  assert.match(adminFiles, /scope="container"/);
  assert.match(adminFiles, /<UniversalLoader/);
  assert.doesNotMatch(adminFiles, /LoadingScreen/);
  for (const copy of [
    "Carregando gestão de arquivos",
    "Salvando...",
    "Atualizando...",
    "Enviando...",
    "Criando...",
  ]) {
    assert.equal(adminFiles.includes(copy), false, copy);
  }

  assert.match(dropbox, /scope="container"/);
  assert.doesNotMatch(dropbox, />Carregando Dropbox\.\.\.</);
  assert.doesNotMatch(dropbox, /Abrindo\.\.\./);
  assert.doesNotMatch(dropbox, /setTimeout\(\(\) => setPreviewLoading/);
});

test("Kepler local não duplica LoadingDialog quando o mapa já possui owner global", () => {
  assert.doesNotMatch(sampleViewer, /LoadingDialog/);
  assert.match(sampleViewer, /aria-busy=\{isMapLoading\}/);
});

test("exceções estruturais permanecem preservadas", () => {
  assert.match(routes, /fallback=\{<ProjectsPageSkeleton \/>\}/);
  assert.match(routes, /fallback=\{<AdminPageSkeleton \/>\}/);
  assert.match(projects, /<ProjectsPageSkeleton \/>/);
});
