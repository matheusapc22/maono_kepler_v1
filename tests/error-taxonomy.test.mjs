import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CATEGORIES, ERROR_CATEGORY_VALUES } from "../functions/_lib/error-categories.js";
import { ERROR_DEFINITIONS, getErrorDefinition } from "../functions/_lib/error-catalog.js";
import { normalizeMaonoError } from "../functions/_lib/maono-error.js";

test("S06 congela as nove categorias oficiais", () => {
  assert.deepEqual(ERROR_CATEGORY_VALUES, [
    "AUTH",
    "PERMISSION",
    "PROJECT",
    "MAP_CONFIG",
    "STORAGE",
    "PERFORMANCE",
    "SPATIAL",
    "ENGINE",
    "INFRASTRUCTURE",
  ]);
  assert.equal(ERROR_CATEGORIES.STORAGE, "STORAGE");
});

test("catálogo associa código semântico a categoria e retry", () => {
  assert.deepEqual(getErrorDefinition("PROJECT_CONFIG_REVISION_CONFLICT", 500), {
    code: "PROJECT_CONFIG_REVISION_CONFLICT",
    category: "MAP_CONFIG",
    status: 409,
    retryable: false,
  });
  assert.equal(getErrorDefinition("DROPBOX_UPLOAD_FAILED", 500).category, "STORAGE");
  assert.equal(getErrorDefinition("DROPBOX_UPLOAD_FAILED", 500).retryable, true);
  assert.equal(getErrorDefinition("FORBIDDEN", 500).category, "PERMISSION");
  assert.equal(getErrorDefinition("DATABASE_NOT_CONFIGURED", 500).category, "INFRASTRUCTURE");
});

test("todos os registros do catálogo usam categoria válida", () => {
  for (const [code, definition] of Object.entries(ERROR_DEFINITIONS)) {
    assert.ok(ERROR_CATEGORY_VALUES.includes(definition.category), `${code} possui categoria inválida`);
    assert.equal(typeof definition.retryable, "boolean", `${code} precisa declarar retryable`);
    assert.ok(Number.isInteger(definition.status), `${code} precisa declarar status HTTP`);
  }
});

test("normalizador preserva erro técnico em vez de catch-all", () => {
  const dropbox = normalizeMaonoError(
    new Error("Falha ao renovar token Dropbox: 503 upstream"),
    { defaultCode: "PROJECT_CONFIG_ERROR" },
  );
  assert.equal(dropbox.code, "DROPBOX_TOKEN_REFRESH_FAILED");
  assert.equal(dropbox.category, "STORAGE");
  assert.equal(dropbox.retryable, true);

  const d1 = normalizeMaonoError(
    new Error("D1 database query failed temporarily"),
    { defaultCode: "PROJECT_CONFIG_ERROR" },
  );
  assert.equal(d1.code, "INFRASTRUCTURE_D1_QUERY_FAILED");
  assert.equal(d1.category, "INFRASTRUCTURE");
});
