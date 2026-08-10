export type SessionHealth =
  | "loading"
  | "healthy"
  | "degraded"
  | "unauthenticated";

export type SessionResponseDisposition =
  | "apply"
  | "preserve"
  | "unauthenticated";

export type SessionResponsePolicy = {
  disposition: SessionResponseDisposition;
  health: SessionHealth;
};

export type SessionFetchResult = {
  response: Response;
  attempts: number;
};

export const SESSION_REQUEST_TIMEOUT_MS = 8_000;
export const SESSION_RETRY_DELAYS_MS = Object.freeze([300, 900] as const);

export class SessionRequestTimeoutError extends Error {
  constructor(message = "A atualização da sessão excedeu o tempo limite.") {
    super(message);
    this.name = "SessionRequestTimeoutError";
  }
}

function createAbortError() {
  const error = new Error("Session request aborted.");
  error.name = "AbortError";
  return error;
}

export function isSessionRequestAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function isRetryableSessionStatus(status: number) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

export function classifySessionResponse(
  status: number,
  hasKnownAuthenticatedSession: boolean,
): SessionResponsePolicy {
  if (status >= 200 && status < 300) {
    return {
      disposition: "apply",
      health: "healthy",
    };
  }

  if (status === 401) {
    return {
      disposition: "unauthenticated",
      health: "unauthenticated",
    };
  }

  if (status === 403) {
    return {
      disposition: "preserve",
      health: hasKnownAuthenticatedSession ? "healthy" : "degraded",
    };
  }

  return {
    disposition: "preserve",
    health: "degraded",
  };
}

type WaitFunction = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>;

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function waitForDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, Math.max(0, milliseconds));

    function handleAbort() {
      globalThis.clearTimeout(timeoutId);
      reject(createAbortError());
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function fetchWithTimeout({
  url,
  init,
  fetchImpl,
  timeoutMs,
  signal,
}: {
  url: string;
  init: RequestInit;
  fetchImpl: FetchFunction;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
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
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw createAbortError();
    }

    if (timedOut) {
      throw new SessionRequestTimeoutError();
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", handleExternalAbort);
  }
}

export async function fetchSessionResponseWithRetry({
  url = "/api/session",
  fetchImpl = globalThis.fetch.bind(globalThis),
  signal,
  timeoutMs = SESSION_REQUEST_TIMEOUT_MS,
  retryDelaysMs = SESSION_RETRY_DELAYS_MS,
  waitImpl = waitForDelay,
}: {
  url?: string;
  fetchImpl?: FetchFunction;
  signal?: AbortSignal;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  waitImpl?: WaitFunction;
} = {}): Promise<SessionFetchResult> {
  const totalAttempts = retryDelaysMs.length + 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout({
        url,
        fetchImpl,
        timeoutMs,
        signal,
        init: {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        },
      });

      if (
        isRetryableSessionStatus(response.status) &&
        attempt < retryDelaysMs.length
      ) {
        await waitImpl(retryDelaysMs[attempt] ?? 0, signal);
        continue;
      }

      return {
        response,
        attempts: attempt + 1,
      };
    } catch (error) {
      if (isSessionRequestAbort(error)) {
        throw error;
      }

      lastError = error;

      if (attempt >= retryDelaysMs.length) {
        throw error;
      }

      await waitImpl(retryDelaysMs[attempt] ?? 0, signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Não foi possível atualizar a sessão.");
}
