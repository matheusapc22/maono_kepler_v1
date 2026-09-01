export type SaveOperation = "create" | "update";

export const MAONO_SAVE_CLIENT_CONTRACT = 1;

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
  return String(
    import.meta.env.VITE_MAONO_CLIENT_BUILD_ID ??
      import.meta.env.VITE_COMMIT_SHA ??
      import.meta.env.VITE_GIT_COMMIT_SHA ??
      "dev",
  ).slice(0, 120);
}

export function measureUtf8PayloadBytes(value: string) {
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

export function serializeSaveRequest(
  attempt: ClientSaveAttempt,
  payload: unknown,
  serializeStartedAt = attempt.startedAt,
): SerializedSaveRequest {
  const body = JSON.stringify(payload);
  if (typeof body !== "string") {
    throw new Error("Não foi possível serializar a tentativa de salvamento.");
  }
  const completedAt = nowMs();
  return {
    body,
    payloadBytes: measureUtf8PayloadBytes(body),
    serializeDurationMs: Math.max(0, Math.round(completedAt - serializeStartedAt)),
    totalDurationMs: Math.max(0, Math.round(completedAt - attempt.startedAt)),
  };
}

export function buildSaveRequestHeaders(attempt: ClientSaveAttempt) {
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
