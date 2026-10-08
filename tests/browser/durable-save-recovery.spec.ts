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

async function mountSaveButton(page: any, query = "") {
  // The real mounted save component/controller/storage are used. Kepler rendering,
  // auth provider and PNG capture are isolated from the deterministic UI regression.
  await page.route("**/src/auth/session.tsx*", (route: any) => route.fulfill({ contentType: "application/javascript", body: 'export const useSession = () => globalThis.__durableFixtureSession ?? ({ authenticated: true, user: { id: "22", role: "super_admin", activeOrganizationId: "9" }, activeOrganization: { id: "9" } });' }));
  await page.route("**/src/pages/Kepler/engine-adapter/index.ts*", (route: any) => route.fulfill({ contentType: "application/javascript", body: 'export const useKeplerEngineAdapter = () => ({ commands: {}, state: { transientDatasetIds: [] } });' }));
  await page.route("**/src/pages/Kepler/thumbnail/capture-thumbnail.ts*", (route: any) => route.fulfill({ contentType: "application/javascript", body: 'export const serializeProjectConfig = state => structuredClone(state.savedConfig);' }));
  await page.route("**/src/pages/Kepler/thumbnail/background-thumbnail-job.ts*", (route: any) => route.fulfill({ contentType: "application/javascript", body: 'export const enqueueProjectThumbnailJob = async () => "READY"; export const prepareProjectThumbnailCapture = () => ({ promise: Promise.resolve(null), cancel() {} });' }));
  await page.goto(`/tests/browser/fixtures/durable-save-button.html${query}`);
  await expect(page.getByRole("button", { name: query.includes("new") ? "Salvar como projeto" : "Salvar mapa", exact: true })).toBeVisible();
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
  await page.locator('[data-maono-save-action="primary"]').click();
  await expect.poll(() => payloadEntered).toBe(true);
  await page.getByRole("button", { name: edit ? "Edit after Save" : "Close unrelated modal", exact: true }).click();
  release();
  await expect(page.locator('[data-maono-save-action="primary"]')).toBeEnabled();
  if (edit) await expect(page.locator('div[role="status"]')).toContainText("Há alterações ainda não salvas");
  else await expect(page.locator('div[role="status"]')).toContainText("Projeto salvo.");
  expect(JSON.parse(uploads[0]).config.label).toBe("clicked");
  await page.locator('[data-maono-save-action="primary"]').click();
  await expect.poll(() => manifests.length).toBe(2);
  expect(manifests[1].expectedConfigRevision).toBe(8);
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
  await page.locator('[data-maono-save-action="primary"]').click();
  await expect.poll(() => uploaded).toBe(true);
  await page.evaluate(() => { (globalThis as any).__durableFixtureSession = { authenticated: true, user: { id: "99", activeOrganizationId: "9" }, activeOrganization: { id: "9" } }; (globalThis as any).__durableFixtureStore.dispatch({ type: "UI_ONLY" }); });
  release(); await expect.poll(() => published).toBe(true);
  await expect(page.getByRole("button", { name: "Exportar tentativa", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-maono-save-action="primary"]')).toBeEnabled();
  expect(methods).toEqual(["GET", "POST", "PUT"]);
  await page.evaluate(() => { (globalThis as any).__durableFixtureSession = { authenticated: true, user: { id: "22", role: "super_admin", activeOrganizationId: "9" }, activeOrganization: { id: "9" } }; (globalThis as any).__durableFixtureStore.dispatch({ type: "UI_ONLY" }); });
  await expect(page.locator('div[role="status"]')).toContainText("Projeto salvo.");
  expect(methods).toEqual(["GET", "POST", "PUT", "GET"]);
});

test("real mounted save bridge shows a plain admission failure, support and same-ID retry", async ({ page, context }, testInfo) => {
  let admitted = false; let manifest: any; const calls: { method: string; id: string | undefined }[] = [];
  await installLocalHttpRoute(page, /\/api\/projects\/demo\/save-operations/, async route => {
    const request = route.request(); calls.push({ method: request.method(), id: request.headers()['x-maono-save-id'] });
    if (request.method() === 'GET') return route.fulfill({ status: 404, json: { ok: false, error: { code: 'SAVE_OPERATION_NOT_FOUND' } } });
    if (request.method() === 'POST') {
      manifest = request.postDataJSON();
      return route.fulfill(admitted ? { json: { ok: true, operation: { state: 'AWAITING_UPLOAD' } } } : { status: 503, json: { ok: false, error: { code: 'PROJECT_DURABLE_SAVE_PAUSED', message: 'Private provider stack should not appear' } } });
    }
    return route.fulfill({ json: { ok: true, operation: { state: 'PUBLISHED', receipt: { operationId: manifest.operationId, organizationId: 9, projectId: 12, baseRevision: 7, publishedRevision: 8, checksum: manifest.contentHash, checksumAlgorithm: 'dropbox-content-hash', sizeBytes: manifest.payloadBytes }, currentRevision: 8 } } });
  });
  await mountSaveButton(page, '?panel=1');
  const footer = page.locator('[data-panel-save-action]');
  const primary = footer.locator('[data-panel-save-proxy=primary]');
  await primary.click();
  await expect(primary).toHaveText('Tentar novamente');
  await expect(footer.getByRole('alert')).toHaveText('Não foi possível concluir o salvamento. Tente novamente. Se o problema continuar, procure o suporte.');
  await expect(footer).not.toContainText(/tentativa|7 dias|revisão|PRIVATE|provider|Referência|snapshot|PNG/i);
  expect(calls.map(call => call.method)).toEqual(['GET', 'POST', 'GET']);
  await footer.screenshot({ path: testInfo.outputPath('plain-save-error.png') });
  const support = footer.getByRole('button', { name: 'Abrir central de chamados' });
  await support.focus(); await expect(support).toBeFocused();
  // Verify the existing Central URL, in a separate tab so no draft is navigated away.
  await context.route('**/projects?cc_org=9', route => route.fulfill({ contentType: 'text/html', body: '<title>Support destination</title>' }));
  const popupPromise = page.waitForEvent('popup'); await support.press('Enter');
  const popup = await popupPromise; await popup.waitForLoadState();
  expect(new URL(popup.url()).pathname + new URL(popup.url()).search).toBe('/projects?cc_org=9');
  expect(page.url()).toContain('durable-save-button.html'); await popup.close();
  admitted = true;
  await primary.click();
  await expect(primary).toHaveText('Salvo');
  await expect(footer).toHaveAttribute('data-save-state', 'saved');
  await footer.screenshot({ path: testInfo.outputPath('confirmed-save.png') });
  expect(new Set(calls.map(call => call.id)).size).toBe(1);
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  await page.getByRole('button', { name: 'Edit after Save' }).click();
  await expect(primary).toHaveText('Salvar mapa');
  await expect(footer).toHaveAttribute('data-save-state', 'idle');
  await expect(footer).not.toContainText('Projeto salvo.');
});

test("a successful transport with an invalid receipt never displays Saved and keeps the clicked bytes", async ({ page }) => {
  await installLocalHttpRoute(page, /\/api\/projects\/demo\/save-operations/, async route => route.fulfill({ json: { ok: true, operation: { state: 'PUBLISHED', receipt: { publishedRevision: 8 } } } }));
  await mountSaveButton(page);
  await page.getByRole('button', { name: 'Salvar mapa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvo', exact: true })).toHaveCount(0);
  const retained = await page.evaluate(async () => {
    const { defaultDurableSaveStore } = await import('/src/pages/Kepler/durable-save-controller.ts');
    const [snapshot] = await defaultDurableSaveStore.listAccount('22', '9');
    return { state: snapshot.localState, body: await snapshot.serialized.body.text() };
  });
  expect(retained.state).toBe('pending'); expect(JSON.parse(retained.body).config.label).toBe('clicked');
});

test("create form keeps title and exact creation intent on retry without technical progress", async ({ page }) => {
  const bodies: string[] = [];
  await installLocalHttpRoute(page, '**/api/projects', async route => { bodies.push(route.request().postData()!); await route.fulfill({ status: 503, json: { ok: false, error: { code: 'PROJECT_DURABLE_SAVE_PAUSED', message: 'private server detail' } } }); });
  await mountSaveButton(page, '?new=1');
  await page.getByRole('button', { name: 'Salvar como projeto', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: /Título/ })).toBeFocused();
  await dialog.getByRole('textbox', { name: /Título/ }).fill('Meu mapa');
  await dialog.getByRole('button', { name: 'Salvar projeto', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Não foi possível concluir o salvamento');
  await expect(dialog).not.toContainText(/slug|servidor|registro|vínculo|arquivos|tentativa|7 dias|private/i);
  await expect(dialog.getByRole('textbox', { name: /Título/ })).toHaveValue('Meu mapa');
  await dialog.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[0]).toBe(bodies[1]);
  await expect(dialog.getByRole('button', { name: 'Abrir central de chamados' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeFocused();
});

test("a terminal conflict preserves the draft without offering an impossible retry, including after reload", async ({ page }) => {
  let reads = 0;
  await installLocalHttpRoute(page, /\/api\/projects\/demo\/save-operations/, async route => { reads++; await route.fulfill({ json: { ok: true, operation: { state: 'CONFLICT' } } }); });
  await mountSaveButton(page, '?panel=1');
  await page.getByRole('button', { name: 'Salvar mapa', exact: true }).click();
  const footer = page.locator('[data-panel-save-action]');
  await expect(footer.getByRole('alert')).toContainText('o projeto foi alterado');
  await expect(footer.getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
  await expect(footer.getByRole('button', { name: 'Abrir central de chamados' })).toBeVisible();
  await page.reload();
  await expect(footer.getByRole('alert')).toContainText('o projeto foi alterado');
  expect(reads).toBe(1);
  const retained = await page.evaluate(async () => {
    const { defaultDurableSaveStore } = await import('/src/pages/Kepler/durable-save-controller.ts');
    const [snapshot] = await defaultDurableSaveStore.listAccount('22', '9');
    return { state: snapshot.localState, body: await snapshot.serialized.body.text(), base: snapshot.expectedConfigRevision };
  });
  expect(retained.state).toBe('conflict'); expect(retained.base).toBe(7); expect(JSON.parse(retained.body).config.label).toBe('clicked');
});
