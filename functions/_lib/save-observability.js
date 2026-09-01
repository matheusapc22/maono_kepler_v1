export const SAVE_STAGE_SEQUENCE = Object.freeze([
  "SERIALIZE",
  "VALIDATE",
  "RESERVE",
  "WRITE",
  "VERIFY",
  "READY",
  "PUBLISH",
]);

const SAVE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SAFE_CODE_PATTERN = /^[A-Z0-9_:-]{2,120}$/;
const SAFE_CATEGORY_PATTERN = /^[A-Z0-9_:-]{2,80}$/;
const MAX_DURATION_MS = 3_600_000;
const CONFIG_TRACE_REGISTRY = new WeakMap();

function nowMs() {
  return Date.now();
}

function createId(prefix) {
  if (typeof crypto?.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function safeString(value, maxLength = 160) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function safeId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return safeString(value);
}

function safeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function safeStatus(value) {
  const number = safeInteger(value);
  return number !== null && number <= 599 ? number : null;
}

function safeDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(Math.round(number), MAX_DURATION_MS);
}

function safeCode(value, pattern) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return pattern.test(normalized) ? normalized : null;
}

function safeSaveId(value) {
  const normalized = String(value || "").trim();
  return SAVE_ID_PATTERN.test(normalized) ? normalized : null;
}

function safeStage(value) {
  return SAVE_STAGE_SEQUENCE.includes(value) ? value : null;
}

function providerFromError(error) {
  return safeString(error?.provider || error?.details?.provider, 80);
}

function providerStatusFromError(error) {
  if (!providerFromError(error)) return null;
  return safeStatus(
    error?.providerStatus ??
      error?.dropboxStatus ??
      error?.details?.providerStatus ??
      error?.cause?.status,
  );
}

export function createSaveId() {
  return createId("save");
}

export function getOrCreateSaveId(request) {
  const incoming = request?.headers?.get?.("X-Maono-Save-Id") || "";
  return safeSaveId(incoming) || createSaveId();
}

export function measureUtf8Bytes(value) {
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}

export async function readSaveJsonBody(request, trace = null) {
  const text = await request.text();
  trace?.updateContext({ payloadBytes: measureUtf8Bytes(text) });
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function bindSaveTraceToConfig(config, trace) {
  if (
    trace &&
    config &&
    typeof config === "object" &&
    !Array.isArray(config)
  ) {
    CONFIG_TRACE_REGISTRY.set(config, trace);
  }
  return config;
}

export function getSaveTraceForConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  return CONFIG_TRACE_REGISTRY.get(config) || null;
}

export function sanitizeSaveDiagnostic(value = {}) {
  const error = value.error || null;
  const provider = safeString(
    value.provider ?? providerFromError(error),
    80,
  );
  const providerStatus = provider
    ? safeStatus(value.providerStatus ?? providerStatusFromError(error))
    : null;

  return {
    event: safeString(value.event, 80),
    saveId: safeSaveId(value.saveId),
    correlationId: safeString(value.correlationId, 100),
    operation: ["create", "update"].includes(value.operation)
      ? value.operation
      : null,
    projectId: safeId(value.projectId),
    organizationId: safeId(value.organizationId),
    expectedRevision: safeInteger(value.expectedRevision),
    candidateRevision: safeInteger(value.candidateRevision),
    payloadBytes: safeInteger(value.payloadBytes),
    stage: safeStage(value.stage),
    stageDurationMs: safeDuration(value.stageDurationMs),
    totalDurationMs: safeDuration(value.totalDurationMs),
    provider,
    providerStatus,
    httpStatus: safeStatus(value.httpStatus),
    code: safeCode(value.code ?? error?.code, SAFE_CODE_PATTERN),
    category: safeCode(value.category ?? error?.category, SAFE_CATEGORY_PATTERN),
    retryable:
      typeof value.retryable === "boolean"
        ? value.retryable
        : typeof error?.retryable === "boolean"
          ? error.retryable
          : typeof error?.details?.retryable === "boolean"
            ? error.details.retryable
            : null,
    result: ["success", "error"].includes(value.result)
      ? value.result
      : null,
  };
}

function compactDiagnostic(value) {
  return Object.fromEntries(
    Object.entries(sanitizeSaveDiagnostic(value)).filter(
      ([, item]) => item !== null && item !== undefined,
    ),
  );
}

export function createSaveTrace({
  request = null,
  saveId = null,
  correlationId = null,
  operation,
  projectId = null,
  organizationId = null,
  expectedRevision = null,
  payloadBytes = null,
} = {}) {
  const startedAt = nowMs();
  const timings = [];
  const context = {
    saveId: safeSaveId(saveId) || getOrCreateSaveId(request),
    correlationId: safeString(correlationId, 100),
    operation: ["create", "update"].includes(operation) ? operation : null,
    projectId: safeId(projectId),
    organizationId: safeId(organizationId),
    expectedRevision: safeInteger(expectedRevision),
    candidateRevision: null,
    payloadBytes: safeInteger(payloadBytes),
    provider: null,
  };
  let currentStage = null;
  let terminalLogged = false;

  function updateContext(next = {}) {
    if ("projectId" in next) context.projectId = safeId(next.projectId);
    if ("organizationId" in next) context.organizationId = safeId(next.organizationId);
    if ("expectedRevision" in next) {
      context.expectedRevision = safeInteger(next.expectedRevision);
    }
    if ("candidateRevision" in next) {
      context.candidateRevision = safeInteger(next.candidateRevision);
    }
    if ("payloadBytes" in next) context.payloadBytes = safeInteger(next.payloadBytes);
    if ("provider" in next) context.provider = safeString(next.provider, 80);
  }

  function totalDurationMs() {
    return Math.max(0, nowMs() - startedAt);
  }

  function log(payload, level = "info") {
    const safe = compactDiagnostic({ ...context, ...payload });
    const method = level === "error" ? "error" : "info";
    console[method]("[Maono save]", safe);
    return safe;
  }

  async function stage(stageName, work) {
    if (!SAVE_STAGE_SEQUENCE.includes(stageName)) {
      throw new Error(`Estágio de save inválido: ${String(stageName)}`);
    }
    currentStage = stageName;
    const stageStartedAt = nowMs();
    try {
      const result = await work();
      const duration = Math.max(0, nowMs() - stageStartedAt);
      timings.push({ stage: stageName, duration });
      log({
        event: "project_save_stage",
        stage: stageName,
        stageDurationMs: duration,
        totalDurationMs: totalDurationMs(),
        result: "success",
      });
      return result;
    } catch (error) {
      const duration = Math.max(0, nowMs() - stageStartedAt);
      timings.push({ stage: stageName, duration });
      fail(error, {
        stage: stageName,
        stageDurationMs: duration,
      });
      throw error;
    }
  }

  function fail(error, options = {}) {
    if (terminalLogged) return false;
    terminalLogged = true;
    const stageName = safeStage(options.stage) || safeStage(error?.details?.stage) || currentStage;
    log(
      {
        event: "project_save_failed",
        stage: stageName,
        stageDurationMs: options.stageDurationMs ?? null,
        totalDurationMs: totalDurationMs(),
        httpStatus: options.httpStatus ?? error?.status ?? null,
        provider: options.provider ?? providerFromError(error) ?? context.provider,
        providerStatus: options.providerStatus ?? providerStatusFromError(error),
        code: options.code ?? error?.code ?? "PROJECT_SAVE_FAILED",
        category: options.category ?? error?.category ?? null,
        retryable:
          typeof options.retryable === "boolean" ? options.retryable : error?.retryable,
        result: "error",
        error,
      },
      "error",
    );
    return true;
  }

  function finishSuccess({ httpStatus = 200 } = {}) {
    if (terminalLogged) return false;
    terminalLogged = true;
    log({
      event: "project_save_completed",
      stage: currentStage,
      totalDurationMs: totalDurationMs(),
      httpStatus,
      result: "success",
    });
    return true;
  }

  function serverTiming() {
    return timings
      .map(({ stage: stageName, duration }) => `${stageName.toLowerCase()};dur=${Math.max(0, Math.round(duration))}`)
      .join(", ");
  }

  function responseHeaders() {
    const headers = {
      "X-Maono-Save-Id": context.saveId,
    };
    if (context.correlationId) {
      headers["X-Correlation-Id"] = context.correlationId;
    }
    const timing = serverTiming();
    if (timing) headers["Server-Timing"] = timing;
    return headers;
  }

  return {
    get saveId() {
      return context.saveId;
    },
    get correlationId() {
      return context.correlationId;
    },
    get currentStage() {
      return currentStage;
    },
    updateContext,
    stage,
    fail,
    finishSuccess,
    responseHeaders,
    serverTiming,
    totalDurationMs,
  };
}
