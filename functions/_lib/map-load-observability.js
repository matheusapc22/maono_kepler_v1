export const MAP_LOAD_EVENT_SEQUENCE = Object.freeze([
  "MAP_OPEN_REQUESTED",
  "SESSION_RESOLVED",
  "PROJECT_RESOLVED",
  "LOAD_GUARD_STARTED",
  "CONFIG_REQUESTED",
  "CONFIG_VALIDATED",
  "MIGRATED",
  "ENGINE_HYDRATION_STARTED",
  "MAP_READY",
]);

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;
const SAFE_CODE_PATTERN = /^[A-Z0-9_:-]{2,120}$/;
const SAFE_CATEGORY_PATTERN = /^[A-Z0-9_:-]{2,80}$/;
const MAX_TRACE_DURATION_MS = 3_600_000;

function safeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function safeDuration(value) {
  const number = safeInteger(value);
  return number === null ? null : Math.min(number, MAX_TRACE_DURATION_MS);
}

function safeId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  return null;
}

function safeCorrelationId(value) {
  const normalized = String(value || "").trim();
  return CORRELATION_ID_PATTERN.test(normalized) ? normalized : null;
}

function safeCode(value, pattern) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return pattern.test(normalized) ? normalized : null;
}

function sanitizeEvent(value, expectedEvent, correlationId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.event !== expectedEvent) return null;
  if (safeCorrelationId(value.correlationId) !== correlationId) return null;

  const duration = safeDuration(value.duration);
  if (duration === null) return null;

  return {
    event: expectedEvent,
    correlationId,
    projectId: safeId(value.projectId),
    revision: safeInteger(value.revision),
    schemaVersion: safeInteger(value.schemaVersion),
    duration,
  };
}

function sanitizeError(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stage = MAP_LOAD_EVENT_SEQUENCE.includes(value.stage) ? value.stage : null;
  const status = safeInteger(value.status);
  return {
    stage,
    code: safeCode(value.code, SAFE_CODE_PATTERN),
    category: safeCode(value.category, SAFE_CATEGORY_PATTERN),
    retryable: typeof value.retryable === "boolean" ? value.retryable : null,
    status,
  };
}

export function sanitizeMapLoadTracePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const correlationId = safeCorrelationId(value.correlationId);
  if (!correlationId) return null;

  const sourceEvents = Array.isArray(value.events) ? value.events : [];
  if (sourceEvents.length < 1 || sourceEvents.length > MAP_LOAD_EVENT_SEQUENCE.length) {
    return null;
  }

  const events = [];
  for (let index = 0; index < sourceEvents.length; index += 1) {
    const sanitized = sanitizeEvent(
      sourceEvents[index],
      MAP_LOAD_EVENT_SEQUENCE[index],
      correlationId,
    );
    if (!sanitized) return null;
    if (index > 0 && sanitized.duration < events[index - 1].duration) return null;
    events.push(sanitized);
  }

  const status = ["success", "error", "incomplete"].includes(value.status)
    ? value.status
    : "incomplete";
  if (status === "success" && events.at(-1)?.event !== "MAP_READY") return null;
  if (events.at(-1)?.event === "MAP_READY" && status !== "success") return null;

  const duration = safeDuration(value.duration);
  if (duration === null || duration < events.at(-1).duration) return null;

  const error = status === "error" ? sanitizeError(value.error) : null;
  if (status === "error" && !error) return null;

  return {
    correlationId,
    projectId: safeId(value.projectId),
    revision: safeInteger(value.revision),
    schemaVersion: safeInteger(value.schemaVersion),
    duration,
    status,
    events,
    error,
  };
}

export function logMapLoadTrace(payload) {
  const safe = sanitizeMapLoadTracePayload(payload);
  if (!safe) return false;

  console.info("[Maono map load]", safe);
  return true;
}
