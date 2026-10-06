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
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
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
    artifactId: project?.preview_artifact_id ?? project?.artifactId ?? null,
    jobState: project?.preview_job_state ?? project?.jobState ??
      (normalizePreviewStatus(project?.preview_status ?? project?.thumbnailStatus) === "PENDING" ? "WAITING_CAPTURE" : null),
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
    `SELECT *
     FROM projects
     WHERE id = ?
       AND organization_id = ?
       AND active = 1
     LIMIT 1`,
  )
    .bind(normalizedProjectId, normalizedOrganizationId)
    .first();
}

// Capability-aware projection preserves readers before migration 0040 is applied.
// Never infer capability from an activation flag: accepted work remains readable.
export async function previewProjectSelect(env) {
  const installed = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_preview_operation_schema'").first();
  return installed ? `projects.preview_artifact_id,
    (SELECT po.state FROM project_preview_operations po WHERE po.id = projects.preview_operation_id
      AND po.organization_id = projects.organization_id AND po.project_id = projects.id
      AND po.revision = projects.config_revision) AS preview_job_state` :
    "NULL AS preview_artifact_id, NULL AS preview_job_state";
}
