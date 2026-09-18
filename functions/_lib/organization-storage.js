import {
  ensureDropboxFolder,
  normalizeDropboxFolderPath,
} from "./dropbox.js";
import {
  getDb,
  getTableColumns,
} from "./organizations.js";
import { createCorrelationId } from "./maono-error.js";

const PROJECTS_ROOT = "/projects";
const DOCUMENTS_FOLDER = "documents";
const MAX_REPAIR_BATCH = 500;

// Dropbox metadata operations have a 15s request budget. Provisioning may touch
// /projects, /projects/{slug} and /documents, so keep a generous lease margin
// without requiring a new schema column.
export const ORGANIZATION_STORAGE_CLAIM_TTL_MS = 120_000;

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
  const code = String(cause?.code || "").trim().toUpperCase();
  if (/^[A-Z][A-Z0-9_]{2,119}$/.test(code)) return code;
  return "ORGANIZATION_STORAGE_PROVISION_FAILED";
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
}) {
  const status =
    normalizeStorageStatus(organization?.storage_status) ||
    ORGANIZATION_STORAGE_STATUS.PENDING;

  return {
    organization,
    rootPath,
    documentsRoot,
    status,
    ready: status === ORGANIZATION_STORAGE_STATUS.READY,
    repairedPath,
    claimed,
    superseded,
    busy,
    correlationId,
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
       SET dropbox_root_path = ?,
           storage_status = 'DISABLED',
           storage_error = NULL,
           storage_checked_at = ?,
           updated_at = ?
       WHERE id = ?
         AND (active = 0 OR active = '0' OR active = false)
       RETURNING *`,
    )
    .bind(rootPath, checkedAt, checkedAt, organizationId)
    .first();
}

async function claimOrganizationStorage(
  env,
  {
    organizationId,
    rootPath,
    claimAt,
    staleBefore,
    revalidateReady,
  },
) {
  return getDb(env)
    .prepare(
      `UPDATE organizations
       SET dropbox_root_path = ?,
           storage_status = 'PENDING',
           storage_error = NULL,
           storage_checked_at = ?,
           updated_at = ?
       WHERE id = ?
         AND active = 1
         AND (
           storage_status IS NULL
           OR TRIM(storage_status) = ''
           OR UPPER(TRIM(storage_status)) NOT IN ('READY', 'PENDING', 'ERROR', 'DISABLED')
           OR UPPER(TRIM(storage_status)) IN ('ERROR', 'DISABLED')
           OR (
             UPPER(TRIM(storage_status)) = 'READY'
             AND (
               (storage_error IS NOT NULL AND TRIM(storage_error) <> '')
               OR ? = 1
             )
           )
           OR (
             UPPER(TRIM(storage_status)) = 'PENDING'
             AND (
               storage_checked_at IS NULL
               OR julianday(storage_checked_at) IS NULL
               OR julianday(storage_checked_at) < julianday(?)
             )
           )
         )
       RETURNING *`,
    )
    .bind(
      rootPath,
      claimAt,
      claimAt,
      organizationId,
      revalidateReady ? 1 : 0,
      staleBefore,
    )
    .first();
}

async function completeOrganizationStorageClaim(
  env,
  {
    organizationId,
    claimAt,
    completedAt,
    status,
    errorCode = null,
  },
) {
  return getDb(env)
    .prepare(
      `UPDATE organizations
       SET storage_status = ?,
           storage_error = ?,
           storage_checked_at = ?,
           updated_at = ?
       WHERE id = ?
         AND active = 1
         AND storage_status = 'PENDING'
         AND storage_checked_at = ?
       RETURNING *`,
    )
    .bind(
      status,
      errorCode,
      completedAt,
      completedAt,
      organizationId,
      claimAt,
    )
    .first();
}

export async function ensureOrganizationStorage(
  env,
  organization,
  {
    provisionDocuments = true,
    correlationId = null,
    nowFn = Date.now,
    claimTtlMs = ORGANIZATION_STORAGE_CLAIM_TTL_MS,
    ensureFolder = ensureDropboxFolder,
    revalidateReady = false,
  } = {},
) {
  if (!organization?.id) {
    throw storageError(
      "Organização inválida para provisionamento de armazenamento.",
      500,
      "ORGANIZATION_STORAGE_CONTEXT_INVALID",
      "organization.storage.context",
      {
        correlationId: correlationId || createCorrelationId(),
        retryable: false,
      },
    );
  }

  const operationCorrelationId = correlationId || createCorrelationId();
  await ensureOrganizationStorageSchema(env, {
    correlationId: operationCorrelationId,
  });
  const rootPath = canonicalOrganizationRoot(organization);
  const documentsRoot = `${rootPath}/${DOCUMENTS_FOLDER}`;
  const configuredPath = normalizeDropboxFolderPath(
    organization.dropbox_root_path,
  );
  const repairedPath = configuredPath !== rootPath;
  const startedAtMs = nowMillis(nowFn);
  const claimAt = isoAt(startedAtMs);

  if (!isActiveOrganization(organization)) {
    const updated = await persistDisabledState(
      env,
      organization.id,
      rootPath,
      claimAt,
    );
    const current =
      updated || (await getOrganizationStorageRow(env, organization.id));

    return storageResult({
      organization:
        current || {
          ...organization,
          dropbox_root_path: rootPath,
          storage_status: ORGANIZATION_STORAGE_STATUS.DISABLED,
          storage_error: null,
          storage_checked_at: claimAt,
        },
      rootPath,
      documentsRoot,
      repairedPath,
      correlationId: operationCorrelationId,
    });
  }

  const staleBefore = isoAt(startedAtMs - Math.max(1, Number(claimTtlMs) || 1));
  const claimed = await claimOrganizationStorage(env, {
    organizationId: organization.id,
    rootPath,
    claimAt,
    staleBefore,
    revalidateReady,
  });

  if (!claimed) {
    const current =
      (await getOrganizationStorageRow(env, organization.id)) || organization;

    if (!isActiveOrganization(current)) {
      const disabledAt = isoAt(nowMillis(nowFn));
      const disabled = await persistDisabledState(
        env,
        organization.id,
        canonicalOrganizationRoot(current),
        disabledAt,
      );

      return storageResult({
        organization: disabled || current,
        rootPath: canonicalOrganizationRoot(current),
        documentsRoot: organizationDocumentsRoot(current),
        repairedPath,
        correlationId: operationCorrelationId,
      });
    }

    return storageResult({
      organization: current,
      rootPath,
      documentsRoot,
      repairedPath,
      correlationId: operationCorrelationId,
      claimed: false,
      busy: isPendingClaimFresh(current, nowMillis(nowFn), claimTtlMs),
    });
  }

  try {
    await ensureFolder(
      env,
      provisionDocuments ? documentsRoot : rootPath,
    );

    const completedAt = isoAt(nowMillis(nowFn));
    const updated = await completeOrganizationStorageClaim(env, {
      organizationId: organization.id,
      claimAt,
      completedAt,
      status: ORGANIZATION_STORAGE_STATUS.READY,
      errorCode: null,
    });

    if (!updated) {
      const current =
        (await getOrganizationStorageRow(env, organization.id)) || claimed;

      return storageResult({
        organization: current,
        rootPath,
        documentsRoot,
        repairedPath,
        correlationId: operationCorrelationId,
        claimed: true,
        superseded: true,
        busy: isPendingClaimFresh(current, nowMillis(nowFn), claimTtlMs),
      });
    }

    return storageResult({
      organization: updated,
      rootPath,
      documentsRoot,
      repairedPath,
      correlationId: operationCorrelationId,
      claimed: true,
    });
  } catch (cause) {
    const completedAt = isoAt(nowMillis(nowFn));
    const failureCode = safeFailureCode(cause);
    const updated = await completeOrganizationStorageClaim(env, {
      organizationId: organization.id,
      claimAt,
      completedAt,
      status: ORGANIZATION_STORAGE_STATUS.ERROR,
      errorCode: failureCode,
    });

    const error = storageError(
      "Não foi possível criar ou validar a pasta Dropbox da organização.",
      502,
      "ORGANIZATION_STORAGE_PROVISION_FAILED",
      "organization.storage.provision",
      {
        cause,
        correlationId: operationCorrelationId,
        retryable: storageCauseRetryable(cause),
        details: {
          providerCode: failureCode,
          statePersisted: Boolean(updated),
          superseded: !updated,
        },
      },
    );

    throw error;
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

async function listRepairCandidates(
  env,
  {
    limit,
    afterId,
    staleBefore,
  },
) {
  const result = await getDb(env)
    .prepare(
      `SELECT *
       FROM organizations
       WHERE active = 1
         AND id > ?
         AND (
           dropbox_root_path IS NULL
           OR TRIM(dropbox_root_path) = ''
           OR dropbox_root_path = '/projects'
           OR dropbox_root_path NOT LIKE '/projects/%'
           OR storage_status IS NULL
           OR TRIM(storage_status) = ''
           OR UPPER(TRIM(storage_status)) NOT IN ('READY', 'PENDING', 'ERROR', 'DISABLED')
           OR UPPER(TRIM(storage_status)) IN ('ERROR', 'DISABLED')
           OR (
             UPPER(TRIM(storage_status)) = 'PENDING'
             AND (
               storage_checked_at IS NULL
               OR julianday(storage_checked_at) IS NULL
               OR julianday(storage_checked_at) < julianday(?)
             )
           )
           OR (
             UPPER(TRIM(storage_status)) = 'READY'
             AND storage_error IS NOT NULL
             AND TRIM(storage_error) <> ''
           )
         )
       ORDER BY id ASC
       LIMIT ?`,
    )
    .bind(afterId, staleBefore, limit + 1)
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
    ensureFolder = ensureDropboxFolder,
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

  const candidateRows = await listRepairCandidates(env, {
    limit: safeLimit,
    afterId: safeAfterId,
    staleBefore,
  });
  const hasMore = candidateRows.length > safeLimit;
  const organizations = candidateRows.slice(0, safeLimit);

  const repaired = [];
  const failed = [];
  const skipped = [];

  for (const organization of organizations) {
    try {
      const storage = await ensureOrganizationStorage(env, organization, {
        correlationId: operationCorrelationId,
        nowFn,
        claimTtlMs,
        ensureFolder,
      });

      if (storage.ready) {
        repaired.push({
          organizationId: organization.id,
          status: ORGANIZATION_STORAGE_STATUS.READY,
          repairedPath: storage.repairedPath,
          superseded: storage.superseded,
          correlationId: operationCorrelationId,
        });
      } else {
        skipped.push({
          organizationId: organization.id,
          status: storage.status,
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
    hasMore,
    nextCursor: hasMore ? lastProcessedId : null,
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
});
