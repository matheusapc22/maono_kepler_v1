import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

const [
  loader,
  overlay,
  provider,
  styles,
  skeleton,
  routes,
  main,
  boot,
  tokens,
] = await Promise.all([
  readFile(new URL("src/components/loading/UniversalLoader.tsx", ROOT), "utf8"),
  readFile(new URL("src/components/loading/LoadingOverlay.tsx", ROOT), "utf8"),
  readFile(new URL("src/components/loading/LoadingProvider.tsx", ROOT), "utf8"),
  readFile(new URL("src/components/loading/UniversalLoader.css", ROOT), "utf8"),
  readFile(new URL("src/components/loading/Skeleton.tsx", ROOT), "utf8"),
  readFile(new URL("src/Routes.tsx", ROOT), "utf8"),
  readFile(new URL("src/main.tsx", ROOT), "utf8"),
  readFile(new URL("index.html", ROOT), "utf8"),
  readFile(new URL("src/maono-design-tokens.css", ROOT), "utf8"),
]);

test("UniversalLoader expõe tamanhos controlados e texto apenas assistivo", () => {
  assert.match(loader, /"inline" \| "compact" \| "page"/);
  assert.match(loader, /mm-sr-only/);
  assert.match(loader, /role="status"/);
  assert.doesNotMatch(loader, />\s*Carregando\s*</);
});

test("material dourado deriva do design system existente", () => {
  for (const token of [
    "--maono-accent",
    "--maono-accent-muted",
    "--maono-accent-strong",
    "--maono-accent-bright",
    "--maono-accent-text",
    "--maono-accent-glow",
    "--maono-accent-glow-strong",
  ]) {
    assert.ok(tokens.includes(token), `token global ausente: ${token}`);
    assert.ok(styles.includes(token), `loader não consome: ${token}`);
  }

  assert.doesNotMatch(styles, /#[0-9a-f]{6}/i);
});

test("spinner possui profundidade discreta e reduced motion", () => {
  assert.match(styles, /perspective\(140px\)/);
  assert.match(styles, /drop-shadow/);
  assert.match(styles, /radial-gradient/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /animation:\s*none/);
});

test("overlay suporta viewport e container sem impor tela de loading", () => {
  assert.match(overlay, /"viewport" \| "container"/);
  assert.match(styles, /\.mm-loading-overlay--viewport/);
  assert.match(styles, /\.mm-loading-overlay--container/);
  assert.match(styles, /background:\s*transparent/);
});

test("provider usa controller tokenizado, ownership de handoff e política anti-flicker", () => {
  assert.match(provider, /DEFAULT_SHOW_AFTER_MS = 120/);
  assert.match(provider, /DEFAULT_MIN_VISIBLE_MS = 250/);
  assert.match(provider, /controller\.begin\(\)/);
  assert.match(provider, /controller\.end\(token\)/);
  assert.match(provider, /controller\.owns\(token\)/);
  assert.match(provider, /LoadingHandoffController/);
  assert.match(provider, /cancelOutsideLocation/);
  assert.match(provider, /controller\.withLoading\(operation\)/);
});

test("fallback genérico de rota usa somente o loader universal", () => {
  assert.match(routes, /import \{ LoadingOverlay \} from "\.\/components\/loading"/);
  assert.match(routes, /const RouteSuspenseFallback/);
  assert.match(
    routes,
    /<LoadingOverlay[\s\S]*?active[\s\S]*?scope="viewport"[\s\S]*?loaderSize="page"/,
  );
  assert.doesNotMatch(routes, /const RouteLoading/);
  assert.doesNotMatch(routes, /<Skeleton /);
});

test("rota /login não possui Suspense ou loader alternativo", () => {
  assert.match(routes, /import LoginPage from "\.\/pages\/Login\.tsx"/);
  assert.match(
    routes,
    /<Route path="\/login" element=\{<LoginPage \/>\} \/>/,
  );
  assert.doesNotMatch(routes, /lazy\(routeModules\.login\)/);
});

test("Projects e Admin preservam seus skeletons estruturais", () => {
  assert.match(skeleton, /export function ProjectsPageSkeleton/);
  assert.match(skeleton, /export function AdminPageSkeleton/);
  assert.match(routes, /fallback=\{<ProjectsPageSkeleton \/>\}/);
  assert.match(routes, /fallback=\{<AdminPageSkeleton \/>\}/);
  assert.match(routes, /if \(loading\)[\s\S]*return <AdminPageSkeleton \/>/);
});

test("rotas lazy legadas também ficam protegidas por Suspense", () => {
  for (const routePath of [
    'path="(:id)"',
    'path="map/:provider"',
    'path="demo/map"',
    'path="demo/map/:provider"',
  ]) {
    const start = routes.indexOf(routePath);
    assert.notEqual(start, -1, `rota ausente: ${routePath}`);
    const excerpt = routes.slice(start, start + 220);
    assert.match(excerpt, /<WithSuspense>/);
    assert.match(excerpt, /<KeplerApp \/>/);
  }
});

test("boot inicial usa exatamente a identidade do Universal Loader", () => {
  assert.match(boot, /id="app-boot-fallback"/);
  assert.match(
    boot,
    /class="mm-loading-overlay mm-loading-overlay--viewport"/,
  );
  assert.match(
    boot,
    /class="mm-universal-loader mm-universal-loader--page"/,
  );
  assert.match(boot, /class="mm-universal-loader__ring"/);
  assert.match(boot, /--maono-loader-size-page:\s*46px/);
  assert.match(boot, /--maono-loader-thickness-page:\s*4px/);
  assert.match(boot, /--maono-loader-duration:\s*1\.05s/);
  assert.match(boot, /@keyframes maono-universal-loader-spin/);
  assert.match(boot, /perspective\(140px\) rotateX\(7deg\)/);
  assert.match(boot, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(boot, /mm-boot-loader/);
  assert.doesNotMatch(boot, /mm-boot-screen/);
  assert.doesNotMatch(boot, /Carregando Maõno Maps/);
});

test("boot mantém recuperação explícita em caso de falha real", () => {
  assert.match(boot, /__MAONO_SHOW_BOOT_FAILURE__/);
  assert.match(boot, /__MAONO_BOOT_TIMEOUT__/);
  assert.match(boot, /12000/);
  assert.match(boot, /Não foi possível iniciar a plataforma/);
  assert.match(boot, /Tentar novamente/);
  assert.match(boot, /window\.location\.reload\(\)/);
});

test("fundação continua instalada no root", () => {
  assert.match(main, /import \{ LoadingProvider \} from "\.\/components\/loading"/);
  assert.match(main, /<LoadingProvider>/);
  assert.match(main, /<SessionProvider>/);
});
