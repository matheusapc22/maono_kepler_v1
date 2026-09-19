import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
async function source(filePath) {
  return readFile(new URL(filePath, ROOT), "utf8");
}
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(next)));
    else files.push(next);
  }
  return files;
}

const [
  boot,
  main,
  provider,
  bootRuntime,
  login,
  loginShim,
  projects,
  sampleViewer,
  routes,
  loadingController,
  loadingDiagnostics,
] = await Promise.all([
  source("index.html"),
  source("src/main.tsx"),
  source("src/components/loading/LoadingProvider.tsx"),
  source("src/components/loading/initial-boot-loader.ts"),
  source("src/pages/Login.tsx"),
  source("src/pages/Login/index.tsx"),
  source("src/pages/Projects.tsx"),
  source("src/pages/Kepler/components/load-data-modal/sample-data-viewer.tsx"),
  source("src/Routes.tsx"),
  source("src/components/loading/loading-controller.ts"),
  source("src/components/loading/loading-diagnostics.ts"),
]);

test("cold load de /login usa componente canônico e libera boot por readiness", () => {
  assert.match(boot, /<div id="root"><\/div>\s*<main[\s\S]*id="app-boot-fallback"/);
  assert.match(boot, /data-loading-owner="initial-boot"/);
  assert.match(provider, /initialBootActive/);
  assert.match(provider, /active=\{isVisible && !initialBootActive\}/);
  assert.match(provider, /completeInitialBootLoading/);
  assert.doesNotMatch(provider, /controller\.activeCount > 0[\s\S]*return false/);
  assert.match(routes, /import LoginPage from "\.\/pages\/Login\.tsx"/);
  assert.match(routes, /<Route path="\/login" element=\{<LoginPage \/>\} \/>/);
  assert.match(loginShim, /export \{ default \} from "\.\.\/Login\.tsx"/);
  assert.match(login, /useInitialBootReadiness\(bootCanCompleteOnLogin\)/);
  assert.match(
    login,
    /useLoadingActivity\([\s\S]*session\.loading && !initialBootActive,[\s\S]*label: "session-bootstrap"/,
  );
  assert.doesNotMatch(login, /maono-login-page__loading/);
  assert.doesNotMatch(login, /maono-login-page__spinner/);
  assert.doesNotMatch(login, /Carregando experiência Maõno/);
});

test("tokens globais têm ownership seguro e stale apenas diagnóstico", () => {
  assert.match(loadingController, /getActiveSnapshot/);
  assert.match(loadingController, /createdAt/);
  assert.match(loadingDiagnostics, /loading_token_stale/);
  assert.doesNotMatch(
    loadingDiagnostics,
    /controller\.end\(|controller\.clear\(/,
  );
});

test("runtime troca watchdog do bundle por watchdog de readiness", () => {
  assert.match(bootRuntime, /INITIAL_BOOT_RUNTIME_TIMEOUT_MS = 35_000/);
  assert.match(bootRuntime, /__MAONO_BOOT_TIMEOUT__/);
  assert.match(bootRuntime, /__MAONO_BOOT_READINESS_TIMEOUT__/);
  assert.match(bootRuntime, /__MAONO_SHOW_BOOT_FAILURE__/);
  assert.match(main, /acknowledgeInitialBootRuntime\(\)/);
});

test("Login autenticado preserva handoff até Projects readiness", () => {
  assert.match(login, /handoffKey: "login-projects"/);
  assert.match(login, /route: "projects"/);
  assert.match(projects, /useCompleteLoadingHandoff/);
  assert.match(projects, /loginProjectsReady/);
  assert.match(projects, /useInitialBootReadiness\([\s\S]*loginProjectsReady/);
});

test("loaders legados removidos não podem voltar", async () => {
  await assert.rejects(access(new URL("src/components/Spinner.tsx", ROOT)));
  assert.doesNotMatch(sampleViewer, /LoadingDialog/);
  const srcDirectory = fileURLToPath(new URL("src/", ROOT));
  const files = await walk(srcDirectory);
  const forbidden = [
    /components\/Spinner/,
    /<Spinner\b/,
    /LoadingDialog/,
    /mm-boot-loader/,
    /mm-boot-screen/,
    /Carregando revisão-base/,
    /Carregando solicitações…/,
    /Carregando sessão…/,
    /Processando…/,
    /Trocando organização e atualizando permissões…/,
    /Validando acesso e atualizando projetos…/,
  ];
  for (const filePath of files) {
    if (!/\.(?:ts|tsx|css)$/.test(filePath)) continue;
    const content = await readFile(filePath, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `legado ${pattern} encontrado em ${filePath}`);
    }
  }
});

test("exceções estruturais aprovadas permanecem no contrato", () => {
  assert.match(routes, /fallback=\{<ProjectsPageSkeleton \/>\}/);
  assert.match(routes, /fallback=\{<AdminPageSkeleton \/>\}/);
  assert.match(projects, /<ProjectsPageSkeleton \/>/);
});
