import {
  ApiError,
  getApiErrorContract,
  getResponseErrorReference,
  withErrorReference,
  type ApiErrorDiagnostic,
} from "./error-contract";
import { normalizeUserError } from "./user-error-catalog";

export type ParsedJsonBody = {
  valid: boolean;
  data: unknown;
};

function buildHeaders(
  initHeaders: HeadersInit | undefined,
  options: { json?: boolean } = {},
): Headers {
  const headers = new Headers(initHeaders);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (options.json && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

function inferCategoryFromStatus(
  status: number,
): ApiErrorDiagnostic["category"] {
  if (status === 401) return "AUTH";
  if (status === 403) return "PERMISSION";
  if (status === 404 || status === 409) return "PROJECT";
  return status >= 500 ? "INFRASTRUCTURE" : undefined;
}

function inferRetryableFromStatus(status: number) {
  return [408, 425, 429, 502, 503, 504].includes(status);
}

export function isAbortError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError",
  );
}

export async function parseResponseJson(
  response: Response,
): Promise<ParsedJsonBody> {
  if (response.status === 204 || response.status === 205) {
    return { valid: true, data: null };
  }

  try {
    return { valid: true, data: await response.json() };
  } catch {
    return { valid: false, data: null };
  }
}

export function buildHttpApiError(
  statusValue: number,
  data: unknown,
  overrides: Partial<ApiErrorDiagnostic> = {},
  reference?: string | null,
): ApiError {
  const contract = getApiErrorContract(data);
  const status = Number(overrides.status ?? statusValue ?? 500);
  const diagnostic = withErrorReference(
    {
      ...contract,
      ...overrides,
      status,
      code: overrides.code ?? contract.code,
      category:
        overrides.category ??
        contract.category ??
        inferCategoryFromStatus(status),
      retryable:
        overrides.retryable ??
        contract.retryable ??
        inferRetryableFromStatus(status),
      details: overrides.details ?? contract.details,
    },
    reference,
  );
  const presentation = normalizeUserError(diagnostic);

  return new ApiError(diagnostic, data, presentation.message);
}

export function buildApiError(
  response: Response,
  data: unknown,
  overrides: Partial<ApiErrorDiagnostic> = {},
): ApiError {
  return buildHttpApiError(
    response.status,
    data,
    overrides,
    getResponseErrorReference(response),
  );
}

export function buildClientApiError(
  diagnostic: ApiErrorDiagnostic,
  payload: unknown = null,
): ApiError {
  const presentation = normalizeUserError(diagnostic);
  return new ApiError(diagnostic, payload, presentation.message);
}

export async function fetchWithNetworkGuard(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw buildClientApiError({
      status: 503,
      code: "INFRASTRUCTURE_NETWORK_FAILURE",
      category: "INFRASTRUCTURE",
      retryable: true,
    });
  }
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const parsed = await parseResponseJson(response);

  if (!response.ok) {
    throw buildApiError(response, parsed.valid ? parsed.data : null);
  }

  if (!parsed.valid) {
    throw buildApiError(response, null, {
      status: 502,
      code: "INFRASTRUCTURE_UNEXPECTED_ERROR",
      category: "INFRASTRUCTURE",
      retryable: true,
    });
  }

  return parsed.data as T;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchWithNetworkGuard(url, {
    ...init,
    credentials: "include",
    headers: buildHeaders(init.headers, { json: true }),
  });

  return parseJsonResponse<T>(response);
}

export async function requestFormDataJson<T>(
  url: string,
  formData: FormData,
  init: Omit<RequestInit, "body" | "method"> = {},
): Promise<T> {
  const response = await fetchWithNetworkGuard(url, {
    ...init,
    method: "POST",
    credentials: "include",
    body: formData,
    headers: buildHeaders(init.headers),
  });

  return parseJsonResponse<T>(response);
}
