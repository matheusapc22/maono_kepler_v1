import assert from "node:assert/strict";
import test from "node:test";
import { SAVE_STALL_NOTICE_MS, executePreparedProjectUpdate, isSaveRequestAbort, runWithSaveStallNotice, hashSavePayload } from "../src/pages/Kepler/durable-save-controller.ts";
import { createIndexedDbSaveStore, LocalSaveStorageError } from "../src/pages/Kepler/durable-save-store.ts";
import { memoryStore, snapshot, response, status, published, receipt, scope } from "./helpers/durable-save-browser-fixtures.mjs";

function hangingFetch(_url, init = {}) { return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })); }
test("stall is only a notice; explicit abort stops waiting without cancelling the operation", async () => {
  const controller = new AbortController(); let stalled = 0; let settled = false;
  const pending = runWithSaveStallNotice({ stallAfterMs: 5, onStall: () => stalled++, operation: () => hangingFetch("/test", { signal: controller.signal }) }).finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(stalled, 1); assert.equal(controller.signal.aborted, false); assert.equal(settled, false);
  controller.abort(); await assert.rejects(pending, isSaveRequestAbort); assert.equal(SAVE_STALL_NOTICE_MS, 12000);
});
test("IndexedDB unavailable or quota failure blocks all network requests and gives an export warning", async () => {
  const value = await snapshot(); let calls = 0;
  await assert.rejects(executePreparedProjectUpdate({ snapshot: value, store: createIndexedDbSaveStore(undefined), fetchImpl: async () => { calls++; } }), /recuperação local.*Exporte/s);
  const store = memoryStore(); store.put = async () => { throw new LocalSaveStorageError("LOCAL_SAVE_QUOTA_EXCEEDED"); };
  await assert.rejects(executePreparedProjectUpdate({ snapshot: value, store, fetchImpl: async () => { calls++; } }), /espaço.*Exporte/s);
  assert.equal(calls, 0);
});
test("explicit snapshot is durable before status, manifest and raw exact-byte upload; receipt purges bytes", async () => {
  const value = await snapshot(); const store = memoryStore(); const calls = [];
  const result = await executePreparedProjectUpdate({ snapshot: value, store, fetchImpl: async (url, init) => {
    assert.ok(await store.get(value.key), "write must finish before every network request"); calls.push({ url, init });
    if (calls.length === 1) return response({ ok: false }, 404);
    if (calls.length === 2) return status("AWAITING_UPLOAD");
    return published(value);
  } });
  assert.deepEqual(calls.map(value => value.init.method), ["GET", "POST", "PUT"]);
  assert.deepEqual(JSON.parse(calls[1].init.body), value.manifest);
  assert.equal(await calls[2].init.body.text(), await value.serialized.body.text());
  assert.equal(await hashSavePayload(calls[2].init.body), value.manifest.contentHash);
  assert.equal(new Set(calls.map(value => value.init.headers["X-Maono-Save-Id"])).size, 1);
  assert.equal(new Set(calls.map(value => value.init.headers["X-Correlation-Id"])).size, 3);
  assert.ok(calls.every(value => value.init.headers["X-Maono-Client-Contract"] === "2"));
  assert.equal(result.data.operation.receipt.publishedRevision, 8);
  assert.equal((await store.get(value.key)).serialized.body, null);
});
test("lost upload response checks historical receipt first, even after head advances to N+2", async () => {
  const value = await snapshot(); const store = memoryStore(); const calls = [];
  const result = await executePreparedProjectUpdate({ snapshot: value, store, fetchImpl: async (_url, init) => {
    calls.push(init.method); if (calls.length === 1) return status("AWAITING_UPLOAD");
    if (calls.length === 2) throw new TypeError("Failed to fetch");
    return published(value, 9);
  } });
  assert.deepEqual(calls, ["GET", "PUT", "GET"]); assert.equal(result.data.operation.currentRevision, 9);
  assert.equal(result.data.operation.receipt.publishedRevision, 8);
});
test("reconstructed reload snapshot polls accepted work without retransmitting", async () => {
  const value = await snapshot(); const store = memoryStore(); await store.put(value); const calls = [];
  const recovered = await store.get(value.key);
  await executePreparedProjectUpdate({ snapshot: recovered, store, pollIntervalMs: 1, fetchImpl: async (_url, init) => { calls.push(init.method); return calls.length === 1 ? status("PAYLOAD_STORED", { nextAction: "POLL" }) : published(value); } });
  assert.deepEqual(calls, ["GET", "GET"]);
});
test("conflict preserves the exact snapshot, expected revision and receipt absence", async () => {
  const value = await snapshot(); const store = memoryStore();
  await assert.rejects(executePreparedProjectUpdate({ snapshot: value, store, fetchImpl: async () => status("CONFLICT") }), /preservadas/);
  const stored = await store.get(value.key); assert.equal(stored.localState, "conflict"); assert.equal(stored.expectedConfigRevision, 7); assert.equal(stored.receipt, undefined); assert.equal(await stored.serialized.body.text(), await value.serialized.body.text());
});
test("same ID with another payload never replaces a pending immutable snapshot", async () => {
  const value = await snapshot(); const store = memoryStore(); await store.put(value);
  const changed = structuredClone(value); changed.manifest.contentHash = "a".repeat(64); let calls = 0;
  await assert.rejects(executePreparedProjectUpdate({ snapshot: changed, store, fetchImpl: async () => { calls++; } }), /mesmo ID/); assert.equal(calls, 0);
});
test("account, organization and project scope changes cannot read or resume another account", async () => {
  const value = await snapshot(); const store = memoryStore(); await store.put(value); let calls = 0;
  assert.deepEqual(await store.listAccount("other", "9"), []);
  for (const altered of [{ ...scope, actorId: "other" }, { ...scope, organizationId: "other" }, { ...scope, projectKey: "other" }]) await assert.rejects(executePreparedProjectUpdate({ snapshot: value, scope: altered, store, fetchImpl: async () => { calls++; } }), /outra conta/);
  await assert.rejects(executePreparedProjectUpdate({ snapshot: value, store, isScopeCurrent: () => false, fetchImpl: async () => { calls++; } }), isSaveRequestAbort); assert.equal(calls, 0);
});
test("receipt scope or integrity mismatch never purges bytes or reports confirmed", async () => {
  const value = await snapshot();
  for (const changed of [{ checksum: "0".repeat(64) }, { organizationId: "other" }, { projectId: 99 }, { baseRevision: 6 }, { sizeBytes: 1 }, { operationId: "another" }]) {
    const store = memoryStore();
    await assert.rejects(executePreparedProjectUpdate({ snapshot: value, store, fetchImpl: async () => published(value, 8, { receipt: receipt(value, 8, changed) }) }), /recibo.*incompleto/);
    assert.ok((await store.get(value.key)).serialized.body);
  }
});
test("expired payload checks status but never uploads or silently substitutes current edits", async () => {
  const value = await snapshot(); value.expiresAt = Date.now() - 1; const store = memoryStore(); let calls = 0;
  await assert.rejects(executePreparedProjectUpdate({ snapshot: value, store, fetchImpl: async () => { calls++; return status("AWAITING_UPLOAD"); } }), /expirou após 7 dias/);
  assert.equal(calls, 1);
});

test("cross-tab local writes cannot resurrect confirmed bytes, extend retention or undo review", async () => {
  const { mergeLocalSaveSnapshot } = await import("../src/pages/Kepler/durable-save-store.ts");
  const value = await snapshot(); const confirmed = { ...value, localState: "confirmed", receipt: receipt(value), serialized: { ...value.serialized, body: null } };
  const merged = mergeLocalSaveSnapshot(confirmed, { ...value, expiresAt: value.expiresAt + 100000 });
  assert.equal(merged.localState, "confirmed"); assert.equal(merged.serialized.body, null); assert.equal(merged.expiresAt, value.expiresAt);
  assert.equal(mergeLocalSaveSnapshot({ ...value, resolvedAt: 1 }, value).resolvedAt, 1);
});

test("a replacement project reusing the slug cannot resume or upload the old project's snapshot", async () => {
  const { snapshotMatchesProject } = await import("../src/pages/Kepler/durable-save-store.ts");
  const value = await snapshot(); const store = memoryStore(); await store.put(value); let calls = 0;
  assert.equal(snapshotMatchesProject(value, "22", "9", "demo", "12"), true);
  assert.equal(snapshotMatchesProject(value, "22", "9", "demo", "99"), false);
  await assert.rejects(executePreparedProjectUpdate({ snapshot: value, scope: { ...value.scope, projectId: "99" }, store, fetchImpl: async () => { calls++; } }), /outra conta/);
  assert.equal(calls, 0); assert.ok((await store.get(value.key)).serialized.body);
  assert.equal(value.headers["X-Maono-Project-Id"], "12");
});

test("explicit registration validation rejection remains exportable and can be reviewed", async () => {
  const value = await snapshot(); const store = memoryStore(); let calls = 0;
  await assert.rejects(executePreparedProjectUpdate({ snapshot: value, store, fetchImpl: async () => ++calls === 1 ? response({ ok: false }, 404) : response({ ok: false, error: { code: "PROJECT_IDENTITY_CHANGED" } }, 409) }));
  const stored = await store.get(value.key); assert.equal(stored.localState, "failed"); assert.ok(stored.serialized.body);
});

test("ambiguous HTTP 5xx after mutation checks receipt without a second upload", async () => {
  const value = await snapshot(); const store = memoryStore(); const calls = [];
  await executePreparedProjectUpdate({ snapshot: value, store, fetchImpl: async (_url, init) => {
    calls.push(init.method);
    if (calls.length === 1) return status("AWAITING_UPLOAD");
    if (calls.length === 2) return response({ ok: false }, 503);
    return published(value);
  } });
  assert.deepEqual(calls, ["GET", "PUT", "GET"]);
});

test("stale cross-tab snapshot cannot restore purged confirmed creation metadata", async () => {
  const { mergeLocalSaveSnapshot } = await import("../src/pages/Kepler/durable-save-store.ts");
  const value = await snapshot();
  const confirmed = { ...value, localState: "confirmed", receipt: receipt(value), creation: { idempotencyKey: "creation:key", requestBody: null }, serialized: { ...value.serialized, body: null } };
  const stale = { ...value, creation: { idempotencyKey: "creation:key", requestBody: JSON.stringify({ name: "Old private title", description: "Old private description" }) } };
  const merged = mergeLocalSaveSnapshot(confirmed, stale);
  assert.equal(merged.creation.requestBody, null); assert.equal(merged.creation.idempotencyKey, "creation:key");
  assert.equal(merged.serialized.body, null); assert.equal(merged.localState, "confirmed");
});
