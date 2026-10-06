import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
let bundle = '';
test.beforeAll(async () => {
  const result = await build({ entryPoints: ['tests/browser/fixtures/preview-spool-epochs.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'epochFixture', define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'prepared-capture-only', setup(plugin) {
      // This suite starts with captured bytes. Any attempt to recapture the live
      // editor is a test error; recovery/session/IDB modules remain real.
      plugin.onResolve({ filter: /capture-thumbnail(?:\.ts)?$/ }, () => ({ path: 'capture-boundary', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function captureProjectThumbnail() { throw new Error("Unexpected recapture during prepared-preview recovery"); }', loader: 'js' }));
    } }] });
  bundle = result.outputFiles[0].text;
});
async function load(page: any) {
  await page.route('http://localhost/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic IndexedDB epoch test</title>' }));
  await page.goto('http://localhost/'); await page.addScriptTag({ content: bundle });
}
test.beforeEach(async ({ page }) => load(page));

for (const method of ['put', 'stage', 'promote']) test(`logout fences a delayed ${method} across independent spool instances`, async ({ page }) => {
  const result = await page.evaluate(async method => {
    const f = (window as any).epochFixture, oldTab = f.spool.createPreviewSpool(), logoutTab = f.spool.createPreviewSpool();
    const capturedEpoch = await oldTab.accountEpoch('actor-a');
    const existing = await f.record('actor-a', capturedEpoch); await oldTab.put(existing);
    const pending = await f.record('actor-a', capturedEpoch), staged = f.staged(pending); await oldTab.stage(staged);
    const hold = f.holdBlob(pending.blob);
    const writing = method === 'promote' ? oldTab.promote(pending, staged.key, () => true) : oldTab[method](method === 'stage' ? staged : pending, () => true);
    const outcome = writing.then(() => 'unexpected-success', (error: any) => error.name);
    await hold.started; await logoutTab.clearAccount('actor-a'); hold.release();
    return { outcome: await outcome, capturedEpoch, after: await f.rawState(), otherTabEpoch: await f.spool.createPreviewSpool().accountEpoch('actor-a') };
  }, method);
  expect(result).toEqual({ outcome: 'AbortError', capturedEpoch: 0, after: { version: 2, previews: 0, staged: 0, epoch: 1 }, otherTabEpoch: 1 });
});

test('pre-purge committed writes are deleted in the same transaction that advances both-store epoch', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).epochFixture, a = f.spool.createPreviewSpool(), b = f.spool.createPreviewSpool();
    const record = await f.record(), stage = f.staged(await f.record()), other = await f.record('actor-b');
    await a.put(record); await a.stage(stage); await a.put(other);
    const scopes: string[][] = [], original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args: any[]) { scopes.push(Array.from(typeof args[0] === 'string' ? [args[0]] : args[0])); return original.apply(this, args as any); };
    try { await b.clearAccount('actor-a'); } finally { IDBDatabase.prototype.transaction = original; }
    return { scopes, actor: await f.rawState(), other: await f.rawState('actor-b') };
  });
  expect(result.scopes).toHaveLength(1); expect(result.scopes[0].sort()).toEqual(['actor-epochs', 'previews', 'staged']);
  expect(result.actor).toEqual({ version: 2, previews: 0, staged: 0, epoch: 1 });
  expect(result.other).toEqual({ version: 2, previews: 1, staged: 0, epoch: 0 });
});

test('concurrent purges increment persistent epochs without lost updates or automatic old-record renewal', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).epochFixture, a = f.spool.createPreviewSpool(), b = f.spool.createPreviewSpool(), legacy = await f.record();
    await a.accountEpoch('actor-a'); await Promise.all([a.clearAccount('actor-a'), b.clearAccount('actor-a')]);
    const epoch = await a.accountEpoch('actor-a');
    const old = await b.put(legacy).then(() => 'unexpected-success', (error: any) => error.name);
    const fresh = await f.record('actor-a', epoch); await b.put(fresh);
    return { epoch, old, fresh: (await a.list('actor-a', '7')).map((record: any) => record.purgeEpoch), other: await b.accountEpoch('actor-b') };
  });
  expect(result).toEqual({ epoch: 2, old: 'AbortError', fresh: [2], other: 0 });
});

for (const method of ['put', 'stage']) test(`ordinary cancellation rolls back a delayed ${method} and preserves previous recoverable bytes`, async ({ page }) => {
  const result = await page.evaluate(async method => {
    const f = (window as any).epochFixture, store = f.spool.createPreviewSpool(), r = await f.record();
    const value = method === 'stage' ? f.staged(r) : r;
    await store[method](value);
    const hold = f.holdBlob(value.blob); let current = true;
    const pending = store[method]({ ...value, attempts: 9 }, () => current).then(() => 'unexpected-success', (error: any) => error.name);
    await hold.started; current = false; hold.release();
    const outcome = await pending;
    const kept = method === 'stage' ? await store.staged('actor-a', '7', r.manifest.saveOperationId) : (await store.list('actor-a', '7'))[0];
    return { outcome, exists: Boolean(kept), size: kept?.blob.size, originalSize: r.blob.size, attempts: kept?.attempts ?? 0, epoch: await store.accountEpoch('actor-a') };
  }, method);
  expect(result.outcome).toBe('AbortError'); expect(result.exists).toBe(true); expect(result.size).toBe(result.originalSize); expect(result.attempts).toBe(0); expect(result.epoch).toBe(0);
});

test('cancellation after queued promotion aborts both changes and leaves staged PNG recoverable', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).epochFixture, store = f.spool.createPreviewSpool(), r = await f.record(), staged = f.staged(r); await store.stage(staged);
    let current = true; const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args: any[]) { const request = original.apply(this, args as any); if (this.name === 'previews' && args[0].key === r.key) current = false; return request; };
    let outcome; try { outcome = await store.promote(r, staged.key, () => current).then(() => 'unexpected-success', (error: any) => error.name); } finally { IDBObjectStore.prototype.put = original; }
    return { outcome, state: await f.rawState(), kept: Boolean(await store.staged('actor-a', '7', r.manifest.saveOperationId)) };
  });
  expect(result).toEqual({ outcome: 'AbortError', state: { version: 2, previews: 0, staged: 1, epoch: 0 }, kept: true });
});

test('staging and atomic promotion retain the captured epoch after a real purge and reload', async ({ page }) => {
  await page.evaluate(async () => {
    const f = (window as any).epochFixture, store = f.spool.createPreviewSpool(); await store.clearAccount('actor-a');
    const r = await f.record('actor-a', await store.accountEpoch('actor-a')); await store.stage(f.staged(r)); sessionStorage.setItem('epoch-record', JSON.stringify({ ...r, blob: null }));
  });
  await load(page);
  const result = await page.evaluate(async () => {
    const f = (window as any).epochFixture, store = f.spool.createPreviewSpool(), record = JSON.parse(sessionStorage.getItem('epoch-record')!);
    const staged = await store.staged('actor-a', '7', record.manifest.saveOperationId);
    await store.promote({ ...record, blob: staged.blob, purgeEpoch: staged.purgeEpoch }, staged.key);
    const rows = await store.list('actor-a', '7');
    return { state: await f.rawState(), epoch: rows[0].purgeEpoch, stagedEpoch: staged.purgeEpoch, size: rows[0].blob.size, expectedSize: record.manifest.sizeBytes };
  });
  expect(result.state).toEqual({ version: 2, previews: 1, staged: 0, epoch: 1 }); expect(result.epoch).toBe(1); expect(result.stagedEpoch).toBe(1); expect(result.size).toBe(result.expectedSize);
});

test('v1 database upgrades without dropping old bytes; legacy epoch zero is fenced after purge', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).epochFixture, r = await f.record(), s = f.staged(await f.record());
    const { blob, ...metadata } = r, { blob: stageBlob, ...stageMetadata } = s;
    const bytes = await blob.arrayBuffer(), stageBytes = await stageBlob.arrayBuffer();
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(f.spool.PREVIEW_SPOOL_DATABASE, 1);
      open.onupgradeneeded = () => { const main = open.result.createObjectStore('previews', { keyPath: 'key' }); main.createIndex('actorId', 'actorId'); main.createIndex('accountKey', 'accountKey'); const staged = open.result.createObjectStore('staged', { keyPath: 'key' }); staged.createIndex('actorId', 'actorId'); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { const db = open.result, tx = db.transaction(['previews', 'staged'], 'readwrite'); tx.objectStore('previews').put({ ...metadata, bytes }); tx.objectStore('staged').put({ ...stageMetadata, bytes: stageBytes }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
    });
    const store = f.spool.createPreviewSpool(); const epoch = await store.accountEpoch('actor-a');
    const rows = await store.list('actor-a', '7'), staged = await store.staged('actor-a', '7', s.saveOperationId), before = await f.rawState();
    await store.clearAccount('actor-a'); const oldWrite = await store.put(r).then(() => 'unexpected-success', (error: any) => error.name);
    return { before, epoch, readEpoch: rows[0].purgeEpoch, stageEpoch: staged.purgeEpoch, sameSize: rows[0].blob.size === r.blob.size && staged.blob.size === s.blob.size, after: await f.rawState(), oldWrite };
  });
  expect(result).toEqual({ before: { version: 2, previews: 1, staged: 1, epoch: 0 }, epoch: 0, readEpoch: 0, stageEpoch: 0, sameSize: true, after: { version: 2, previews: 0, staged: 0, epoch: 1 }, oldWrite: 'AbortError' });
});


test('expired session cannot revive a prepared PNG through quota fallback after same-account reauthentication', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).epochFixture, store = f.spool.defaultPreviewSpool;
    f.recovery.activatePreviewRecovery('actor-a', '7');
    const fence = f.recovery.capturePreviewSessionFence('actor-a', '7');
    const record = await f.record('actor-a', await fence.purgeEpoch), staged = f.staged(record), manifest = record.manifest;
    const snapshot = { scope: { actorId: 'actor-a', organizationId: '7', projectId: '19' }, projectSlug: 'synthetic',
      manifest: { operationId: manifest.saveOperationId, contentHash: manifest.configChecksum }, editorSessionId: manifest.editorSessionId, editGeneration: manifest.editGeneration, serialized: { body: null } };
    const receipt = { operationId: manifest.saveOperationId, organizationId: 7, projectId: 19, publishedRevision: 2, checksum: manifest.configChecksum, checksumAlgorithm: 'dropbox-content-hash' };
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), called = new Promise<void>(resolve => { entered = resolve; });
    const originalPromote = store.promote, originalFetch = window.fetch; let fetches = 0;
    store.promote = async () => { entered(); await gate; throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); };
    window.fetch = async () => { fetches++; return new Response(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED_UPLOAD' } }), { status: 503 }); };
    try {
      const pending = f.background.enqueueProjectThumbnailJob({ snapshot, data: { receipt }, capture: { promise: Promise.resolve(staged), isCurrent: fence.isCurrent, cancel: () => {} } });
      await called;
      f.recovery.activatePreviewRecovery(null, null);
      f.recovery.activatePreviewRecovery('actor-a', '7');
      release();
      const outcome = await pending;
      return { outcome, fetches, oldFenceCurrent: fence.isCurrent(), stored: (await store.list('actor-a', '7')).length };
    } finally {
      store.promote = originalPromote; window.fetch = originalFetch; f.recovery.activatePreviewRecovery(null, null);
    }
  });
  expect(result).toEqual({ outcome: 'CANCELLED', fetches: 0, oldFenceCurrent: false, stored: 0 });
});

test('same-account login waits for pending atomic purge before direct staged lookup or upload', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = (window as any).epochFixture, store = f.spool.defaultPreviewSpool;
    f.recovery.activatePreviewRecovery('actor-a', '7');
    const firstFence = f.recovery.capturePreviewSessionFence('actor-a', '7');
    const record = await f.record('actor-a', await firstFence.purgeEpoch), staged = f.staged(record), m = record.manifest;
    await store.stage(staged);
    const snapshot = { scope: { actorId: 'actor-a', organizationId: '7', projectId: '19' }, projectSlug: 'synthetic',
      manifest: { operationId: m.saveOperationId, contentHash: m.configChecksum }, editorSessionId: m.editorSessionId, editGeneration: m.editGeneration, serialized: { body: null } };
    const receipt = { operationId: m.saveOperationId, organizationId: 7, projectId: 19, publishedRevision: 2, checksum: m.configChecksum, checksumAlgorithm: 'dropbox-content-hash' };
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), called = new Promise<void>(resolve => { entered = resolve; });
    const originalClear = store.clearAccount, originalStaged = store.staged, originalPromote = store.promote, originalFetch = window.fetch;
    let reads = 0, promotions = 0, fetches = 0, finished = false;
    store.clearAccount = async (actor: string) => { entered(); await gate; return originalClear(actor); };
    store.staged = async (...args: any[]) => { reads++; return originalStaged(...args); };
    store.promote = async (...args: any[]) => { promotions++; return originalPromote(...args); };
    window.fetch = async () => { fetches++; throw new DOMException('No network is permitted in this regression', 'AbortError'); };
    try {
      f.recovery.activatePreviewRecovery(null, null, 'logout'); await called;
      f.recovery.activatePreviewRecovery('actor-a', '7');
      const pending = f.background.enqueueProjectThumbnailJob({ snapshot, data: { receipt } }).then((value: any) => { finished = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 30));
      const beforeRelease = { reads, promotions, fetches, finished };
      release(); const outcome = await pending;
      return { beforeRelease, outcome, promotions, fetches, state: await f.rawState() };
    } finally {
      release(); store.clearAccount = originalClear; store.staged = originalStaged; store.promote = originalPromote; window.fetch = originalFetch;
      f.recovery.activatePreviewRecovery(null, null);
    }
  });
  expect(result).toEqual({ beforeRelease: { reads: 0, promotions: 0, fetches: 0, finished: false }, outcome: 'WAITING_CAPTURE', promotions: 0, fetches: 0,
    state: { version: 2, previews: 0, staged: 0, epoch: 1 } });
});
