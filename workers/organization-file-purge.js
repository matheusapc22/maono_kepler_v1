import { createCorrelationId } from "../functions/_lib/maono-error.js";
import { recordAuditLog } from "../functions/_lib/permissions.js";
import {
  ORGANIZATION_FILE_PURGE_CLAIM_TTL_MS,
  ORGANIZATION_FILE_PURGE_DEFAULT_BATCH_SIZE,
  ORGANIZATION_FILE_PURGE_MAX_BATCH_SIZE,
  listExpiredOrganizationFilesForPurge,
  purgeOrganizationFile,
} from "../functions/_lib/organization-file-purge.js";

function booleanValue(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
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

function clockMillis(nowFn) {
  const value = Number(nowFn());
  return Number.isFinite(value) ? value : Date.now();
}

export function organizationFilePurgeConfig(env) {
  return {
    enabled: booleanValue(env?.MAONO_DOCUMENT_PURGE_ENABLED, false),
    killSwitch: booleanValue(env?.MAONO_DOCUMENT_PURGE_KILL_SWITCH, true),
    dryRun: booleanValue(env?.MAONO_DOCUMENT_PURGE_DRY_RUN, true),
    batchSize: boundedInteger(
      env?.MAONO_DOCUMENT_PURGE_BATCH_SIZE,
      ORGANIZATION_FILE_PURGE_DEFAULT_BATCH_SIZE,
      1,
      ORGANIZATION_FILE_PURGE_MAX_BATCH_SIZE,
    ),
    claimTtlMs:
      boundedInteger(
        env?.MAONO_DOCUMENT_PURGE_CLAIM_TTL_SECONDS,
        Math.round(ORGANIZATION_FILE_PURGE_CLAIM_TTL_MS / 1000),
        30,
        60 * 60,
      ) * 1000,
  };
}

async function auditItem(audit, env, {
  row,
  action,
  result,
  correlationId,
  code = null,
}) {
  await audit(env, {
    actorUserId: null,
    organizationId: row.organization_id,
    projectId: row.project_id || null,
    action,
    resourceType: "document",
    resourceId: row.id,
    result,
    metadata: {
      correlationId,
      fileId: row.id,
      purgeAfter: row.purge_after || null,
      code,
      source: "scheduled",
      telemetryVersion: 1,
    },
  });
}

export async function runScheduledDocumentPurge(
  env,
  {
    listCandidates = listExpiredOrganizationFilesForPurge,
    purge = purgeOrganizationFile,
    audit = recordAuditLog,
    correlationId = createCorrelationId(),
    nowFn = Date.now,
  } = {},
) {
  const config = organizationFilePurgeConfig(env);

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

  const startedAtMs = clockMillis(nowFn);
  const startedAt = new Date(startedAtMs).toISOString();
  const candidates = await listCandidates(env, {
    limit: config.batchSize,
    now: new Date(startedAtMs),
    claimTtlMs: config.claimTtlMs,
  });

  await audit(env, {
    actorUserId: null,
    action: "document.purge.scheduled.start",
    resourceType: "platform",
    resourceId: "organization_files",
    result: config.dryRun ? "dry_run" : "started",
    metadata: {
      correlationId,
      dryRun: config.dryRun,
      batchSize: config.batchSize,
      eligible: candidates.rows.length,
      hasMore: candidates.hasMore,
      startedAt,
      telemetryVersion: 1,
    },
  });

  let purged = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of candidates.rows) {
    if (config.dryRun) {
      skipped += 1;
      await auditItem(audit, env, {
        row,
        action: "document.purge.automatic",
        result: "dry_run",
        correlationId,
      });
      continue;
    }

    try {
      const result = await purge(env, {
        organizationId: row.organization_id,
        fileId: row.id,
        now: new Date(clockMillis(nowFn)),
        requireExpired: true,
        claimTtlMs: config.claimTtlMs,
      });
      purged += 1;
      await auditItem(audit, env, {
        row: result.file || row,
        action: "document.purge.automatic",
        result: "success",
        correlationId,
      });
    } catch (error) {
      failed += 1;
      await auditItem(audit, env, {
        row,
        action: "document.purge.automatic",
        result: "failed",
        correlationId,
        code: error?.code || "DOCUMENT_PURGE_FAILED",
      });
    }
  }

  const finishedAtMs = clockMillis(nowFn);
  const completedAt = new Date(finishedAtMs).toISOString();
  const durationMs = Math.max(0, finishedAtMs - startedAtMs);

  await audit(env, {
    actorUserId: null,
    action: "document.purge.scheduled.complete",
    resourceType: "platform",
    resourceId: "organization_files",
    result:
      failed > 0
        ? "partial"
        : config.dryRun
          ? "dry_run"
          : "success",
    metadata: {
      correlationId,
      dryRun: config.dryRun,
      checked: candidates.rows.length,
      purged,
      failed,
      skipped,
      hasMore: candidates.hasMore,
      startedAt,
      completedAt,
      durationMs,
      telemetryVersion: 1,
    },
  });

  console.info("[Maono document purge]", {
    correlationId,
    dryRun: config.dryRun,
    checked: candidates.rows.length,
    purged,
    failed,
    skipped,
    hasMore: candidates.hasMore,
    durationMs,
  });

  return {
    executed: true,
    correlationId,
    config,
    result: {
      checked: candidates.rows.length,
      purged,
      failed,
      skipped,
      hasMore: candidates.hasMore,
    },
    startedAt,
    completedAt,
    durationMs,
  };
}

export default {
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledDocumentPurge(env));
  },
};

export const __organizationFilePurgeWorkerTesting = Object.freeze({
  booleanValue,
  boundedInteger,
  clockMillis,
});
