import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const saveButtonSource = await readFile(
  new URL("../src/pages/Kepler/components/maono-save-button.tsx", import.meta.url),
  "utf8",
);

test("ApiError do frontend preserva taxonomia S06", () => {
  assert.match(source, /export type ErrorCategory =/);
  for (const category of [
    "AUTH",
    "PERMISSION",
    "PROJECT",
    "MAP_CONFIG",
    "STORAGE",
    "PERFORMANCE",
    "SPATIAL",
    "ENGINE",
    "INFRASTRUCTURE",
  ]) {
    assert.match(source, new RegExp(`"${category}"`));
  }
  assert.match(source, /category\?: ErrorCategory/);
  assert.match(source, /retryable: boolean/);
  assert.match(source, /correlationId\?: string/);
  assert.match(source, /X-Correlation-Id/);
  assert.match(source, /getErrorContract\(data\)/);
});

test("save do Kepler não esconde falha STORAGE/INFRASTRUCTURE em mensagem 5xx", () => {
  assert.match(saveButtonSource, /getErrorReference/);
  assert.match(saveButtonSource, /category === "STORAGE"/);
  assert.match(saveButtonSource, /category === "INFRASTRUCTURE"/);
  assert.match(saveButtonSource, /category === "MAP_CONFIG"/);
  assert.match(saveButtonSource, /correlationId/);
  assert.match(saveButtonSource, /ID \$\{correlationId\}/);
  assert.doesNotMatch(
    saveButtonSource,
    /if \(response\.status >= 500\) \{\s*return "Não foi possível salvar agora\. Tente novamente em alguns instantes\.";/,
  );
});
