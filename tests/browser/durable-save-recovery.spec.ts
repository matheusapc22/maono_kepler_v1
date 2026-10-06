import { installLocalHttpRoute } from './fixtures/local-http-route';
import { expect, test } from "@playwright/test";
const harness = "/tests/browser/fixtures/durable-save.html";
const controllerPath = "/src/pages/Kepler/durable-save-controller.ts";
const storePath = "/src/pages/Kepler/durable-save-store.ts";
const observabilityPath = "/src/pages/Kepler/save-observability.ts";
async function prepare(page: any, payloadBytes = 0) {
  return page.evaluate(async ({ controllerPath, observabilityPath, payloadBytes }: any) => {
    const { prepareProjectUpdateSnapshot, defaultDurableSaveStore } = await import(/* @vite-ignore */ controllerPath);
    const { beginClientSaveAttempt } = await import(/* @vite-ignore */ observabilityPath);
    const value = await prepareProjectUpdateSnapshot({ attempt: beginClientSaveAttempt("update"), scope: { actorId: "22", organizationId: "9", projectKey: "demo", projectId: "12" }, projectSlug: "demo", config: { version: "v1", config: { label: "Clique: Maõno 🚀" }, datasets: [], padding: "x".repeat(payloadBytes) }, expectedConfigRevision: 7, editorSessionId: "original-editor", editGeneration: 2 });
    await defaultDurableSaveStore.put(value);
    return { key: value.key, manifest: value.manifest, byteLength: value.serialized.body.size };
  }, { controllerPath, observabilityPath, payloadBytes });
}
function receipt(value: any) { return { operationId: value.manifest.operationId, organizationId: 9, projectId: 12, baseRevision: 7, publishedRevision: 8, checksum: value.manifest.contentHash, checksumAlgorithm: "dropbox-content-hash", sizeBytes: value.byteLength, committedAt: "2026-10-05T12:00:00Z" }; }

test("IndexedDB survives reload; historical receipt at N+2 prevents upload and purges bytes", async ({ page }) => {
  await page.goto(harness); const value = await prepare(page); await page.reload();
  const calls: string[] = [];
  await installLocalHttpRoute(page, "**/api/projects/demo/save-operations/**", async route => { calls.push(route.request().method()); await route.fulfill({ json: { ok: true, operation: { state: "PUBLISHED", receipt: receipt(value), currentRevision: 9 } } }); });
  const result = await page.evaluate(async ({ controllerPath, key }: any) => {
    const { defaultDurableSaveStore, executePreparedProjectUpdate } = await import(/* @vite-ignore */ controllerPath);
    const snapshot = await defaultDurableSaveStore.get(key);
    const result = await executePreparedProjectUpdate({ snapshot });
    return { historical: result.data.operation.receipt.publishedRevision, current: result.data.operation.currentRevision, payload: (await defaultDurableSaveStore.get(key)).serialized.body };
  }, { controllerPath, key: value.key });
  expect(calls).toEqual(["GET"]); expect(result).toEqual({ historical: 8, current: 9, payload: null });
});

test("large payload and reconstructed serializable headers are byte-identical after reload", async ({ page }) => {
  await page.goto(harness); const value = await prepare(page, 8 * 1024 * 1024 + 17); await page.reload();
  const calls: string[] = []; let bytes: Buffer | null = null; let headers: any;
  await installLocalHttpRoute(page, "**/api/projects/demo/save-operations/**", async route => {
    const request = route.request(); calls.push(request.method());
    if (request.method() === "GET") await route.fulfill({ json: { ok: true, operation: { state: "AWAITING_UPLOAD", nextAction: "UPLOAD" } } });
    else { bytes = request.postDataBuffer(); headers = request.headers(); await route.fulfill({ json: { ok: true, operation: { state: "PUBLISHED", receipt: receipt(value), currentRevision: 8 } } }); }
  });
  const expectedBody = await page.evaluate(async ({ controllerPath, key }: any) => {
    const { defaultDurableSaveStore, executePreparedProjectUpdate } = await import(/* @vite-ignore */ controllerPath);
    const snapshot = await defaultDurableSaveStore.get(key); const body = await snapshot.serialized.body.text();
    await executePreparedProjectUpdate({ snapshot }); return body;
  }, { controllerPath, key: value.key });
  expect(calls).toEqual(["GET", "PUT"]); expect(bytes!.equals(Buffer.from(expectedBody))).toBe(true);
  expect(headers["x-maono-expected-revision"]).toBe("7"); expect(headers["x-maono-config-size"]).toBe(String(value.byteLength)); expect(headers["x-maono-client-contract"]).toBe("2");
});

test("offline interruption preserves bytes and online retry queries status first with same operation ID", async ({ page, context }) => {
  await page.goto(harness); const value = await prepare(page);
  await context.setOffline(true);
  const failure = await page.evaluate(async ({ controllerPath, key }: any) => {
    const { defaultDurableSaveStore, executePreparedProjectUpdate } = await import(/* @vite-ignore */ controllerPath);
    try { await executePreparedProjectUpdate({ snapshot: await defaultDurableSaveStore.get(key) }); return false; } catch { return Boolean((await defaultDurableSaveStore.get(key)).serialized.body); }
  }, { controllerPath, key: value.key });
  expect(failure).toBe(true); await context.setOffline(false); await page.reload();
  const calls: string[] = [];
  await installLocalHttpRoute(page, "**/api/projects/demo/save-operations/**", async route => { calls.push(`${route.request().method()}:${route.request().headers()["x-maono-save-id"]}`); await route.fulfill({ json: { ok: true, operation: { state: "PUBLISHED", receipt: receipt(value), currentRevision: 8 } } }); });
  await page.evaluate(async ({ controllerPath, key }: any) => { const { defaultDurableSaveStore, executePreparedProjectUpdate } = await import(/* @vite-ignore */ controllerPath); await executePreparedProjectUpdate({ snapshot: await defaultDurableSaveStore.get(key) }); }, { controllerPath, key: value.key });
  expect(calls).toEqual([`GET:${value.manifest.operationId}`]);
});

test("account isolation, logout retention, seven-day expiry and no secret headers use actual IndexedDB", async ({ page }) => {
  await page.goto(harness); const value = await prepare(page); await page.reload();
  const result = await page.evaluate(async ({ controllerPath, storePath, key }: any) => {
    const { defaultDurableSaveStore } = await import(/* @vite-ignore */ controllerPath);
    const { LOCAL_SAVE_RETENTION_MS } = await import(/* @vite-ignore */ storePath);
    const other = await defaultDurableSaveStore.listAccount("other", "9");
    const same = await defaultDurableSaveStore.listAccount("22", "9");
    const snapshot = await defaultDurableSaveStore.get(key); snapshot.expiresAt = Date.now() - 1; await defaultDurableSaveStore.put(snapshot);
    const expired = await defaultDurableSaveStore.get(key);
    return { other: other.length, same: same.length, retention: LOCAL_SAVE_RETENTION_MS, expired: expired.localState, payload: expired.serialized.body, headers: Object.keys(expired.headers) };
  }, { controllerPath, storePath, key: value.key });
  expect(result.other).toBe(0); expect(result.same).toBe(1); expect(result.retention).toBe(7 * 24 * 60 * 60 * 1000); expect(result.expired).toBe("expired"); expect(result.payload).toBeNull(); expect(result.headers).not.toContain("Authorization"); expect(result.headers).not.toContain("Cookie");
});

async function mountSaveButton(page: any) {
  // The real mounted save component/controller/storage are used. Kepler rendering,
  // auth provider and PNG capture are isolated from the deterministic UI regression.
  await page.route("**/src/auth/session.tsx*", (route: any) => route.fulfill({ contentType: "application/javascript", body: 'export const useSession = () => globalThis.__durableFixtureSession ?? ({ authenticated: true, user: { id: "22", activeOrganizationId: "9" }, activeOrganization: { id: "9" } });' }));
  await page.route("**/src/pages/Kepler/engine-adapter/index.ts*", (route: any) => route.fulfill({ contentType: "application/javascript", body: 'export const useKeplerEngineAdapter = () => ({ commands: {}, state: { transientDatasetIds: [] } });' }));
  await page.route("**/src/pages/Kepler/thumbnail/capture-thumbnail.ts*", (route: any) => route.fulfill({ contentType: "application/javascript", body: 'export const serializeProjectConfig = state => structuredClone(state.savedConfig);' }));
  await page.route("**/src/pages/Kepler/thumbnail/background-thumbnail-job.ts*", (route: any) => route.fulfill({ contentType: "application/javascript", body: 'export const enqueueProjectThumbnailJob = async () => "READY";' }));
  await page.goto("/tests/browser/fixtures/durable-save-button.html");
  await expect(page.getByRole("button", { name: "Salvar na Maõno", exact: true })).toBeVisible();
}
for (const edit of [false, true]) test(`mounted Save button preserves late drafts; uiOnly=${!edit}`, async ({ page }) => {
  let release!: () => void;
  const canReply = new Promise<void>(resolve => { release = resolve; });
  const manifests: any[] = []; const uploads: string[] = [];
  let payloadEntered = false;
  await installLocalHttpRoute(page, /\/api\/projects\/demo\/save-operations/, async route => {
    const request = route.request();
    if (request.method() === "GET") { await route.fulfill({ status: 404, json: { ok: false } }); return; }
    if (request.method() === "POST") { manifests.push(JSON.parse(request.postData()!)); await route.fulfill({ json: { ok: true, operation: { state: "AWAITING_UPLOAD" } } }); return; }
    const manifest = manifests.at(-1); uploads.push(request.postData()!); payloadEntered = true;
    if (uploads.length === 1) await canReply;
    await route.fulfill({ json: { ok: true, operation: { state: "PUBLISHED", receipt: { operationId: manifest.operationId, organizationId: 9, projectId: 12, baseRevision: manifest.expectedConfigRevision, publishedRevision: manifest.expectedConfigRevision + 1, checksum: manifest.contentHash, checksumAlgorithm: "dropbox-content-hash", sizeBytes: manifest.payloadBytes }, currentRevision: manifest.expectedConfigRevision + 1 } } });
  });
  await mountSaveButton(page);
  await page.getByRole("button", { name: "Salvar na Maõno", exact: true }).click();
  await expect.poll(() => payloadEntered).toBe(true);
  await page.getByRole("button", { name: edit ? "Edit after Save" : "Close unrelated modal", exact: true }).click();
  release();
  await expect(page.getByRole("button", { name: "Salvar na Maõno", exact: true })).toBeEnabled();
  if (edit) await expect(page.locator('div[role="status"]')).toContainText("Há alterações locais");
  else await expect(page.locator('div[role="status"]')).toContainText("Projeto salvo na revisão 8");
  expect(JSON.parse(uploads[0]).config.label).toBe("clicked");
  await page.getByRole("button", { name: "Salvar na Maõno", exact: true }).click();
  await expect.poll(() => manifests.length).toBe(2);
  expect(manifests[1].expectedConfigRevision).toBe(edit ? 7 : 8);
  await expect.poll(() => uploads.length).toBe(2);
  expect(JSON.parse(uploads[1]).config.label).toBe(edit ? "later edit" : "clicked");
});

test("mounted account switch hides original snapshot; login recovers status without another upload", async ({ page }) => {
  let release!: () => void;
  const canReply = new Promise<void>(resolve => { release = resolve; });
  let manifest: any = null; let uploaded = false; let published = false; const methods: string[] = [];
  const publishedBody = () => ({ ok: true, operation: { state: "PUBLISHED", receipt: { operationId: manifest.operationId, organizationId: 9, projectId: 12, baseRevision: 7, publishedRevision: 8, checksum: manifest.contentHash, checksumAlgorithm: "dropbox-content-hash", sizeBytes: manifest.payloadBytes }, currentRevision: 8 } });
  await installLocalHttpRoute(page, /\/api\/projects\/demo\/save-operations/, async route => {
    const request = route.request(); methods.push(request.method());
    if (request.method() === "GET") { await route.fulfill(published ? { json: publishedBody() } : { status: 404, json: { ok: false } }); return; }
    if (request.method() === "POST") { manifest = JSON.parse(request.postData()!); await route.fulfill({ json: { ok: true, operation: { state: "AWAITING_UPLOAD" } } }); return; }
    uploaded = true; await canReply; published = true;
    await route.fulfill({ json: publishedBody() });
  });
  await mountSaveButton(page);
  await page.getByRole("button", { name: "Salvar na Maõno", exact: true }).click();
  await expect.poll(() => uploaded).toBe(true);
  await page.evaluate(() => { (globalThis as any).__durableFixtureSession = { authenticated: true, user: { id: "99", activeOrganizationId: "9" }, activeOrganization: { id: "9" } }; (globalThis as any).__durableFixtureStore.dispatch({ type: "UI_ONLY" }); });
  release(); await expect.poll(() => published).toBe(true);
  await expect(page.getByRole("button", { name: "Exportar tentativa", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salvar na Maõno", exact: true })).toBeEnabled();
  expect(methods).toEqual(["GET", "POST", "PUT"]);
  await page.evaluate(() => { (globalThis as any).__durableFixtureSession = { authenticated: true, user: { id: "22", activeOrganizationId: "9" }, activeOrganization: { id: "9" } }; (globalThis as any).__durableFixtureStore.dispatch({ type: "UI_ONLY" }); });
  await expect(page.locator('div[role="status"]')).toContainText("Projeto salvo na revisão 8");
  expect(methods).toEqual(["GET", "POST", "PUT", "GET"]);
});
