import { normalizeDropboxFolderPath } from "./dropbox.js";
import {
  ORGANIZATION_STORAGE_CLAIM_TTL_MS,
  ORGANIZATION_STORAGE_STATUS,
  ensureOrganizationStorage,
} from "./organization-storage.js";

function normalizeText(value) {
  return String(value || "").trim();
}

export function normalizeOrganizationSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function lifecycleError(
  message,
  status,
  code,
  {
    correlationId = null,
    retryable = false,
    details = null,
    cause = null,
  } = {},
) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.category = code.startsWith("ORGANIZATION_STORAGE_")
    ? "STORAGE"
    : "INFRASTRUCTURE";
  error.retryable = retryable;
  error.correlationId = correlationId;
  error.publicMessage = message;
  if (details) error.details = details;
  if (cause) error.cause = cause;
  return error;
}

function isUniqueConstraintError(error) {
  return /UNIQUE constraint failed|constraint failed: UNIQUE|\bUNIQUE\b/i.test(
    String(error?.message || ""),
  );
}

function isActive(row) {
  return !(
    row?.active === 0 ||
    row?.active === "0" ||
    row?.active === false
  );
}

function normalizedStorageStatus(row) {
  return String(row?.storage_status || "").trim().toUpperCase();
}

function isPendingFresh(
  row,
  nowMs,
  claimTtlMs = ORGANIZATION_STORAGE_CLAIM_TTL_MS,
) {
  if (normalizedStorageStatus(row) !== ORGANIZATION_STORAGE_STATUS.PENDING) {
    return false;
  }

  const checkedAt = Date.parse(String(row?.storage_checked_at || ""));
  return (
    Number.isFinite(checkedAt) &&
    checkedAt > nowMs - Math.max(1, Number(claimTtlMs) || 1)
  );
}

function normalizeOrganizationPayload(body, current = null) {
  const name = normalizeText(body?.name ?? current?.name);
  const slug = normalizeOrganizationSlug(
    body?.slug ?? current?.slug ?? name,
  );
  const description = normalizeText(
    body?.description ?? current?.description,
  );
  const active =
    body?.active === false
      ? 0
      : body?.active === true
        ? 1
        : current
          ? Number(current.active || 0)
          : 1;
  const requestedPath = normalizeText(
    body?.dropboxRootPath ??
      body?.dropbox_root_path ??
      current?.dropbox_root_path,
  );
  const dropboxRootPath = normalizeDropboxFolderPath(
    requestedPath ||
      `/projects/${slug || `organization-${current?.id || "new"}`}`,
  );

  return {
    name,
    slug,
    description,
    active,
    dropboxRootPath,
  };
}

function validateOrganizationPayload(payload, correlationId) {
  if (!payload.name) {
    throw lifecycleError(
      "Informe o nome da organização.",
      400,
      "ORGANIZATION_NAME_REQUIRED",
      { correlationId },
    );
  }

  if (!payload.slug) {
    throw lifecycleError(
      "Informe um identificador válido para a organização.",
      400,
      "ORGANIZATION_SLUG_REQUIRED",
      { correlationId },
    );
  }

  if (
    !payload.dropboxRootPath ||
    !payload.dropboxRootPath.startsWith("/projects/")
  ) {
    throw lifecycleError(
      "A pasta da organização deve ficar dentro de /projects. Exemplo: /projects/cliente-a.",
      400,
      "ORGANIZATION_PATH_INVALID",
      { correlationId },
    );
  }

  return payload;
}

export async function getOrganizationLifecycleById(env, organizationId) {
  return env.DB.prepare(
    `SELECT *
     FROM organizations
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(organizationId)
    .first();
}

async function getOrganizationBySlug(env, slug) {
  return env.DB.prepare(
    `SELECT *
     FROM organizations
     WHERE slug = ?
     LIMIT 1`,
  )
    .bind(slug)
    .first();
}

async function getOrganizationByPath(env, dropboxRootPath) {
  return env.DB.prepare(
    `SELECT *
     FROM organizations
     WHERE dropbox_root_path = ?
     LIMIT 1`,
  )
    .bind(dropboxRootPath)
    .first();
}

async function getIdentityMatches(env, slug, dropboxRootPath) {
  const bySlug = await getOrganizationBySlug(env, slug);
  const byPath = await getOrganizationByPath(env, dropboxRootPath);
  const exact =
    bySlug &&
    byPath &&
    Number(bySlug.id) === Number(byPath.id)
      ? bySlug
      : null;

  return { bySlug, byPath, exact };
}

function assertNoIdentityCollision(
  matches,
  {
    correlationId,
    excludeOrganizationId = null,
  } = {},
) {
  const conflicts = [matches.bySlug, matches.byPath].filter(
    (row) =>
      row &&
      (excludeOrganizationId === null ||
        Number(row.id) !== Number(excludeOrganizationId)),
  );

  if (conflicts.length > 0) {
    throw lifecycleError(
      "Já existe outra organização com este identificador ou pasta Dropbox.",
      409,
      "ORGANIZATION_EXISTS",
      {
        correlationId,
        retryable: false,
      },
    );
  }
}

function canResumeCreate(row) {
  if (!row || !isActive(row)) return false;
  const status = normalizedStorageStatus(row);
  return (
    status !== ORGANIZATION_STORAGE_STATUS.READY &&
    status !== ORGANIZATION_STORAGE_STATUS.DISABLED
  );
}

async function insertOrganization(env, payload, nowIso) {
  return env.DB.prepare(
    `INSERT INTO organizations (
      name,
      slug,
      description,
      dropbox_root_path,
      active,
      storage_status,
      storage_error,
      storage_checked_at
    )
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    RETURNING *`,
  )
    .bind(
      payload.name,
      payload.slug,
      payload.description || null,
      payload.dropboxRootPath,
      payload.active,
      payload.active
        ? ORGANIZATION_STORAGE_STATUS.PENDING
        : ORGANIZATION_STORAGE_STATUS.DISABLED,
      payload.active ? null : nowIso,
    )
    .first();
}

async function persistOrganizationFields(
  env,
  organizationId,
  payload,
  mode,
  nowIso,
) {
  if (mode === "disabled") {
    return env.DB.prepare(
      `UPDATE organizations
       SET name = ?,
           slug = ?,
           description = ?,
           dropbox_root_path = ?,
           active = 0,
           storage_status = 'DISABLED',
           storage_error = NULL,
           storage_checked_at = ?,
           updated_at = ?
       WHERE id = ?
       RETURNING *`,
    )
      .bind(
        payload.name,
        payload.slug,
        payload.description || null,
        payload.dropboxRootPath,
        nowIso,
        nowIso,
        organizationId,
      )
      .first();
  }

  if (mode === "reset-pending") {
    return env.DB.prepare(
      `UPDATE organizations
       SET name = ?,
           slug = ?,
           description = ?,
           dropbox_root_path = ?,
           active = 1,
           storage_status = 'PENDING',
           storage_error = NULL,
           storage_checked_at = NULL,
           updated_at = ?
       WHERE id = ?
       RETURNING *`,
    )
      .bind(
        payload.name,
        payload.slug,
        payload.description || null,
        payload.dropboxRootPath,
        nowIso,
        organizationId,
      )
      .first();
  }

  return env.DB.prepare(
    `UPDATE organizations
     SET name = ?,
         slug = ?,
         description = ?,
         dropbox_root_path = ?,
         active = 1,
         updated_at = ?
     WHERE id = ?
     RETURNING *`,
  )
    .bind(
      payload.name,
      payload.slug,
      payload.description || null,
      payload.dropboxRootPath,
      nowIso,
      organizationId,
    )
    .first();
}

async function persistOrganizationFieldsSafely(
  env,
  organizationId,
  payload,
  mode,
  nowIso,
  correlationId,
) {
  try {
    return await persistOrganizationFields(
      env,
      organizationId,
      payload,
      mode,
      nowIso,
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw lifecycleError(
        "Já existe outra organização com este identificador ou pasta Dropbox.",
        409,
        "ORGANIZATION_EXISTS",
        {
          correlationId,
          cause: error,
        },
      );
    }
    throw error;
  }
}

async function ensureLifecycleStorageReady(
  env,
  organization,
  {
    correlationId,
    nowFn,
    claimTtlMs,
    ensureStorage,
  },
) {
  const storage = await ensureStorage(env, organization, {
    correlationId,
    nowFn,
    claimTtlMs,
  });

  if (storage.ready) {
    return {
      organization: storage.organization,
      storage,
    };
  }

  if (storage.busy) {
    throw lifecycleError(
      "O armazenamento desta organização já está sendo preparado. Aguarde alguns instantes e tente novamente.",
      409,
      "ORGANIZATION_STORAGE_IN_PROGRESS",
      {
        correlationId,
        retryable: true,
      },
    );
  }

  throw lifecycleError(
    "O armazenamento da organização ainda não está pronto.",
    503,
    "ORGANIZATION_STORAGE_NOT_READY",
    {
      correlationId,
      retryable: true,
    },
  );
}

function lifecycleResult(
  organization,
  {
    created = false,
    resumed = false,
    storage = null,
  } = {},
) {
  const status = normalizedStorageStatus(organization);
  return {
    organization,
    created,
    resumed,
    storageReady: status === ORGANIZATION_STORAGE_STATUS.READY,
    storagePending: status === ORGANIZATION_STORAGE_STATUS.PENDING,
    storageBusy: Boolean(storage?.busy),
  };
}

export async function createOrganizationLifecycle(
  env,
  body,
  {
    correlationId = null,
    nowFn = Date.now,
    claimTtlMs = ORGANIZATION_STORAGE_CLAIM_TTL_MS,
    ensureStorage = ensureOrganizationStorage,
  } = {},
) {
  const nowMs = Number(nowFn());
  const nowIso = new Date(
    Number.isFinite(nowMs) ? nowMs : Date.now(),
  ).toISOString();
  const payload = validateOrganizationPayload(
    normalizeOrganizationPayload(body),
    correlationId,
  );

  let matches = await getIdentityMatches(
    env,
    payload.slug,
    payload.dropboxRootPath,
  );
  let organization = null;
  let created = false;
  let resumed = false;

  if (matches.bySlug || matches.byPath) {
    if (matches.exact && payload.active && canResumeCreate(matches.exact)) {
      organization = await persistOrganizationFieldsSafely(
        env,
        matches.exact.id,
        payload,
        "preserve",
        nowIso,
        correlationId,
      );
      resumed = true;
    } else {
      assertNoIdentityCollision(matches, { correlationId });
      throw lifecycleError(
        "Já existe uma organização com este identificador ou pasta Dropbox.",
        409,
        "ORGANIZATION_EXISTS",
        { correlationId },
      );
    }
  } else {
    try {
      organization = await insertOrganization(env, payload, nowIso);
      created = true;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;

      matches = await getIdentityMatches(
        env,
        payload.slug,
        payload.dropboxRootPath,
      );

      if (matches.exact && payload.active && canResumeCreate(matches.exact)) {
        organization = await persistOrganizationFields(
          env,
          matches.exact.id,
          payload,
          "preserve",
          nowIso,
        );
        resumed = true;
      } else {
        throw lifecycleError(
          "Já existe uma organização com este identificador ou pasta Dropbox.",
          409,
          "ORGANIZATION_EXISTS",
          {
            correlationId,
            cause: error,
          },
        );
      }
    }
  }

  if (!payload.active) {
    return lifecycleResult(organization, { created, resumed });
  }

  const ready = await ensureLifecycleStorageReady(env, organization, {
    correlationId,
    nowFn,
    claimTtlMs,
    ensureStorage,
  });

  return lifecycleResult(ready.organization, {
    created,
    resumed,
    storage: ready.storage,
  });
}

export async function updateOrganizationLifecycle(
  env,
  organizationId,
  body,
  {
    correlationId = null,
    nowFn = Date.now,
    claimTtlMs = ORGANIZATION_STORAGE_CLAIM_TTL_MS,
    ensureStorage = ensureOrganizationStorage,
  } = {},
) {
  const current = await getOrganizationLifecycleById(env, organizationId);

  if (!current) {
    throw lifecycleError(
      "Organização não encontrada.",
      404,
      "ORGANIZATION_NOT_FOUND",
      { correlationId },
    );
  }

  const nowMs = Number(nowFn());
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const nowIso = new Date(safeNowMs).toISOString();
  const payload = validateOrganizationPayload(
    normalizeOrganizationPayload(body, current),
    correlationId,
  );

  const matches = await getIdentityMatches(
    env,
    payload.slug,
    payload.dropboxRootPath,
  );
  assertNoIdentityCollision(matches, {
    correlationId,
    excludeOrganizationId: organizationId,
  });

  const currentPath = normalizeDropboxFolderPath(current.dropbox_root_path);
  const pathChanged = currentPath !== payload.dropboxRootPath;
  const currentStatus = normalizedStorageStatus(current);
  const pendingFresh = isPendingFresh(current, safeNowMs, claimTtlMs);

  if (!payload.active) {
    const disabled = await persistOrganizationFieldsSafely(
      env,
      organizationId,
      payload,
      "disabled",
      nowIso,
      correlationId,
    );
    return lifecycleResult(disabled);
  }

  if (pendingFresh && pathChanged) {
    throw lifecycleError(
      "O armazenamento desta organização está sendo preparado. Aguarde a conclusão antes de alterar a pasta.",
      409,
      "ORGANIZATION_STORAGE_IN_PROGRESS",
      {
        correlationId,
        retryable: true,
      },
    );
  }

  const healthyMetadataOnly =
    isActive(current) &&
    !pathChanged &&
    currentStatus === ORGANIZATION_STORAGE_STATUS.READY &&
    !normalizeText(current.storage_error);

  const pendingMetadataOnly =
    isActive(current) &&
    !pathChanged &&
    pendingFresh;

  if (healthyMetadataOnly || pendingMetadataOnly) {
    const updated = await persistOrganizationFieldsSafely(
      env,
      organizationId,
      payload,
      "preserve",
      nowIso,
      correlationId,
    );
    return lifecycleResult(updated);
  }

  const prepared = await persistOrganizationFieldsSafely(
    env,
    organizationId,
    payload,
    !isActive(current) || pathChanged ? "reset-pending" : "preserve",
    nowIso,
    correlationId,
  );

  const ready = await ensureLifecycleStorageReady(env, prepared, {
    correlationId,
    nowFn,
    claimTtlMs,
    ensureStorage,
  });

  return lifecycleResult(ready.organization, {
    storage: ready.storage,
  });
}

export const __organizationLifecycleTesting = Object.freeze({
  normalizeOrganizationPayload,
  normalizedStorageStatus,
  isPendingFresh,
  canResumeCreate,
  isUniqueConstraintError,
});
