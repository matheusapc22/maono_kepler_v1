import type { PreviewManifest } from "./preview-contract.ts";

// Proposed defaults, separately enabled only after the documented retention decision.
export const PREVIEW_SPOOL_DATABASE = "maono-project-preview-spool";
export const PREVIEW_SPOOL_DATABASE_VERSION = 2;
export const PREVIEW_SPOOL_RETENTION_MS = 24 * 60 * 60 * 1000;
export const PREVIEW_SPOOL_MAX_BYTES = 32 * 1024 * 1024;
const STORE = "previews";
const STAGED = "staged";
const ACTOR_EPOCHS = "actor-epochs";
export type StagedPreview = { purgeEpoch?: number; key: string; actorId: string; organizationId: string; saveOperationId: string; editorSessionId: string; editGeneration: number; rendererVersion: string; blob: Blob; imageChecksum: string; captureMethod: string; createdAt: number; expiresAt: number };
export type PreviewSpoolRecord = {
  purgeEpoch?: number;
  key: string;
  accountKey: string;
  actorId: string;
  organizationId: string;
  slug: string;
  manifest: PreviewManifest;
  blob: Blob;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  state: "LOCAL_READY" | "RETRY_WAIT" | "FAILED_FINAL";
};
type StoredRecord = Omit<PreviewSpoolRecord, "blob"> & { bytes: ArrayBuffer };
export interface PreviewSpool {
  /** Capture before starting work; never refresh an old record's epoch to retry. */
  accountEpoch(actorId: string): Promise<number>;
  put(record: PreviewSpoolRecord, isCurrent?: () => boolean): Promise<void>;
  promote(record: PreviewSpoolRecord, stagedKey: string, isCurrent?: () => boolean): Promise<void>;
  list(actorId: string, organizationId: string): Promise<PreviewSpoolRecord[]>;
  remove(key: string): Promise<void>;
  clearAccount(actorId: string): Promise<void>;
  stage(record: StagedPreview, isCurrent?: () => boolean): Promise<void>;
  staged(actorId: string, organizationId: string, saveOperationId: string): Promise<StagedPreview | null>;
  removeStaged(key: string): Promise<void>;
}
export function previewAccountKey(actorId: string, organizationId: string) { return JSON.stringify([actorId, organizationId]); }
export function previewSpoolKey(actorId: string, manifest: PreviewManifest) { return JSON.stringify([actorId, manifest.organizationId, manifest.projectId, manifest.operationId]); }
function validateRecord(value: PreviewSpoolRecord) {
  if (!value.actorId || !value.organizationId || !value.slug || value.key !== previewSpoolKey(value.actorId, value.manifest) ||
    value.accountKey !== previewAccountKey(value.actorId, value.organizationId) || value.manifest.organizationId !== value.organizationId ||
    !/^[a-f0-9]{64}$/.test(value.manifest.imageChecksum) || !value.blob || value.blob.type !== "image/png" ||
    value.blob.size !== value.manifest.sizeBytes || value.blob.size > 4 * 1024 * 1024 || value.blob.size < 45 ||
    value.expiresAt > value.createdAt + PREVIEW_SPOOL_RETENTION_MS) throw new Error("PREVIEW_LOCAL_INTEGRITY_FAILED");
}
export function createPreviewSpool(indexedDb: IDBFactory | undefined = globalThis.indexedDB): PreviewSpool {
  async function open() {
    if (!indexedDb) throw new Error("PREVIEW_LOCAL_STORAGE_UNAVAILABLE");
    return new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = indexedDb.open(PREVIEW_SPOOL_DATABASE, PREVIEW_SPOOL_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "key" });
          store.createIndex("accountKey", "accountKey"); store.createIndex("actorId", "actorId");
        }
        if (!db.objectStoreNames.contains(STAGED)) {
          const staged = db.createObjectStore(STAGED, { keyPath: "key" }); staged.createIndex("actorId", "actorId");
        }
        if (!db.objectStoreNames.contains(ACTOR_EPOCHS)) db.createObjectStore(ACTOR_EPOCHS, { keyPath: "actorId" });
        // Version 1 records keep their bytes and are interpreted as epoch zero.
      };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error("PREVIEW_LOCAL_STORAGE_BLOCKED")); };
    });
  }
  async function transaction<T>(run: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void, storeName = STORE): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        // All instances/tabs serialize actor fencing and both payload stores
        // through the same IDB transaction scope, including logout purge.
        const tx = db.transaction([STORE, STAGED, ACTOR_EPOCHS], "readwrite"); let result: T; let failure: unknown;
        const fail = (error: unknown) => { failure = error; try { tx.abort(); } catch { reject(failure); } };
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error("PREVIEW_LOCAL_STORAGE_UNAVAILABLE"));
        try { run(tx.objectStore(storeName), value => { result = value; }, fail); } catch (error) { fail(error); }
      });
    } finally { db.close(); }
  }
  function epochOf(value: { purgeEpoch?: number } | undefined) {
    const epoch = value?.purgeEpoch ?? 0;
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error("PREVIEW_LOCAL_INTEGRITY_FAILED");
    return epoch;
  }
  function assertCurrent(isCurrent: () => boolean) {
    if (!isCurrent()) throw new DOMException("O contexto da prévia mudou.", "AbortError");
  }
  function withActorEpoch(store: IDBObjectStore, actorId: string, capturedEpoch: number | undefined, isCurrent: () => boolean,
    run: (epoch: number) => void, fail: (error: unknown) => void) {
    const request = store.transaction.objectStore(ACTOR_EPOCHS).get(actorId);
    request.onsuccess = () => {
      try {
        assertCurrent(isCurrent);
        const epoch = epochOf(request.result);
        if (capturedEpoch !== undefined && capturedEpoch !== epoch) throw new DOMException("A prévia pertence a uma sessão já removida.", "AbortError");
        run(epoch);
      } catch (error) { fail(error); }
    };
  }
  function allRows(store: IDBObjectStore, callback: (rows: any[], otherBytes: number, otherRows: any[]) => void) {
    const request = store.getAll();
    request.onsuccess = () => {
      const otherStore = store.transaction.objectStore(store.name === STORE ? STAGED : STORE);
      const other = otherStore.getAll(); other.onsuccess = () => {
        const now = Date.now(); let otherBytes = 0;
        for (const row of other.result) {
          if (row.expiresAt <= now) otherStore.delete(row.key); else otherBytes += row.bytes.byteLength;
        }
        callback(request.result, otherBytes, other.result.filter(row => row.expiresAt > now));
      };
    };
  }
  async function writeRecord(record: PreviewSpoolRecord, stagedKey?: string, isCurrent: () => boolean = () => true) {
    validateRecord(record);
    const purgeEpoch = epochOf(record);
    assertCurrent(isCurrent);
    const { blob, ...metadata } = record;
    const bytes = await blob.arrayBuffer();
    await transaction<void>((store, done, fail) => {
      withActorEpoch(store, metadata.actorId, purgeEpoch, isCurrent, () => allRows(store, (rows: StoredRecord[], otherBytes, otherRows) => {
        if (!isCurrent()) return fail(new DOMException("O contexto da prévia mudou.", "AbortError"));
        const precursor = stagedKey ? otherRows.find(row => row.key === stagedKey) : null;
        if (precursor && (precursor.actorId !== record.actorId || precursor.organizationId !== record.organizationId ||
          precursor.saveOperationId !== record.manifest.saveOperationId || precursor.imageChecksum !== record.manifest.imageChecksum ||
          precursor.editorSessionId !== record.manifest.editorSessionId || precursor.editGeneration !== record.manifest.editGeneration || epochOf(precursor) !== purgeEpoch)) return fail(new Error("PREVIEW_LOCAL_IDENTITY_MISMATCH"));
        let total = otherBytes - (precursor?.bytes.byteLength || 0); let existing: StoredRecord | undefined;
        for (const row of rows) {
          if (row.expiresAt <= Date.now()) { store.delete(row.key); continue; }
          if (row.key === record.key) existing = row; else total += row.bytes.byteLength;
        }
        if (existing && (JSON.stringify(existing.manifest) !== JSON.stringify(record.manifest) || epochOf(existing) !== purgeEpoch)) return fail(new Error("PREVIEW_LOCAL_IDENTITY_MISMATCH"));
        if (total + bytes.byteLength > PREVIEW_SPOOL_MAX_BYTES) return fail(new Error("PREVIEW_LOCAL_QUOTA_EXCEEDED"));
        const write = store.put({ ...metadata, purgeEpoch, bytes, ...(existing ? { createdAt: existing.createdAt, expiresAt: Math.min(existing.expiresAt, record.expiresAt),
          attempts: Math.max(existing.attempts, record.attempts), ...(existing.state === "FAILED_FINAL" ? { state: "FAILED_FINAL" } : {}) } : {}) });
        write.onsuccess = () => { try { assertCurrent(isCurrent); } catch (error) { fail(error); } };
        // Promotion and removal share a transaction: no doubled quota, lost bytes or half-promotion.
        if (precursor) store.transaction.objectStore(STAGED).delete(stagedKey!);
        done();
      }), fail);
    });
  }
  return {
    async accountEpoch(actorId) {
      if (!actorId) throw new Error("PREVIEW_LOCAL_INTEGRITY_FAILED");
      return transaction<number>((store, done, fail) => withActorEpoch(store, actorId, undefined, () => true, done, fail));
    },
    put: (record, isCurrent) => writeRecord(record, undefined, isCurrent),
    promote: (record, stagedKey, isCurrent) => writeRecord(record, stagedKey, isCurrent),
    async list(actorId, organizationId) {
      const rows = await transaction<StoredRecord[]>((store, done) => {
        allRows(store, (all: StoredRecord[]) => {
          // This regular recovery read also expires abandoned staged captures.
          for (const row of all) if (row.expiresAt <= Date.now()) store.delete(row.key);
          done(all.filter(row => row.accountKey === previewAccountKey(actorId, organizationId) && row.expiresAt > Date.now()));
        });
      });
      return rows.flatMap(({ bytes, ...row }) => {
        try { const result = { ...row, purgeEpoch: epochOf(row), blob: new Blob([bytes], { type: "image/png" }) }; validateRecord(result); return [result]; }
        catch { return []; } // Keep malformed bytes until expiry, but do not block other operations.
      });
    },
    async remove(key) { await transaction<void>((store, done) => { store.delete(key); done(); }); },
    async clearAccount(actorId) {
      if (!actorId) throw new Error("PREVIEW_LOCAL_INTEGRITY_FAILED");
      await transaction<void>((store, done, fail) => {
        withActorEpoch(store, actorId, undefined, () => true, epoch => {
          if (epoch === Number.MAX_SAFE_INTEGER) return fail(new Error("PREVIEW_LOCAL_INTEGRITY_FAILED"));
          store.transaction.objectStore(ACTOR_EPOCHS).put({ actorId, purgeEpoch: epoch + 1 });
          let remaining = 2;
          for (const name of [STORE, STAGED]) {
            const request = store.transaction.objectStore(name).index("actorId").openCursor(IDBKeyRange.only(actorId));
            request.onsuccess = () => {
              const cursor = request.result;
              if (cursor) { cursor.delete(); cursor.continue(); }
              else if (--remaining === 0) done();
            };
          }
        }, fail);
      });
    },
    async stage(record, isCurrent = () => true) {
      if (!record.actorId || !record.organizationId || !record.saveOperationId || record.blob.size > 4 * 1024 * 1024 || record.expiresAt > record.createdAt + PREVIEW_SPOOL_RETENTION_MS) throw new Error("PREVIEW_LOCAL_INTEGRITY_FAILED");
      const purgeEpoch = epochOf(record);
      assertCurrent(isCurrent);
      const { blob, ...metadata } = record; const bytes = await blob.arrayBuffer();
      await transaction<void>((store, done, fail) => {
        withActorEpoch(store, metadata.actorId, purgeEpoch, isCurrent, () => allRows(store, (rows: (Omit<StagedPreview, "blob"> & { bytes: ArrayBuffer })[], otherBytes) => {
          if (!isCurrent()) return fail(new DOMException("O contexto da prévia mudou.", "AbortError"));
          let total = otherBytes; let existing;
          for (const row of rows) {
            if (row.expiresAt <= Date.now()) { store.delete(row.key); continue; }
            if (row.key === record.key) existing = row; else total += row.bytes.byteLength;
          }
          if (existing && (existing.imageChecksum !== record.imageChecksum || existing.saveOperationId !== record.saveOperationId || epochOf(existing) !== purgeEpoch)) return fail(new Error("PREVIEW_LOCAL_IDENTITY_MISMATCH"));
          if (total + bytes.byteLength > PREVIEW_SPOOL_MAX_BYTES) return fail(new Error("PREVIEW_LOCAL_QUOTA_EXCEEDED"));
          const write = store.put({ ...metadata, purgeEpoch, bytes, ...(existing ? { expiresAt: Math.min(existing.expiresAt, record.expiresAt) } : {}) });
          write.onsuccess = () => { try { assertCurrent(isCurrent); } catch (error) { fail(error); } };
          done();
        }), fail);
      }, STAGED);
    },
    async staged(actorId, organizationId, saveOperationId) {
      const key = JSON.stringify([actorId, organizationId, saveOperationId]);
      return transaction<StagedPreview | null>((store, done) => {
        const request = store.get(key); request.onsuccess = () => {
          const row = request.result; if (!row || row.expiresAt <= Date.now()) { if (row) store.delete(key); done(null); return; }
          const { bytes, ...metadata } = row; done({ ...metadata, purgeEpoch: epochOf(metadata), blob: new Blob([bytes], { type: "image/png" }) });
        };
      }, STAGED);
    },
    async removeStaged(key) { await transaction<void>((store, done) => { store.delete(key); done(); }, STAGED); },
  };
}
export const defaultPreviewSpool = createPreviewSpool();
