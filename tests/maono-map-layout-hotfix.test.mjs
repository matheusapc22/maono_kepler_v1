import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexSource = await readFile(
  new URL("../src/pages/Kepler/index.tsx", import.meta.url),
  "utf8",
);
const shellCss = await readFile(
  new URL(
    "../src/pages/Kepler/components/maono-map-shell/maono-map-shell.css",
    import.meta.url,
  ),
  "utf8",
);
const layoutDebug = await readFile(
  new URL(
    "../src/pages/Kepler/components/maono-map-shell/map-layout-debug.ts",
    import.meta.url,
  ),
  "utf8",
);

function rule(source, selector) {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `seletor não encontrado: ${selector}`);
  const end = source.indexOf("}", start);
  assert.notEqual(end, -1, `fechamento não encontrado: ${selector}`);
  return source.slice(start, end + 1);
}

test("o mapa não depende mais do AutoSizer", () => {
  assert.doesNotMatch(indexSource, /react-virtualized\/dist\/commonjs\/AutoSizer/);
  assert.doesNotMatch(indexSource, /<AutoSizer/);
  assert.match(indexSource, /function MeasuredKeplerViewport/);
  assert.match(indexSource, /<MeasuredKeplerViewport/);
});

test("ResizeObserver mede o pai real do mapa", () => {
  assert.match(indexSource, /function useParentElementSize/);
  assert.match(indexSource, /new ResizeObserver\(scheduleMeasure\)/);
  assert.match(indexSource, /parent\.getBoundingClientRect\(\)/);
  assert.match(indexSource, /Window\.addEventListener\("resize", scheduleMeasure\)/);
});

test("a raiz recebe largura e altura em pixels medidos", () => {
  assert.match(indexSource, /ref=\{mapRootRef\}/);
  assert.match(indexSource, /mapRootSize\.width > 0/);
  assert.match(indexSource, /mapRootSize\.height > 0/);
  assert.match(indexSource, /useSynchronizedKeplerFrame\(mapRootRef, mapRootSize\)/);
});

test("ScreenshotWrapper e container são sincronizados explicitamente", () => {
  assert.match(indexSource, /\.maono-kepler-screenshot-root/);
  assert.match(indexSource, /\.maono-kepler-container/);
  assert.match(indexSource, /\.maono-kepler-panel-group--horizontal/);
  assert.match(indexSource, /Object\.assign\(node\.style/);
  assert.match(indexSource, /width,/);
  assert.match(indexSource, /height,/);
});

test("Kepler recebe dimensões positivas antes de montar", () => {
  assert.match(indexSource, /width > 0 && height > 0 \? renderMap/);
  assert.match(indexSource, /width=\{width\}/);
  assert.match(indexSource, /height=\{height\}/);
  assert.match(indexSource, /fallbackSize=\{mapRootSize\}/);
});

test("viewport e painéis possuem contexto geométrico estável", () => {
  assert.match(
    shellCss,
    /\.maono-kepler-viewport\s*\{[\s\S]*position: absolute;[\s\S]*inset: 0;[\s\S]*width: 100%;[\s\S]*height: 100%;/,
  );
  assert.match(
    shellCss,
    /\.maono-kepler-main-panel,[\s\S]*\.maono-kepler-map-panel\s*\{[\s\S]*position: relative;/,
  );
});

test("handle do painel continua clicável", () => {
  const handle = rule(shellCss, ".maono-map-panel-host__handle {");
  assert.match(handle, /pointer-events: auto;/);
});

test("debug acompanha o viewport medido", () => {
  assert.match(layoutDebug, /\["measured-viewport", "\.maono-kepler-viewport"\]/);
  assert.doesNotMatch(layoutDebug, /maono-kepler-autosizer/);
});
