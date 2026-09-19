import assert from "node:assert/strict";
import test from "node:test";

import {
  renderRecoveryWranglerConfig,
} from "../scripts/organization-storage/render-recovery-wrangler-config.mjs";

const DB_ID = "123e4567-e89b-42d3-a456-426614174000";

test("config disabled nasce sem recovery mutável", () => {
  const config = renderRecoveryWranglerConfig({
    mode: "disabled",
    databaseId: DB_ID,
  });

  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_ENABLED = "false"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_DRY_RUN = "true"/,
  );
  assert.match(config, new RegExp(DB_ID));
  assert.match(config, /crons = \["\*\/15 \* \* \* \*"\]/);
});

test("config dry-run habilita worker sem apply", () => {
  const config = renderRecoveryWranglerConfig({
    mode: "dry-run",
    databaseId: DB_ID,
  });

  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_ENABLED = "true"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_DRY_RUN = "true"/,
  );
});

test("config apply exige modo explícito e mantém kill switch falso", () => {
  const config = renderRecoveryWranglerConfig({
    mode: "apply",
    databaseId: DB_ID,
    batchSize: 5,
    errorBackoffSeconds: 1200,
  });

  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_ENABLED = "true"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_DRY_RUN = "false"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_KILL_SWITCH = "false"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_BATCH_SIZE = "5"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_ERROR_BACKOFF_SECONDS = "1200"/,
  );
});

test("renderer rejeita D1 id e modo inválidos", () => {
  assert.throws(
    () =>
      renderRecoveryWranglerConfig({
        mode: "apply",
        databaseId: "not-a-d1-id",
      }),
    /D1_DATABASE_ID/,
  );

  assert.throws(
    () =>
      renderRecoveryWranglerConfig({
        mode: "unknown",
        databaseId: DB_ID,
      }),
    /disabled, dry-run ou apply/,
  );
});
