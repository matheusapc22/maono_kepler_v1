import { getErrorDefinition } from "./error-catalog.js";
import { isErrorCategory } from "./error-categories.js";

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function inferTechnicalCode(error) {
  const message = String(error?.message || "");
  const status = Number(error?.status || error?.dropboxStatus || 0);

  if (/dropbox/i.test(message)) {
    if (status === 429) return "DROPBOX_RATE_LIMITED";
    if (/token|oauth/i.test(message)) return "DROPBOX_TOKEN_REFRESH_FAILED";
    if (/baixar|download/i.test(message)) return "DROPBOX_DOWNLOAD_FAILED";
    if (/metadata|consultar arquivo/i.test(message)) return "DROPBOX_METADATA_FAILED";
    if (/enviar|upload/i.test(message)) return "DROPBOX_UPLOAD_FAILED";
    return "DROPBOX_UNAVAILABLE";
  }

  if (/\bD1\b|sqlite|database|banco de dados/i.test(message)) {
    return /não configurad|not configured/i.test(message)
      ? "INFRASTRUCTURE_D1_NOT_CONFIGURED"
      : "INFRASTRUCTURE_D1_QUERY_FAILED";
  }

  if (/postgis|postgres/i.test(message)) {
    return "INFRASTRUCTURE_POSTGIS_QUERY_FAILED";
  }

  return null;
}

export function createCorrelationId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getOrCreateCorrelationId(request) {
  const incoming = request?.headers?.get?.("X-Correlation-Id") || "";
  const normalized = String(incoming).trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(normalized)) return normalized;
  return createCorrelationId();
}

export class MaonoError extends Error {
  constructor({
    code,
    message,
    category,
    status,
    retryable,
    correlationId = null,
    details = null,
    cause = null,
  }) {
    const definition = getErrorDefinition(code, status || 500);
    super(message || "Não foi possível concluir a operação.");
    this.name = "MaonoError";
    this.code = definition.code;
    this.category = isErrorCategory(category) ? category : definition.category;
    this.status = Number(status || definition.status || 500);
    this.retryable = booleanOr(retryable, definition.retryable);
    this.correlationId = correlationId || null;
    if (details) this.details = details;
    if (cause) this.cause = cause;
  }
}

export function createMaonoError(code, options = {}) {
  return new MaonoError({ code, ...options });
}

export function normalizeMaonoError(error, options = {}) {
  if (error instanceof MaonoError) {
    if (!error.correlationId && options.correlationId) error.correlationId = options.correlationId;
    return error;
  }

  const technicalCode = inferTechnicalCode(error);
  const fallbackCode =
    error?.code ||
    technicalCode ||
    options.defaultCode ||
    "INFRASTRUCTURE_UNEXPECTED_ERROR";
  const definition = getErrorDefinition(fallbackCode, options.status || error?.status || 500);
  const retryable =
    typeof options.retryable === "boolean"
      ? options.retryable
      : typeof error?.retryable === "boolean"
        ? error.retryable
        : typeof error?.details?.retryable === "boolean"
          ? error.details.retryable
          : definition.retryable;

  return new MaonoError({
    code: fallbackCode,
    message: options.message || error?.message || "Não foi possível concluir a operação.",
    category: options.category || error?.category || definition.category,
    status: options.status || error?.status || definition.status,
    retryable,
    correlationId: options.correlationId || error?.correlationId || null,
    details: options.details || error?.details || null,
    cause: error,
  });
}

export function toPublicError(error, { correlationId = null, includeMessage = true } = {}) {
  const normalized = normalizeMaonoError(error, { correlationId });
  return {
    code: normalized.code,
    category: normalized.category,
    retryable: Boolean(normalized.retryable),
    correlationId: normalized.correlationId || correlationId || createCorrelationId(),
    ...(includeMessage && normalized.message ? { message: normalized.message } : {}),
    ...(normalized.details ? { details: normalized.details } : {}),
  };
}

export function logMaonoError(error, context = {}) {
  const normalized = normalizeMaonoError(error, {
    correlationId: context.correlationId,
  });
  const payload = {
    level: "error",
    correlationId: normalized.correlationId || null,
    code: normalized.code,
    category: normalized.category,
    retryable: Boolean(normalized.retryable),
    status: normalized.status,
    route: context.route || null,
    method: context.method || null,
    organizationId: context.organizationId ?? null,
    projectId: context.projectId ?? null,
    operation: context.operation || null,
    provider: context.provider || null,
  };
  console.error("[Maono error]", payload);
  return normalized;
}
