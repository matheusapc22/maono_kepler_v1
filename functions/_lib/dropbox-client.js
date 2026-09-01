import { requireEnv } from "./http.js";
import { createMaonoError } from "./maono-error.js";

const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 5_000;
const TOKEN_TIMEOUT_MS = 4_000;
const DEFAULT_BUDGET_MS = 15_000;
const RESPONSE_RESERVE_MS = 1_500;
const TOKEN_SAFETY_WINDOW_MS = 60_000;
const MAX_RETRIES = 3;
const CLIENTS = new WeakMap();

function nowMs() {
  return Date.now();
}

function clampInteger(value, fallback, min = 0, max = 120_000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function parseRetryAfter(value, now = nowMs()) {
  const text = String(value || "").trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }
  const dateMs = Date.parse(text);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - now);
}

function defaultRetryDelay(retryIndex, random = Math.random) {
  const windows = [
    [250, 500],
    [750, 1_500],
    [1_500, 3_000],
  ];
  const [min, max] = windows[Math.min(retryIndex, windows.length - 1)];
  const unit = Math.max(0, Math.min(1, Number(random()) || 0));
  return Math.round(min + unit * (max - min));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function providerRequestId(response) {
  return response?.headers?.get?.("x-dropbox-request-id") || null;
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function isCanonicalDropboxError(error) {
  return String(error?.code || "").startsWith("DROPBOX_");
}

function dropboxError(code, {
  message,
  status,
  retryable,
  operation,
  providerStatus = null,
  attempts = 1,
  providerElapsedMs = 0,
  retryAfterMs = null,
  cause = null,
} = {}) {
  const error = createMaonoError(code, {
    message,
    status,
    retryable,
    details: {
      provider: "dropbox",
      operation,
      providerStatus,
      attempts,
      providerElapsedMs,
      ...(retryAfterMs !== null ? { retryAfterMs } : {}),
    },
    cause,
  });
  error.provider = "dropbox";
  error.providerStatus = providerStatus;
  error.dropboxStatus = providerStatus;
  return error;
}

function terminalErrorForResponse(response, context) {
  const status = Number(response?.status || 0);
  if (status === 401 || status === 403) {
    return dropboxError("DROPBOX_AUTH_FAILED", {
      ...context,
      status: 503,
      providerStatus: status,
      retryable: false,
      message: "A autenticação do storage Dropbox falhou.",
    });
  }
  if (status === 429) {
    return dropboxError("DROPBOX_RATE_LIMITED", {
      ...context,
      status: 429,
      providerStatus: status,
      retryable: true,
      message: "O Dropbox limitou temporariamente as requisições.",
    });
  }
  if ([502, 503, 504].includes(status)) {
    return dropboxError("DROPBOX_UNAVAILABLE", {
      ...context,
      status: 503,
      providerStatus: status,
      retryable: true,
      message: "O Dropbox está temporariamente indisponível.",
    });
  }
  return null;
}

function defaultMetricLogger(metric) {
  console.info("[Maono Dropbox]", metric);
}

export class DropboxClient {
  constructor(env, options = {}) {
    this.env = env;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.sleepFn = options.sleepFn || sleep;
    this.randomFn = options.randomFn || Math.random;
    this.nowFn = options.nowFn || nowMs;
    this.metricFn = options.metricFn || defaultMetricLogger;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.refreshPromise = null;
  }

  emitMetric(payload) {
    const metric = { provider: "dropbox", ...payload };
    try {
      this.metricFn?.(metric);
    } catch {
      // Observabilidade do provider nunca pode alterar o resultado da operação.
    }
    return metric;
  }

  invalidateAccessToken() {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  tokenStillValid() {
    return Boolean(
      this.accessToken &&
      this.accessTokenExpiresAt - this.nowFn() > TOKEN_SAFETY_WINDOW_MS,
    );
  }

  async getAccessToken() {
    if (this.tokenStillValid()) return this.accessToken;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.refreshAccessToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async refreshAccessToken() {
    requireEnv(this.env, [
      "DROPBOX_APP_KEY",
      "DROPBOX_APP_SECRET",
      "DROPBOX_REFRESH_TOKEN",
    ]);

    const response = await this.request({
      operation: "oauth2.token",
      url: DROPBOX_TOKEN_URL,
      auth: false,
      timeoutMs: TOKEN_TIMEOUT_MS,
      buildInit: () => {
        const body = new URLSearchParams();
        body.set("grant_type", "refresh_token");
        body.set("refresh_token", this.env.DROPBOX_REFRESH_TOKEN);
        body.set("client_id", this.env.DROPBOX_APP_KEY);
        body.set("client_secret", this.env.DROPBOX_APP_SECRET);
        return {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        };
      },
    });

    if (!response.ok) {
      throw dropboxError("DROPBOX_AUTH_FAILED", {
        message: "Não foi possível renovar a autenticação do Dropbox.",
        status: 503,
        retryable: false,
        operation: "oauth2.token",
        providerStatus: Number(response.status || 0),
      });
    }

    let data;
    try {
      data = await response.json();
    } catch (cause) {
      throw dropboxError("DROPBOX_AUTH_FAILED", {
        message: "O Dropbox retornou uma resposta de autenticação inválida.",
        status: 503,
        retryable: false,
        operation: "oauth2.token",
        providerStatus: Number(response.status || 0),
        cause,
      });
    }

    const token = String(data?.access_token || "").trim();
    if (!token) {
      throw dropboxError("DROPBOX_AUTH_FAILED", {
        message: "O Dropbox não retornou um access token válido.",
        status: 503,
        retryable: false,
        operation: "oauth2.token",
        providerStatus: Number(response.status || 0),
      });
    }

    const expiresInSeconds = clampInteger(data?.expires_in, 14_400, 60, 86_400);
    this.accessToken = token;
    this.accessTokenExpiresAt = this.nowFn() + expiresInSeconds * 1_000;
    return token;
  }

  async request({
    operation,
    url,
    buildInit,
    auth = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    budgetMs = DEFAULT_BUDGET_MS,
    maxRetries = MAX_RETRIES,
  }) {
    if (typeof this.fetchFn !== "function") {
      throw dropboxError("DROPBOX_UNAVAILABLE", {
        message: "Cliente HTTP indisponível para acessar o Dropbox.",
        status: 503,
        retryable: true,
        operation,
      });
    }
    if (typeof buildInit !== "function") {
      throw new TypeError("DropboxClient.request exige buildInit.");
    }

    const startedAt = this.nowFn();
    const deadlineAt = startedAt + clampInteger(budgetMs, DEFAULT_BUDGET_MS, 1_000);
    const perAttemptTimeout = clampInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 50);
    const retries = clampInteger(maxRetries, MAX_RETRIES, 0, MAX_RETRIES);
    let attempt = 0;
    let lastRetryAfterMs = null;
    let lastFailure = null;

    while (attempt <= retries) {
      attempt += 1;
      const attemptStartedAt = this.nowFn();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), perAttemptTimeout);
      let response = null;
      let outcome = "error";
      let providerStatus = null;
      let timedOut = false;

      try {
        const accessToken = auth ? await this.getAccessToken() : null;
        const init = await buildInit({ accessToken, attempt });
        response = await this.fetchFn(url, { ...init, signal: controller.signal });
        providerStatus = Number(response?.status || 0) || null;
        outcome = response?.ok ? "success" : "response";
      } catch (error) {
        timedOut = controller.signal.aborted || isAbortError(error);
        lastFailure = error;
        outcome = timedOut ? "timeout" : "network_error";
      } finally {
        clearTimeout(timer);
      }

      const attemptDurationMs = Math.max(0, this.nowFn() - attemptStartedAt);
      const elapsedMs = Math.max(0, this.nowFn() - startedAt);

      if (!response && isCanonicalDropboxError(lastFailure)) {
        this.emitMetric({
          event: "dropbox_request_attempt",
          operation,
          attempt,
          status: lastFailure?.providerStatus ?? null,
          outcome: "terminal_error",
          attemptDurationMs,
          providerElapsedMs: elapsedMs,
        });
        this.emitMetric({
          event: "dropbox_request_summary",
          operation,
          attempts: attempt,
          status: lastFailure?.providerStatus ?? null,
          outcome: lastFailure.code,
          providerElapsedMs: elapsedMs,
        });
        throw lastFailure;
      }

      if (!response && lastFailure?.retryable === false) {
        this.emitMetric({
          event: "dropbox_request_attempt",
          operation,
          attempt,
          status: Number(lastFailure?.status || 0) || null,
          outcome: "terminal_error",
          attemptDurationMs,
          providerElapsedMs: elapsedMs,
        });
        throw lastFailure;
      }

      const retryableResponse = response && RETRYABLE_STATUS.has(Number(response.status));
      const retryableFailure = !response && (timedOut || Boolean(lastFailure));

      if (response?.ok) {
        this.emitMetric({
          event: "dropbox_request_attempt",
          operation,
          attempt,
          status: providerStatus,
          outcome: "success",
          attemptDurationMs,
          providerElapsedMs: elapsedMs,
          providerRequestId: providerRequestId(response),
        });
        this.emitMetric({
          event: "dropbox_request_summary",
          operation,
          attempts: attempt,
          status: providerStatus,
          outcome: "success",
          providerElapsedMs: elapsedMs,
        });
        return response;
      }

      if (response && !retryableResponse) {
        if ([401, 403].includes(Number(response.status))) {
          this.invalidateAccessToken();
        }
        const canonical = terminalErrorForResponse(response, {
          operation,
          attempts: attempt,
          providerElapsedMs: elapsedMs,
        });
        this.emitMetric({
          event: "dropbox_request_attempt",
          operation,
          attempt,
          status: providerStatus,
          outcome: canonical ? "terminal_error" : "non_retryable_response",
          attemptDurationMs,
          providerElapsedMs: elapsedMs,
          providerRequestId: providerRequestId(response),
        });
        if (canonical) throw canonical;
        return response;
      }

      const retryAfterMs = response?.status === 429
        ? parseRetryAfter(response.headers?.get?.("retry-after"), this.nowFn())
        : null;
      lastRetryAfterMs = retryAfterMs;
      const retryIndex = attempt - 1;
      const retryDelayMs = retryAfterMs ?? defaultRetryDelay(retryIndex, this.randomFn);
      const remainingMs = Math.max(0, deadlineAt - this.nowFn());
      const willRetry = Boolean(
        (retryableResponse || retryableFailure) &&
        attempt <= retries &&
        remainingMs > retryDelayMs + RESPONSE_RESERVE_MS + 250,
      );

      this.emitMetric({
        event: "dropbox_request_attempt",
        operation,
        attempt,
        status: providerStatus,
        outcome: willRetry ? "retry" : outcome,
        attemptDurationMs,
        retryDelayMs: willRetry ? retryDelayMs : null,
        providerElapsedMs: elapsedMs,
        providerRequestId: providerRequestId(response),
      });

      if (willRetry) {
        await this.sleepFn(retryDelayMs);
        continue;
      }

      const finalElapsedMs = Math.max(0, this.nowFn() - startedAt);
      let terminal;
      if (response) {
        terminal = terminalErrorForResponse(response, {
          operation,
          attempts: attempt,
          providerElapsedMs: finalElapsedMs,
          retryAfterMs: lastRetryAfterMs,
        });
      } else if (timedOut) {
        terminal = dropboxError("DROPBOX_TIMEOUT", {
          message: "O Dropbox excedeu o tempo limite da operação.",
          status: 504,
          retryable: true,
          operation,
          attempts: attempt,
          providerElapsedMs: finalElapsedMs,
          cause: lastFailure,
        });
      } else {
        terminal = dropboxError("DROPBOX_UNAVAILABLE", {
          message: "Não foi possível alcançar o Dropbox.",
          status: 503,
          retryable: true,
          operation,
          attempts: attempt,
          providerElapsedMs: finalElapsedMs,
          cause: lastFailure,
        });
      }

      this.emitMetric({
        event: "dropbox_request_summary",
        operation,
        attempts: attempt,
        status: providerStatus,
        outcome: terminal?.code || "DROPBOX_UNAVAILABLE",
        providerElapsedMs: finalElapsedMs,
      });
      throw terminal;
    }

    throw dropboxError("DROPBOX_UNAVAILABLE", {
      message: "Não foi possível concluir a operação no Dropbox.",
      status: 503,
      retryable: true,
      operation,
      attempts: attempt,
      providerElapsedMs: Math.max(0, this.nowFn() - startedAt),
    });
  }
}

export function createDropboxClient(env, options = {}) {
  return new DropboxClient(env, options);
}

export function getDropboxClient(env) {
  if (!env || (typeof env !== "object" && typeof env !== "function")) {
    return new DropboxClient(env || {});
  }
  let client = CLIENTS.get(env);
  if (!client) {
    client = new DropboxClient(env);
    CLIENTS.set(env, client);
  }
  return client;
}

export const __dropboxClientTesting = Object.freeze({
  parseRetryAfter,
  defaultRetryDelay,
  constants: {
    DEFAULT_TIMEOUT_MS,
    TOKEN_TIMEOUT_MS,
    DEFAULT_BUDGET_MS,
    RESPONSE_RESERVE_MS,
    TOKEN_SAFETY_WINDOW_MS,
    MAX_RETRIES,
  },
});
