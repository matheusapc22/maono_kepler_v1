import { recordAuditLog } from "./permissions.js";

export const ORGANIZATION_STORAGE_OBSERVATION_ACTION = "organization.storage.observation";
const TYPES = new Set(["created", "operational", "failure", "blocked", "attempt"]);
const SOURCES = new Set(["lifecycle", "scheduled", "operator"]);

function safeId(value) {
  const id = String(value ?? "");
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(id) ? id : null;
}

function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

// Only allowlisted operational metadata enters audit_logs. Provider payloads,
// paths, names and exception messages must never become metric labels.
export function organizationStorageObservation(value = {}) {
  if (!TYPES.has(value.type) || !SOURCES.has(value.source)) return null;
  const organizationId = Number(value.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return null;
  const observedAt = timestamp(value.observedAt);
  const correlationId = safeId(value.correlationId);
  if (!observedAt || !correlationId) return null;
  const observation = {
    schemaVersion: 1,
    type: value.type,
    source: value.source,
    organizationId,
    observedAt,
    correlationId,
  };
  for (const key of ["incidentId", "previousIncidentId", "reason", "providerCode"]) {
    const safe = safeId(value[key]);
    if (safe) observation[key] = safe;
  }
  for (const key of ["createdAt", "incidentStartedAt", "firstFailedAt", "completedAt", "nextRetryAt"]) {
    const safe = timestamp(value[key]);
    if (safe) observation[key] = safe;
  }
  for (const key of ["activeAtCreation", "retryable", "physicallyVerified", "manualIntervention", "superseded", "retryBudgetReset"]) {
    if (typeof value[key] === "boolean") observation[key] = value[key];
  }
  if (Number.isSafeInteger(value.attemptCount) && value.attemptCount >= 0) {
    observation.attemptCount = value.attemptCount;
  }
  if (Number.isFinite(value.durationMs) && value.durationMs >= 0) {
    observation.durationMs = value.durationMs;
  }
  return observation;
}

export async function recordOrganizationStorageObservation(env, value, { audit = recordAuditLog } = {}) {
  const metadata = organizationStorageObservation(value);
  if (!metadata) {
    console.warn("[Maono storage telemetry]", { code: "INVALID_OBSERVATION" });
    return { recorded: false, reason: "INVALID_OBSERVATION" };
  }
  try {
    const result = await audit(env, {
      actorUserId: null,
      organizationId: metadata.organizationId,
      action: ORGANIZATION_STORAGE_OBSERVATION_ACTION,
      resourceType: "organization",
      resourceId: String(metadata.organizationId),
      result: metadata.type,
      metadata,
    });
    // recordAuditLog deliberately tolerates unavailable audit storage. Missing
    // observations must be visible and produce an inconclusive SLO, not success.
    const recorded = result?.success === true || Number(result?.meta?.changes) > 0;
    if (!recorded) {
      console.warn("[Maono storage telemetry]", {
        code: "AUDIT_OBSERVATION_NOT_PERSISTED",
        correlationId: metadata.correlationId,
        organizationId: metadata.organizationId,
      });
    }
    return { recorded, reason: recorded ? null : "AUDIT_OBSERVATION_NOT_PERSISTED" };
  } catch {
    console.warn("[Maono storage telemetry]", {
      code: "AUDIT_OBSERVATION_NOT_PERSISTED",
      correlationId: metadata.correlationId,
      organizationId: metadata.organizationId,
    });
    return { recorded: false, reason: "AUDIT_OBSERVATION_NOT_PERSISTED" };
  }
}
