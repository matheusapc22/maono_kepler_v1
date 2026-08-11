import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");

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
