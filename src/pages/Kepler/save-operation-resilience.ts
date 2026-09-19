import { parseResponseJson } from "../../lib/api-transport.ts";

import {
  buildSaveRequestHeaders,
  readSaveResponseDiagnostics,
  serializeSaveRequest,
  type ClientSaveAttempt,
  type SaveResponseDiagnostics,
  type SerializedSaveRequest,
} from "./save-observability.ts";

export const SAVE_STALL_NOTICE_MS = 12_000;

type LegacyPreview = {
  dataUrl: string;
  method: string;
  diagnostics: string[];
} | null;

export type PreparedProjectUpdateSnapshot = {
  attempt: ClientSaveAttempt;
  projectSlug: string;
  config: any;
  expectedConfigRevision: number;
  serialized: SerializedSaveRequest;
};

export type ProjectUpdateFlowResult = {
  response: Response;
  data: any;
  diagnostics: SaveResponseDiagnostics;
  snapshot: PreparedProjectUpdateSnapshot;
};

const PENDING_UPDATE_RECOVERY =
  new Map<string, PreparedProjectUpdateSnapshot>();

async function readJsonResponse(response: Response): Promise<any> {
  const parsed = await parseResponseJson(response);

  if (parsed.valid) {
    return parsed.data;
  }

  return {
    ok: false,
    error: {
      code: "INFRASTRUCTURE_UNEXPECTED_ERROR",
      category: "INFRASTRUCTURE",
      retryable: true,
    },
  };
}

export function isSaveRequestAbort(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError",
  );
}

export function prepareProjectUpdateSnapshot({
  attempt,
  projectSlug,
  config,
  expectedConfigRevision,
  legacy,
}: {
  attempt: ClientSaveAttempt;
  projectSlug: string;
  config: any;
  expectedConfigRevision: number;
  legacy: LegacyPreview;
}): PreparedProjectUpdateSnapshot {
  const serialized = serializeSaveRequest(attempt, {
    config,
    expectedConfigRevision,
    ...(legacy
      ? {
          thumbnailDataUrl: legacy.dataUrl,
          thumbnailCapture: {
            method: legacy.method,
            diagnostics: legacy.diagnostics.join(" | "),
          },
        }
      : {}),
  });

  return {
    attempt,
    projectSlug,
    config,
    expectedConfigRevision,
    serialized,
  };
}

export async function runWithSaveStallNotice<T>({
  operation,
  stallAfterMs = SAVE_STALL_NOTICE_MS,
  onStall = () => {},
}: {
  operation: () => Promise<T>;
  stallAfterMs?: number;
  onStall?: () => void;
}): Promise<T> {
  let stalled = false;
  const timeoutId = globalThis.setTimeout(() => {
    stalled = true;
    onStall();
  }, Math.max(1, stallAfterMs));

  try {
    return await operation();
  } finally {
    globalThis.clearTimeout(timeoutId);
    void stalled;
  }
}

export async function executePreparedProjectUpdate({
  snapshot,
  signal,
  fetchImpl = globalThis.fetch.bind(globalThis),
  stallAfterMs = SAVE_STALL_NOTICE_MS,
  onStall = () => {},
}: {
  snapshot: PreparedProjectUpdateSnapshot;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  stallAfterMs?: number;
  onStall?: () => void;
}): Promise<ProjectUpdateFlowResult> {
  const response = await runWithSaveStallNotice({
    stallAfterMs,
    onStall,
    operation: () =>
      fetchImpl(
        `/api/projects/${encodeURIComponent(snapshot.projectSlug)}/config`,
        {
          method: "PUT",
          credentials: "include",
          headers: buildSaveRequestHeaders(snapshot.attempt),
          body: snapshot.serialized.body,
          signal,
        },
      ),
  });

  const diagnostics = readSaveResponseDiagnostics(
    response,
    snapshot.attempt,
  );
  const data = await readJsonResponse(response);

  return {
    response,
    data,
    diagnostics,
    snapshot,
  };
}

export function rememberProjectUpdateRecovery(
  snapshot: PreparedProjectUpdateSnapshot,
) {
  PENDING_UPDATE_RECOVERY.set(snapshot.projectSlug, snapshot);
}

export function getProjectUpdateRecovery(projectSlug: string) {
  return PENDING_UPDATE_RECOVERY.get(projectSlug) ?? null;
}

export function clearProjectUpdateRecovery(projectSlug: string) {
  return PENDING_UPDATE_RECOVERY.delete(projectSlug);
}
