import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dialog = await readFile(
  new URL(
    "../src/pages/Kepler/components/map-overlay/BufferDialog.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("dialog abre com um único raio sugerido de 500 metros", () => {
  assert.match(dialog, /const DEFAULT_UNIT: BufferUnit = "m"/);
  assert.match(dialog, /const DEFAULT_RANGES = \["500"\]/);
  assert.doesNotMatch(dialog, /\["500",\s*"1000"/);
});

test("dialog permite unidade m ou km e conversão antes da troca", () => {
  assert.match(dialog, /<option value="m">Metros \(m\)<\/option>/);
  assert.match(dialog, /<option value="km">Quilômetros \(km\)<\/option>/);
  assert.match(dialog, /convertBufferDistanceText\(value, unit, nextUnit\)/);
  assert.match(dialog, /Corrija os valores dos raios antes de alterar a unidade/);
});

test("raios são manuais, decimais e limitados a quatro", () => {
  assert.match(dialog, /inputMode="decimal"/);
  assert.match(dialog, /const MAX_RANGES = 4/);
  assert.match(dialog, /\+ Adicionar outro raio/);
  assert.match(dialog, /index > 0/);
  assert.match(dialog, /Remover raio/);
});

test("submit valida 1m..200km e duplicados", () => {
  assert.match(dialog, /MIN_RADIUS_METERS = 1/);
  assert.match(dialog, /MAX_RADIUS_METERS = 200_000/);
  assert.match(dialog, /Já existe um buffer com esse raio/);
  assert.match(dialog, /Informe entre um e quatro raios/);
});

test("dialog mantém acessibilidade de modal e feedback de busy", () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /Gerando buffers…/);
  assert.match(dialog, /Gerar buffers/);
});
