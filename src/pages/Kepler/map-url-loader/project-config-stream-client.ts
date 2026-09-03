export type MapConfigStreamFailureClass =
  | "headers"
  | "body"
  | "parse"
  | "revision_changed"
  | "navigation_abort";

export type MapConfigStreamAttemptOutcome = "success" | "retry" | "error" | "aborted";

export type MapConfigStreamAttemptTrace = {
  attempt: 1 | 2;
  revision: number | null;
  expectedSizeBytes: number | null;
  receivedBytes: number;
  responseStartMs: number;
  bodyDurationMs: number;
  parseDurationMs: number;
  failureClass: MapConfigStreamFailureClass | null;
  retryScheduled: boolean;
  outcome: MapConfigStreamAttemptOutcome;
  code: string | null;
};

export type LoadedProjectConfigStream = {
  config: unknown;
  projectId: number | null;
  revision: number | null;
  schemaName: string | null;
  schemaVersion: number | null;
  sizeBytes: number;
  correlationId: string | null;
  attemptCount: 1 | 2;
};

type MapConfigStreamErrorOptions = {
  code: string;
  category?: string;
  retryable?: boolean;
  status?: number | null;
  correlationId?: string | null;
  failureClass: MapConfigStreamFailureClass;
  revision?: number | null;
  expectedSizeBytes?: number | null;
  receivedBytes?: number;
  bodyDurationMs?: number;
  parseDurationMs?: number;
};

export class MapConfigStreamError extends Error {
  code: string;
  category: string;
  retryable: boolean;
  status: number | null;
  correlationId: string | null;
  failureClass: MapConfigStreamFailureClass;
  revision: number | null;
  expectedSizeBytes: number | null;
  receivedBytes: number;
  bodyDurationMs: number;
  parseDurationMs: number;

  constructor(message: string, options: MapConfigStreamErrorOptions) {
    super(message);
    this.name = "MapConfigStreamError";
    this.code = options.code;
    this.category = options.category || "MAP_CONFIG_LOAD";
    this.retryable = Boolean(options.retryable);
    this.status = Number.isFinite(Number(options.status)) ? Number(options.status) : null;
    this.correlationId = options.correlationId || null;
    this.failureClass = options.failureClass;
    this.revision = Number.isInteger(options.revision) ? Number(options.revision) : null;
    this.expectedSizeBytes = Number.isInteger(options.expectedSizeBytes)
      ? Number(options.expectedSizeBytes)
      : null;
    this.receivedBytes = Number.isFinite(options.receivedBytes)
      ? Number(options.receivedBytes)
      : 0;
    this.bodyDurationMs = Number.isFinite(options.bodyDurationMs)
      ? Math.max(0, Math.round(Number(options.bodyDurationMs)))
      : 0;
    this.parseDurationMs = Number.isFinite(options.parseDurationMs)
      ? Math.max(0, Math.round(Number(options.parseDurationMs)))
      : 0;
  }
}

export function isMapConfigStreamError(error: unknown): error is MapConfigStreamError {
  return error instanceof MapConfigStreamError;
}

function isAbortError(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Carregamento cancelado pela navegação.", "AbortError");
}

function readNonNegativeIntegerHeader(headers: Headers, name: string) {
  const raw = String(headers.get(name) || "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function readPositiveIntegerHeader(headers: Headers, name: string) {
  const value = readNonNegativeIntegerHeader(headers, name);
  return value !== null && value > 0 ? value : null;
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function mapServerErrorCode(code: string | null) {
  if (code === "PROJECT_CONFIG_STREAM_REVISION_CHANGED") {
    return "MAP_CONFIG_STREAM_REVISION_CHANGED";
  }
  if (
    code === "PROJECT_CONFIG_STREAM_START_TIMEOUT" ||
    code === "PROJECT_CONFIG_STREAM_INACTIVITY_TIMEOUT"
  ) {
    return "MAP_CONFIG_STREAM_TIMEOUT";
  }
  return code || "PROJECT_CONFIG_LOAD_FAILED";
}

async function parseSmallErrorResponse(response: Response) {
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const serverCode = payload?.error?.code || payload?.code || null;
  const code = mapServerErrorCode(serverCode);
  const category = payload?.error?.category || payload?.category || "MAP_CONFIG_LOAD";
  const retryableFromPayload = payload?.error?.retryable ?? payload?.retryable;
  const retryableStatus = [408, 425, 429].includes(response.status) || response.status >= 500;
  const revisionChanged = code === "MAP_CONFIG_STREAM_REVISION_CHANGED";
  const timeout = code === "MAP_CONFIG_STREAM_TIMEOUT";
  const correlationId =
    payload?.error?.correlationId ||
    payload?.correlationId ||
    response.headers.get("X-Correlation-Id") ||
    null;
  const message =
    payload?.error?.message ||
    payload?.message ||
    (revisionChanged
      ? "O projeto foi atualizado durante o carregamento. Reabra para carregar a revisão mais recente."
      : "Não foi possível carregar a configuração do projeto.");

  return new MapConfigStreamError(message, {
    code,
    category,
    retryable: revisionChanged
      ? false
      : typeof retryableFromPayload === "boolean"
        ? retryableFromPayload
        : timeout || retryableStatus,
    status: response.status,
    correlationId,
    failureClass: revisionChanged ? "revision_changed" : "headers",
  });
}

async function defaultSleep(ms: number, signal: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Carregamento cancelado pela navegação.", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    else {
      setTimeout(() => signal.removeEventListener("abort", onAbort), ms + 1);
    }
  });
}

function decodeChunks(chunks: Uint8Array[]) {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    text += decoder.decode(chunk, { stream: true });
    chunks[index] = new Uint8Array(0);
  }

  text += decoder.decode();
  return text;
}

async function readCompleteJsonBody(
  response: Response,
  signal: AbortSignal,
  now: () => number,
) {
  const revision = readNonNegativeIntegerHeader(response.headers, "X-Maono-Config-Revision");
  const configSize = readPositiveIntegerHeader(response.headers, "X-Maono-Config-Size");
  const contentLength = readPositiveIntegerHeader(response.headers, "Content-Length");
  const correlationId = response.headers.get("X-Correlation-Id") || null;

  if (configSize !== null && contentLength !== null && configSize !== contentLength) {
    throw new MapConfigStreamError(
      "O servidor informou tamanhos incompatíveis para a configuração do projeto.",
      {
        code: "MAP_CONFIG_STREAM_HEADERS_INVALID",
        retryable: false,
        status: response.status,
        correlationId,
        failureClass: "headers",
        revision,
        expectedSizeBytes: configSize,
      },
    );
  }

  const expectedSizeBytes = configSize ?? contentLength;
  if (expectedSizeBytes === null) {
    throw new MapConfigStreamError(
      "O servidor não informou um tamanho confiável para validar a configuração.",
      {
        code: "MAP_CONFIG_STREAM_HEADERS_INVALID",
        retryable: false,
        status: response.status,
        correlationId,
        failureClass: "headers",
        revision,
      },
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new MapConfigStreamError(
      "O navegador não recebeu um body legível para a configuração do projeto.",
      {
        code: "MAP_CONFIG_STREAM_INTERRUPTED",
        retryable: true,
        status: response.status,
        correlationId,
        failureClass: "body",
        revision,
        expectedSizeBytes,
      },
    );
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  const bodyStartedAt = now();

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    const bodyDurationMs = now() - bodyStartedAt;
    if (isAbortError(error, signal)) throw error;
    try {
      await reader.cancel(error);
    } catch {
      // Best effort only: the original transport error is more useful.
    }
    throw new MapConfigStreamError(
      "O carregamento foi interrompido antes de receber todos os dados do projeto.",
      {
        code: "MAP_CONFIG_STREAM_INTERRUPTED",
        retryable: true,
        status: response.status,
        correlationId,
        failureClass: "body",
        revision,
        expectedSizeBytes,
        receivedBytes,
        bodyDurationMs,
      },
    );
  }

  const bodyDurationMs = now() - bodyStartedAt;
  if (receivedBytes < expectedSizeBytes) {
    throw new MapConfigStreamError(
      "O carregamento terminou antes de receber todos os bytes esperados do projeto.",
      {
        code: "MAP_CONFIG_STREAM_INTERRUPTED",
        retryable: true,
        status: response.status,
        correlationId,
        failureClass: "body",
        revision,
        expectedSizeBytes,
        receivedBytes,
        bodyDurationMs,
      },
    );
  }

  if (receivedBytes > expectedSizeBytes) {
    throw new MapConfigStreamError(
      "O carregamento recebeu mais bytes do que o tamanho publicado do projeto.",
      {
        code: "MAP_CONFIG_STREAM_LENGTH_MISMATCH",
        retryable: false,
        status: response.status,
        correlationId,
        failureClass: "body",
        revision,
        expectedSizeBytes,
        receivedBytes,
        bodyDurationMs,
      },
    );
  }

  throwIfAborted(signal);
  const text = decodeChunks(chunks);
  const parseStartedAt = now();
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    const parseDurationMs = now() - parseStartedAt;
    throw new MapConfigStreamError(
      "A configuração armazenada foi recebida por completo, mas o JSON é inválido.",
      {
        code: "MAP_CONFIG_STORED_JSON_INVALID",
        retryable: false,
        status: response.status,
        correlationId,
        failureClass: "parse",
        revision,
        expectedSizeBytes,
        receivedBytes,
        bodyDurationMs,
        parseDurationMs,
      },
    );
  }

  return {
    config,
    revision,
    expectedSizeBytes,
    receivedBytes,
    bodyDurationMs: Math.max(0, Math.round(bodyDurationMs)),
    parseDurationMs: Math.max(0, Math.round(now() - parseStartedAt)),
  };
}

function emitAttempt(
  callback: ((trace: MapConfigStreamAttemptTrace) => void) | undefined,
  trace: MapConfigStreamAttemptTrace,
) {
  if (!callback) return;
  try {
    callback(trace);
  } catch {
    // Observability must never break project loading.
  }
}

type ProjectConfigStreamOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
  onAttempt?: (trace: MapConfigStreamAttemptTrace) => void;
};

export async function loadProjectConfigStream(
  projectSlug: string,
  signal: AbortSignal,
  options: ProjectConfigStreamOptions = {},
): Promise<LoadedProjectConfigStream> {
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || defaultSleep;
  const random = options.random || Math.random;
  const now = options.now || nowMs;
  let pinnedRevision: number | null = null;

  for (let attempt = 1 as 1 | 2; attempt <= 2; attempt = (attempt + 1) as 1 | 2) {
    throwIfAborted(signal);
    const attemptStartedAt = now();
    let response: Response | null = null;
    let responseRevision: number | null = pinnedRevision;

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (pinnedRevision !== null) {
        headers["X-Maono-Expected-Config-Revision"] = String(pinnedRevision);
      }

      response = await fetchImpl(`/api/projects/${encodeURIComponent(projectSlug)}/config-stream`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers,
        signal,
      });

      const responseStartMs = Math.max(0, Math.round(now() - attemptStartedAt));
      responseRevision = readNonNegativeIntegerHeader(
        response.headers,
        "X-Maono-Config-Revision",
      );

      if (!response.ok) {
        const error = await parseSmallErrorResponse(response);
        const retryScheduled = error.retryable && attempt === 1;
        emitAttempt(options.onAttempt, {
          attempt,
          revision: responseRevision,
          expectedSizeBytes: error.expectedSizeBytes,
          receivedBytes: error.receivedBytes,
          responseStartMs,
          bodyDurationMs: error.bodyDurationMs,
          parseDurationMs: error.parseDurationMs,
          failureClass: error.failureClass,
          retryScheduled,
          outcome: retryScheduled ? "retry" : "error",
          code: error.code,
        });
        if (!retryScheduled) throw error;

        const delayMs = 500 + Math.round(random() * 500);
        await sleep(delayMs, signal);
        continue;
      }

      if (response.headers.get("X-Maono-Config-Transport") !== "stream") {
        throw new MapConfigStreamError(
          "O servidor não confirmou o transporte seguro da configuração.",
          {
            code: "MAP_CONFIG_STREAM_HEADERS_INVALID",
            retryable: false,
            status: response.status,
            correlationId: response.headers.get("X-Correlation-Id"),
            failureClass: "headers",
            revision: responseRevision,
          },
        );
      }

      try {
        const body = await readCompleteJsonBody(response, signal, now);
        emitAttempt(options.onAttempt, {
          attempt,
          revision: body.revision,
          expectedSizeBytes: body.expectedSizeBytes,
          receivedBytes: body.receivedBytes,
          responseStartMs,
          bodyDurationMs: body.bodyDurationMs,
          parseDurationMs: body.parseDurationMs,
          failureClass: null,
          retryScheduled: false,
          outcome: "success",
          code: null,
        });

        return {
          config: body.config,
          projectId: readNonNegativeIntegerHeader(response.headers, "X-Maono-Project-Id"),
          revision: body.revision,
          schemaName: response.headers.get("X-Maono-Config-Schema") || null,
          schemaVersion: readNonNegativeIntegerHeader(
            response.headers,
            "X-Maono-Config-Schema-Version",
          ),
          sizeBytes: body.receivedBytes,
          correlationId: response.headers.get("X-Correlation-Id") || null,
          attemptCount: attempt,
        };
      } catch (error) {
        if (isAbortError(error, signal)) {
          emitAttempt(options.onAttempt, {
            attempt,
            revision: responseRevision,
            expectedSizeBytes: null,
            receivedBytes: 0,
            responseStartMs,
            bodyDurationMs: 0,
            parseDurationMs: 0,
            failureClass: "navigation_abort",
            retryScheduled: false,
            outcome: "aborted",
            code: null,
          });
          throw error;
        }

        const normalized = isMapConfigStreamError(error)
          ? error
          : new MapConfigStreamError("Falha ao processar a configuração recebida.", {
              code: "MAP_CONFIG_CLIENT_PARSE_FAILED",
              retryable: false,
              status: response.status,
              correlationId: response.headers.get("X-Correlation-Id"),
              failureClass: "parse",
              revision: responseRevision,
            });
        const retryScheduled = normalized.retryable && attempt === 1;
        emitAttempt(options.onAttempt, {
          attempt,
          revision: normalized.revision ?? responseRevision,
          expectedSizeBytes: normalized.expectedSizeBytes,
          receivedBytes: normalized.receivedBytes,
          responseStartMs,
          bodyDurationMs: normalized.bodyDurationMs,
          parseDurationMs: normalized.parseDurationMs,
          failureClass: normalized.failureClass,
          retryScheduled,
          outcome: retryScheduled ? "retry" : "error",
          code: normalized.code,
        });

        if (!retryScheduled) throw normalized;
        if (responseRevision !== null) pinnedRevision = responseRevision;
        const delayMs = 500 + Math.round(random() * 500);
        await sleep(delayMs, signal);
      }
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      if (isMapConfigStreamError(error)) throw error;

      const responseStartMs = Math.max(0, Math.round(now() - attemptStartedAt));
      const transportError = new MapConfigStreamError(
        "Não foi possível concluir a transferência da configuração do projeto.",
        {
          code: "MAP_CONFIG_STREAM_INTERRUPTED",
          retryable: true,
          status: response?.status ?? null,
          correlationId: response?.headers.get("X-Correlation-Id") || null,
          failureClass: "headers",
          revision: responseRevision,
        },
      );
      const retryScheduled = attempt === 1;
      emitAttempt(options.onAttempt, {
        attempt,
        revision: responseRevision,
        expectedSizeBytes: null,
        receivedBytes: 0,
        responseStartMs,
        bodyDurationMs: 0,
        parseDurationMs: 0,
        failureClass: "headers",
        retryScheduled,
        outcome: retryScheduled ? "retry" : "error",
        code: transportError.code,
      });
      if (!retryScheduled) throw transportError;
      const delayMs = 500 + Math.round(random() * 500);
      await sleep(delayMs, signal);
    }
  }

  throw new MapConfigStreamError("Não foi possível carregar a configuração do projeto.", {
    code: "MAP_CONFIG_STREAM_INTERRUPTED",
    retryable: false,
    failureClass: "body",
  });
}
