import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalogSource = await readFile(
  new URL("../src/lib/user-error-catalog.ts", import.meta.url),
  "utf8",
);
const exportsSource = await readFile(
  new URL("../src/pages/Projects/components/ExportsSection.tsx", import.meta.url),
  "utf8",
);
const documentsSource = await readFile(
  new URL("../src/pages/Projects/components/DocumentsSection.tsx", import.meta.url),
  "utf8",
);

test("catálogo cobre códigos e categorias prioritários sem provider na copy", () => {
  for (const code of [
    "AUTH_INVALID_CREDENTIALS",
    "AUTH_SESSION_EXPIRED",
    "PERMISSION_PROJECT_SAVE_DENIED",
    "PROJECT_CONFIG_REVISION_CONFLICT",
    "PERFORMANCE_OPERATION_TIMEOUT",
    "INFRASTRUCTURE_NETWORK_FAILURE",
  ]) {
    assert.match(catalogSource, new RegExp(code));
  }

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
    assert.match(catalogSource, new RegExp(`${category}:`));
  }

  assert.doesNotMatch(
    catalogSource,
    /message:\s*["'`][^"'`]*(Dropbox|Cloudflare|Worker|D1|backend|runtime|schema)/i,
  );
});

test("support reference é curta e separada do identificador operacional", () => {
  assert.match(catalogSource, /MNO-/);
  assert.match(catalogSource, /formatSupportReference/);
  assert.match(catalogSource, /stableReference/);
});

test("Exportações usa o normalizador central em vez de requestError.message", () => {
  assert.match(exportsSource, /normalizeUserError/);
  assert.match(exportsSource, /setError\(normalizeUserError\(requestError\)\.message\)/);
  assert.doesNotMatch(exportsSource, /requestError\.message/);
});

test("Documentos normaliza erros sem expor diagnósticos técnicos", () => {
  assert.match(documentsSource, /normalizeUserError\(error\)/);
  assert.match(
    documentsSource,
    /formatSupportReference\(presentation\.supportReference\)/,
  );

  assert.doesNotMatch(documentsSource, /payload\?\.code/);
  assert.doesNotMatch(documentsSource, /payload\?\.stage/);
  assert.doesNotMatch(documentsSource, /payload\?\.requestId/);
  assert.doesNotMatch(documentsSource, /`código \$\{/);
  assert.doesNotMatch(documentsSource, /`etapa \$\{/);
  assert.doesNotMatch(documentsSource, /`requisição \$\{/);
  assert.doesNotMatch(documentsSource, /Dropbox/i);
  assert.doesNotMatch(documentsSource, /Cloudflare D1/i);
});
