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

test("provider usa controller tokenizado e política anti-flicker", () => {
  assert.match(provider, /DEFAULT_SHOW_AFTER_MS = 120/);
  assert.match(provider, /DEFAULT_MIN_VISIBLE_MS = 250/);
  assert.match(provider, /controller\.begin\(\)/);
  assert.match(provider, /controller\.end\(token\)/);
  assert.match(provider, /controller\.withLoading\(operation\)/);
});

test("fundação é instalada no root sem substituir loadings existentes", () => {
  assert.match(main, /import \{ LoadingProvider \} from "\.\/components\/loading"/);
  assert.match(main, /<LoadingProvider>/);
  assert.match(main, /<SessionProvider>/);

  assert.match(skeleton, /export function ProjectsPageSkeleton/);
  assert.match(skeleton, /export function AdminPageSkeleton/);
  assert.match(routes, /fallback=\{<ProjectsPageSkeleton \/>\}/);
  assert.match(routes, /fallback=\{<AdminPageSkeleton \/>\}/);
  assert.match(routes, /const RouteLoading/);
});

test("PRL-01 não substitui boot loader nem fluxo de rotas", () => {
  assert.match(boot, /id="app-boot-fallback"/);
  assert.match(boot, /Carregando Maõno Maps/);
  assert.match(routes, /const RouteLoading/);
});
