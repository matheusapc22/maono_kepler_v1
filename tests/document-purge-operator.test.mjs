import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PURGE_PRODUCTION_DATABASE_ID,
  renderDocumentPurgeWranglerConfig,
} from "../scripts/document-purge/render-wrangler-config.mjs";
import {
  verifyDocumentPurgeD1Evidence,
} from "../scripts/document-purge/verify-d1-evidence.mjs";

test("renderer produz disabled, dry-run e apply com defaults seguros", () => {
  const disabled = renderDocumentPurgeWranglerConfig({
    mode: "disabled",
    databaseId: PURGE_PRODUCTION_DATABASE_ID,
    outputPath: ".tmp/disabled.toml",
  });
  assert.match(disabled, /MAONO_DOCUMENT_PURGE_ENABLED = "false"/);
  assert.match(disabled, /MAONO_DOCUMENT_PURGE_KILL_SWITCH = "true"/);
  assert.match(disabled, /MAONO_DOCUMENT_PURGE_DRY_RUN = "true"/);
  assert.match(disabled, /MAONO_DOCUMENT_PURGE_BATCH_SIZE = "25"/);

  const dryRun = renderDocumentPurgeWranglerConfig({
    mode: "dry-run",
    databaseId: PURGE_PRODUCTION_DATABASE_ID,
  });
  assert.match(dryRun, /MAONO_DOCUMENT_PURGE_ENABLED = "true"/);
  assert.match(dryRun, /MAONO_DOCUMENT_PURGE_KILL_SWITCH = "false"/);
  assert.match(dryRun, /MAONO_DOCUMENT_PURGE_DRY_RUN = "true"/);

  const apply = renderDocumentPurgeWranglerConfig({
    mode: "apply",
    databaseId: PURGE_PRODUCTION_DATABASE_ID,
  });
  assert.match(apply, /MAONO_DOCUMENT_PURGE_DRY_RUN = "false"/);
});

test("verificador exige Production, migration 0024, schema, índice e bookmark", () => {
  const result = verifyDocumentPurgeD1Evidence({
    databaseInfo: {
      uuid: PURGE_PRODUCTION_DATABASE_ID,
      name: "maono_maps",
    },
    queryResults: [
      {
        success: true,
        results: [
          {
            name: "0024_document_folders_trash.sql",
            applied_at: "2026-09-24 22:54:36",
          },
        ],
      },
      {
        success: true,
        results: [
          { name: "folder_id" },
          { name: "deleted_by" },
          { name: "purge_after" },
          { name: "trashed_from_folder_id" },
          { name: "purged_at" },
        ],
      },
      {
        success: true,
        results: [
          {
            name: "idx_organization_files_purge_queue",
            unique: 0,
            partial: 1,
          },
        ],
      },
      {
        success: true,
        results: [
          { seqno: 0, name: "purge_after" },
          { seqno: 1, name: "purged_at" },
        ],
      },
    ],
    recoveryInfo: { bookmark: "bookmark-test" },
  });

  assert.equal(result.prerequisiteVerified, true);
  assert.equal(result.databaseId, PURGE_PRODUCTION_DATABASE_ID);
});

test("workflow exige confirmação explícita e baseline disabled", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/document-purge-operator.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /VALIDATE_DOCUMENT_PURGE_OPERATOR/);
  assert.match(workflow, /DEPLOY_DOCUMENT_PURGE_DISABLED/);
  assert.match(workflow, /DEPLOY_DOCUMENT_PURGE_DRY_RUN/);
  assert.match(workflow, /DEPLOY_DOCUMENT_PURGE_APPLY/);
  assert.match(workflow, /MIGRATION_0024_APPLIED_TO_TARGET_D1/);
  assert.match(workflow, /Verify live D1 identity and 0024 without writes/);
  assert.match(workflow, /Deploy disabled baseline first/);
  assert.match(workflow, /Restore disabled mode after incomplete activation/);
  assert.doesNotMatch(workflow, /d1 migrations apply/);
});
