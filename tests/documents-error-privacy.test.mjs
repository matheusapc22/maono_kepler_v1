import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/pages/Projects/components/DocumentsSection.tsx", import.meta.url),
  "utf8",
);

test("documents UI normalizes request errors without exposing technical diagnostics", () => {
  assert.match(source, /normalizeUserError\(error\)/);
  assert.match(source, /formatSupportReference\(presentation\.supportReference\)/);

  assert.doesNotMatch(source, /payload\?\.code/);
  assert.doesNotMatch(source, /payload\?\.stage/);
  assert.doesNotMatch(source, /payload\?\.requestId/);
  assert.doesNotMatch(source, /`código \$\{/);
  assert.doesNotMatch(source, /`etapa \$\{/);
  assert.doesNotMatch(source, /`requisição \$\{/);
  assert.doesNotMatch(source, /Dropbox/i);
  assert.doesNotMatch(source, /Cloudflare D1/i);
});
