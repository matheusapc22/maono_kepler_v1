import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

const [
  main,
  platformLayout,
  shell,
  shellLayout,
  shellRuntime,
  kepler,
  boot,
] = await Promise.all([
  source("src/main.tsx"),
  source("src/platform-layout.css"),
  source("src/pages/Kepler/components/maono-map-shell/MaonoMapShell.tsx"),
  source("src/pages/Kepler/components/maono-map-shell/maono-map-layout-contract.css"),
  source("src/pages/Kepler/components/maono-map-shell/MaonoMapRuntime.tsx"),
  source("src/pages/Kepler/index.tsx"),
  source("index.html"),
]);

test("plataforma usa uma única referência dinâmica de viewport", () => {
  assert.match(main, /import "\.\/platform-layout\.css"/);
  assert.match(platformLayout, /--maono-app-viewport-height:\s*100vh/);
  assert.match(platformLayout, /@supports \(height: 100dvh\)/);
  assert.match(platformLayout, /--maono-app-viewport-height:\s*100dvh/);
  assert.match(
    platformLayout,
    /#root\s*\{[\s\S]*height:\s*var\(--maono-app-viewport-height\)\s*!important/,
  );

  for (const surface of [
    ".maono-login-page",
    ".mm-projects-page",
    ".mm-projects-layout",
    ".mm-loading-screen",
    ".admin-page",
    ".maono-admin-page",
    ".maono-map-gate",
  ]) {
    assert.ok(platformLayout.includes(surface), `viewport não cobre ${surface}`);
  }

  assert.match(platformLayout, /\.maono-login-page\s*\{[\s\S]*overflow-y:\s*auto\s*!important/);
  assert.doesNotMatch(platformLayout, /\bzoom\s*:/i);
  assert.doesNotMatch(platformLayout, /transform:\s*scale\(/i);
});

test("boot inicial usa a mesma estratégia 100vh com upgrade para 100dvh", () => {
  assert.match(boot, /--mm-boot-viewport-height:\s*100vh/);
  assert.match(boot, /@supports \(height: 100dvh\)/);
  assert.match(boot, /--mm-boot-viewport-height:\s*100dvh/);
  assert.match(
    boot,
    /\.mm-boot-screen\s*\{[\s\S]*min-height:\s*var\(--mm-boot-viewport-height\)/,
  );
});

test("painel é overlay opaco e mantém a barreira visual da PR 106", () => {
  assert.match(shell, /className="maono-map-runtime__map"/);
  assert.match(shellLayout, /@media \(min-width: 1021px\)/);
  assert.match(
    shellLayout,
    /\.maono-map-panel-host__panel\s*\{[\s\S]*isolation:\s*isolate[\s\S]*contain:\s*paint[\s\S]*background:\s*var\(--maono-map-panel\)/,
  );
  assert.match(
    shellLayout,
    /\.maono-map-panel-host__panel::before\s*\{[\s\S]*background:\s*var\(--maono-map-panel\)/,
  );
  assert.match(shellLayout, /\.maono-map-panel-host__panel\s*\{[\s\S]*pointer-events:\s*auto/);
  assert.doesNotMatch(shellLayout, /\bzoom\s*:/i);
  assert.doesNotMatch(shellLayout, /transform:\s*scale\(/i);
});

test("abrir ou fechar painel não altera geometria do viewport do Kepler", () => {
  const mapRule = shellLayout.match(/\.maono-map-runtime__map\s*\{([\s\S]*?)\}/)?.[1] ?? "";

  assert.doesNotMatch(mapRule, /transition\s*:/i);
  assert.doesNotMatch(mapRule, /will-change\s*:/i);
  assert.doesNotMatch(
    shellLayout,
    /\.maono-map-runtime--panel-(?:open|collapsed)\s+\.maono-map-runtime__map/,
  );
  assert.doesNotMatch(
    shellLayout,
    /\.maono-map-runtime__map\s*\{[\s\S]*?(?:left|right|width|height|inset|transform)\s*:/i,
  );
  assert.match(shellLayout, /\.maono-map-topbar\s*\{[\s\S]*transition:\s*left/);
});

test("tablet e mobile mantêm overlay bloqueante sem redimensionar o mapa", () => {
  assert.match(shellLayout, /@media \(max-width: 1020px\)/);
  assert.match(shellLayout, /\.maono-map-panel-host__backdrop\s*\{[\s\S]*pointer-events:\s*auto/);
  assert.doesNotMatch(
    shellLayout,
    /\.maono-map-runtime--panel-(?:open|collapsed)\s+\.maono-map-runtime__map/,
  );
  assert.match(shellRuntime, /matchMedia\("\(max-width: 1020px\)"\)/);
});

test("Kepler conserva ResizeObserver apenas para mudanças reais de contêiner", () => {
  assert.match(kepler, /ResizeObserver/);
  assert.match(kepler, /getBoundingClientRect\(\)/);
  assert.match(kepler, /MeasuredKeplerViewport/);
  assert.match(kepler, /width=\{width\}/);
  assert.match(kepler, /height=\{height\}/);
});
