import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  panel:
    "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
  list: "../src/pages/Kepler/components/maono-layer-panel/LayerList.tsx",
  item:
    "../src/pages/Kepler/components/maono-layer-panel/LayerListItem.tsx",
  inspector:
    "../src/pages/Kepler/components/maono-layer-panel/LayerInspector.tsx",
  styles:
    "../src/pages/Kepler/components/maono-layer-panel/layer-accordion.css",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [
      key,
      await readFile(new URL(path, import.meta.url), "utf8"),
    ]),
  ),
);

test("cada camada mantém expansão independente e permite múltiplas abertas", () => {
  assert.match(source.list, /expandedLayerIds/);
  assert.match(source.list, /const next = new Set\(current\)/);
  assert.match(source.list, /next\.delete\(layer\.id\)/);
  assert.match(source.list, /next\.add\(layer\.id\)/);
  assert.doesNotMatch(source.list, /new Set\(\[layer\.id\]\)/);
  assert.match(source.list, /renderLayerDetails/);
});

test("cabeçalho expõe semântica de accordion e chevron", () => {
  assert.match(source.item, /aria-expanded=\{expanded\}/);
  assert.match(source.item, /aria-controls=\{detailsId\}/);
  assert.match(source.item, /maono-layer-list__chevron/);
  assert.match(source.item, /name="chevron-down"/);
  assert.match(source.item, /role="region"/);
  assert.match(source.item, /aria-hidden=\{!expanded\}/);
});

test("detalhes são incorporados em cada camada e o inspetor usa ids únicos", () => {
  assert.match(source.panel, /renderLayerDetails=\{renderLayerDetails\}/);
  assert.match(source.panel, /function renderLayerDetails/);
  assert.match(source.panel, /<LayerInspector[\s\S]*layer=\{layer\}/);
  assert.match(source.inspector, /maono-layer-name-error-\$\{encodeURIComponent/);
  assert.doesNotMatch(source.inspector, /id="maono-layer-name-error"/);
});

test("abertura e fechamento usam animação suave com redução de movimento herdada", () => {
  assert.match(source.styles, /grid-template-rows: 0fr/);
  assert.match(source.styles, /grid-template-rows: 1fr/);
  assert.match(source.styles, /220ms cubic-bezier/);
  assert.match(source.styles, /\.maono-layer-list__item\.is-expanded/);
  assert.match(source.styles, /transform: rotate\(180deg\)/);
});
