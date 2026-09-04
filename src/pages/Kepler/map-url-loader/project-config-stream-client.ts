export type MapConfigStreamFailureClass =
  | "headers"
  | "body"
  | "parse"
  | "revision_changed"
  | "navigation_abort";

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
  outcome: "success" | "retry" | "error" | "aborted";
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

type ErrorOptions = {
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

type DirectDescriptor = {
  downloadUrl: string;
  projectId: number | null;
  revision: number;
  sizeBytes: number;
  schemaName: string | null;
  schemaVersion: number | null;
  correlationId: string | null;
};

type BodyMetadata = {
  revision?: number | null;
  expectedSizeBytes?: number | null;
  correlationId?: string | null;
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

  constructor(message: string, options: ErrorOptions) {
    super(message);
    this.name = "MapConfigStreamError";
    this.code = options.code;
    this.category = options.category || "MAP_CONFIG_LOAD";
    this.retryable = Boolean(options.retryable);
    this.status = finiteNumber(options.status);
    this.correlationId = options.correlationId || null;
    this.failureClass = options.failureClass;
    this.revision = integerOrNull(options.revision);
    this.expectedSizeBytes = integerOrNull(options.expectedSizeBytes);
    this.receivedBytes = finiteNumber(options.receivedBytes) ?? 0;
    this.bodyDurationMs = roundedDuration(options.bodyDurationMs);
    this.parseDurationMs = roundedDuration(options.parseDurationMs);
  }
}

export function isMapConfigStreamError(error: unknown): error is MapConfigStreamError {
  return error instanceof MapConfigStreamError;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function integerOrNull(value: unknown) {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function positiveIntegerOrNull(value: unknown) {
  const number = integerOrNull(value);
  return number !== null && number > 0 ? number : null;
}

function roundedDuration(value: unknown) {
  const number = finiteNumber(value);
  return number === null ? 0 : Math.round(number);
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Carregamento cancelado pela navegação.", "AbortError");
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError(signal);
}

function isAbort(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function headerInteger(headers: Headers, name: string, positiveOnly = false) {
  const raw = String(headers.get(name) || "").trim();
  if (!raw) return null;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 0) return null;
  return positiveOnly && number === 0 ? null : number;
}

function serverCode(code: string | null) {
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

async function apiError(response: Response) {
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const workerResourceLimit =
    payload?.cloudflare_error === true && Number(payload?.error_code) === 1102;
  const code = workerResourceLimit
    ? "MAP_CONFIG_WORKER_RESOURCE_LIMIT"
    : serverCode(payload?.error?.code || payload?.code || null);
  const revisionChanged = code === "MAP_CONFIG_STREAM_REVISION_CHANGED";
  const timeout = code === "MAP_CONFIG_STREAM_TIMEOUT";
  const retryablePayload = payload?.error?.retryable ?? payload?.retryable;
  const retryableStatus = [408, 425, 429].includes(response.status) || response.status >= 500;

  return new MapConfigStreamError(
    workerResourceLimit
      ? "O Worker excedeu o limite de recursos ao preparar o carregamento do projeto."
      : payload?.error?.message ||
        payload?.message ||
        (revisionChanged
          ? "O projeto foi atualizado durante o carregamento. Reabra para carregar a revisão mais recente."
          : "Não foi possível carregar a configuração do projeto."),
    {
      code,
      category: workerResourceLimit
        ? "INFRASTRUCTURE"
        : payload?.error?.category || payload?.category || "MAP_CONFIG_LOAD",
      retryable: workerResourceLimit
        ? false
        : revisionChanged
          ? false
          : typeof retryablePayload === "boolean"
            ? retryablePayload
            : timeout || retryableStatus,
      status: response.status,
      correlationId:
        payload?.error?.correlationId ||
        payload?.correlationId ||
        response.headers.get("X-Correlation-Id"),
      failureClass: revisionChanged ? "revision_changed" : "headers",
    },
  );
}

async function defaultSleep(ms: number, signal: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function decodeAfterCompletenessCheck(chunks: Uint8Array[]) {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  for (let index = 0; index < chunks.length; index += 1) {
    text += decoder.decode(chunks[index], { stream: true });
    chunks[index] = new Uint8Array(0);
  }
  return text + decoder.decode();
}

async function readCompleteJsonBody(
  response: Response,
  signal: AbortSignal,
  now: () => number,
  metadata: BodyMetadata = {},
) {
  const metadataRevision = integerOrNull(metadata.revision);
  const revision = metadataRevision ?? headerInteger(response.headers, "X-Maono-Config-Revision");
  const metadataSize = positiveIntegerOrNull(metadata.expectedSizeBytes);
  const configSize = metadataSize ?? headerInteger(response.headers, "X-Maono-Config-Size", true);
  const contentLength = headerInteger(response.headers, "Content-Length", true);
  const correlationId =
    metadata.correlationId || response.headers.get("X-Correlation-Id") || null;

  if (
    metadataSize === null &&
    configSize !== null &&
    contentLength !== null &&
    configSize !== contentLength
  ) {
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

  const expectedSizeBytes = metadataSize ?? configSize ?? contentLength;
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
  const cancelForNavigation = () => {
    Promise.resolve(reader.cancel(abortError(signal))).catch(() => undefined);
  };
  signal.addEventListener("abort", cancelForNavigation, { once: true });

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
    if (isAbort(error, signal)) throw error;
    try {
      await reader.cancel(error);
    } catch {
      // Upstream cancellation is best effort after a transport failure.
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
  } finally {
    signal.removeEventListener("abort", cancelForNavigation);
  }

  throwIfAborted(signal);
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

  const text = decodeAfterCompletenessCheck(chunks);
  const parseStartedAt = now();
  try {
    return {
      config: JSON.parse(text),
      revision,
      expectedSizeBytes,
      receivedBytes,
      bodyDurationMs: roundedDuration(bodyDurationMs),
      parseDurationMs: roundedDuration(now() - parseStartedAt),
    };
  } catch {
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
        parseDurationMs: now() - parseStartedAt,
      },
    );
  }
}

async function readDirectDescriptor(response: Response): Promise<DirectDescriptor> {
  if (response.headers.get("X-Maono-Config-Transport") !== "direct") {
    try {
      await response.body?.cancel();
    } catch {
      // Deploy drift guard: cancel legacy proxy body without turning it into a fallback.
    }
    throw new MapConfigStreamError(
      "O backend ainda não disponibiliza a entrega direta da configuração.",
      {
        code: "MAP_CONFIG_DIRECT_DELIVERY_UNAVAILABLE",
        retryable: false,
        status: response.status,
        correlationId: response.headers.get("X-Correlation-Id"),
        failureClass: "headers",
        revision: headerInteger(response.headers, "X-Maono-Config-Revision"),
      },
    );
  }

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const downloadUrl = String(payload?.downloadUrl || "").trim();
  const revision = integerOrNull(payload?.revision);
  const sizeBytes = positiveIntegerOrNull(payload?.sizeBytes);
  let validUrl = false;
  try {
    validUrl = new URL(downloadUrl).protocol === "https:";
  } catch {
    validUrl = false;
  }

  if (!validUrl || revision === null || sizeBytes === null) {
    throw new MapConfigStreamError(
      "O backend retornou um descriptor de download inválido.",
      {
        code: "MAP_CONFIG_DIRECT_DESCRIPTOR_INVALID",
        retryable: false,
        status: response.status,
        correlationId:
          payload?.correlationId || response.headers.get("X-Correlation-Id"),
        failureClass: "headers",
        revision,
        expectedSizeBytes: sizeBytes,
      },
    );
  }

  return {
    downloadUrl,
    projectId: integerOrNull(payload?.projectId),
    revision,
    sizeBytes,
    schemaName: typeof payload?.schemaName === "string" ? payload.schemaName : null,
    schemaVersion: integerOrNull(payload?.schemaVersion),
    correlationId:
      payload?.correlationId || response.headers.get("X-Correlation-Id") || null,
  };
}

function emitAttempt(
  callback: ((trace: MapConfigStreamAttemptTrace) => void) | undefined,
  trace: MapConfigStreamAttemptTrace,
) {
  try {
    callback?.(trace);
  } catch {
    // Observability never changes the load result.
  }
}

type ProjectConfigStreamOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
  correlationId?: string | null;
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

  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    const attempt = attemptNumber as 1 | 2;
    throwIfAborted(signal);
    const attemptStartedAt = now();
    let response: Response | null = null;
    let responseRevision: number | null = pinnedRevision;

    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (options.correlationId) headers["X-Correlation-Id"] = options.correlationId;
      if (pinnedRevision !== null) {
        headers["X-Maono-Expected-Config-Revision"] = String(pinnedRevision);
      }

      response = await fetchImpl(
        `/api/projects/${encodeURIComponent(projectSlug)}/config-stream?delivery=direct`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers,
          signal,
        },
      );

      const responseStartMs = roundedDuration(now() - attemptStartedAt);
      responseRevision = headerInteger(response.headers, "X-Maono-Config-Revision");

      if (!response.ok) {
        const error = await apiError(response);
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
        await sleep(500 + Math.round(random() * 500), signal);
        continue;
      }

      const descriptor = await readDirectDescriptor(response);
      responseRevision = descriptor.revision;
      if (pinnedRevision !== null && descriptor.revision !== pinnedRevision) {
        throw new MapConfigStreamError(
          "A revisão publicada mudou durante a repetição do carregamento.",
          {
            code: "MAP_CONFIG_STREAM_REVISION_CHANGED",
            retryable: false,
            status: 409,
            correlationId: descriptor.correlationId,
            failureClass: "revision_changed",
            revision: descriptor.revision,
            expectedSizeBytes: descriptor.sizeBytes,
          },
        );
      }

      try {
        const downloadResponse = await fetchImpl(descriptor.downloadUrl, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal,
        });

        if (!downloadResponse.ok) {
          const retryableStatus =
            [408, 425, 429].includes(downloadResponse.status) || downloadResponse.status >= 500;
          throw new MapConfigStreamError(
            "O storage não conseguiu entregar a configuração do projeto.",
            {
              code: "MAP_CONFIG_DIRECT_DOWNLOAD_FAILED",
              retryable: retryableStatus,
              status: downloadResponse.status,
              correlationId: descriptor.correlationId,
              failureClass: "headers",
              revision: descriptor.revision,
              expectedSizeBytes: descriptor.sizeBytes,
            },
          );
        }

        const body = await readCompleteJsonBody(downloadResponse, signal, now, {
          revision: descriptor.revision,
          expectedSizeBytes: descriptor.sizeBytes,
          correlationId: descriptor.correlationId,
        });
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
          projectId: descriptor.projectId,
          revision: body.revision,
          schemaName: descriptor.schemaName,
          schemaVersion: descriptor.schemaVersion,
          sizeBytes: body.receivedBytes,
          correlationId: descriptor.correlationId,
          attemptCount: attempt,
        };
      } catch (error) {
        if (isAbort(error, signal)) {
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
          : new MapConfigStreamError(
              "Não foi possível acessar diretamente a configuração no storage.",
              {
                code: "MAP_CONFIG_DIRECT_DOWNLOAD_FAILED",
                retryable: true,
                status: null,
                correlationId: descriptor.correlationId,
                failureClass: "headers",
                revision: descriptor.revision,
                expectedSizeBytes: descriptor.sizeBytes,
              },
            );
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
        pinnedRevision = descriptor.revision;
        await sleep(500 + Math.round(random() * 500), signal);
      }
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      if (isMapConfigStreamError(error)) throw error;

      const transportError = new MapConfigStreamError(
        "Não foi possível preparar a entrega direta da configuração do projeto.",
        {
          code: "MAP_CONFIG_DIRECT_DELIVERY_FAILED",
          retryable: true,
          status: response?.status ?? null,
          correlationId:
            response?.headers.get("X-Correlation-Id") || options.correlationId || null,
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
        responseStartMs: roundedDuration(now() - attemptStartedAt),
        bodyDurationMs: 0,
        parseDurationMs: 0,
        failureClass: "headers",
        retryScheduled,
        outcome: retryScheduled ? "retry" : "error",
        code: transportError.code,
      });
      if (!retryScheduled) throw transportError;
      await sleep(500 + Math.round(random() * 500), signal);
    }
  }

  throw new MapConfigStreamError("Não foi possível carregar a configuração do projeto.", {
    code: "MAP_CONFIG_DIRECT_DELIVERY_FAILED",
    retryable: false,
    failureClass: "body",
  });
}
