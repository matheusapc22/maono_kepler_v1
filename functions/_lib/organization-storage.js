import {
  ensureDropboxFolder,
  normalizeDropboxFolderPath,
} from "./dropbox.js";
import {
  getDb,
  getTableColumns,
} from "./organizations.js";
import { createCorrelationId } from "./maono-error.js";
import { recordOrganizationStorageObservation } from "./organization-storage-telemetry.js";
import { organizationStoragePathPolicy } from "./organization-storage-policy.js";
import {
  ORGANIZATION_STORAGE_MAX_ATTEMPTS,
  ORGANIZATION_STORAGE_RETRY_DELAY_MS,
  organizationStorageRetryDecision,
  readOrganizationStorageIncident,
  safeStorageFailureCode,
  startOrganizationStorageIncident,
} from "./organization-storage-retry.js";

const PROJECTS_ROOT = "/projects";
const DOCUMENTS_FOLDER = "documents";
const MAX_REPAIR_BATCH = 500;

// Dropbox metadata operations have a 15s request budget. Provisioning may touch
// /projects, /projects/{slug} and /documents, so keep a generous lease margin
// without requiring a new schema column.
export const ORGANIZATION_STORAGE_CLAIM_TTL_MS = 120_000;
export const ORGANIZATION_STORAGE_ERROR_BACKOFF_MS = 15 * 60 * 1000;

export const ORGANIZATION_STORAGE_STATUS = Object.freeze({
  PENDING: "PENDING",
  READY: "READY",
  ERROR: "ERROR",
  DISABLED: "DISABLED",
});

const STORAGE_SCHEMA_COLUMNS = [
  "dropbox_root_path",
  "storage_status",
  "storage_error",
  "storage_checked_at",
];

function nowMillis(nowFn = Date.now) {
  const value = typeof nowFn === "function" ? nowFn() : Date.now();
  const millis = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(millis) ? millis : Date.now();
}

function isoAt(millis) {
  return new Date(millis).toISOString();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeStorageStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  return Object.values(ORGANIZATION_STORAGE_STATUS).includes(status)
    ? status
    : null;
}

function isActiveOrganization(organization) {
  return !(
    organization?.active === 0 ||
    organization?.active === "0" ||
    organization?.active === false
  );
}

function isPendingClaimFresh(
  organization,
  nowMs,
  claimTtlMs = ORGANIZATION_STORAGE_CLAIM_TTL_MS,
) {
  if (
    normalizeStorageStatus(organization?.storage_status) !==
    ORGANIZATION_STORAGE_STATUS.PENDING
  ) {
    return false;
  }

  const checkedAt = Date.parse(String(organization?.storage_checked_at || ""));
  if (!Number.isFinite(checkedAt)) return false;

  return checkedAt > nowMs - claimTtlMs;
}

function storageError(
  message,
  status,
  code,
  stage,
  {
    cause = null,
    correlationId = null,
    retryable = false,
    details = null,
  } = {},
) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.category = "STORAGE";
  error.stage = stage;
  error.retryable = retryable;
  error.publicMessage = message;
  error.correlationId = correlationId;
  error.details = details;
  if (cause) error.cause = cause;
  return error;
}

function safeFailureCode(cause) {
  return safeStorageFailureCode(cause?.code);
}

function storageCauseRetryable(cause) {
  if (typeof cause?.retryable === "boolean") return cause.retryable;

  const status = Number(cause?.status || cause?.dropboxStatus || 0);
  return status === 429 || status >= 500 || cause instanceof TypeError;
}

function storageResult({
  organization,
  rootPath,
  documentsRoot,
  repairedPath,
  correlationId,
  claimed = false,
  superseded = false,
  busy = false,
  incident = null,
  completedAt = null,
  physicallyVerified = false,
  reason = null,
}) {
  const status =
    normalizeStorageStatus(organization?.storage_status) ||
    ORGANIZATION_STORAGE_STATUS.PENDING;

  return {
    organization,
    rootPath,
    documentsRoot,
    status,
    ready: isActiveOrganization(organization) &&
      status === ORGANIZATION_STORAGE_STATUS.READY &&
      organizationStoragePathPolicy(organization).valid &&
      !String(organization?.storage_error || "").trim(),
    repairedPath,
    claimed,
    superseded,
    busy,
    correlationId,
    reason,
    incidentId: incident?.incidentId || null,
    incidentStartedAt: incident?.incidentStartedAt || null,
    firstFailedAt: incident?.firstFailedAt || null,
    attemptCount: incident?.attemptCount || 0,
    nextRetryAt: incident?.nextRetryAt || null,
    retryable: Boolean(incident?.retryable && incident.attemptCount < ORGANIZATION_STORAGE_MAX_ATTEMPTS),
    providerCode: incident?.providerCode || null,
    completedAt,
    physicallyVerified,
  };
}

export async function ensureOrganizationStorageSchema(
  env,
  { correlationId = null } = {},
) {
  const columns = await getTableColumns(env, "organizations");
  const missing = STORAGE_SCHEMA_COLUMNS.filter((column) => !columns.has(column));

  if (missing.length > 0) {
    throw storageError(
      "A migration de armazenamento das organizações ainda não foi aplicada.",
      500,
      "ORGANIZATION_STORAGE_SCHEMA_OUTDATED",
      "organization.storage.schema",
      {
        correlationId,
        retryable: false,
        details: { missingColumns: missing },
      },
    );
  }

  return columns;
}

export function canonicalOrganizationRoot(organization) {
  const configured = normalizeDropboxFolderPath(
    organization?.dropbox_root_path,
  );

  if (
    configured &&
    configured !== PROJECTS_ROOT &&
    configured.startsWith(`${PROJECTS_ROOT}/`)
  ) {
    return configured;
  }

  const slug =
    normalizeSlug(organization?.slug) ||
    normalizeSlug(organization?.name) ||
    `organization-${organization?.id || "unknown"}`;

  return `${PROJECTS_ROOT}/${slug}`;
}

export function organizationDocumentsRoot(organization) {
  return `${canonicalOrganizationRoot(organization)}/${DOCUMENTS_FOLDER}`;
}

async function getOrganizationStorageRow(env, organizationId) {
  return getDb(env)
    .prepare(
      `SELECT *
       FROM organizations
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(organizationId)
    .first();
}

async function persistDisabledState(
  env,
  organizationId,
  rootPath,
  checkedAt,
) {
  return getDb(env)
    .prepare(
      `UPDATE organizations
       SET storage_status = 'DISABLED',
           storage_error = NULL,
           storage_checked_at = ?,
           updated_at = ?
       WHERE id = ?
         AND (active = 0 OR active = '0' OR active = false)
       RETURNING *`,
    )
    .bind(checkedAt, checkedAt, organizationId)
    .first();
}

async function claimOrganizationStorage(env, { organization, claimAt, claimValue, staleBefore, revalidateReady }) {
  return getDb(env).prepare(
    `UPDATE organizations
     SET storage_status = 'PENDING', storage_error = ?, storage_checked_at = ?, updated_at = ?
     WHERE id = ? AND active = 1
       AND dropbox_root_path IS ? AND storage_status IS ?
       AND storage_error IS ? AND storage_checked_at IS ?
       AND (
         storage_status IS NULL OR TRIM(storage_status) = ''
         OR UPPER(TRIM(storage_status)) NOT IN ('READY', 'PENDING', 'ERROR', 'DISABLED')
         OR UPPER(TRIM(storage_status)) IN ('ERROR', 'DISABLED')
         OR (UPPER(TRIM(storage_status)) = 'READY' AND
             ((storage_error IS NOT NULL AND TRIM(storage_error) <> '') OR ? = 1))
         OR (UPPER(TRIM(storage_status)) = 'PENDING' AND
             (storage_checked_at IS NULL OR julianday(storage_checked_at) IS NULL
              OR julianday(storage_checked_at) <= julianday(?)))
       ) RETURNING *`,
  ).bind(claimValue, claimAt, claimAt, organization.id,
    organization.dropbox_root_path ?? null, organization.storage_status ?? null,
    organization.storage_error ?? null, organization.storage_checked_at ?? null,
    revalidateReady ? 1 : 0, staleBefore).first();
}

async function completeOrganizationStorageClaim(env, {
  organizationId, rootPath, claimAt, claimValue, completedAt, status, errorCode = null,
}) {
  return getDb(env).prepare(
    `UPDATE organizations
     SET storage_status = ?, storage_error = ?, storage_checked_at = ?, updated_at = ?
     WHERE id = ? AND active = 1 AND storage_status = 'PENDING'
       AND storage_checked_at = ? AND storage_error = ? AND dropbox_root_path = ?
     RETURNING *`,
  ).bind(status, errorCode, completedAt, completedAt, organizationId,
    claimAt, claimValue, rootPath).first();
}

export async function ensureOrganizationStorage(env, organization, {
  provisionDocuments = true,
  correlationId = null,
  nowFn = Date.now,
  claimTtlMs = ORGANIZATION_STORAGE_CLAIM_TTL_MS,
  ensureFolder = ensureDropboxFolder,
  revalidateReady = false,
  unattended = false,
  telemetrySource = "lifecycle",
  resetRetryBudget = false,
  observe = recordOrganizationStorageObservation,
} = {}) {
  const operationCorrelationId = correlationId || createCorrelationId();
  if (!organization?.id) {
    throw storageError("Organização inválida para provisionamento de armazenamento.", 500,
      "ORGANIZATION_STORAGE_CONTEXT_INVALID", "organization.storage.context",
      { correlationId: operationCorrelationId });
  }
  await ensureOrganizationStorageSchema(env, { correlationId: operationCorrelationId });
  // Refresh before deriving a path or retry budget: caller snapshots can be stale.
  organization = await getOrganizationStorageRow(env, organization.id);
  if (!organization) {
    throw storageError("Organização não encontrada.", 404,
      "ORGANIZATION_STORAGE_CONTEXT_INVALID", "organization.storage.context",
      { correlationId: operationCorrelationId });
  }
  const policy = organizationStoragePathPolicy(organization);
  const rootPath = policy.configuredPath;
  const documentsRoot = rootPath ? `${rootPath}/${DOCUMENTS_FOLDER}` : null;
  const startedAtMs = nowMillis(nowFn);
  const claimAt = isoAt(startedAtMs);
  const previous = readOrganizationStorageIncident(organization.storage_error);
  const resultFor = (row, extra = {}) => storageResult({
    organization: row, rootPath: normalizeDropboxFolderPath(row?.dropbox_root_path),
    documentsRoot: row?.dropbox_root_path ? `${normalizeDropboxFolderPath(row.dropbox_root_path)}/${DOCUMENTS_FOLDER}` : null,
    repairedPath: false, correlationId: operationCorrelationId, incident: previous, ...extra,
  });
  if (!isActiveOrganization(organization)) {
    const disabled = await persistDisabledState(env, organization.id, rootPath, claimAt);
    return resultFor(disabled || organization);
  }
  if (!policy.valid || (unattended && policy.decisionRequired)) {
    throw storageError("O armazenamento desta organização precisa de verificação pela equipe responsável.",
      503, "ORGANIZATION_STORAGE_PATH_DECISION_REQUIRED", "organization.storage.path",
      { correlationId: operationCorrelationId, details: { reason: policy.reason } });
  }
  if (isPendingClaimFresh(organization, startedAtMs, claimTtlMs)) {
    return resultFor(organization, { busy: true, reason: "CLAIM_IN_PROGRESS" });
  }
  const healthy = normalizeStorageStatus(organization.storage_status) === "READY" &&
    !String(organization.storage_error || "").trim();
  if (healthy && !revalidateReady) return resultFor(organization);
  const decision = organizationStorageRetryDecision(organization, startedAtMs);
  const resetIncident = resetRetryBudget === true && telemetrySource === "operator";
  if (!decision.allowed && !resetIncident) {
    const retryable = decision.reason === "RETRY_BACKOFF";
    throw storageError(retryable
      ? "O armazenamento está sendo preparado. Aguarde alguns instantes."
      : "O armazenamento desta organização precisa de verificação pela equipe responsável.",
      503, `ORGANIZATION_STORAGE_${decision.reason}`, "organization.storage.retry",
      { correlationId: operationCorrelationId, retryable,
        details: { ...resultFor(organization), organization: undefined, rootPath: undefined, documentsRoot: undefined,
          reason: decision.reason } });
  }
  const incident = startOrganizationStorageIncident(resetIncident ? null : previous, {
    incidentId: createCorrelationId(), nowMs: startedAtMs,
  });
  // A unique claim token also guards two claims made in the same millisecond.
  const claimValue = JSON.stringify({ ...incident, claimId: createCorrelationId() });
  const claimed = await claimOrganizationStorage(env, {
    organization, claimAt, claimValue,
    staleBefore: isoAt(startedAtMs - Math.max(1, Number(claimTtlMs) || 1)), revalidateReady,
  });
  if (!claimed) {
    const current = await getOrganizationStorageRow(env, organization.id) || organization;
    return resultFor(current, { busy: isPendingClaimFresh(current, nowMillis(nowFn), claimTtlMs), reason: "STATE_CHANGED" });
  }
  const emit = (type, value = {}) => observe(env, {
    type, source: telemetrySource, organizationId: organization.id,
    observedAt: isoAt(nowMillis(nowFn)), correlationId: operationCorrelationId,
    ...incident, manualIntervention: telemetrySource === "operator",
    ...(resetIncident ? { previousIncidentId: previous?.incidentId || null, retryBudgetReset: true } : {}),
    ...value,
  });
  await emit("attempt");
  const complete = (extra) => completeOrganizationStorageClaim(env, {
    organizationId: organization.id, rootPath: organization.dropbox_root_path,
    claimAt, claimValue, ...extra,
  });
  try {
    // READY means the complete required structure exists; root-only callers
    // cannot weaken this invariant. ensureFolder validates each path component.
    await ensureFolder(env, documentsRoot);
    const completedAt = isoAt(nowMillis(nowFn));
    const updated = await complete({ completedAt, status: ORGANIZATION_STORAGE_STATUS.READY });
    const current = updated || await getOrganizationStorageRow(env, organization.id) || claimed;
    if (updated) await emit("operational", { completedAt, physicallyVerified: true,
      retryable: false, durationMs: Math.max(0, Date.parse(completedAt) - startedAtMs) });
    return resultFor(current, {
      incident, claimed: true, superseded: !updated, completedAt,
      physicallyVerified: Boolean(updated),
      busy: !updated && isPendingClaimFresh(current, nowMillis(nowFn), claimTtlMs),
    });
  } catch (cause) {
    const completedAt = isoAt(nowMillis(nowFn));
    const failureCode = safeFailureCode(cause);
    const retryable = storageCauseRetryable(cause);
    const failedIncident = {
      ...incident, providerCode: failureCode, retryable,
      firstFailedAt: incident.firstFailedAt || completedAt,
      nextRetryAt: retryable && incident.attemptCount < ORGANIZATION_STORAGE_MAX_ATTEMPTS
        ? isoAt(Date.parse(completedAt) + ORGANIZATION_STORAGE_RETRY_DELAY_MS) : null,
    };
    const updated = await complete({ completedAt, status: ORGANIZATION_STORAGE_STATUS.ERROR,
      errorCode: JSON.stringify(failedIncident) });
    await emit("failure", { ...failedIncident, completedAt, physicallyVerified: false,
      superseded: !updated, durationMs: Math.max(0, Date.parse(completedAt) - startedAtMs) });
    throw storageError("Não foi possível criar ou validar a pasta Dropbox da organização.",
      502, "ORGANIZATION_STORAGE_PROVISION_FAILED", "organization.storage.provision", {
        cause, correlationId: operationCorrelationId,
        retryable: retryable && incident.attemptCount < ORGANIZATION_STORAGE_MAX_ATTEMPTS,
        details: { ...failedIncident, completedAt, physicallyVerified: false,
          statePersisted: Boolean(updated), superseded: !updated },
      });
  }
}

export function publicOrganizationStorage(result) {
  const organization = result?.organization || {};

  return {
    status:
      normalizeStorageStatus(organization.storage_status) ||
      (result?.ready
        ? ORGANIZATION_STORAGE_STATUS.READY
        : ORGANIZATION_STORAGE_STATUS.PENDING),
    ready: Boolean(result?.ready),
    repaired: Boolean(result?.repairedPath),
    busy: Boolean(result?.busy),
    checkedAt: organization.storage_checked_at || null,
  };
}

function storageEvidence(value) {
  return Object.fromEntries([
    "incidentId", "incidentStartedAt", "firstFailedAt", "attemptCount", "nextRetryAt",
    "retryable", "completedAt", "physicallyVerified", "providerCode", "claimed", "superseded",
  ].map((key) => [key, value?.[key] ?? null]));
}

function incidentEvidence(value) {
  return storageEvidence(readOrganizationStorageIncident(value));
}

function normalizeLimit(limit) {
  const numericLimit = Number(limit);
  return Math.max(
    1,
    Math.min(
      Number.isInteger(numericLimit) ? numericLimit : 100,
      MAX_REPAIR_BATCH,
    ),
  );
}

function normalizeAfterId(afterId) {
  const numericAfterId = Number(afterId);
  return Number.isInteger(numericAfterId) && numericAfterId > 0
    ? numericAfterId
    : 0;
}

function repairCandidateReason(organization, {
  nowMs,
  claimTtlMs = ORGANIZATION_STORAGE_CLAIM_TTL_MS,
  errorBackoffMs = 0,
} = {}) {
  const path = normalizeDropboxFolderPath(
    organization?.dropbox_root_path,
  );
  const policy = organizationStoragePathPolicy(organization);
  if (policy.decisionRequired) return policy.reason;
  const decision = organizationStorageRetryDecision(organization, nowMs);
  if (!decision.allowed) return decision.reason;
  const status = normalizeStorageStatus(organization?.storage_status);
  const checkedAt = Date.parse(
    String(organization?.storage_checked_at || ""),
  );

  if (
    !path ||
    path === PROJECTS_ROOT ||
    !path.startsWith(`${PROJECTS_ROOT}/`)
  ) {
    return "PATH_INVALID";
  }

  if (!status) return "STATE_INVALID";
  if (status === ORGANIZATION_STORAGE_STATUS.DISABLED) {
    return "ACTIVE_DISABLED";
  }

  if (status === ORGANIZATION_STORAGE_STATUS.PENDING) {
    const stale =
      !Number.isFinite(checkedAt) ||
      checkedAt <= nowMs - Math.max(1, Number(claimTtlMs) || 1);
    return stale ? "PENDING_EXPIRED" : null;
  }

  if (status === ORGANIZATION_STORAGE_STATUS.ERROR) {
    const retryAllowed =
      Number(errorBackoffMs) <= 0 ||
      !Number.isFinite(checkedAt) ||
      checkedAt <= nowMs - Math.max(0, Number(errorBackoffMs) || 0);
    return retryAllowed ? "ERROR_RETRY" : null;
  }

  if (
    status === ORGANIZATION_STORAGE_STATUS.READY &&
    String(organization?.storage_error || "").trim()
  ) {
    return "READY_WITH_ERROR";
  }

  return null;
}

async function listRepairCandidates(
  env,
  {
    limit,
    afterId,
    staleBefore,
    errorRetryBefore,
    errorBackoffEnabled,
    fairOrder,
    nowIso,
  },
) {
  const orderSql = fairOrder
    ? `ORDER BY
         CASE WHEN lower(rtrim(trim(dropbox_root_path), '/')) = '/projects/' || lower(slug)
           AND CASE WHEN json_valid(storage_error) THEN
             json_extract(storage_error, '$.v') = 1
             AND json_type(storage_error, '$.retryable') = 'true'
             AND json_type(storage_error, '$.attemptCount') = 'integer'
             AND json_extract(storage_error, '$.attemptCount') BETWEEN 1 AND ${ORGANIZATION_STORAGE_MAX_ATTEMPTS - 1}
             AND json_type(storage_error, '$.incidentId') = 'text'
             AND length(json_extract(storage_error, '$.incidentId')) BETWEEN 1 AND 120
             AND json_extract(storage_error, '$.incidentId') NOT GLOB '*[^A-Za-z0-9_-]*'
             AND json_type(storage_error, '$.incidentStartedAt') = 'text'
             AND julianday(json_extract(storage_error, '$.incidentStartedAt')) IS NOT NULL
             AND (json_type(storage_error, '$.firstFailedAt') = 'null'
               OR (json_type(storage_error, '$.firstFailedAt') = 'text'
                 AND julianday(json_extract(storage_error, '$.firstFailedAt')) IS NOT NULL))
             AND (json_type(storage_error, '$.nextRetryAt') = 'null'
               OR (json_type(storage_error, '$.nextRetryAt') = 'text'
                 AND julianday(json_extract(storage_error, '$.nextRetryAt')) <= julianday(?)))
           ELSE storage_error IS NULL OR trim(storage_error) = ''
             OR (length(trim(storage_error)) BETWEEN 3 AND 120
               AND upper(trim(storage_error)) GLOB '[A-Z]*'
               AND upper(trim(storage_error)) NOT GLOB '*[^A-Z0-9_]*'
               AND upper(storage_error) NOT GLOB '*AUTH*'
               AND upper(storage_error) NOT GLOB '*TOKEN*'
               AND upper(storage_error) NOT GLOB '*CREDENTIAL*'
               AND upper(storage_error) NOT GLOB '*FORBIDDEN*'
               AND upper(storage_error) NOT GLOB '*PERMISSION*'
               AND upper(storage_error) NOT GLOB '*INVALID*'
               AND upper(storage_error) NOT GLOB '*CONFLICT*'
               AND upper(storage_error) NOT GLOB '*ENV_MISSING*'
               AND (upper(storage_error) GLOB '*TIMEOUT*' OR upper(storage_error) GLOB '*UNAVAILABLE*'
                 OR upper(storage_error) GLOB '*RATE_LIMIT*' OR upper(storage_error) GLOB '*NETWORK*'
                 OR upper(storage_error) GLOB '*RETRY_EXHAUSTED*' OR upper(storage_error) GLOB '*REQUEST_FAILED*'
                 OR upper(storage_error) GLOB '*REQUEST_BUDGET*')) END
           THEN 0 ELSE 1 END ASC,
         CASE
           WHEN storage_checked_at IS NULL
             OR julianday(storage_checked_at) IS NULL
           THEN 0
           ELSE julianday(storage_checked_at)
         END ASC,
         id ASC`
    : "ORDER BY id ASC";
  const result = await getDb(env)
    .prepare(
      `SELECT *
       FROM organizations
       WHERE active = 1
         AND (? = 1 OR id > ?)
         AND (
           dropbox_root_path IS NULL
           OR TRIM(dropbox_root_path) = ''
           OR dropbox_root_path = '/projects'
           OR dropbox_root_path NOT LIKE '/projects/%'
           OR storage_status IS NULL
           OR TRIM(storage_status) = ''
           OR UPPER(TRIM(storage_status)) NOT IN ('READY', 'PENDING', 'ERROR', 'DISABLED')
           OR UPPER(TRIM(storage_status)) = 'DISABLED'
           OR (
             UPPER(TRIM(storage_status)) = 'ERROR'
             AND (
               ? = 0
               OR storage_checked_at IS NULL
               OR julianday(storage_checked_at) IS NULL
               OR julianday(storage_checked_at) <= julianday(?)
             )
           )
           OR (
             UPPER(TRIM(storage_status)) = 'PENDING'
             AND (
               storage_checked_at IS NULL
               OR julianday(storage_checked_at) IS NULL
               OR julianday(storage_checked_at) <= julianday(?)
             )
           )
           OR (
             UPPER(TRIM(storage_status)) = 'READY'
             AND storage_error IS NOT NULL
             AND TRIM(storage_error) <> ''
           )
         )
       ${orderSql}
       LIMIT ?`,
    )
    .bind(
      fairOrder ? 1 : 0,
      afterId,
      errorBackoffEnabled ? 1 : 0,
      errorRetryBefore,
      staleBefore,
      ...(fairOrder ? [nowIso] : []),
      limit + 1,
    )
    .all();

  return result?.results || [];
}

export async function repairActiveOrganizationStorages(
  env,
  {
    limit = 100,
    afterId = 0,
    correlationId = null,
    nowFn = Date.now,
    claimTtlMs = ORGANIZATION_STORAGE_CLAIM_TTL_MS,
    errorBackoffMs = 0,
    fairOrder = false,
    dryRun = false,
    ensureFolder = ensureDropboxFolder,
    telemetrySource = "operator",
  } = {},
) {
  const operationCorrelationId = correlationId || createCorrelationId();
  await ensureOrganizationStorageSchema(env, {
    correlationId: operationCorrelationId,
  });

  const safeLimit = normalizeLimit(limit);
  const safeAfterId = normalizeAfterId(afterId);
  const startedAtMs = nowMillis(nowFn);
  const staleBefore = isoAt(
    startedAtMs - Math.max(1, Number(claimTtlMs) || 1),
  );
  const safeErrorBackoffMs = Math.max(
    0,
    Number(errorBackoffMs) || 0,
  );
  const errorRetryBefore = isoAt(
    startedAtMs - safeErrorBackoffMs,
  );

  const candidateRows = await listRepairCandidates(env, {
    limit: safeLimit,
    afterId: safeAfterId,
    staleBefore,
    errorRetryBefore,
    errorBackoffEnabled: safeErrorBackoffMs > 0,
    fairOrder: Boolean(fairOrder),
    nowIso: isoAt(startedAtMs),
  });
  const hasMore = candidateRows.length > safeLimit;
  const organizations = candidateRows.slice(0, safeLimit);

  const repaired = [];
  const failed = [];
  const skipped = [];

  if (dryRun) {
    for (const organization of organizations) {
      skipped.push({
        organizationId: organization.id,
        status:
          normalizeStorageStatus(organization.storage_status) ||
          ORGANIZATION_STORAGE_STATUS.PENDING,
        reason:
          repairCandidateReason(organization, {
            nowMs: startedAtMs,
            claimTtlMs,
            errorBackoffMs: safeErrorBackoffMs,
          }) || "STATE_CHANGED",
        correlationId: operationCorrelationId,
      });
    }
  } else for (const organization of organizations) {
    const reason = repairCandidateReason(organization, { nowMs: startedAtMs, claimTtlMs, errorBackoffMs: safeErrorBackoffMs });
    if (["PATH_INVALID", "PATH_LEGACY", "RETRY_BLOCKED", "RETRY_EXHAUSTED", "RETRY_BACKOFF"].includes(reason)) {
      skipped.push({ organizationId: organization.id, status: organization.storage_status,
        reason, correlationId: operationCorrelationId, ...incidentEvidence(organization.storage_error) });
      continue;
    }
    try {
      const storage = await ensureOrganizationStorage(env, organization, {
        correlationId: operationCorrelationId,
        nowFn,
        claimTtlMs,
        ensureFolder,
        unattended: true,
        telemetrySource,
      });

      if (storage.ready && storage.claimed && !storage.superseded && storage.physicallyVerified) {
        repaired.push({
          organizationId: organization.id,
          status: ORGANIZATION_STORAGE_STATUS.READY,
          ...storageEvidence(storage),
          repairedPath: storage.repairedPath,
          superseded: storage.superseded,
          correlationId: operationCorrelationId,
        });
      } else {
        skipped.push({
          organizationId: organization.id,
          status: storage.status,
          ...storageEvidence(storage),
          reason: storage.busy
            ? "CLAIM_IN_PROGRESS"
            : storage.superseded
              ? "CLAIM_SUPERSEDED"
              : "STATE_CHANGED",
          correlationId: operationCorrelationId,
        });
      }
    } catch (error) {
      failed.push({
        organizationId: organization.id,
        status: ORGANIZATION_STORAGE_STATUS.ERROR,
        ...storageEvidence(error?.details || {}),
        retryable: Boolean(error?.retryable),
        superseded: Boolean(error?.details?.superseded),
        code: error?.code || "ORGANIZATION_STORAGE_PROVISION_FAILED",
        stage: error?.stage || "organization.storage.provision",
        correlationId: error?.correlationId || operationCorrelationId,
      });
    }
  }

  const lastProcessedId =
    organizations.length > 0
      ? Number(organizations[organizations.length - 1].id)
      : safeAfterId;

  return {
    correlationId: operationCorrelationId,
    checked: organizations.length,
    ready: repaired.length,
    failed: failed.length,
    skipped: skipped.length,
    dryRun: Boolean(dryRun),
    fairOrder: Boolean(fairOrder),
    errorBackoffMs: safeErrorBackoffMs,
    hasMore,
    nextCursor:
      !fairOrder && hasMore ? lastProcessedId : null,
    organizations: [...repaired, ...failed, ...skipped],
  };
}

export const __organizationStorageTesting = Object.freeze({
  MAX_REPAIR_BATCH,
  normalizeStorageStatus,
  isPendingClaimFresh,
  storageCauseRetryable,
  normalizeLimit,
  normalizeAfterId,
  repairCandidateReason,
});
