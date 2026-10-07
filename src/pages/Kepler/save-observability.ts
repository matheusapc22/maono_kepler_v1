export type SaveOperation = "create" | "update";

export const MAONO_SAVE_CLIENT_CONTRACT = 2;
export const MAONO_LARGE_SAVE_THRESHOLD_BYTES = 8 * 1024 * 1024;

export type ClientSaveAttempt = {
  saveId: string;
  correlationId: string;
  operation: SaveOperation;
  startedAt: number;
};

export type SerializedSaveRequest = {
  body: string;
  payloadBytes: number;
  serializeDurationMs: number;
  totalDurationMs: number;
};

export type SerializedMapConfigTransport = SerializedSaveRequest & {
  large: boolean;
  expectedConfigRevision: number;
  headers: Record<string, string>;
};

export type SaveResponseDiagnostics = {
  saveId: string;
  correlationId: string;
  serverTiming: string | null;
  apiContract: string | null;
  apiBuild: string | null;
  dbSchema: string | null;
};

function nowMs() {
  // Wall-clock timestamps survive reload when an attempt is reconstructed.
  return Date.now();
}

function randomId(prefix: "save" | "corr") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function clientBuildId() {
  const viteEnv = import.meta.env ?? {};
  return String(
    viteEnv.VITE_MAONO_CLIENT_BUILD_ID ??
      viteEnv.VITE_COMMIT_SHA ??
      viteEnv.VITE_GIT_COMMIT_SHA ??
      "dev",
  ).slice(0, 120);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertLargeConfigShape(config: unknown) {
  if (!isRecord(config) || !config.version) {
    throw new Error("O MapConfig grande não possui version válida.");
  }
  if (!isRecord(config.config)) {
    throw new Error("O MapConfig grande não possui objeto config válido.");
  }
  if (!Array.isArray(config.datasets)) {
    throw new Error("O MapConfig grande não possui datasets válidos.");
  }

  const available = new Set(
    config.datasets
      .map((dataset: any) =>
        String(dataset?.info?.id ?? dataset?.data?.id ?? dataset?.id ?? "").trim(),
      )
      .filter(Boolean),
  );
  const layers = Array.isArray(config?.config?.visState?.layers)
    ? config.config.visState.layers
    : [];

  for (const layer of layers) {
    const rawDataId = layer?.config?.dataId ?? layer?.dataId;
    const dataIds = Array.isArray(rawDataId) ? rawDataId : [rawDataId];
    for (const candidate of dataIds) {
      const dataId = String(candidate || "").trim();
      if (
        /^maono_analysis_(?:buffer|isochrone)_/.test(dataId) &&
        !available.has(dataId)
      ) {
        throw new Error(
          "A configuração contém uma camada de análise Maõno sem o dataset correspondente.",
        );
      }
    }
  }
}

export function measureUtf8PayloadBytes(value: string) {
  if (typeof Blob !== "undefined") {
    return new Blob([value]).size;
  }
  return new TextEncoder().encode(value).byteLength;
}

export function beginClientSaveAttempt(operation: SaveOperation): ClientSaveAttempt {
  return {
    saveId: randomId("save"),
    correlationId: randomId("corr"),
    operation,
    startedAt: nowMs(),
  };
}

export function serializeMapConfigTransport(
  attempt: ClientSaveAttempt,
  config: unknown,
  expectedConfigRevision: number,
  serializeStartedAt = attempt.startedAt,
): SerializedMapConfigTransport {

  const body = JSON.stringify(config);
  if (typeof body !== "string") {
    throw new Error("Não foi possível serializar a configuração do projeto.");
  }

  const payloadBytes = measureUtf8PayloadBytes(body);
  const large = payloadBytes > MAONO_LARGE_SAVE_THRESHOLD_BYTES;
  if (large) {
    if (!Number.isInteger(expectedConfigRevision) || expectedConfigRevision < 0) {
      throw new Error("A revisão esperada do projeto é inválida para o transporte do MapConfig.");
    }
    assertLargeConfigShape(config);

  }

  const completedAt = nowMs();
  return {
    body,
    payloadBytes,
    large,
    expectedConfigRevision,
    headers: {
      ...buildSaveRequestHeaders(attempt),
      "Content-Type": "application/vnd.maono.map-config+json",
      "X-Maono-Expected-Revision": String(expectedConfigRevision),
      "X-Maono-Config-Size": String(payloadBytes),
      "X-Maono-Config-Schema": "legacy-kepler",
      "X-Maono-Config-Schema-Version": "1",
      "X-Maono-Config-Version": String((config as any)?.version || "").slice(0, 80),
      "X-Maono-Dataset-Count": String(Array.isArray((config as any)?.datasets) ? (config as any).datasets.length : 0),
      ...(large ? { "X-Maono-Large-Config": "1" } : {}),
    },
    serializeDurationMs: Math.max(0, Math.round(completedAt - serializeStartedAt)),
    totalDurationMs: Math.max(0, Math.round(completedAt - attempt.startedAt)),
  };
}

export function buildSaveRequestHeaders(
  attempt: ClientSaveAttempt,
) {
  // Transport metadata is explicit and serializable; no object-identity registry.
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Maono-Save-Id": attempt.saveId,
    "X-Correlation-Id": attempt.correlationId,
    "X-Maono-Client-Contract": String(MAONO_SAVE_CLIENT_CONTRACT),
    "X-Maono-Client-Build": clientBuildId(),
  };
}

export function readSaveResponseDiagnostics(
  response: Response,
  attempt: ClientSaveAttempt,
): SaveResponseDiagnostics {
  return {
    saveId: response.headers.get("X-Maono-Save-Id") || attempt.saveId,
    correlationId:
      response.headers.get("X-Correlation-Id") || attempt.correlationId,
    serverTiming: response.headers.get("Server-Timing"),
    apiContract: response.headers.get("X-Maono-Api-Contract"),
    apiBuild: response.headers.get("X-Maono-Api-Build"),
    dbSchema: response.headers.get("X-Maono-Db-Schema"),
  };
}

export function clientSaveTotalDurationMs(attempt: ClientSaveAttempt) {
  return Math.max(0, Math.round(nowMs() - attempt.startedAt));
}

export function isNetworkSaveFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message);
}
