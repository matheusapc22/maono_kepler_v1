import { createCorrelationId } from "../functions/_lib/maono-error.js";
import {
  ORGANIZATION_STORAGE_CLAIM_TTL_MS,
  ORGANIZATION_STORAGE_ERROR_BACKOFF_MS,
  repairActiveOrganizationStorages,
} from "../functions/_lib/organization-storage.js";
import { recordAuditLog } from "../functions/_lib/permissions.js";

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;

function booleanValue(value, fallback = false) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function organizationStorageRecoveryConfig(env) {
  return {
    enabled: booleanValue(
      env?.MAONO_STORAGE_RECOVERY_ENABLED,
      false,
    ),
    killSwitch: booleanValue(
      env?.MAONO_STORAGE_RECOVERY_KILL_SWITCH,
      false,
    ),
    dryRun: booleanValue(
      env?.MAONO_STORAGE_RECOVERY_DRY_RUN,
      true,
    ),
    batchSize: boundedInteger(
      env?.MAONO_STORAGE_RECOVERY_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      1,
      MAX_BATCH_SIZE,
    ),
    errorBackoffMs:
      boundedInteger(
        env?.MAONO_STORAGE_RECOVERY_ERROR_BACKOFF_SECONDS,
        Math.round(ORGANIZATION_STORAGE_ERROR_BACKOFF_MS / 1000),
        0,
        24 * 60 * 60,
      ) * 1000,
    claimTtlMs:
      boundedInteger(
        env?.MAONO_STORAGE_RECOVERY_CLAIM_TTL_SECONDS,
        Math.round(ORGANIZATION_STORAGE_CLAIM_TTL_MS / 1000),
        30,
        30 * 60,
      ) * 1000,
  };
}

export async function runScheduledStorageRecovery(
  env,
  {
    repair = repairActiveOrganizationStorages,
    audit = recordAuditLog,
    correlationId = createCorrelationId(),
    nowFn = Date.now,
  } = {},
) {
  const config = organizationStorageRecoveryConfig(env);

  if (!config.enabled) {
    return {
      executed: false,
      reason: "FEATURE_DISABLED",
      correlationId,
      config,
    };
  }

  if (config.killSwitch) {
    return {
      executed: false,
      reason: "KILL_SWITCH",
      correlationId,
      config,
    };
  }

  await audit(env, {
    actorUserId: null,
    action: "organization.storage.recovery.scheduled.start",
    resourceType: "platform",
    resourceId: "organization_storage",
    result: config.dryRun ? "dry_run" : "started",
    metadata: {
      correlationId,
      dryRun: config.dryRun,
      batchSize: config.batchSize,
      errorBackoffMs: config.errorBackoffMs,
      claimTtlMs: config.claimTtlMs,
    },
  });

  try {
    const result = await repair(env, {
      limit: config.batchSize,
      afterId: 0,
      correlationId,
      nowFn,
      claimTtlMs: config.claimTtlMs,
      errorBackoffMs: config.errorBackoffMs,
      fairOrder: true,
      dryRun: config.dryRun,
    });

    await audit(env, {
      actorUserId: null,
      action: "organization.storage.recovery.scheduled.complete",
      resourceType: "platform",
      resourceId: "organization_storage",
      result:
        result.failed > 0
          ? "partial"
          : config.dryRun
            ? "dry_run"
            : "success",
      metadata: {
        correlationId,
        dryRun: config.dryRun,
        checked: result.checked,
        ready: result.ready,
        failed: result.failed,
        skipped: result.skipped,
        hasMore: result.hasMore,
        fairOrder: result.fairOrder,
        errorBackoffMs: result.errorBackoffMs,
      },
    });

    console.info("[Maono organization storage recovery]", {
      correlationId,
      dryRun: config.dryRun,
      checked: result.checked,
      ready: result.ready,
      failed: result.failed,
      skipped: result.skipped,
      hasMore: result.hasMore,
    });

    return {
      executed: true,
      correlationId,
      config,
      result,
    };
  } catch (error) {
    await audit(env, {
      actorUserId: null,
      action: "organization.storage.recovery.scheduled.failed",
      resourceType: "platform",
      resourceId: "organization_storage",
      result: "failed",
      metadata: {
        correlationId,
        dryRun: config.dryRun,
        code: error?.code || "ORGANIZATION_STORAGE_RECOVERY_FAILED",
        stage: error?.stage || "organization.storage.recovery",
      },
    });

    console.error("[Maono organization storage recovery]", {
      correlationId,
      code: error?.code || "ORGANIZATION_STORAGE_RECOVERY_FAILED",
      stage: error?.stage || "organization.storage.recovery",
    });
    throw error;
  }
}

export default {
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledStorageRecovery(env));
  },
};

export const __organizationStorageRecoveryTesting = Object.freeze({
  booleanValue,
  boundedInteger,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
});
