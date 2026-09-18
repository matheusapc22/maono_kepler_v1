import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lifecycleSource = await readFile(
  new URL("../functions/_lib/organization-lifecycle.js", import.meta.url),
  "utf8",
);
const storageSource = await readFile(
  new URL("../functions/_lib/organization-storage.js", import.meta.url),
  "utf8",
);
const listCreateSource = await readFile(
  new URL("../functions/api/admin/organizations/index.js", import.meta.url),
  "utf8",
);
const updateSource = await readFile(
  new URL("../functions/api/admin/organizations/[id].js", import.meta.url),
  "utf8",
);
const syncSource = await readFile(
  new URL(
    "../functions/api/admin/organizations/sync-dropbox.js",
    import.meta.url,
  ),
  "utf8",
);
const migrationSource = await readFile(
  new URL(
    "../migrations/0009_organization_storage_invariant.sql",
    import.meta.url,
  ),
  "utf8",
);

test("Create, Update/Reactivation e Sync reutilizam lifecycle compartilhado", () => {
  assert.match(listCreateSource, /createOrganizationLifecycle/);
  assert.match(updateSource, /updateOrganizationLifecycle/);
  assert.match(syncSource, /createOrganizationLifecycle/);
  assert.match(syncSource, /updateOrganizationLifecycle/);

  for (const source of [listCreateSource, updateSource, syncSource]) {
    assert.doesNotMatch(source, /ensureDropboxFolder/);
    assert.doesNotMatch(source, /storage_status\s*=\s*['"]READY['"]/);
  }

  assert.doesNotMatch(listCreateSource, /INSERT INTO organizations/);
  assert.doesNotMatch(syncSource, /INSERT INTO organizations/);
  assert.doesNotMatch(syncSource, /UPDATE organizations/);
});

test("lifecycle é D1-first e READY depende de ensureOrganizationStorage", () => {
  assert.match(lifecycleSource, /INSERT INTO organizations/);
  assert.match(lifecycleSource, /ORGANIZATION_STORAGE_STATUS\.PENDING/);
  assert.match(lifecycleSource, /ensureOrganizationStorage/);
  assert.match(lifecycleSource, /ensureLifecycleStorageReady/);
  assert.doesNotMatch(lifecycleSource, /ensureDropboxFolder/);
});

test("retry natural usa slug + dropbox_root_path e não requer migration nova", () => {
  assert.match(lifecycleSource, /WHERE slug = \?/);
  assert.match(lifecycleSource, /WHERE dropbox_root_path = \?/);
  assert.match(lifecycleSource, /canResumeCreate/);
  assert.match(migrationSource, /storage_status/);
  assert.match(migrationSource, /storage_checked_at/);
  assert.match(migrationSource, /dropbox_root_path/);
});

test("storage não reprovisiona READY saudável em corrida de retry", () => {
  assert.match(
    storageSource,
    /UPPER\(TRIM\(storage_status\)\) = 'READY'[\s\S]*storage_error[\s\S]*OR \? = 1/,
  );
  assert.match(storageSource, /revalidateReady = false/);
});

test("entry points preservam correlationId em resposta e auditoria", () => {
  for (const source of [listCreateSource, updateSource, syncSource]) {
    assert.match(source, /getOrCreateCorrelationId/);
    assert.match(source, /X-Correlation-Id/);
    assert.match(source, /correlationId/);
  }

  assert.match(listCreateSource, /errorResponseFromError/);
  assert.match(updateSource, /errorResponseFromError/);
  assert.match(syncSource, /errorResponseFromError/);
});

test("sync não importa arquivos antes do storage READY", () => {
  assert.match(syncSource, /if \(result\.storageReady\)/);
  assert.match(syncSource, /storage_pending/);
  assert.match(syncSource, /stableFolderSuffix/);
});

test("update mantém caminho de delete isolado do lifecycle de ativação", () => {
  assert.match(updateSource, /SET active = 0,[\s\S]*storage_status = 'DISABLED'/);
  assert.doesNotMatch(updateSource, /SET[\s\S]{0,200}active = 1/);
});
