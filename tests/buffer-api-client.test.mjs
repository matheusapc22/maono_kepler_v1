import assert from "node:assert/strict";
import test from "node:test";

import {
  convertBufferDistance,
  convertBufferDistanceText,
  formatBufferEditableNumber,
  parseBufferNumber,
} from "../src/pages/Kepler/map-panel/buffer-api.ts";

test("conversão m → km preserva a distância real", () => {
  assert.equal(convertBufferDistance(500, "m", "km"), 0.5);
  assert.equal(convertBufferDistanceText("500", "m", "km"), "0,5");
  assert.equal(convertBufferDistanceText("1250", "m", "km"), "1,25");
});

test("conversão km → m preserva a distância real", () => {
  assert.equal(convertBufferDistance(0.5, "km", "m"), 500);
  assert.equal(convertBufferDistanceText("0,5", "km", "m"), "500");
  assert.equal(convertBufferDistanceText("1.25", "km", "m"), "1250");
});

test("parser aceita ponto e vírgula decimal sem separador de milhar", () => {
  assert.equal(parseBufferNumber("0,5"), 0.5);
  assert.equal(parseBufferNumber("1.25"), 1.25);
  assert.equal(parseBufferNumber("500"), 500);
  assert.equal(parseBufferNumber("1.000,5"), null);
  assert.equal(parseBufferNumber("abc"), null);
});

test("formatter usa vírgula na edição brasileira", () => {
  assert.equal(formatBufferEditableNumber(0.5), "0,5");
  assert.equal(formatBufferEditableNumber(1.25), "1,25");
  assert.equal(formatBufferEditableNumber(500), "500");
});

test("campo vazio permanece vazio durante troca de unidade e inválido falha fechado", () => {
  assert.equal(convertBufferDistanceText("", "m", "km"), "");
  assert.equal(convertBufferDistanceText("abc", "m", "km"), null);
});
