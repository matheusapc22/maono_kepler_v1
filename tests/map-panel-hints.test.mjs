import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { panelHintPosition } from "../src/pages/Kepler/components/maono-layer-panel/panel-hint-position.ts";

test("hint opens below the trigger when there is room", () => {
  assert.deepEqual(panelHintPosition(
    { top: 80, bottom: 104, right: 340 },
    { width: 288, height: 108 },
    { width: 1280, height: 800 },
  ), { left: 52, top: 110, maxWidth: 1264, maxHeight: 784 });
});

test("hint flips above its trigger near the viewport bottom", () => {
  const position = panelHintPosition(
    { top: 420, bottom: 444, right: 270 },
    { width: 288, height: 108 },
    { width: 320, height: 480 },
  );
  assert.deepEqual(position, { left: 8, top: 306, maxWidth: 304, maxHeight: 464 });
});

test("long hint is clamped and can scroll within a narrow, short viewport", () => {
  const position = panelHintPosition(
    { top: 92, bottom: 116, right: 312 },
    { width: 360, height: 240 },
    { width: 320, height: 144 },
  );
  assert.deepEqual(position, { left: 8, top: 8, maxWidth: 304, maxHeight: 128 });
});

test("visual-viewport offsets are respected after mobile zoom or keyboard resize", () => {
  const position = panelHintPosition(
    { top: 600, bottom: 624, right: 400 },
    { width: 288, height: 160 },
    { width: 320, height: 240, left: 32, top: 300 },
  );
  assert.equal(position.left, 56);
  assert.equal(position.top, 372);
  assert.equal(position.maxWidth, 304);
  assert.equal(position.maxHeight, 224);
});

test("hint remains inside every edge even if its trigger has scrolled out of view", () => {
  for (const right of [-20, 160, 340]) {
    for (const top of [-80, 0, 100, 440, 600]) {
      const position = panelHintPosition(
        { top, bottom: top + 24, right },
        { width: 288, height: 108 },
        { width: 320, height: 480 },
      );
      assert.ok(position.left >= 8 && position.left + 288 <= 312);
      assert.ok(position.top >= 8 && position.top + 108 <= 472);
    }
  }
});

const base = "../src/pages/Kepler/components/maono-layer-panel/";
const read = (file) => readFile(new URL(base + file, import.meta.url), "utf8");
const [grouping, style, filter, valueEditor, inspector, hint, css] = await Promise.all([
  read("PointSpatialGroupingSection.tsx"), read("LayerStyleEditor.tsx"),
  read("FilterDetailView.tsx"), read("filters/FilterValueEditor.tsx"),
  read("LayerInspector.tsx"), read("PanelHint.tsx"), read("panel-hint.css"),
]);

test("only the two selected long explanations move into local hint components", () => {
  assert.match(grouping, /<PanelHint label="Sobre o agrupamento espacial">\s*\{"Os agrupamentos são uma representação interna da mesma camada\. A visibilidade, a ordem e o estilo lógico permanecem únicos no painel\."\}\s*<\/PanelHint>/);
  assert.match(style, /<PanelHint label="Sobre os modos de composição">\s*\{"Estes modos são globais e afetam a composição de todas as camadas\."\}\s*<\/PanelHint>/);
  assert.doesNotMatch(grouping, /<p className="maono-point-spatial-grouping__description"/);
  assert.doesNotMatch(style, /<p className="maono-style-help"/);
  assert.equal((grouping.match(/<PanelHint /g) ?? []).length, 1);
  assert.equal((style.match(/<PanelHint /g) ?? []).length, 1);
});

test("validation, compatibility, read-only notices and short filter instruction remain visible", () => {
  assert.match(grouping, /<p className="maono-point-spatial-grouping__notice">\s*Modo de visualização/);
  assert.match(grouping, /className="maono-point-spatial-grouping__notice is-warning"\s*role="status"/);
  assert.match(inspector, /<p className="maono-layer-structure__error" role="alert">/);
  assert.match(filter, /<p className="maono-filter-compatibility" role="status">/);
  assert.match(filter, /<small>O mapa responde à alteração após a confirmação\.<\/small>/);
  assert.match(valueEditor, /<p className="maono-filter-editor__warning">\s*A lista de valores desta propriedade está incompleta/);
  assert.doesNotMatch(filter + valueEditor + inspector, /<PanelHint/);
});

test("hint accessibility, isolation and viewport handling are explicit", () => {
  assert.match(hint, /aria-label=\{label\}/);
  assert.match(hint, /aria-describedby=\{open \? id : undefined\}/);
  assert.match(hint, /role="tooltip"/);
  assert.match(hint, /document\.body/);
  assert.match(hint, /addEventListener\("keydown", handleKeyDown, true\)/);
  assert.match(hint, /event\.stopPropagation\(\)/);
  assert.match(hint, /addEventListener\("pointerdown", dismissOutside, true\)/);
  assert.match(hint, /addEventListener\("focusin", dismissOutside, true\)/);
  assert.match(hint, /window\.visualViewport/);
  assert.match(css, /position: fixed/);
  assert.match(css, /overflow: auto/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(hint, /href=|https?:/);
});
