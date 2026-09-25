import {
  getDb,
  getFileDropboxPath,
  getOrganizationOrThrow,
} from "./organizations.js";
import { requireDocumentFoldersSchema } from "./organization-file-folders.js";
import { deleteOrganizationBinary } from "./organization-files.js";
import {
  requireOrganizationStorageReady,
} from "./organization-storage-readiness.js";

export const ORGANIZATION_FILE_PURGE_DEFAULT_BATCH_SIZE = 25;
export const ORGANIZATION_FILE_PURGE_MAX_BATCH_SIZE = 100;
export const ORGANIZATION_FILE_PURGE_CLAIM_TTL_MS = 15 * 60 * 1000;

function purgeError(message, status, code, stage = "document.purge") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.stage = stage;
  error.publicMessage = message;
  return error;
}

function normalizeNow(now) {
  const value = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(value.getTime())) {
    throw purgeError(
      "Data de purge inválida.",
      500,
      "DOCUMENT_PURGE_DATE_INVALID",
    );
  }
  return value;
}

function boundedLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return ORGANIZATION_FILE_PURGE_DEFAULT_BATCH_SIZE;
  return Math.min(
    ORGANIZATION_FILE_PURGE_MAX_BATCH_SIZE,
    Math.max(1, parsed),
  );
}

function safeFailureCode(error) {
  return String(error?.code || "DOCUMENT_PURGE_REMOTE_FAILED").slice(0, 120);
}

async function rowById(env, organizationId, fileId) {
  return (
    (await getDb(env)
      .prepare(`
        SELECT *
        FROM organization_files
        WHERE id = ?
          AND organization_id = ?
        LIMIT 1
      `)
      .bind(fileId, organizationId)
      .first()) || null
  );
}

export async function findOrganizationFileForPurge(
  env,
  organizationId,
  fileId,
) {
  await requireDocumentFoldersSchema(env);
  return (
    (await getDb(env)
      .prepare(`
        SELECT *
        FROM organization_files
        WHERE id = ?
          AND organization_id = ?
          AND deleted_at IS NOT NULL
          AND (
            UPPER(COALESCE(status, '')) IN ('TRASHED', 'PURGE_PENDING', 'PURGED')
            OR purged_at IS NOT NULL
          )
        LIMIT 1
      `)
      .bind(fileId, organizationId)
      .first()) || null
  );
}

export async function listExpiredOrganizationFilesForPurge(
  env,
  {
    limit = ORGANIZATION_FILE_PURGE_DEFAULT_BATCH_SIZE,
    now = new Date(),
    claimTtlMs = ORGANIZATION_FILE_PURGE_CLAIM_TTL_MS,
  } = {},
) {
  await requireDocumentFoldersSchema(env);
  const current = normalizeNow(now);
  const safeLimit = boundedLimit(limit);
  const staleBefore = new Date(
    current.getTime() - Math.max(30_000, Number(claimTtlMs) || 0),
  ).toISOString();

  const result = await getDb(env)
    .prepare(`
      SELECT *
      FROM organization_files
      WHERE deleted_at IS NOT NULL
        AND purge_after IS NOT NULL
        AND purged_at IS NULL
        AND datetime(purge_after) <= datetime(?)
        AND (
          UPPER(COALESCE(status, '')) = 'TRASHED'
          OR (
            UPPER(COALESCE(status, '')) = 'PURGE_PENDING'
            AND datetime(COALESCE(updated_at, deleted_at)) <= datetime(?)
          )
        )
      ORDER BY datetime(purge_after) ASC, id ASC
      LIMIT ?
    `)
    .bind(current.toISOString(), staleBefore, safeLimit + 1)
    .all();

  const rows = result?.results || [];
  const hasMore = rows.length > safeLimit;

  return {
    rows: hasMore ? rows.slice(0, safeLimit) : rows,
    hasMore,
    limit: safeLimit,
    now: current.toISOString(),
    staleBefore,
  };
}

async function claimForPurge(
  env,
  {
    organizationId,
    fileId,
    now,
    claimTtlMs,
    requireExpired,
  },
) {
  const current = normalizeNow(now);
  const staleBefore = new Date(
    current.getTime() - Math.max(30_000, Number(claimTtlMs) || 0),
  ).toISOString();

  const expiryClause = requireExpired
    ? "AND purge_after IS NOT NULL AND datetime(purge_after) <= datetime(?)"
    : "";
  const bindings = [
    current.toISOString(),
    fileId,
    organizationId,
    staleBefore,
  ];
  if (requireExpired) bindings.push(current.toISOString());

  const result = await getDb(env)
    .prepare(`
      UPDATE organization_files
      SET status = 'PURGE_PENDING',
          active = 0,
          error_message = NULL,
          updated_at = ?
      WHERE id = ?
        AND organization_id = ?
        AND deleted_at IS NOT NULL
        AND purged_at IS NULL
        AND (
          UPPER(COALESCE(status, '')) = 'TRASHED'
          OR (
            UPPER(COALESCE(status, '')) = 'PURGE_PENDING'
            AND datetime(COALESCE(updated_at, deleted_at)) <= datetime(?)
          )
        )
        ${expiryClause}
    `)
    .bind(...bindings)
    .run();

  if (Number(result?.meta?.changes || 0) > 0) {
    return {
      file: await rowById(env, organizationId, fileId),
      alreadyPurged: false,
      claimedAt: current.toISOString(),
    };
  }

  const existing = await rowById(env, organizationId, fileId);
  if (
    existing?.purged_at ||
    String(existing?.status || "").toUpperCase() === "PURGED"
  ) {
    return {
      file: existing,
      alreadyPurged: true,
      claimedAt: null,
    };
  }

  if (
    String(existing?.status || "").toUpperCase() === "PURGE_PENDING"
  ) {
    throw purgeError(
      "A exclusão permanente deste documento já está em processamento.",
      409,
      "DOCUMENT_PURGE_IN_PROGRESS",
      "document.purge.claim",
    );
  }

  if (
    requireExpired &&
    existing?.purge_after &&
    new Date(existing.purge_after).getTime() > current.getTime()
  ) {
    throw purgeError(
      "O documento ainda não atingiu o prazo de exclusão automática.",
      409,
      "DOCUMENT_PURGE_NOT_EXPIRED",
      "document.purge.claim",
    );
  }

  throw purgeError(
    "Documento não encontrado na Lixeira.",
    404,
    "ORGANIZATION_FILE_TRASH_NOT_FOUND",
    "document.purge.lookup",
  );
}

async function releaseClaimAfterRemoteFailure(
  env,
  {
    organizationId,
    fileId,
    now,
    error,
  },
) {
  const current = normalizeNow(now);
  await getDb(env)
    .prepare(`
      UPDATE organization_files
      SET status = 'TRASHED',
          error_message = ?,
          updated_at = ?
      WHERE id = ?
        AND organization_id = ?
        AND purged_at IS NULL
        AND UPPER(COALESCE(status, '')) = 'PURGE_PENDING'
    `)
    .bind(
      safeFailureCode(error),
      current.toISOString(),
      fileId,
      organizationId,
    )
    .run();
}

async function finalizePurge(
  env,
  {
    organizationId,
    fileId,
    now,
  },
) {
  const current = normalizeNow(now);
  const purgedAt = current.toISOString();
  const result = await getDb(env)
    .prepare(`
      UPDATE organization_files
      SET status = 'PURGED',
          active = 0,
          folder_id = NULL,
          purged_at = ?,
          error_message = NULL,
          updated_at = ?
      WHERE id = ?
        AND organization_id = ?
        AND purged_at IS NULL
        AND UPPER(COALESCE(status, '')) = 'PURGE_PENDING'
    `)
    .bind(purgedAt, purgedAt, fileId, organizationId)
    .run();

  const file = await rowById(env, organizationId, fileId);
  if (Number(result?.meta?.changes || 0) > 0) {
    return { file, idempotent: false };
  }

  if (
    file?.purged_at ||
    String(file?.status || "").toUpperCase() === "PURGED"
  ) {
    return { file, idempotent: true };
  }

  throw purgeError(
    "O tombstone do documento não pôde ser finalizado.",
    409,
    "DOCUMENT_PURGE_FINALIZE_CONFLICT",
    "document.purge.finalize",
  );
}

export async function purgeOrganizationFile(
  env,
  {
    organizationId,
    fileId,
    now = new Date(),
    requireExpired = false,
    claimTtlMs = ORGANIZATION_FILE_PURGE_CLAIM_TTL_MS,
    deleteBinary = deleteOrganizationBinary,
  },
) {
  await requireDocumentFoldersSchema(env);

  const initial = await rowById(env, organizationId, fileId);
  if (
    initial?.purged_at ||
    String(initial?.status || "").toUpperCase() === "PURGED"
  ) {
    return {
      file: initial,
      idempotent: true,
      remoteDeleteConfirmed: true,
    };
  }

  const organization = await getOrganizationOrThrow(env, organizationId);
  requireOrganizationStorageReady(organization, {
    operation: "document.purge.readiness",
  });

  const claimed = await claimForPurge(env, {
    organizationId,
    fileId,
    now,
    claimTtlMs,
    requireExpired,
  });

  if (claimed.alreadyPurged) {
    return {
      file: claimed.file,
      idempotent: true,
      remoteDeleteConfirmed: true,
    };
  }

  const dropboxPath = getFileDropboxPath(claimed.file);
  if (!dropboxPath) {
    const error = purgeError(
      "Documento sem caminho de armazenamento para exclusão permanente.",
      409,
      "DOCUMENT_PURGE_PATH_MISSING",
      "document.purge.remote",
    );
    await releaseClaimAfterRemoteFailure(env, {
      organizationId,
      fileId,
      now,
      error,
    });
    throw error;
  }

  let remoteDeleteConfirmed = false;
  try {
    // deleteOrganizationBinary treats provider not_found as an idempotent success.
    await deleteBinary(env, dropboxPath);
    remoteDeleteConfirmed = true;
  } catch (error) {
    await releaseClaimAfterRemoteFailure(env, {
      organizationId,
      fileId,
      now,
      error,
    });
    error.status = Number(error?.status || 502);
    error.code = error?.code || "DOCUMENT_PURGE_REMOTE_FAILED";
    error.stage = error?.stage || "document.purge.remote";
    error.publicMessage =
      "Não foi possível excluir permanentemente o documento do armazenamento.";
    throw error;
  }

  try {
    const finalized = await finalizePurge(env, {
      organizationId,
      fileId,
      now,
    });
    return {
      ...finalized,
      remoteDeleteConfirmed,
    };
  } catch (error) {
    // Once provider deletion is confirmed we intentionally keep PURGE_PENDING.
    // A later retry can safely observe provider not_found and finalize the tombstone.
    error.status = Number(error?.status || 500);
    error.code = error?.code || "DOCUMENT_PURGE_FINALIZE_FAILED";
    error.stage = error?.stage || "document.purge.finalize";
    error.publicMessage =
      "A exclusão remota foi confirmada, mas a finalização do registro precisa ser repetida.";
    throw error;
  }
}

export const __organizationFilePurgeTesting = Object.freeze({
  boundedLimit,
  normalizeNow,
  safeFailureCode,
});
