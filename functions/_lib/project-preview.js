export const PROJECT_PREVIEW_STATUS = Object.freeze({
  UNKNOWN: "UNKNOWN",
  PENDING: "PENDING",
  READY: "READY",
  FAILED: "FAILED",
  MISSING: "MISSING",
});

const PROJECT_PREVIEW_STATUSES = new Set(
  Object.values(PROJECT_PREVIEW_STATUS),
);

const PREVIEW_ERROR_LIMIT = 160;
const PREVIEW_METHOD_LIMIT = 120;

function normalizeProjectId(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0
    ? normalized
    : null;
}

function normalizeOrganizationId(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0
    ? normalized
    : null;
}

export function normalizePreviewRevision(value, { allowZero = true } = {}) {
  const normalized = Number(value);
  const minimum = allowZero ? 0 : 1;

  return Number.isInteger(normalized) && normalized >= minimum
    ? normalized
    : null;
}

export function normalizePreviewStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();

  return PROJECT_PREVIEW_STATUSES.has(normalized)
    ? normalized
    : PROJECT_PREVIEW_STATUS.UNKNOWN;
}

export function sanitizePreviewCode(
  value,
  fallback = "PROJECT_PREVIEW_ERROR",
) {
  const normalized = String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]+/g, "_")
    .slice(0, PREVIEW_ERROR_LIMIT);

  return normalized || fallback;
}

export function sanitizeCaptureMethod(value) {
  const normalized = String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+._:-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PREVIEW_METHOD_LIMIT);

  return normalized || "unknown";
}

export function publicProjectPreview(project) {
  const configRevision =
    normalizePreviewRevision(
      project?.config_revision ?? project?.configRevision,
    ) ?? 0;
  const thumbnailRevision = normalizePreviewRevision(
    project?.preview_revision ??
      project?.thumbnailRevision ??
      project?.thumbnail_revision,
  );

  return {
    thumbnailStatus: normalizePreviewStatus(
      project?.preview_status ??
        project?.thumbnailStatus ??
        project?.thumbnail_status,
    ),
    configRevision,
    thumbnailRevision,
    thumbnailUpdatedAt:
      project?.preview_updated_at ??
      project?.thumbnailUpdatedAt ??
      project?.thumbnail_updated_at ??
      null,
    thumbnailAttempts: Math.max(
      0,
      Number(
        project?.preview_attempts ??
          project?.thumbnailAttempts ??
          project?.thumbnail_attempts ??
          0,
      ) || 0,
    ),
  };
}

export async function getProjectPreviewState(
  env,
  { projectId, organizationId },
) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);

  if (!normalizedProjectId || !normalizedOrganizationId) {
    return null;
  }

  return env.DB.prepare(
    `SELECT
      id,
      organization_id,
      default_config_file,
      dropbox_root_path,
      config_revision,
      preview_status,
      preview_revision,
      preview_updated_at,
      preview_attempts,
      preview_last_error,
      preview_capture_method
     FROM projects
     WHERE id = ?
       AND organization_id = ?
       AND active = 1
     LIMIT 1`,
  )
    .bind(normalizedProjectId, normalizedOrganizationId)
    .first();
}

export async function markProjectPreviewAttempt(
  env,
  {
    projectId,
    organizationId,
    revision,
    captureMethod,
  },
) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedRevision = normalizePreviewRevision(revision, {
    allowZero: false,
  });

  if (
    !normalizedProjectId ||
    !normalizedOrganizationId ||
    !normalizedRevision
  ) {
    return null;
  }

  return env.DB.prepare(
    `UPDATE projects
     SET
       preview_status = 'PENDING',
       preview_attempts = preview_attempts + 1,
       preview_last_error = NULL,
       preview_capture_method = ?
     WHERE id = ?
       AND organization_id = ?
       AND active = 1
       AND config_revision = ?
     RETURNING
       config_revision,
       preview_status,
       preview_revision,
       preview_updated_at,
       preview_attempts,
       preview_capture_method`,
  )
    .bind(
      sanitizeCaptureMethod(captureMethod),
      normalizedProjectId,
      normalizedOrganizationId,
      normalizedRevision,
    )
    .first();
}

export async function markProjectPreviewReady(
  env,
  {
    projectId,
    organizationId,
    revision,
    captureMethod,
  },
) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedRevision = normalizePreviewRevision(revision);

  if (
    !normalizedProjectId ||
    !normalizedOrganizationId ||
    normalizedRevision === null
  ) {
    return null;
  }

  return env.DB.prepare(
    `UPDATE projects
     SET
       preview_status = 'READY',
       preview_revision = ?,
       preview_updated_at = CURRENT_TIMESTAMP,
       preview_last_error = NULL,
       preview_capture_method = ?
     WHERE id = ?
       AND organization_id = ?
       AND active = 1
       AND config_revision = ?
     RETURNING
       config_revision,
       preview_status,
       preview_revision,
       preview_updated_at,
       preview_attempts,
       preview_capture_method`,
  )
    .bind(
      normalizedRevision,
      sanitizeCaptureMethod(captureMethod),
      normalizedProjectId,
      normalizedOrganizationId,
      normalizedRevision,
    )
    .first();
}

export async function markProjectPreviewFailed(
  env,
  {
    projectId,
    organizationId,
    revision,
    errorCode,
    captureMethod,
  },
) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedRevision = normalizePreviewRevision(revision, {
    allowZero: false,
  });

  if (
    !normalizedProjectId ||
    !normalizedOrganizationId ||
    !normalizedRevision
  ) {
    return null;
  }

  return env.DB.prepare(
    `UPDATE projects
     SET
       preview_status = 'FAILED',
       preview_updated_at = CURRENT_TIMESTAMP,
       preview_last_error = ?,
       preview_capture_method = ?
     WHERE id = ?
       AND organization_id = ?
       AND active = 1
       AND config_revision = ?
     RETURNING
       config_revision,
       preview_status,
       preview_revision,
       preview_updated_at,
       preview_attempts,
       preview_last_error,
       preview_capture_method`,
  )
    .bind(
      sanitizePreviewCode(errorCode),
      sanitizeCaptureMethod(captureMethod),
      normalizedProjectId,
      normalizedOrganizationId,
      normalizedRevision,
    )
    .first();
}

export async function markProjectPreviewMissing(
  env,
  {
    projectId,
    organizationId,
    expectedStatus = PROJECT_PREVIEW_STATUS.UNKNOWN,
    errorCode = "PROJECT_THUMBNAIL_NOT_FOUND",
  },
) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedExpectedStatus = normalizePreviewStatus(expectedStatus);

  if (!normalizedProjectId || !normalizedOrganizationId) {
    return null;
  }

  return env.DB.prepare(
    `UPDATE projects
     SET
       preview_status = 'MISSING',
       preview_updated_at = CURRENT_TIMESTAMP,
       preview_last_error = ?
     WHERE id = ?
       AND organization_id = ?
       AND active = 1
       AND preview_status = ?
     RETURNING
       config_revision,
       preview_status,
       preview_revision,
       preview_updated_at,
       preview_attempts,
       preview_last_error`,
  )
    .bind(
      sanitizePreviewCode(errorCode),
      normalizedProjectId,
      normalizedOrganizationId,
      normalizedExpectedStatus,
    )
    .first();
}
