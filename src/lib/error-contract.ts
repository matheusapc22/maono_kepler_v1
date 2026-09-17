export type ErrorCategory =
  | "AUTH"
  | "PERMISSION"
  | "PROJECT"
  | "MAP_CONFIG"
  | "STORAGE"
  | "PERFORMANCE"
  | "SPATIAL"
  | "ENGINE"
  | "INFRASTRUCTURE";

export type ApiErrorContract = {
  code: string;
  category: ErrorCategory;
  retryable: boolean;
  correlationId: string;
  message?: string;
  details?: unknown;
};

export type ApiErrorDiagnostic = {
  status: number;
  code?: string;
  category?: ErrorCategory;
  retryable: boolean;
  correlationId?: string;
  details?: unknown;
};

const SAFE_API_ERROR_MESSAGE = "Não foi possível concluir esta ação.";
const ERROR_CATEGORIES = new Set<ErrorCategory>([
  "AUTH",
  "PERMISSION",
  "PROJECT",
  "MAP_CONFIG",
  "STORAGE",
  "PERFORMANCE",
  "SPATIAL",
  "ENGINE",
  "INFRASTRUCTURE",
]);

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function categoryField(record: Record<string, unknown>, key: string) {
  const value = stringField(record, key) as ErrorCategory | undefined;
  return value && ERROR_CATEGORIES.has(value) ? value : undefined;
}

export function getApiErrorContract(payload: unknown): Partial<ApiErrorContract> {
  if (!payload || typeof payload !== "object") return {};

  const envelope = payload as Record<string, unknown>;
  const errorValue = envelope["error"];
  if (!errorValue || typeof errorValue !== "object") {
    return {
      code: stringField(envelope, "code"),
    };
  }

  const error = errorValue as Record<string, unknown>;
  return {
    code: stringField(error, "code"),
    category: categoryField(error, "category"),
    retryable: booleanField(error, "retryable"),
    correlationId: stringField(error, "correlationId"),
    message: stringField(error, "message"),
    details: error["details"],
  };
}

export class ApiError extends Error {
  status: number;
  code?: string;
  category?: ErrorCategory;
  retryable: boolean;
  correlationId?: string;
  details?: unknown;
  payload: unknown;

  constructor(
    diagnostic: ApiErrorDiagnostic,
    payload: unknown = null,
    publicMessage = SAFE_API_ERROR_MESSAGE,
  ) {
    super(publicMessage || SAFE_API_ERROR_MESSAGE);
    this.name = "ApiError";
    this.status = diagnostic.status;
    this.code = diagnostic.code;
    this.category = diagnostic.category;
    this.retryable = diagnostic.retryable === true;
    this.correlationId = diagnostic.correlationId;
    this.details = diagnostic.details;
    this.payload = payload;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function apiErrorDiagnostic(
  value: unknown,
): ApiErrorDiagnostic | null {
  if (isApiError(value)) {
    return {
      status: value.status,
      code: value.code,
      category: value.category,
      retryable: value.retryable,
      correlationId: value.correlationId,
      details: value.details,
    };
  }

  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const status = Number(candidate["status"] ?? 0);
  const retryable = candidate["retryable"] === true;
  const code = stringField(candidate, "code");
  const category = categoryField(candidate, "category");
  const correlationId = stringField(candidate, "correlationId");

  if (!status && !code && !category && !correlationId) return null;

  return {
    status: Number.isFinite(status) ? status : 0,
    code,
    category,
    retryable,
    correlationId,
    details: candidate["details"],
  };
}
