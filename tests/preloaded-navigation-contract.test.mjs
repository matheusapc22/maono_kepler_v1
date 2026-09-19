import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const [routes, routeModules, preparedHook, login, projects, projectsSection, projectCard] =
  await Promise.all([
    readFile(new URL("src/Routes.tsx", ROOT), "utf8"),
    readFile(new URL("src/route-modules.ts", ROOT), "utf8"),
    readFile(new URL("src/hooks/usePreparedNavigate.ts", ROOT), "utf8"),
    readFile(new URL("src/pages/Login.tsx", ROOT), "utf8"),
    readFile(new URL("src/pages/Projects.tsx", ROOT), "utf8"),
    readFile(new URL("src/pages/Projects/components/ProjectsSection.tsx", ROOT), "utf8"),
    readFile(new URL("src/pages/Projects/components/ProjectCard.tsx", ROOT), "utf8"),
  ]);

test("rotas lazy compartilham o mesmo registry usado pelo prefetch", () => {
  assert.match(routeModules, /createCachedModuleLoader/);
  assert.match(routeModules, /mapManagement/);
  assert.match(routeModules, /projects/);
  assert.match(routeModules, /kepler/);
  assert.match(routes, /lazy\(routeModules\.mapManagement\)/);
  assert.match(routes, /lazy\(routeModules\.projects\)/);
  assert.match(routes, /lazy\(routeModules\.kepler\)/);
  assert.doesNotMatch(routeModules, /login:/);
  assert.doesNotMatch(routes, /lazy\(routeModules\.login\)/);
});

test("prepared navigation prepara chunk e pré-condição antes de alterar a rota", () => {
  assert.match(preparedHook, /Promise\.all\(/);
  assert.match(preparedHook, /preloadRouteModule\(route\)/);
  assert.match(preparedHook, /beforeNavigate\(abortController\.signal\)/);
  assert.match(preparedHook, /activeLoadingTokenRef/);
  assert.match(preparedHook, /activeAbortControllerRef/);
  assert.match(preparedHook, /controller\.isCurrent\(intent\)/);
  assert.match(preparedHook, /navigate\(destination, \{ replace \}\)/);
  assert.match(preparedHook, /handoffLoading/);
  assert.match(preparedHook, /cancelLoadingHandoff/);
});

test("Login canônico usa sessão, prefetch e handoff para Projects", () => {
  assert.match(login, /const session = useSession\(\)/);
  assert.match(login, /route: "projects"/);
  assert.match(login, /beforeNavigate: \(signal\)/);
  assert.match(
    login,
    /session\.login\(email, password, \{ signal \}\)/,
  );
  assert.match(login, /handoffKey: "login-projects"/);
  assert.match(login, /authenticatedRedirectPending/);
  assert.match(login, /useLoadingActivity\(session\.loading && !initialBootActive\)/);
  assert.match(login, /useInitialBootReadiness\(bootCanCompleteOnLogin\)/);
  assert.doesNotMatch(login, /Entrando\.\.\./);
  assert.doesNotMatch(login, /assetsReady/);
  assert.match(login, /directLoginControllerRef/);
  assert.match(login, /directLoginControllerRef\.current\?\.abort\(\)/);
});

test("Projects prepara chunks antes das navegações pesadas", () => {
  assert.match(projects, /route: "kepler"/);
  assert.match(projects, /to: "\/maps\/new\/create"/);
  assert.match(projects, /handoffKey: "map:\/maps\/new\/create"/);
  assert.match(projectsSection, /route: "kepler"/);
  assert.match(projectsSection, /prepareProjectMapDestination/);
  assert.match(projectsSection, /to: \(\) => destination/);
  assert.match(projectsSection, /handoffKey: \(resolvedDestination\)/);
});

test("ProjectCard preserva modified-click e remove copy de espera", () => {
  assert.match(projectCard, /event\.metaKey/);
  assert.match(projectCard, /event\.ctrlKey/);
  assert.match(projectCard, /event\.preventDefault\(\)/);
  assert.match(projectCard, /void onOpen\(project\)/);
  assert.doesNotMatch(projectCard, /Abrindo\.\.\./);
  assert.match(projectCard, />Abrir projeto<\/span>/);
});

test("callback de autenticação usa feedback universal sem texto visual", () => {
  const callbackStart = routes.indexOf("const AuthCallback");
  const callbackEnd = routes.indexOf("const NotFound");
  const callback = routes.slice(callbackStart, callbackEnd);
  assert.match(callback, /<LoadingOverlay/);
  assert.match(callback, /accessibleLabel="Autenticando"/);
  assert.match(callback, /window\.opener\.postMessage/);
  assert.match(callback, /window\.close\(\)/);
});

test("Projects e Admin continuam como exceções estruturais", () => {
  assert.match(routes, /fallback=\{<ProjectsPageSkeleton \/>\}/);
  assert.match(routes, /fallback=\{<AdminPageSkeleton \/>\}/);
});
