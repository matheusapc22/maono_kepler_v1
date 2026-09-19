import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const driftSource = await readFile(
  new URL(
    "../functions/_lib/organization-storage-drift.js",
    import.meta.url,
  ),
  "utf8",
);
const dropboxSource = await readFile(
  new URL("../functions/_lib/dropbox.js", import.meta.url),
  "utf8",
);
const endpointSource = await readFile(
  new URL(
    "../functions/api/admin/organizations/storage-drift.js",
    import.meta.url,
  ),
  "utf8",
);
const operatorSource = await readFile(
  new URL(
    "../.github/workflows/organization-storage-recovery-operator.yml",
    import.meta.url,
  ),
  "utf8",
);
const renderConfigSource = await readFile(
  new URL(
    "../scripts/organization-storage/render-recovery-wrangler-config.mjs",
    import.meta.url,
  ),
  "utf8",
);

test("inventário físico pagina /projects até o fim", () => {
  assert.match(dropboxSource, /listDropboxFolderAll/);
  assert.match(
    dropboxSource,
    /files\/list_folder\/continue/,
  );
  assert.match(dropboxSource, /while \(hasMore\)/);
  assert.match(dropboxSource, /DROPBOX_LIST_PAGE_LIMIT_EXCEEDED/);
  assert.match(driftSource, /listDropboxFolderAll/);
});

test("drift report é report-only e apply é seletivo", () => {
  assert.match(driftSource, /buildOrganizationStorageDriftReport/);
  assert.match(driftSource, /applyOrganizationStorageDriftRepairs/);
  assert.match(driftSource, /approvedOrganizationIds/);
  assert.match(driftSource, /APPLY_APPROVED_STORAGE_DRIFT/);
  assert.match(driftSource, /revalidateReady: true/);
  assert.doesNotMatch(driftSource, /deleteDropboxPath/);
  assert.doesNotMatch(driftSource, /INSERT INTO organizations/);
  assert.doesNotMatch(driftSource, /UPDATE organizations/);
});

test("órfãos e paths legados são classificados, não adotados automaticamente", () => {
  assert.match(driftSource, /ORPHAN_PHYSICAL_FOLDER/);
  assert.match(driftSource, /ORGANIZATION_PATH_LEGACY/);
  assert.match(driftSource, /repairable: false/);
  assert.doesNotMatch(driftSource, /createOrganizationLifecycle/);
  assert.doesNotMatch(driftSource, /deleteOrganization/);
});

test("endpoint Admin separa report e apply com auditoria e correlação", () => {
  assert.match(endpointSource, /request\.method === "GET"/);
  assert.match(endpointSource, /request\.method === "POST"/);
  assert.match(endpointSource, /getOrCreateCorrelationId/);
  assert.match(endpointSource, /recordAuditLog/);
  assert.match(endpointSource, /storage_drift\.report/);
  assert.match(endpointSource, /storage_drift\.apply/);
  assert.match(endpointSource, /errorResponseFromError/);
  assert.match(endpointSource, /X-Correlation-Id/);
});

test("operador exige confirmação explícita da migration 0009 antes de dry-run/apply", () => {
  assert.match(operatorSource, /migration_0009_confirmation/);
  assert.match(
    operatorSource,
    /MIGRATION_0009_APPLIED_TO_TARGET_D1/,
  );
  assert.match(
    operatorSource,
    /DEPLOY_STORAGE_RECOVERY_DRY_RUN/,
  );
  assert.match(
    operatorSource,
    /DEPLOY_STORAGE_RECOVERY_APPLY/,
  );
  assert.match(operatorSource, /environment: production/);
});

test("operador sempre implanta baseline disabled antes de modo mutável", () => {
  const disabled = operatorSource.indexOf(
    "Deploy disabled baseline first",
  );
  const final = operatorSource.indexOf(
    "Deploy requested final mode",
  );
  assert.ok(disabled >= 0);
  assert.ok(final > disabled);
  assert.match(
    operatorSource,
    /MAONO_RECOVERY_OPERATOR_MODE: disabled/,
  );
});

test("config de deploy não versiona D1 id nem secrets", () => {
  assert.match(
    renderConfigSource,
    /MAONO_RECOVERY_D1_DATABASE_ID/,
  );
  assert.match(
    renderConfigSource,
    /MAONO_STORAGE_RECOVERY_ENABLED/,
  );
  assert.match(
    renderConfigSource,
    /MAONO_STORAGE_RECOVERY_DRY_RUN/,
  );
  assert.doesNotMatch(
    renderConfigSource,
    /DROPBOX_REFRESH_TOKEN\s*=/,
  );
  assert.doesNotMatch(
    renderConfigSource,
    /database_id\s*=\s*"[0-9a-f]{8}-/,
  );
});
