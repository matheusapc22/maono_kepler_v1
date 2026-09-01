export type SaveOperation = "create" | "update";

export const MAONO_SAVE_CLIENT_CONTRACT = 1;
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

export type SaveResponseDiagnostics = {
  saveId: string;
  correlationId: string;
  serverTiming: string | null;
  apiContract: string | null;
  apiBuild: string | null;
  dbSchema: string | null;
};

type LargeSaveMetadata = {
  expectedConfigRevision: number;
  payloadBytes: number;
  configVersion: string;
  datasetCount: number;
};

const LARGE_SAVE_REGISTRY = new WeakMap<ClientSaveAttempt, LargeSaveMetadata>();

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
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

function prepareLargeUpdateBody(
  attempt: ClientSaveAttempt,
  payload: unknown,
): { body: string; payloadBytes: number } | null {
  if (attempt.operation !== "update" || !isRecord(payload) || !("config" in payload)) {
    return null;
  }

  const config = payload.config;
  const body = JSON.stringify(config);
  if (typeof body !== "string") {
    throw new Error("Não foi possível serializar a configuração do projeto.");
  }
  const payloadBytes = measureUtf8PayloadBytes(body);
  if (payloadBytes <= MAONO_LARGE_SAVE_THRESHOLD_BYTES) {
    return null;
  }

  assertLargeConfigShape(config);
  const expectedConfigRevision = Number(payload.expectedConfigRevision);
  if (!Number.isInteger(expectedConfigRevision) || expectedConfigRevision < 0) {
    throw new Error("A revisão esperada do projeto é inválida para o save grande.");
  }

  LARGE_SAVE_REGISTRY.set(attempt, {
    expectedConfigRevision,
    payloadBytes,
    configVersion: String((config as any).version).slice(0, 80),
    datasetCount: (config as any).datasets.length,
  });
  return { body, payloadBytes };
}

export function serializeSaveRequest(
  attempt: ClientSaveAttempt,
  payload: unknown,
  serializeStartedAt = attempt.startedAt,
): SerializedSaveRequest {
  LARGE_SAVE_REGISTRY.delete(attempt);

  const large = prepareLargeUpdateBody(attempt, payload);
  const body = large?.body ?? JSON.stringify(payload);
  if (typeof body !== "string") {
    throw new Error("Não foi possível serializar a tentativa de salvamento.");
  }
  const completedAt = nowMs();
  return {
    body,
    payloadBytes: large?.payloadBytes ?? measureUtf8PayloadBytes(body),
    serializeDurationMs: Math.max(0, Math.round(completedAt - serializeStartedAt)),
    totalDurationMs: Math.max(0, Math.round(completedAt - attempt.startedAt)),
  };
}

export function buildSaveRequestHeaders(attempt: ClientSaveAttempt) {
  const large = LARGE_SAVE_REGISTRY.get(attempt);
  return {
    "Content-Type": large
      ? "application/vnd.maono.map-config+json"
      : "application/json",
    Accept: "application/json",
    "X-Maono-Save-Id": attempt.saveId,
    "X-Correlation-Id": attempt.correlationId,
    "X-Maono-Client-Contract": String(MAONO_SAVE_CLIENT_CONTRACT),
    "X-Maono-Client-Build": clientBuildId(),
    ...(large
      ? {
          "X-Maono-Large-Config": "1",
          "X-Maono-Expected-Revision": String(large.expectedConfigRevision),
          "X-Maono-Config-Size": String(large.payloadBytes),
          "X-Maono-Config-Schema": "legacy-kepler",
          "X-Maono-Config-Schema-Version": "1",
          "X-Maono-Config-Version": large.configVersion,
          "X-Maono-Dataset-Count": String(large.datasetCount),
        }
      : {}),
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
