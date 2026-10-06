import type { ClientSaveAttempt, SaveResponseDiagnostics } from "./save-observability.ts";

/** Only explicit Save snapshots are retained; live editor changes never enter this store. */
export const LOCAL_SAVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DURABLE_SAVE_DATABASE = "maono-explicit-save-operations";
const STORE = "operations";
export type SaveScope = { actorId: string; organizationId: string; projectKey: string; projectId?: string };
export type SaveManifest = {
  operationId: string;
  operation: "create" | "update" | "change_request";
  expectedConfigRevision: number;
  payloadBytes: number;
  contentHash: string;
  checksumAlgorithm: "dropbox-content-hash";
  serializationVersion: 1;
  schemaName: "legacy-kepler";
  schemaVersion: 1;
  configVersion: string;
  datasetCount: number;
  creationKey?: string;
};
export type SaveReceipt = {
  operationId: string;
  publishedRevision?: number;
  configRevision?: number;
  revision?: number;
  currentRevision?: number;
  [key: string]: unknown;
};
export type DurableSaveSnapshot = {
  key: string;
  scopeKey: string;
  accountKey: string;
  scope: SaveScope;
  attempt: ClientSaveAttempt;
  projectSlug: string;
  expectedConfigRevision: number;
  manifest: SaveManifest;
  headers: Record<string, string>;
  serialized: { body: Blob | null; payloadBytes: number; serializeDurationMs: number; totalDurationMs: number };
  editorSessionId: string;
  editGeneration: number;
  createdAt: number;
  expiresAt: number;
  localState: "pending" | "confirmed" | "conflict" | "failed" | "expired";
  resolvedAt?: number;
  receipt?: SaveReceipt;
  diagnostics?: SaveResponseDiagnostics;
  /** Kept until a lost reservation response is recovered using its original key. */
  creation?: { requestBody: string | null; idempotencyKey: string };
};
// This encoding is local to IndexedDB. The controller still receives the original
// Blob, and the manifest, request headers and server serialization stay unchanged.
type StoredSaveSnapshot = Omit<DurableSaveSnapshot, "serialized"> & {
  serialized: Omit<DurableSaveSnapshot["serialized"], "body"> & {
    body: Blob | ArrayBuffer | null;
    bodyEncoding?: "arraybuffer-v1";
    bodyType?: string;
  };
};
export function snapshotMatchesProject(snapshot: DurableSaveSnapshot, actorId: string, organizationId: string, projectSlug: string, projectId: string) {
  return snapshot.scope.actorId === actorId && snapshot.scope.organizationId === organizationId && snapshot.projectSlug === projectSlug && Boolean(projectId) && snapshot.scope.projectId === projectId;
}
export function isPendingSaveSnapshot(value: DurableSaveSnapshot) {
  return value.localState !== "confirmed" && !value.resolvedAt;
}
export async function archiveReviewedSaveSnapshot(store: DurableSaveStore, snapshot: DurableSaveSnapshot) {
  if (!["conflict", "failed", "expired"].includes(snapshot.localState)) throw new Error("Verifique o resultado antes de arquivar esta tentativa.");
  // Deliberate acknowledgement preserves exportable bytes and never updates/rebases the editor.
  await store.put({ ...snapshot, resolvedAt: Date.now() });
}
export interface DurableSaveStore {
  put(snapshot: DurableSaveSnapshot): Promise<void>;
  get(key: string): Promise<DurableSaveSnapshot | null>;
  list(scope: SaveScope): Promise<DurableSaveSnapshot[]>;
  listAccount(actorId: string, organizationId: string): Promise<DurableSaveSnapshot[]>;
}
export type LocalSaveStorageCode = "LOCAL_SAVE_STORAGE_UNAVAILABLE" | "LOCAL_SAVE_QUOTA_EXCEEDED" | "LOCAL_SAVE_CORRUPTED" | "LOCAL_SAVE_CREATION_PAYLOAD_UNAVAILABLE";
export class LocalSaveStorageError extends Error {
  code: LocalSaveStorageCode;
  constructor(code: LocalSaveStorageCode, cause?: unknown) {
    super(code === "LOCAL_SAVE_CREATION_PAYLOAD_UNAVAILABLE"
      ? "A cópia local desta tentativa expirou ou foi removida. Nenhuma nova reserva foi iniciada. Exporte o rascunho atual e revise a tentativa antes de criar o projeto novamente."
      : code === "LOCAL_SAVE_CORRUPTED"
      ? "A cópia local desta tentativa está inválida. Exporte o rascunho atual antes de fechar ou recarregar; o conteúdo inválido não será enviado."
      : code === "LOCAL_SAVE_QUOTA_EXCEEDED"
      ? "Não há espaço no navegador para preservar esta tentativa. Exporte o mapa antes de fechar ou recarregar. A recuperação local não está garantida."
      : "A recuperação local não está disponível neste navegador. Exporte o mapa antes de fechar ou recarregar. A recuperação local não está garantida.", { cause });
    this.name = "LocalSaveStorageError";
    this.code = code;
  }
}
export function saveAccountKey(actorId: string, organizationId: string) {
  if (!actorId || !organizationId) throw new Error("Identidade de salvamento incompleta.");
  return JSON.stringify([String(actorId), String(organizationId)]);
}
export function saveScopeKey(scope: SaveScope) {
  saveAccountKey(scope.actorId, scope.organizationId);
  if (!scope.projectKey) throw new Error("Projeto de salvamento ausente.");
  return JSON.stringify([scope.actorId, scope.organizationId, scope.projectKey]);
}
export function saveSnapshotKey(scope: SaveScope, operationId: string) {
  return JSON.stringify([scope.actorId, scope.organizationId, scope.projectKey, operationId]);
}
function storageError(error: unknown) {
  return error instanceof LocalSaveStorageError ? error : new LocalSaveStorageError(
    (error as { name?: string })?.name === "QuotaExceededError" ? "LOCAL_SAVE_QUOTA_EXCEEDED" : "LOCAL_SAVE_STORAGE_UNAVAILABLE", error,
  );
}
export function validateLocalSnapshot(value: DurableSaveSnapshot) {
  if (!value || value.key !== saveSnapshotKey(value.scope, value.manifest?.operationId) ||
    value.scopeKey !== saveScopeKey(value.scope) || value.accountKey !== saveAccountKey(value.scope.actorId, value.scope.organizationId) ||
    value.attempt.saveId !== value.manifest.operationId || value.manifest.serializationVersion !== 1 ||
    value.manifest.checksumAlgorithm !== "dropbox-content-hash" || !/^[a-f0-9]{64}$/.test(value.manifest.contentHash) ||
    value.manifest.expectedConfigRevision !== value.expectedConfigRevision ||
    (value.scope.projectId && value.manifest.operation !== "change_request" && value.headers["X-Maono-Project-Id"] !== value.scope.projectId) ||
    (value.serialized.body !== null && !(value.serialized.body instanceof Blob)) ||
    value.serialized.payloadBytes !== value.manifest.payloadBytes ||
    (value.serialized.body && value.serialized.body.size !== value.manifest.payloadBytes)) {
    throw new LocalSaveStorageError("LOCAL_SAVE_CORRUPTED");
  }
  // Persisted request headers are a strict allowlist: never cookies, authorization, or tokens.
  for (const name of Object.keys(value.headers)) {
    if (!/^(content-type|accept|x-maono-(save-id|client-contract|client-build|project-id|expected-revision|config-size|config-schema|config-schema-version|config-version|dataset-count|large-config|creation-key))$/i.test(name)) {
      throw new LocalSaveStorageError("LOCAL_SAVE_CORRUPTED");
    }
  }
  return value;
}
export function mergeLocalSaveSnapshot(existing: DurableSaveSnapshot | undefined, incoming: DurableSaveSnapshot) {
  if (!existing) return incoming;
  if (JSON.stringify(existing.manifest) !== JSON.stringify(incoming.manifest) || existing.scopeKey !== incoming.scopeKey) throw new LocalSaveStorageError("LOCAL_SAVE_CORRUPTED");
  // A second tab cannot resurrect confirmed bytes, undo review, or extend retention.
  const result = { ...incoming, createdAt: existing.createdAt, expiresAt: Math.min(existing.expiresAt, incoming.expiresAt), projectSlug: existing.projectSlug || incoming.projectSlug,
    scope: { ...incoming.scope, ...(existing.scope.projectId ? { projectId: existing.scope.projectId } : {}) },
    ...(existing.resolvedAt ? { resolvedAt: existing.resolvedAt } : {}),
  };
  if (existing.localState === "confirmed") return { ...result, localState: "confirmed" as const, receipt: existing.receipt, creation: existing.creation ? { ...existing.creation, requestBody: null } : undefined, serialized: { ...incoming.serialized, body: null } };
  if (existing.localState === "expired") return { ...result, localState: incoming.localState === "confirmed" ? "confirmed" as const : "expired" as const, creation: existing.creation ? { ...existing.creation, requestBody: null } : undefined, serialized: { ...incoming.serialized, body: null } };
  return result;
}
function readStoredSnapshot(value: StoredSaveSnapshot): DurableSaveSnapshot {
  try {
    const { body, bodyEncoding, bodyType, ...serialized } = value.serialized;
    if (bodyEncoding === undefined) return validateLocalSnapshot(value as DurableSaveSnapshot);
    if (bodyEncoding !== "arraybuffer-v1" || typeof bodyType !== "string" || (body !== null && !(body instanceof ArrayBuffer))) {
      throw new LocalSaveStorageError("LOCAL_SAVE_CORRUPTED");
    }
    return validateLocalSnapshot({ ...value, serialized: { ...serialized, body: body === null ? null : new Blob([body], { type: bodyType }) } });
  } catch (error) {
    throw error instanceof LocalSaveStorageError ? error : new LocalSaveStorageError("LOCAL_SAVE_CORRUPTED", error);
  }
}
function purgeSnapshotPayload<T extends StoredSaveSnapshot>(value: T): T {
  return { ...value, localState: value.localState === "confirmed" ? "confirmed" : "expired",
    creation: value.creation ? { ...value.creation, requestBody: null } : undefined,
    serialized: { ...value.serialized, body: null },
  };
}
function isBlobStorageFailure(error: unknown) {
  const cause = error instanceof LocalSaveStorageError ? error.cause : error;
  const { name, message } = (cause ?? {}) as { name?: string; message?: string };
  if (/corrupt|quota/i.test(message ?? "")) return false;
  return (name === "UnknownError" && /\bpreparing blob(?:\/file)? data\b/i.test(message ?? "")) ||
    (name === "DataCloneError" && /\bblob\b/i.test(message ?? ""));
}
export function createIndexedDbSaveStore(indexedDb: IDBFactory | undefined = globalThis.indexedDB): DurableSaveStore {
  let useByteEncoding = false;
  async function open() {
    if (!indexedDb) throw new LocalSaveStorageError("LOCAL_SAVE_STORAGE_UNAVAILABLE");
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDb.open(DURABLE_SAVE_DATABASE, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("scopeKey", "scopeKey");
        store.createIndex("accountKey", "accountKey");
        store.createIndex("expiresAt", "expiresAt");
      };
      request.onsuccess = () => {
        const db = request.result;
        // Expire payloads across accounts on the next DB access, without exposing their contents.
        // A closed browser cannot run cleanup at the seven-day instant.
        const tx = db.transaction(STORE, "readwrite");
        const cursor = tx.objectStore(STORE).index("expiresAt").openCursor(IDBKeyRange.upperBound(Date.now()));
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const value = row.value as StoredSaveSnapshot;
          if (value.serialized?.body || value.creation?.requestBody) row.update(purgeSnapshotPayload(value));
          row.continue();
        };
        tx.oncomplete = () => resolve(db);
        tx.onabort = tx.onerror = () => { db.close(); reject(storageError(tx.error)); };
      };
      request.onerror = () => reject(storageError(request.error));
      request.onblocked = () => reject(new LocalSaveStorageError("LOCAL_SAVE_STORAGE_UNAVAILABLE"));
    });
  }
  async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(storageError(tx.error || request.error));
      });
    } catch (error) { throw storageError(error); } finally { db.close(); }
  }
  async function write(value: DurableSaveSnapshot, bytes?: ArrayBuffer) {
    const db = await open();
    try {
      return await new Promise<DurableSaveSnapshot>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          const read = store.get(value.key);
          let failure: unknown;
          let merged: DurableSaveSnapshot;
          read.onsuccess = () => {
            try {
              merged = mergeLocalSaveSnapshot(read.result ? readStoredSnapshot(read.result) : undefined, value);
              if (merged.localState === "confirmed" || merged.localState === "expired" || merged.expiresAt <= Date.now()) merged = purgeSnapshotPayload(merged);
              validateLocalSnapshot(merged);
              const stored: StoredSaveSnapshot = bytes === undefined ? merged : { ...merged, serialized: {
                ...merged.serialized, body: merged.serialized.body ? bytes : null,
                bodyEncoding: "arraybuffer-v1", bodyType: merged.serialized.body?.type ?? "",
              } };
              const put = store.put(stored);
              put.onerror = () => { failure = put.error; };
            }
            catch (error) { failure = error; tx.abort(); }
          };
          // Request errors precede tx.error in WebKit. Retain the native failure,
          // and wait for abort before a retry or for commit before acknowledging.
          tx.onerror = () => { failure ||= tx.error || read.error; };
          tx.oncomplete = () => failure ? reject(storageError(failure)) : resolve(merged);
          tx.onabort = () => reject(storageError(failure || tx.error || read.error));
      });
    } catch (error) { throw storageError(error); } finally { db.close(); }
  }
  async function putSnapshot(value: DurableSaveSnapshot) {
    validateLocalSnapshot(value);
    if (value.localState === "confirmed" || value.localState === "expired" || value.expiresAt <= Date.now()) value = purgeSnapshotPayload(value);
    if (!useByteEncoding || !value.serialized.body) {
      try { return await write(value); }
      catch (error) {
        if (!value.serialized.body || !isBlobStorageFailure(error)) throw error;
      }
    }
    // Finish asynchronous Blob reading before opening a transaction. Awaiting it
    // in an IndexedDB request callback lets WebKit make the transaction inactive.
    try {
      const bytes = await value.serialized.body!.arrayBuffer();
      if (bytes.byteLength !== value.manifest.payloadBytes) throw new LocalSaveStorageError("LOCAL_SAVE_CORRUPTED");
      const stored = await write(value, bytes);
      useByteEncoding = true;
      return stored;
    } catch (error) { throw storageError(error); }
  }
  async function expire(values: StoredSaveSnapshot[]) {
    const snapshots: DurableSaveSnapshot[] = [];
    for (const stored of values) {
      let value = readStoredSnapshot(stored);
      if (value.expiresAt <= Date.now() && (value.serialized.body || value.creation?.requestBody)) value = await putSnapshot(value);
      snapshots.push(value);
    }
    return snapshots.sort((a, b) => a.createdAt - b.createdAt);
  }
  return {
    async put(value) { await putSnapshot(value); },
    async get(key) {
      const value = await transaction<StoredSaveSnapshot | undefined>("readonly", store => store.get(key));
      return value ? (await expire([value]))[0] : null;
    },
    async list(scope) {
      return expire(await transaction("readonly", store => store.index("scopeKey").getAll(saveScopeKey(scope))));
    },
    async listAccount(actorId, organizationId) {
      return expire(await transaction("readonly", store => store.index("accountKey").getAll(saveAccountKey(actorId, organizationId))));
    },
  };
}
