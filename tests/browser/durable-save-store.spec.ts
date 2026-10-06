import { expect, test, type Page } from "@playwright/test";

const harness = "/tests/browser/fixtures/durable-save.html";
const storePath = "/src/pages/Kepler/durable-save-store.ts";
const controllerPath = "/src/pages/Kepler/durable-save-controller.ts";
const observabilityPath = "/src/pages/Kepler/save-observability.ts";

async function prepare(page: Page) {
  await page.goto(harness);
  return page.evaluate(async ({ storePath, controllerPath, observabilityPath }) => {
    const storage = await import(/* @vite-ignore */ storePath);
    const controller = await import(/* @vite-ignore */ controllerPath);
    const { beginClientSaveAttempt } = await import(/* @vite-ignore */ observabilityPath);
    const value = await controller.prepareProjectUpdateSnapshot({
      attempt: beginClientSaveAttempt("update"), scope: { actorId: "22", organizationId: "9", projectKey: "demo", projectId: "12" },
      projectSlug: "demo", expectedConfigRevision: 7, editorSessionId: "store-test", editGeneration: 2,
      config: { version: "v1", config: { label: "Clique: Maõno 🚀", binaryCharacters: "\u0000\u0080\u00ff" }, datasets: [], padding: "é".repeat(32 * 1024) },
    });
    const state: any = {
      ...storage, ...controller, value, store: storage.createIndexedDbSaveStore(), writes: [], fault: {}, network: [],
      raw: async (operation: "get" | "put", argument: any) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(storage.DURABLE_SAVE_DATABASE, 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<any>((resolve, reject) => {
            const tx = db.transaction("operations", operation === "put" ? "readwrite" : "readonly");
            const request = tx.objectStore("operations")[operation](argument);
            let failure: any;
            request.onerror = () => { failure = request.error; };
            tx.oncomplete = () => resolve(request.result);
            tx.onabort = () => reject(failure || tx.error);
          });
        } finally { db.close(); }
      },
      published: () => new Response(JSON.stringify({ ok: true, operation: { state: "PUBLISHED", currentRevision: 9, receipt: {
        operationId: value.manifest.operationId, organizationId: 9, projectId: 12, baseRevision: 7, publishedRevision: 8,
        checksum: value.manifest.contentHash, checksumAlgorithm: value.manifest.checksumAlgorithm, sizeBytes: value.manifest.payloadBytes,
      } } }), { headers: { "Content-Type": "application/json" } }),
    };
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (record: any, ...args: any[]) {
      if (this.name !== "operations") return originalPut.call(this, record, ...args);
      const format = record.serialized?.body instanceof Blob ? "blob" : record.serialized?.body instanceof ArrayBuffer ? "bytes" : "empty";
      state.writes.push(format);
      const fault = state.fault[format];
      if (fault) throw new DOMException(fault.message, fault.name);
      const request = originalPut.call(this, record, ...args);
      if (state.fault.abortOnSuccess) request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
    (globalThis as any).__durableStoreTest = state;
    // Initialize the real object store and indexes before any direct legacy reads.
    await state.store.listAccount("22", "9");
    return { key: value.key, size: value.manifest.payloadBytes, hash: value.manifest.contentHash, type: value.serialized.body.type };
  }, { storePath, controllerPath, observabilityPath });
}

for (const name of ["UnknownError", "DataCloneError"]) test(`${name} for Blob persistence falls back to committed, versioned bytes and survives reload`, async ({ page }) => {
  const expected = await prepare(page);
  const written = await page.evaluate(async name => {
    const state = (globalThis as any).__durableStoreTest;
    state.fault.blob = { name, message: "Error preparing Blob/File data to be stored in object store" };
    await state.store.put(state.value);
    const raw = await state.raw("get", state.value.key);
    return { writes: state.writes, encoding: raw.serialized.bodyEncoding, bytes: raw.serialized.body.byteLength, blob: raw.serialized.body instanceof Blob };
  }, name);
  expect(written).toEqual({ writes: ["blob", "bytes"], encoding: "arraybuffer-v1", bytes: expected.size, blob: false });
  await page.reload();
  const recovered = await page.evaluate(async ({ storePath, controllerPath, expected }) => {
    const { createIndexedDbSaveStore } = await import(/* @vite-ignore */ storePath);
    const { hashSavePayload } = await import(/* @vite-ignore */ controllerPath);
    const store = createIndexedDbSaveStore();
    const value = await store.get(expected.key);
    return {
      blob: value.serialized.body instanceof Blob, hash: await hashSavePayload(value.serialized.body), size: value.serialized.body.size,
      type: value.serialized.body.type, manifest: value.manifest.contentHash, encoding: value.serialized.bodyEncoding ?? null,
      account: (await store.listAccount("22", "9")).length, other: (await store.listAccount("other", "9")).length,
      scope: (await store.list(value.scope)).length,
    };
  }, { storePath, controllerPath, expected });
  expect(recovered).toEqual({ blob: true, hash: expected.hash, size: expected.size, type: expected.type, manifest: expected.hash, encoding: null, account: 1, other: 0, scope: 1 });
});

test("existing native Blob records remain readable without rewriting their representation", async ({ page }) => {
  const expected = await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (globalThis as any).__durableStoreTest;
    try { await state.raw("put", state.value); }
    catch (error: any) { return { unsupported: { name: error.name, message: error.message } }; }
    const value = await state.store.get(state.value.key);
    const raw = await state.raw("get", state.value.key);
    return { hash: await state.hashSavePayload(value.serialized.body), blob: raw.serialized.body instanceof Blob, encoding: raw.serialized.bodyEncoding ?? null, writes: state.writes };
  });
  if (result.unsupported) {
    expect(["UnknownError", "DataCloneError"]).toContain(result.unsupported.name);
    expect(result.unsupported.message).toMatch(/\bblob\b/i);
    test.skip(true, "This browser cannot create a native legacy Blob record; the versioned-byte recovery cases still run.");
  }
  expect(result).toEqual({ hash: expected.hash, blob: true, encoding: null, writes: ["blob"] });
});

for (const fault of [
  { name: "QuotaExceededError", message: "Storage quota exceeded", code: "LOCAL_SAVE_QUOTA_EXCEEDED" },
  { name: "UnknownError", message: "Database file is unavailable", code: "LOCAL_SAVE_STORAGE_UNAVAILABLE" },
  { name: "UnknownError", message: "Blob backing file is corrupted", code: "LOCAL_SAVE_STORAGE_UNAVAILABLE" },
  { name: "UnknownError", message: "Error preparing Blob/File data: quota exceeded", code: "LOCAL_SAVE_STORAGE_UNAVAILABLE" },
  { name: "UnknownError", message: "Error preparing Blob/File data: corrupted backing file", code: "LOCAL_SAVE_STORAGE_UNAVAILABLE" },
  { name: "DataCloneError", message: "The object could not be cloned", code: "LOCAL_SAVE_STORAGE_UNAVAILABLE" },
]) test(`${fault.name}: ${fault.message} never retries or transmits without durable storage`, async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async fault => {
    const state = (globalThis as any).__durableStoreTest;
    state.fault.blob = fault;
    let code;
    try { await state.executePreparedProjectUpdate({ snapshot: state.value, store: state.store, fetchImpl: async () => { state.network.push("request"); return state.published(); } }); }
    catch (error: any) { code = error.code; }
    return { code, writes: state.writes, network: state.network, record: await state.store.get(state.value.key) };
  }, fault);
  expect(result).toEqual({ code: fault.code, writes: ["blob"], network: [], record: null });
});

test("quota failure during the byte fallback is not acknowledged and sends no requests", async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (globalThis as any).__durableStoreTest;
    state.fault = { blob: { name: "UnknownError", message: "Error preparing Blob/File data" }, bytes: { name: "QuotaExceededError", message: "Quota exceeded" } };
    let code;
    try { await state.executePreparedProjectUpdate({ snapshot: state.value, store: state.store, fetchImpl: async () => { state.network.push("request"); return state.published(); } }); }
    catch (error: any) { code = error.code; }
    return { code, writes: state.writes, network: state.network, record: await state.store.get(state.value.key) };
  });
  expect(result).toEqual({ code: "LOCAL_SAVE_QUOTA_EXCEEDED", writes: ["blob", "bytes"], network: [], record: null });
});

test("a successful IndexedDB request followed by transaction abort never acknowledges a save", async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (globalThis as any).__durableStoreTest;
    state.fault = { blob: { name: "UnknownError", message: "Error preparing Blob/File data" }, abortOnSuccess: true };
    let code;
    try { await state.executePreparedProjectUpdate({ snapshot: state.value, store: state.store, fetchImpl: async () => { state.network.push("request"); return state.published(); } }); }
    catch (error: any) { code = error.code; }
    return { code, writes: state.writes, network: state.network, record: await state.store.get(state.value.key) };
  });
  expect(result).toEqual({ code: "LOCAL_SAVE_STORAGE_UNAVAILABLE", writes: ["blob", "bytes"], network: [], record: null });
});

test("immutable identity rejects replacement manifests and project IDs in byte records", async ({ page }) => {
  const expected = await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (globalThis as any).__durableStoreTest;
    state.fault.blob = { name: "UnknownError", message: "Error preparing Blob/File data" };
    await state.store.put(state.value);
    const codes = [];
    for (const value of [
      { ...state.value, manifest: { ...state.value.manifest, contentHash: "a".repeat(64) } },
      { ...state.value, scope: { ...state.value.scope, projectId: "99" }, headers: { ...state.value.headers, "X-Maono-Project-Id": "99" } },
    ]) {
      try { await state.store.put(value); }
      catch (error: any) { codes.push(error.code); }
    }
    const value = await state.store.get(state.value.key);
    return { codes, hash: await state.hashSavePayload(value.serialized.body), projectId: value.scope.projectId, state: value.localState };
  });
  expect(result).toEqual({ codes: ["LOCAL_SAVE_CORRUPTED", "LOCAL_SAVE_CORRUPTED"], hash: expected.hash, projectId: "12", state: "pending" });
});

test("confirmed receipts win while an older writer asynchronously prepares byte storage", async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (globalThis as any).__durableStoreTest;
    state.value.creation = { idempotencyKey: "creation:test", requestBody: "private project title" };
    state.fault.blob = { name: "UnknownError", message: "Error preparing Blob/File data" };
    await state.store.put(state.value);
    const stale = state.createIndexedDbSaveStore();
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = state.value.serialized.body.arrayBuffer.bind(state.value.serialized.body);
    state.value.serialized.body.arrayBuffer = async () => { entered(); await gate; return original(); };
    const staleWrite = stale.put({ ...state.value, expiresAt: state.value.expiresAt + 100000 });
    await waiting;
    const confirmed = await state.executePreparedProjectUpdate({ snapshot: state.value, store: state.store, fetchImpl: async () => state.published() });
    release(); await staleWrite;
    const value = await state.store.get(state.value.key);
    const raw = await state.raw("get", state.value.key);
    return { state: value.localState, receipt: value.receipt.publishedRevision, body: value.serialized.body, creation: value.creation.requestBody,
      rawBody: raw.serialized.body, expiresAt: value.expiresAt, originalExpiresAt: state.value.expiresAt, revision: confirmed.data.operation.currentRevision };
  });
  expect(result).toEqual({ state: "confirmed", receipt: 8, body: null, creation: null, rawBody: null, expiresAt: result.originalExpiresAt, originalExpiresAt: result.originalExpiresAt, revision: 9 });
});

test("expiry purges byte records across accounts, stays monotonic, and accepts a later historical receipt", async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (globalThis as any).__durableStoreTest;
    state.value.creation = { idempotencyKey: "creation:test", requestBody: "private project title" };
    state.fault.blob = { name: "UnknownError", message: "Error preparing Blob/File data" };
    await state.store.put(state.value);
    const raw = await state.raw("get", state.value.key);
    raw.expiresAt = Date.now() - 1;
    await state.raw("put", raw);
    const other = await state.store.listAccount("other", "9");
    const expired = await state.raw("get", state.value.key);
    await state.createIndexedDbSaveStore().put({ ...state.value, resolvedAt: 123 });
    await state.createIndexedDbSaveStore().put(state.value);
    const stale = await state.store.get(state.value.key);
    const calls: string[] = [];
    await state.executePreparedProjectUpdate({ snapshot: state.value, store: state.store, fetchImpl: async (_url: string, init: RequestInit) => { calls.push(init.method!); return state.published(); } });
    const confirmed = await state.store.get(state.value.key);
    return { other: other.length, expired: { state: expired.localState, body: expired.serialized.body, creation: expired.creation.requestBody },
      stale: { state: stale.localState, body: stale.serialized.body, creation: stale.creation.requestBody, reviewed: stale.resolvedAt, expiry: stale.expiresAt },
      originalExpiry: raw.expiresAt, confirmed: { state: confirmed.localState, body: confirmed.serialized.body, creation: confirmed.creation.requestBody, receipt: confirmed.receipt.publishedRevision }, calls };
  });
  expect(result).toEqual({ other: 0, expired: { state: "expired", body: null, creation: null },
    stale: { state: "expired", body: null, creation: null, reviewed: 123, expiry: result.originalExpiry }, originalExpiry: result.originalExpiry,
    confirmed: { state: "confirmed", body: null, creation: null, receipt: 8 }, calls: ["GET"] });
});

for (const corruption of ["encoding", "size", "type"]) test(`invalid byte record ${corruption} blocks recovery before any request`, async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async corruption => {
    const state = (globalThis as any).__durableStoreTest;
    state.fault.blob = { name: "UnknownError", message: "Error preparing Blob/File data" };
    await state.store.put(state.value);
    const raw = await state.raw("get", state.value.key);
    if (corruption === "encoding") raw.serialized.bodyEncoding = "arraybuffer-v99";
    if (corruption === "size") raw.serialized.body = new ArrayBuffer(1);
    if (corruption === "type") raw.serialized.body = "not bytes";
    await state.raw("put", raw);
    let code;
    try { await state.executePreparedProjectUpdate({ snapshot: state.value, store: state.store, fetchImpl: async () => { state.network.push("request"); return state.published(); } }); }
    catch (error: any) { code = error.code; }
    return { code, network: state.network };
  }, corruption);
  expect(result).toEqual({ code: "LOCAL_SAVE_CORRUPTED", network: [] });
});

test("same-size byte corruption never reaches upload or becomes confirmed", async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (globalThis as any).__durableStoreTest;
    state.fault.blob = { name: "UnknownError", message: "Error preparing Blob/File data" };
    await state.store.put(state.value);
    const raw = await state.raw("get", state.value.key);
    new Uint8Array(raw.serialized.body)[0] ^= 1;
    await state.raw("put", raw);
    let code;
    try { await state.executePreparedProjectUpdate({ snapshot: state.value, store: state.store, fetchImpl: async (_url: string, init: RequestInit) => {
      state.network.push(init.method); return new Response(JSON.stringify({ ok: true, operation: { state: "AWAITING_UPLOAD" } }), { headers: { "Content-Type": "application/json" } });
    } }); } catch (error: any) { code = error.code; }
    return { code, network: state.network, state: (await state.store.get(state.value.key)).localState };
  });
  expect(result).toEqual({ code: "LOCAL_SAVE_PAYLOAD_INTEGRITY_FAILED", network: ["GET"], state: "pending" });
});
