import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeNumericDraft,
  numericRangeStep,
  opacityToPercent,
  parseNumericDraft,
  percentToOpacity,
  snapNumericSliderValue,
  stepNumericValue,
} from "../src/pages/Kepler/components/maono-layer-panel/numeric-control.ts";

test("rascunhos vazios, incompletos e não finitos nunca viram zero", () => {
  for (const text of ["", " ", "-", ".", "1e", "NaN", "Infinity", "-Infinity", "1e999"]) {
    assert.equal(parseNumericDraft(text), null, text);
    assert.equal(normalizeNumericDraft(text, 37, 0, 100), 37, text);
  }
  assert.equal(parseNumericDraft("0"), 0);
  assert.equal(normalizeNumericDraft("0", 37, 0, 100), 0);
});

test("normalização limita valores finitos sem perder decimais suportados", () => {
  assert.equal(normalizeNumericDraft("-5", 37, 0, 100), 0);
  assert.equal(normalizeNumericDraft("105", 37, 0, 100), 100);
  assert.equal(normalizeNumericDraft("1.5", 2, 0, 100), 1.5);
  assert.equal(normalizeNumericDraft("12.3", 10, 0, 100), 12.3);
  assert.equal(normalizeNumericDraft("-4.75", -5, -10, -1), -4.75);
  assert.equal(normalizeNumericDraft("", Number.NaN, 1, 500), 1);
});

test("porcentagem é somente apresentação; o contrato salvo permanece entre zero e um", () => {
  for (const value of [0, 1, 13, 20, 29, 37, 47, 73, 75, 99, 100]) {
    const opacity = percentToOpacity(value);
    assert.equal(opacity, value / 100);
    assert.equal(opacityToPercent(opacity), value);
    assert.equal(JSON.parse(JSON.stringify({ opacity })).opacity, opacity);
  }
  assert.equal(opacityToPercent(0.375), 37.5, "Existing precise saved values are not rounded to integers");
});

test("valores precisos fora do incremento continuam iguais no slider e nas setas", () => {
  assert.equal(numericRangeStep(37, 0, 1), 1);
  assert.equal(numericRangeStep(37.5, 0, 1), "any");
  assert.equal(numericRangeStep(1.5, 0, 0.1), 0.1);
  assert.equal(numericRangeStep(1.55, 0, 0.1), "any");
  assert.equal(stepNumericValue(37.5, 1, 1, 0, 100), 38.5);
  assert.equal(stepNumericValue(1.55, 1, 0.1, 0, 100), 1.65);
  assert.equal(stepNumericValue(1.6, -1, 0.1, 0, 100), 1.5);
  assert.equal(stepNumericValue(100, 1, 1, 0, 100), 100);
  assert.equal(stepNumericValue(0, -1, 1, 0, 100), 0);
  assert.equal(stepNumericValue(10.2, 1, 0.1, 0, 10.25), 10.25);
  assert.equal(stepNumericValue(0.3, -1, 0.1, 0.25, 10), 0.25);
  assert.equal(stepNumericValue(0.000001, 1, 0.000001, 0, 1), 0.000002);
  assert.equal(snapNumericSliderValue(37.51234567, 0, 100, 1), 38);
  assert.equal(snapNumericSliderValue(1.551234567, 0, 100, 0.1), 1.6);
  assert.equal(snapNumericSliderValue(-1, 0, 100, 0.1), 0);
  assert.equal(snapNumericSliderValue(900, 0, 100, 0.1), 100);
});

test("os oito controles usam o componente compartilhado e os limites do renderer", async () => {
  const source = await readFile(new URL("../src/pages/Kepler/components/maono-layer-panel/LayerStyleEditor.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/<RangeControl\b/g) ?? []).length, 8);
  assert.match(source, /import RangeControl from "\.\/SliderNumberControl"/);
  assert.equal((source.match(/step=\{0\.1\}/g) ?? []).length, 6);
  assert.equal((source.match(/step=\{1\}/g) ?? []).length, 2);
  assert.match(source, /label="Opacidade"[\s\S]*?value=\{opacityToPercent\(style\.opacity\)\}[\s\S]*?maximum=\{100\}/);
  assert.match(source, /label="Opacidade do contorno"[\s\S]*?value=\{opacityToPercent\(style\.strokeOpacity\)\}/);
  for (const kind of ["opacity", "strokeOpacity"]) {
    assert.match(source, new RegExp(`kind: "${kind}", value: percentToOpacity\\(value\\)`));
  }
  for (const [label, minimum, maximum] of [
    ["Espessura", 0, 100],
    ["Raio mínimo", 0, 500],
    ["Raio máximo", 0, 500],
    ["Raio de agregação", 1, 500],
    ["Raio do mapa de calor", 0, 100],
  ]) {
    assert.match(source, new RegExp(`label="${label}"[\\s\\S]*?minimum=\\{${minimum}\\}[\\s\\S]*?maximum=\\{${maximum}\\}`));
  }
});

test("mínimo e máximo dos filtros reutilizam edição segura sem mudar o contrato", async () => {
  const source = await readFile(new URL("../src/pages/Kepler/components/maono-layer-panel/filters/FilterValueEditor.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/<NumericInput\b/g) ?? []).length, 2);
  assert.doesNotMatch(source, /updateMinimum\(Number\(event\.target\.value\)\)|updateMaximum\(Number\(event\.target\.value\)\)/);
  assert.match(source, /maximum=\{currentDraft\[1\]\}/);
  assert.match(source, /minimum=\{currentDraft\[0\]\}/);
  assert.match(source, /onCommit=\{\(next\) => commit\(\[next, currentDraft\[1\]\]\)\}/);
  assert.match(source, /onCommit=\{\(next\) => commit\(\[currentDraft\[0\], next\]\)\}/);
});
