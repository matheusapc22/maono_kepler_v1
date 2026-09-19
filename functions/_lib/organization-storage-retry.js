// Versioned, bounded metadata in the existing 0009 storage_error column. Never
// stores provider messages/tokens/paths. READY clears the envelope; callers
// retain its safe fields in durable audit events before considering SLOs.
export const ORGANIZATION_STORAGE_MAX_ATTEMPTS = 5;
export const ORGANIZATION_STORAGE_RETRY_DELAY_MS = 15 * 60 * 1000;
const VERSION = 1;
const KNOWN_TRANSIENT = /(?:TIMEOUT|UNAVAILABLE|RATE_LIMIT|NETWORK|RETRY_EXHAUSTED|REQUEST_FAILED|REQUEST_BUDGET)/;
const KNOWN_PERMANENT = /(?:AUTH|TOKEN|CREDENTIAL|FORBIDDEN|PERMISSION|INVALID|CONFLICT|ENV_MISSING)/;

export function safeStorageFailureCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(code) ? code : "ORGANIZATION_STORAGE_PROVISION_FAILED";
}

function timestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(Date.parse(value)).toISOString() : null;
}

export function readOrganizationStorageIncident(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!text.startsWith("{")) {
    const providerCode = safeStorageFailureCode(text);
    return { legacy: true, providerCode, attemptCount: 0,
      retryable: !KNOWN_PERMANENT.test(providerCode) && KNOWN_TRANSIENT.test(providerCode) };
  }
  try {
    const item = JSON.parse(text);
    if (item.v !== VERSION || !Number.isInteger(item.attemptCount) || item.attemptCount < 1 ||
        item.attemptCount > ORGANIZATION_STORAGE_MAX_ATTEMPTS || typeof item.retryable !== "boolean" ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(item.incidentId || "") || !timestamp(item.incidentStartedAt) ||
        (item.nextRetryAt !== null && !timestamp(item.nextRetryAt)) ||
        (item.firstFailedAt !== null && !timestamp(item.firstFailedAt))) {
      throw new Error("invalid incident");
    }
    return {
      v: VERSION, incidentId: item.incidentId,
      incidentStartedAt: timestamp(item.incidentStartedAt),
      firstFailedAt: timestamp(item.firstFailedAt),
      nextRetryAt: timestamp(item.nextRetryAt),
      attemptCount: item.attemptCount,
      retryable: item.retryable,
      providerCode: safeStorageFailureCode(item.providerCode),
    };
  } catch {
    return { malformed: true, providerCode: "ORGANIZATION_STORAGE_INCIDENT_INVALID", attemptCount: 0, retryable: false };
  }
}

export function organizationStorageRetryDecision(organization, nowMs = Date.now()) {
  const incident = readOrganizationStorageIncident(organization?.storage_error);
  if (!incident) return { allowed: true, incident, reason: null };
  if (incident.malformed || !incident.retryable) return { allowed: false, incident, reason: "RETRY_BLOCKED" };
  if (incident.attemptCount >= ORGANIZATION_STORAGE_MAX_ATTEMPTS) return { allowed: false, incident, reason: "RETRY_EXHAUSTED" };
  if (Date.parse(incident.nextRetryAt || "") > nowMs) return { allowed: false, incident, reason: "RETRY_BACKOFF" };
  return { allowed: true, incident, reason: null };
}

export function startOrganizationStorageIncident(previous, { incidentId, nowMs }) {
  return {
    v: VERSION,
    incidentId: previous?.incidentId || incidentId,
    incidentStartedAt: previous?.incidentStartedAt || new Date(nowMs).toISOString(),
    firstFailedAt: previous?.firstFailedAt || null,
    nextRetryAt: null,
    attemptCount: (previous?.attemptCount || 0) + 1,
    retryable: true,
    providerCode: previous?.providerCode || "ORGANIZATION_STORAGE_PROVISION_PENDING",
  };
}
