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
    if (entry.isDirectory()) {
      files.push(...(await walk(next)));
    } else {
      files.push(next);
    }
  }

  return files;
}

const [
  boot,
  main,
  provider,
  login,
  projects,
  sampleViewer,
  routes,
] = await Promise.all([
  source("index.html"),
  source("src/main.tsx"),
  source("src/components/loading/LoadingProvider.tsx"),
  source("src/pages/Login/index.tsx"),
  source("src/pages/Projects.tsx"),
  source("src/pages/Kepler/components/load-data-modal/sample-data-viewer.tsx"),
  source("src/Routes.tsx"),
]);

test("cold load de /login mantém um único DOM loader até readiness", () => {
  assert.match(
    boot,
    /<div id="root"><\/div>\s*<main[\s\S]*id="app-boot-fallback"/,
  );
  assert.doesNotMatch(
    boot,
    /<div id="root">\s*<main[\s\S]*id="app-boot-fallback"/,
  );
  assert.match(boot, /data-loading-owner="initial-boot"/);

  assert.match(provider, /initialBootActive/);
  assert.match(
    provider,
    /active=\{isVisible && !initialBootActive\}/,
  );
  assert.match(provider, /completeInitialBootLoading/);
  assert.match(provider, /controller\.activeCount > 0/);

  assert.match(login, /useInitialBootReadiness\(!loginLoading\)/);
  assert.match(login, /if \(loginLoading\) \{[\s\S]*return null/);
  assert.doesNotMatch(login, /LoadingOverlay/);

  assert.match(routes, /<Route path="\/login" element=\{<LoginPage \/>\} \/>/);
  assert.doesNotMatch(routes, /lazy\(routeModules\.login\)/);
});

test("runtime só remove o boot imediatamente fora de /login", () => {
  assert.match(main, /acknowledgeInitialBootRuntime\(\)/);
  assert.match(main, /window\.location\.pathname/);
  assert.match(main, /completeInitialBootLoader\(\)/);
});

test("Login autenticado mantém o mesmo boot até Projects readiness", () => {
  assert.match(login, /handoffKey: "login-projects"/);
  assert.match(projects, /useCompleteLoadingHandoff/);
  assert.match(projects, /loginProjectsReady/);
  assert.match(
    projects,
    /useInitialBootReadiness\([\s\S]*loginProjectsReady/,
  );
});

test("loaders legados removidos não podem voltar", async () => {
  await assert.rejects(
    access(new URL("src/components/Spinner.tsx", ROOT)),
  );

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
      assert.doesNotMatch(
        content,
        pattern,
        `legado ${pattern} encontrado em ${filePath}`,
      );
    }
  }
});

test("exceções estruturais aprovadas permanecem no contrato", () => {
  assert.match(routes, /fallback=\{<ProjectsPageSkeleton \/>\}/);
  assert.match(routes, /fallback=\{<AdminPageSkeleton \/>\}/);
  assert.match(projects, /<ProjectsPageSkeleton \/>/);
});
