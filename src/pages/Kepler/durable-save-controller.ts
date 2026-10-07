import { parseResponseJson } from "../../lib/api-transport.ts";
import { beginClientSaveAttempt, buildSaveRequestHeaders, readSaveResponseDiagnostics, serializeMapConfigTransport, type ClientSaveAttempt, type SaveResponseDiagnostics, type SerializedMapConfigTransport } from "./save-observability.ts";
import { createIndexedDbSaveStore, LOCAL_SAVE_RETENTION_MS, saveAccountKey, saveScopeKey, saveSnapshotKey, validateLocalSnapshot, type DurableSaveSnapshot, type DurableSaveStore, type SaveScope } from "./durable-save-store.ts";

export const SAVE_STALL_NOTICE_MS = 12_000;
export type SavePhase = "PREPARING" | "LOCAL_READY" | "SENDING" | "CHECKING" | "CONFIRMED" | "NEEDS_ACTION";
export type ProjectUpdateFlowResult = { response: Response; data: any; diagnostics: SaveResponseDiagnostics; snapshot: DurableSaveSnapshot };
export const defaultDurableSaveStore = createIndexedDbSaveStore();
const HASH_BLOCK_BYTES = 4 * 1024 * 1024;
export async function hashSavePayload(blob: Blob) {
  const digests = new Uint8Array(Math.ceil(blob.size / HASH_BLOCK_BYTES) * 32);
  for (let offset = 0, index = 0; offset < blob.size; offset += HASH_BLOCK_BYTES, index++) {
    digests.set(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.slice(offset, offset + HASH_BLOCK_BYTES).arrayBuffer())), index * 32);
  }
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", digests)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function isSaveRequestAbort(error: unknown) {
  return (error as { name?: string })?.name === "AbortError";
}
export async function runWithSaveStallNotice<T>({ operation, stallAfterMs = SAVE_STALL_NOTICE_MS, onStall = () => {} }: {
  operation: () => Promise<T>; stallAfterMs?: number; onStall?: () => void;
}) {
  const timer = setTimeout(onStall, Math.max(1, stallAfterMs));
  try { return await operation(); } finally { clearTimeout(timer); }
}
export async function prepareProjectUpdateSnapshot({ attempt, scope, projectSlug, config, expectedConfigRevision, editorSessionId, editGeneration, creation, transport }: {
  attempt: ClientSaveAttempt; scope: SaveScope; projectSlug: string; config: any; expectedConfigRevision: number;
  editorSessionId: string; editGeneration: number; creation?: DurableSaveSnapshot["creation"]; transport?: SerializedMapConfigTransport;
}): Promise<DurableSaveSnapshot> {
  const serialized = transport ?? serializeMapConfigTransport(attempt, config, expectedConfigRevision);
  const body = new Blob([serialized.body], { type: "application/vnd.maono.map-config+json" });
  const { ["X-Correlation-Id"]: _requestCorrelation, ...headers } = serialized.headers;
  void _requestCorrelation;
  if (scope.projectId) headers["X-Maono-Project-Id"] = scope.projectId;
  if (creation) headers["X-Maono-Creation-Key"] = creation.idempotencyKey;
  return {
    key: saveSnapshotKey(scope, attempt.saveId), scopeKey: saveScopeKey(scope), accountKey: saveAccountKey(scope.actorId, scope.organizationId), scope,
    attempt, projectSlug, expectedConfigRevision, headers,
    manifest: { operationId: attempt.saveId, operation: attempt.operation, expectedConfigRevision, payloadBytes: body.size,
      contentHash: await hashSavePayload(body), checksumAlgorithm: "dropbox-content-hash", serializationVersion: 1,
      schemaName: "legacy-kepler", schemaVersion: 1, configVersion: String(config?.version || "").slice(0, 80), datasetCount: Array.isArray(config?.datasets) ? config.datasets.length : 0,
      ...(creation ? { creationKey: creation.idempotencyKey } : {}),
    },
    serialized: { ...serialized, body }, editorSessionId, editGeneration, createdAt: Date.now(), expiresAt: Date.now() + LOCAL_SAVE_RETENTION_MS, localState: "pending", ...(creation ? { creation } : {}),
  };
}
export function confirmationMatchesEditor(snapshot: DurableSaveSnapshot, editorSessionId: string, editGeneration: number) {
  return snapshot.editorSessionId === editorSessionId && snapshot.editGeneration === editGeneration;
}
export function receiptRevision(data: any) {
  const receipt = data?.operation?.receipt ?? data?.receipt;
  return Math.max(0, Number(receipt?.publishedRevision ?? receipt?.configRevision ?? receipt?.revision ?? data?.configRevision ?? 0) || 0);
}
export function operationState(data: any) { return String(data?.operation?.state ?? data?.state ?? ""); }
export type DurableSavePublicCode =
  | "SAVE_RECEIPT_UNVERIFIED"
  | "SAVE_CREATION_ACTIVE_UNCONFIRMED"
  | "SAVE_OPERATION_CONFLICT"
  | "SAVE_OPERATION_FAILED_FINAL"
  | "LOCAL_SAVE_PAYLOAD_EXPIRED"
  | "LOCAL_SAVE_PAYLOAD_INTEGRITY_FAILED"
  | "SAVE_OPERATION_STATE_UNRECOGNIZED";
export class DurableSaveError extends Error {
  response: Response; data: any; snapshot: DurableSaveSnapshot; code?: DurableSavePublicCode;
  constructor(message: string, response: Response, data: any, snapshot: DurableSaveSnapshot, code?: DurableSavePublicCode) {
    super(message); this.name = "DurableSaveError"; this.response = response; this.data = data; this.snapshot = snapshot; this.code = code;
  }
}
function abortCheck(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("A espera foi interrompida.", "AbortError"); }
async function waitForPoll(ms: number, signal?: AbortSignal) {
  abortCheck(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("A espera foi interrompida.", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
export async function executePreparedProjectUpdate({ snapshot, scope = snapshot.scope, signal, store = defaultDurableSaveStore, fetchImpl = globalThis.fetch.bind(globalThis), onStall, stallAfterMs, onPhase = () => {}, pollIntervalMs = 1500, isScopeCurrent = () => true }: {
  snapshot: DurableSaveSnapshot; scope?: SaveScope; signal?: AbortSignal; store?: DurableSaveStore; fetchImpl?: typeof fetch;
  onStall?: () => void; stallAfterMs?: number; onPhase?: (phase: SavePhase, data?: any) => void; pollIntervalMs?: number; isScopeCurrent?: () => boolean;
}): Promise<ProjectUpdateFlowResult> {
  // A fresh authenticated scope must be supplied by the UI after login; never recover another account.
  if (saveScopeKey(scope) !== snapshot.scopeKey || scope.projectId !== snapshot.scope.projectId) throw new Error("A tentativa pertence a outra conta, organização ou projeto.");
  const ensureCurrent = () => { abortCheck(signal); if (!isScopeCurrent()) throw new DOMException("O contexto de conta mudou.", "AbortError"); };
  ensureCurrent(); validateLocalSnapshot(snapshot);
  if (!scope.projectId) throw Object.assign(new Error("A identidade do projeto não foi confirmada. Preserve o rascunho antes de abrir novamente o projeto."), { code: "PROJECT_IDENTITY_REQUIRED" });
  const stored = await store.get(snapshot.key);
  if (!stored) await store.put(snapshot); // Mandatory durable write before the first transmission.
  else {
    if (JSON.stringify(stored.manifest) !== JSON.stringify(snapshot.manifest)) throw new Error("O mesmo ID não pode representar outro conteúdo ou revisão-base.");
    snapshot = stored;
  }
  onPhase("LOCAL_READY");
  const run = async () => {
    const base = `/api/projects/${encodeURIComponent(snapshot.projectSlug)}/save-operations`;
    const path = `${base}/${encodeURIComponent(snapshot.manifest.operationId)}`;
    let integrityChecked = false;
    async function send(url: string, method = "GET", body?: BodyInit) {
      ensureCurrent();
      const requestAttempt = { ...snapshot.attempt, ...beginClientSaveAttempt(snapshot.attempt.operation), saveId: snapshot.attempt.saveId };
      const headers = { ...buildSaveRequestHeaders(requestAttempt), ...snapshot.headers, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) };
      const response = await fetchImpl(url, { method, body, headers, credentials: "include", cache: "no-store", signal });
      const parsed = await parseResponseJson(response);
      ensureCurrent();
      const data: any = parsed.valid ? parsed.data : { ok: false, error: { message: "A resposta do servidor não pôde ser confirmada. Verifique esta mesma tentativa novamente." } };
      return { response, data, diagnostics: readSaveResponseDiagnostics(response, requestAttempt) };
    }
    async function mutate(url: string, method: string, body: BodyInit) {
      try {
        const result = await send(url, method, body);
        if (result.response.status >= 500) {
          onPhase("CHECKING");
          try { return await send(path); } catch { return result; }
        }
        return result;
      }
      catch (error) {
        ensureCurrent();
        // A lost mutation response is ambiguous: ask for its receipt before any further send.
        onPhase("CHECKING");
        try { return await send(path); } catch { throw error; }
      }
    }
    onPhase("CHECKING");
    let result = await send(path); // Every retry/reload/online/login first asks for the historical receipt.
    if (result.response.status === 404) {
      result = await mutate(base, "POST", JSON.stringify(snapshot.manifest));
    }
    while (true) {
      ensureCurrent();
      const state = operationState(result.data);
      if (!result.response.ok || result.data?.ok === false) {
        // Explicit terminal validation/revision rejections can be reviewed and archived.
        // Authentication, transient infrastructure and unknown responses remain pending.
        if ([400, 409, 410, 413, 415, 422].includes(result.response.status)) {
          const code = String(result.data?.error?.code ?? "");
          await store.put({ ...snapshot, localState: result.response.status === 409 && /REVISION|VERSION_CONFLICT/.test(code) ? "conflict" : "failed" });
        }
        onPhase("NEEDS_ACTION", result.data);
        throw new DurableSaveError(result.data?.error?.message || "O resultado ainda não foi confirmado. A tentativa anterior foi preservada.", result.response, result.data, snapshot);
      }
      if (state === "PUBLISHED") {
        const receipt = result.data?.operation?.receipt ?? result.data?.receipt;
        if (!receipt || receipt.operationId !== snapshot.manifest.operationId || !receiptRevision(result.data) ||
          String(receipt.organizationId) !== snapshot.scope.organizationId ||
          (snapshot.scope.projectId && String(receipt.projectId) !== snapshot.scope.projectId) ||
          Number(receipt.baseRevision) !== snapshot.expectedConfigRevision ||
          receipt.checksum !== snapshot.manifest.contentHash || receipt.checksumAlgorithm !== snapshot.manifest.checksumAlgorithm ||
          Number(receipt.sizeBytes) !== snapshot.manifest.payloadBytes) {
          throw new DurableSaveError("O recibo de salvamento está incompleto. A tentativa foi preservada.", result.response, result.data, snapshot, "SAVE_RECEIPT_UNVERIFIED");
        }
        if (snapshot.attempt.operation === "create" && !(result.data?.project?.active === true || result.data?.status === "active" || (result.data?.lifecycle?.state ?? result.data?.project?.lifecycle?.state ?? receipt.lifecycleState) === "ACTIVE")) {
          throw new DurableSaveError("O recibo não confirmou o projeto ACTIVE. A tentativa foi preservada para revisão.", result.response, result.data, snapshot, "SAVE_CREATION_ACTIVE_UNCONFIRMED");
        }
        const confirmed = { ...snapshot, localState: "confirmed" as const, receipt, diagnostics: result.diagnostics, creation: snapshot.creation ? { ...snapshot.creation, requestBody: null } : undefined, serialized: { ...snapshot.serialized, body: null } };
        try { await store.put(confirmed); } catch { result.data.localCleanupWarning = true; }
        onPhase("CONFIRMED", result.data);
        return { ...result, snapshot };
      }
      if (state === "CONFLICT" || state === "FAILED_FINAL") {
        await store.put({ ...snapshot, localState: state === "CONFLICT" ? "conflict" : "failed" });
        onPhase("NEEDS_ACTION", result.data);
        throw new DurableSaveError(state === "CONFLICT" ? "O projeto mudou antes da publicação. Suas alterações foram preservadas para revisão." : "A tentativa não pôde ser concluída. O snapshot foi preservado para exportação.", result.response, result.data, snapshot, state === "CONFLICT" ? "SAVE_OPERATION_CONFLICT" : "SAVE_OPERATION_FAILED_FINAL");
      }
      const nextAction = String(result.data?.operation?.nextAction ?? result.data?.nextAction ?? "").toLowerCase();
      if (state === "AWAITING_UPLOAD" || nextAction === "upload") {
        if (!snapshot.serialized.body || snapshot.expiresAt <= Date.now()) {
          throw new DurableSaveError("A cópia local desta tentativa expirou após 7 dias ou foi removida. O servidor ainda não recebeu todo o mapa. Preserve o rascunho atual antes de recarregar.", result.response, result.data, snapshot, "LOCAL_SAVE_PAYLOAD_EXPIRED");
        }
        if (!integrityChecked && await hashSavePayload(snapshot.serialized.body) !== snapshot.manifest.contentHash) {
          throw new DurableSaveError("A cópia local não passou na verificação de integridade. Exporte o rascunho atual; esta tentativa não será reenviada.", result.response, result.data, snapshot, "LOCAL_SAVE_PAYLOAD_INTEGRITY_FAILED");
        }
        integrityChecked = true;
        onPhase("SENDING", result.data);
        result = await mutate(`${path}/payload`, "PUT", snapshot.serialized.body);
      } else if (["RECEIVING", "PAYLOAD_STORED", "PROCESSING", "RETRY_WAIT"].includes(state)) {
        onPhase("CHECKING", result.data);
        await waitForPoll(pollIntervalMs, signal);
        result = await send(path);
      } else {
        throw new DurableSaveError("Estado de salvamento desconhecido. Preserve o rascunho e verifique esta tentativa novamente.", result.response, result.data, snapshot, "SAVE_OPERATION_STATE_UNRECOGNIZED");
      }
    }
  };
  // Web Locks coordinate tabs when supported. Server CAS remains the authority everywhere.
  return runWithSaveStallNotice({ onStall, stallAfterMs, operation: () => {
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request(`maono-save:${snapshot.scopeKey}`, { mode: "exclusive", signal }, run) : run();
  } });
}
