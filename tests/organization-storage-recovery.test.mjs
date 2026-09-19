import assert from "node:assert/strict";
import test from "node:test";

import {
  organizationStorageRecoveryConfig,
  runScheduledStorageRecovery,
} from "../workers/organization-storage-recovery.js";

test("recovery nasce desabilitado e em dry-run por padrão", () => {
  const config = organizationStorageRecoveryConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.killSwitch, false);
  assert.equal(config.dryRun, true);
  assert.equal(config.batchSize, 10);
  assert.equal(config.errorBackoffMs, 15 * 60 * 1000);
  assert.equal(config.claimTtlMs, 120 * 1000);
});

test("feature desabilitada e kill switch retornam antes do reconciler", async () => {
  let repairCalls = 0;
  let auditCalls = 0;
  const repair = async () => {
    repairCalls += 1;
  };
  const audit = async () => {
    auditCalls += 1;
  };

  const disabled = await runScheduledStorageRecovery(
    {},
    {
      repair,
      audit,
      correlationId: "corr-prh06-disabled",
    },
  );
  assert.equal(disabled.executed, false);
  assert.equal(disabled.reason, "FEATURE_DISABLED");

  const killed = await runScheduledStorageRecovery(
    {
      MAONO_STORAGE_RECOVERY_ENABLED: "true",
      MAONO_STORAGE_RECOVERY_KILL_SWITCH: "true",
    },
    {
      repair,
      audit,
      correlationId: "corr-prh06-killed",
    },
  );
  assert.equal(killed.executed, false);
  assert.equal(killed.reason, "KILL_SWITCH");
  assert.equal(repairCalls, 0);
  assert.equal(auditCalls, 0);
});

test("dry-run propaga fairness/backoff sem mutação do reconciler", async () => {
  const audits = [];
  let receivedOptions = null;

  const result = await runScheduledStorageRecovery(
    {
      MAONO_STORAGE_RECOVERY_ENABLED: "true",
      MAONO_STORAGE_RECOVERY_DRY_RUN: "true",
      MAONO_STORAGE_RECOVERY_BATCH_SIZE: "7",
      MAONO_STORAGE_RECOVERY_ERROR_BACKOFF_SECONDS: "600",
      MAONO_STORAGE_RECOVERY_CLAIM_TTL_SECONDS: "180",
    },
    {
      correlationId: "corr-prh06-dry",
      repair: async (_env, options) => {
        receivedOptions = options;
        return {
          correlationId: options.correlationId,
          checked: 2,
          ready: 0,
          failed: 0,
          skipped: 2,
          hasMore: false,
          fairOrder: options.fairOrder,
          dryRun: options.dryRun,
          errorBackoffMs: options.errorBackoffMs,
          organizations: [],
        };
      },
      audit: async (_env, event) => {
        audits.push(event);
      },
    },
  );

  assert.equal(result.executed, true);
  assert.equal(receivedOptions.limit, 7);
  assert.equal(receivedOptions.afterId, 0);
  assert.equal(receivedOptions.fairOrder, true);
  assert.equal(receivedOptions.dryRun, true);
  assert.equal(receivedOptions.errorBackoffMs, 600_000);
  assert.equal(receivedOptions.claimTtlMs, 180_000);
  assert.equal(receivedOptions.correlationId, "corr-prh06-dry");
  assert.equal(receivedOptions.telemetrySource, "scheduled");
  assert.equal(audits.length, 2);
  assert.equal(audits[0].actorUserId, null);
  assert.equal(audits[0].metadata.correlationId, "corr-prh06-dry");
  assert.equal(audits[1].result, "dry_run");
});

test("modo apply mantém correlationId e registra conclusão parcial", async () => {
  const audits = [];

  const result = await runScheduledStorageRecovery(
    {
      MAONO_STORAGE_RECOVERY_ENABLED: "1",
      MAONO_STORAGE_RECOVERY_DRY_RUN: "0",
      MAONO_STORAGE_RECOVERY_BATCH_SIZE: "5000",
    },
    {
      correlationId: "corr-prh06-apply",
      repair: async (_env, options) => ({
        correlationId: options.correlationId,
        checked: 3,
        ready: 2,
        failed: 1,
        skipped: 0,
        hasMore: true,
        fairOrder: options.fairOrder,
        dryRun: options.dryRun,
        errorBackoffMs: options.errorBackoffMs,
        organizations: [],
      }),
      audit: async (_env, event) => {
        audits.push(event);
      },
    },
  );

  assert.equal(result.config.batchSize, 50);
  assert.equal(result.config.dryRun, false);
  assert.equal(result.result.failed, 1);
  assert.equal(audits[1].result, "partial");
  assert.equal(audits[1].metadata.correlationId, "corr-prh06-apply");
});

test("recovery mede duração de lote sem confundir dry-run com prontidão física", async () => {
  const audits = [];
  const ticks = [Date.parse("2026-09-19T00:00:00Z"), Date.parse("2026-09-19T00:00:01.250Z")];
  const result = await runScheduledStorageRecovery(
    { MAONO_STORAGE_RECOVERY_ENABLED: "true" },
    {
      nowFn: () => ticks.shift(),
      repair: async () => ({ checked: 1, ready: 0, failed: 0, skipped: 1, organizations: [] }),
      audit: async (_env, event) => audits.push(event),
    },
  );
  assert.equal(result.durationMs, 1250);
  assert.equal(audits[1].metadata.durationMs, 1250);
  assert.equal(audits[1].metadata.telemetryVersion, 1);
  assert.equal(audits[1].result, "dry_run");
  assert.equal(audits.some((event) => event.action === "organization.storage.observation"), false);
});

test("recovery preserva erro original e duração também em falha de lote", async () => {
  const audits = [];
  const original = Object.assign(new Error("provider failure"), { code: "STORAGE_TEST_FAILED" });
  let now = 1000;
  await assert.rejects(runScheduledStorageRecovery(
    { MAONO_STORAGE_RECOVERY_ENABLED: "true", MAONO_STORAGE_RECOVERY_DRY_RUN: "false" },
    {
      nowFn: () => { const value = now; now += 800; return value; },
      repair: async () => { throw original; },
      audit: async (_env, event) => audits.push(event),
    },
  ), (error) => error === original);
  assert.equal(audits.at(-1).action, "organization.storage.recovery.scheduled.failed");
  assert.equal(audits.at(-1).metadata.durationMs, 800);
  assert.equal(audits.at(-1).metadata.code, "STORAGE_TEST_FAILED");
});
