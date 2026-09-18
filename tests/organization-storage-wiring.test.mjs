import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storageSource = await readFile(
  new URL("../functions/_lib/organization-storage.js", import.meta.url),
  "utf8",
);
const repairEndpointSource = await readFile(
  new URL(
    "../functions/api/admin/organizations/repair-storage.js",
    import.meta.url,
  ),
  "utf8",
);
const migrationSource = await readFile(
  new URL("../migrations/0009_organization_storage_invariant.sql", import.meta.url),
  "utf8",
);

test("PRH-04 reutiliza migration 0009 sem criar segunda taxonomia de estado", () => {
  for (const column of [
    "storage_status",
    "storage_error",
    "storage_checked_at",
    "dropbox_root_path",
  ]) {
    assert.match(migrationSource, new RegExp(column));
  }

  assert.match(storageSource, /PENDING/);
  assert.match(storageSource, /READY/);
  assert.match(storageSource, /ERROR/);
  assert.match(storageSource, /DISABLED/);
  assert.doesNotMatch(storageSource, /RECOVERING|INCIDENT|PROVISIONING/);
});

test("claim é atômico e conclusão usa compare-and-set pelo checked_at", () => {
  assert.match(
    storageSource,
    /storage_status = 'PENDING'[\s\S]*julianday\(storage_checked_at\) < julianday\(\?\)/,
  );
  assert.match(
    storageSource,
    /storage_status = 'PENDING'[\s\S]*storage_checked_at = \?[\s\S]*RETURNING \*/,
  );
  assert.match(storageSource, /ORGANIZATION_STORAGE_CLAIM_TTL_MS = 120_000/);
  assert.match(storageSource, /julianday\(storage_checked_at\)/);
});

test("repair é cursorizado e seleciona apenas estados inconsistentes", () => {
  assert.match(storageSource, /id > \?/);
  assert.match(storageSource, /ORDER BY id ASC/);
  assert.match(storageSource, /LIMIT \?/);
  assert.match(storageSource, /limit \+ 1/);
  assert.match(storageSource, /hasMore/);
  assert.match(storageSource, /nextCursor/);
  assert.match(storageSource, /storage_status\)\) IN \('ERROR', 'DISABLED'\)/);
  assert.match(storageSource, /storage_status\)\) = 'PENDING'/);
});

test("endpoint propaga correlationId e não devolve mensagem técnica crua", () => {
  assert.match(repairEndpointSource, /getOrCreateCorrelationId/);
  assert.match(repairEndpointSource, /X-Correlation-Id/);
  assert.match(repairEndpointSource, /afterId/);
  assert.match(repairEndpointSource, /cursor/);
  assert.match(repairEndpointSource, /errorResponseFromError/);
  assert.match(
    repairEndpointSource,
    /publicMessage: "Falha ao reconciliar o armazenamento\."/,
  );
  assert.doesNotMatch(
    repairEndpointSource,
    /errorResponse\([\s\S]*error\?\.message/,
  );
});

test("storage_error persiste código canônico em vez de provider message", () => {
  assert.match(storageSource, /safeFailureCode/);
  assert.match(storageSource, /storage_error = \?/);
  assert.doesNotMatch(
    storageSource,
    /cause\?\.message \|\| "Falha desconhecida ao provisionar o Dropbox\."/,
  );
});
