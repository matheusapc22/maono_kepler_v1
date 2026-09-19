import { buildClientApiError } from "../lib/api-transport.ts";

export const AUTH_LOGIN_REQUEST_TIMEOUT_MS = 15_000;

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function createAbortError() {
  const error = new Error("Authentication request aborted.");
  error.name = "AbortError";
  return error;
}

export function isAuthRequestAbort(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError",
  );
}

export async function fetchAuthLoginWithDeadline({
  input = "/api/auth/login",
  init,
  signal,
  timeoutMs = AUTH_LOGIN_REQUEST_TIMEOUT_MS,
  fetchImpl = globalThis.fetch.bind(globalThis),
}: {
  input?: RequestInfo | URL;
  init: RequestInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: FetchFunction;
}): Promise<Response> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  const controller = new AbortController();
  let timedOut = false;

  function handleExternalAbort() {
    controller.abort();
  }

  signal?.addEventListener("abort", handleExternalAbort, { once: true });

  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));

  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw createAbortError();
    }

    if (timedOut) {
      throw buildClientApiError({
        status: 408,
        code: "AUTH_LOGIN_TIMEOUT",
        category: "AUTH",
        retryable: true,
      });
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", handleExternalAbort);
  }
}
