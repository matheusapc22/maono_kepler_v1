import { normalizeDropboxFolderPath } from "./dropbox.js";
import {
  ORGANIZATION_STORAGE_CLAIM_TTL_MS,
  ORGANIZATION_STORAGE_STATUS,
} from "./organization-storage.js";

function nowMillis(nowFn = Date.now) {
  const value = typeof nowFn === "function" ? nowFn() : Date.now();
  const millis = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(millis) ? millis : Date.now();
}

function normalizedStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  return Object.values(ORGANIZATION_STORAGE_STATUS).includes(status)
    ? status
    : null;
}

function activeOrganization(organization) {
  return !(
    organization?.active === 0 ||
    organization?.active === "0" ||
    organization?.active === false
  );
}

function validOrganizationPath(organization) {
  const path = normalizeDropboxFolderPath(
    organization?.dropbox_root_path,
  );
  return Boolean(
    path &&
      path !== "/projects" &&
      path.startsWith("/projects/"),
  );
}

export function readOrganizationStorageReadiness(
  organization,
  {
    nowFn = Date.now,
    claimTtlMs = ORGANIZATION_STORAGE_CLAIM_TTL_MS,
  } = {},
) {
  const nowMs = nowMillis(nowFn);
  const active = activeOrganization(organization);
  const rawStatus = normalizedStatus(organization?.storage_status);
  const status =
    rawStatus ||
    (active
      ? ORGANIZATION_STORAGE_STATUS.PENDING
      : ORGANIZATION_STORAGE_STATUS.DISABLED);
  const checkedAt = organization?.storage_checked_at || null;
  const checkedAtMs = Date.parse(String(checkedAt || ""));
  const pendingFresh =
    active &&
    status === ORGANIZATION_STORAGE_STATUS.PENDING &&
    Number.isFinite(checkedAtMs) &&
    checkedAtMs > nowMs - Math.max(1, Number(claimTtlMs) || 1);
  const pathValid = validOrganizationPath(organization);
  const hasResidualError = Boolean(
    String(organization?.storage_error || "").trim(),
  );
  const ready =
    active &&
    status === ORGANIZATION_STORAGE_STATUS.READY &&
    pathValid &&
    !hasResidualError;

  let reason = "READY";
  if (!active) reason = "ORGANIZATION_INACTIVE";
  else if (!pathValid) reason = "STORAGE_PATH_INVALID";
  else if (!rawStatus) reason = "STORAGE_STATE_INVALID";
  else if (status === ORGANIZATION_STORAGE_STATUS.ERROR) {
    reason = "STORAGE_ERROR";
  } else if (status === ORGANIZATION_STORAGE_STATUS.DISABLED) {
    reason = "STORAGE_DISABLED";
  } else if (status === ORGANIZATION_STORAGE_STATUS.PENDING) {
    reason = pendingFresh ? "CLAIM_IN_PROGRESS" : "CLAIM_STALE";
  } else if (status === ORGANIZATION_STORAGE_STATUS.READY && hasResidualError) {
    reason = "READY_WITH_ERROR";
  } else if (!ready) {
    reason = "STORAGE_STATE_INVALID";
  }

  const retryable =
    active &&
    !ready &&
    reason !== "STORAGE_DISABLED";
  const recoveryRecommended =
    active &&
    !ready &&
    !pendingFresh;

  return {
    status,
    ready,
    busy: pendingFresh,
    retryable,
    recoveryRecommended,
    reason,
    checkedAt,
  };
}

function readinessError(readiness, operation) {
  const inactive =
    readiness.reason === "ORGANIZATION_INACTIVE" ||
    readiness.reason === "STORAGE_DISABLED";
  const error = new Error(
    inactive
      ? "A organização não está disponível para esta operação."
      : readiness.busy
        ? "O armazenamento da organização está sendo preparado. Tente novamente em instantes."
        : "O armazenamento da organização está temporariamente indisponível.",
  );

  error.status = inactive ? 409 : 503;
  error.code = inactive
    ? "ORGANIZATION_STORAGE_DISABLED"
    : readiness.busy
      ? "ORGANIZATION_STORAGE_IN_PROGRESS"
      : "ORGANIZATION_STORAGE_NOT_READY";
  error.category = "STORAGE";
  error.stage = operation || "organization.storage.readiness";
  error.retryable = readiness.retryable;
  error.publicMessage = error.message;
  error.details = {
    storageStatus: readiness.status,
    readinessReason: readiness.reason,
    recoveryRecommended: readiness.recoveryRecommended,
  };
  return error;
}

export function requireOrganizationStorageReady(
  organization,
  options = {},
) {
  const readiness = readOrganizationStorageReadiness(
    organization,
    options,
  );

  if (!readiness.ready) {
    throw readinessError(readiness, options.operation);
  }

  return readiness;
}

export function publicOrganizationStorageReadiness(readiness) {
  return {
    status: readiness?.status || ORGANIZATION_STORAGE_STATUS.PENDING,
    ready: Boolean(readiness?.ready),
    busy: Boolean(readiness?.busy),
    retryable: Boolean(readiness?.retryable),
    recoveryRecommended: Boolean(readiness?.recoveryRecommended),
    checkedAt: readiness?.checkedAt || null,
  };
}

export const __organizationStorageReadinessTesting = Object.freeze({
  activeOrganization,
  normalizedStatus,
  validOrganizationPath,
});
