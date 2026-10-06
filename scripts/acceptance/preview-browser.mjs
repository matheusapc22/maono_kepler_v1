import { createHash, randomUUID } from 'node:crypto';
import { fail } from './production-acceptance-lib.mjs';
import { validatePreviewPng } from '../../functions/_lib/project-preview-png.js';
import { makeManifest } from './suites/durable-project-save.mjs';

const MAX_PNG_BYTES = 4 * 1024 * 1024;
const WAIT_MS = 8 * 60_000;
export function check(value, message, code = 'PNG_ACCEPTANCE_ASSERTION_FAILED') {
  if (!value) fail(code, message);
}
function ok(response, expected = 200) {
  check(response.status === expected && response.body?.ok !== false, `Resposta de acceptance divergente: HTTP ${response.status}.`);
  return response.body;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const saveHeaders = project => ({ 'X-Maono-Client-Contract': '2', 'X-Maono-Client-Build': 'registered-durable-preview-v1', 'X-Maono-Project-Id': String(project.id) });

// Closing a browser also revokes its Node-side helper requests. A completed
// request cannot resume the scenario and start another write after timeout.
export function revocableBrowserScope(ctx) {
  let active = true;
  const pending = new Set();
  const assertActive = () => check(active, 'Escopo do navegador encerrado.', 'PNG_BROWSER_SCOPE_CLOSED');
  const scope = Object.create(ctx);
  scope.assertAdmission = () => { assertActive(); ctx.assertAdmission(); };
  scope.requestTimeoutMs = ms => { assertActive(); return ctx.requestTimeoutMs(ms); };
  scope.pause = async ms => { assertActive(); await ctx.pause(ms); assertActive(); };
  scope.api = async (...args) => {
    assertActive();
    const request = ctx.api(...args);
    pending.add(request);
    request.then(() => pending.delete(request), () => pending.delete(request));
    const response = await request;
    assertActive();
    return response;
  };
  return {
    scope,
    stop() { active = false; },
    async drain(timeoutMs = 30_000) {
      let timer;
      try {
        await Promise.race([Promise.allSettled([...pending]), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('Pedidos do navegador ainda não terminaram.'),
            { name: 'AcceptanceBudgetError', code: 'PNG_BROWSER_REQUESTS_UNVERIFIED' })), timeoutMs);
        })]);
      } finally { clearTimeout(timer); }
    },
  };
}

export function allowedBrowserMutation(url, method, baseUrl, project) {
  const base = new URL(baseUrl), target = new URL(url);
  if (target.origin !== base.origin) return false;
  const root = `/api/projects/${encodeURIComponent(project.slug)}`;
  return (method === 'POST' && target.pathname === `${root}/save-operations`) ||
    (method === 'PUT' && target.pathname.startsWith(`${root}/save-operations/`) && /^\/[^/]+\/payload$/.test(target.pathname.slice(`${root}/save-operations`.length))) ||
    (['POST', 'PUT', 'PATCH'].includes(method) && target.pathname === `${root}/thumbnail`) ||
    (method === 'POST' && ['/api/observability/map-load', '/api/observability/project-preview'].includes(target.pathname));
}

// The guard never supplies fake data or successful responses. It only blocks
// writes outside the already-created synthetic project and closure budget.
export async function installBrowserWriteGuard(page, ctx, project) {
  let blocked = false;
  await page.route('**/*', async route => {
    const request = route.request(), method = request.method();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.fallback();
    try {
      ctx.assertAdmission();
      check(allowedBrowserMutation(request.url(), method, ctx.baseUrl, project), 'Mutação de navegador fora da fixture registrada.', 'PNG_BROWSER_WRITE_OUT_OF_SCOPE');
      return route.fallback();
    } catch { blocked = true; return route.abort('blockedbyclient'); }
  });
  return () => check(!blocked, 'O navegador tentou mutação fora do escopo ou prazo.', 'PNG_BROWSER_WRITE_OUT_OF_SCOPE');
}

export async function waitUntil(ctx, probe, label, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + ctx.requestTimeoutMs(timeoutMs);
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await ctx.pause(1_000);
  }
  fail('PNG_ACCEPTANCE_TIMEOUT', `${label} não confirmado no prazo; cleanup e restauração continuam obrigatórios.`);
}

export function verifySaveReceipt(receipt, saveManifest, project, organizationId, body) {
  const computed = makeManifest(body.toString('utf8'), saveManifest.operationId, saveManifest.expectedConfigRevision, 'update');
  check(computed.contentHash === saveManifest.contentHash && body.length === saveManifest.payloadBytes, 'JSON enviado diverge do manifesto capturado.');
  check(receipt?.operationId === saveManifest.operationId && Number(receipt.organizationId) === organizationId && Number(receipt.projectId) === Number(project.id) &&
    receipt.baseRevision === saveManifest.expectedConfigRevision && receipt.publishedRevision === saveManifest.expectedConfigRevision + 1 &&
    receipt.checksum === saveManifest.contentHash && receipt.checksumAlgorithm === 'dropbox-content-hash' && receipt.sizeBytes === body.length &&
    typeof receipt.committedAt === 'string', 'Recibo JSON não corresponde à fixture e aos bytes capturados.');
}
export function verifyPreviewReceipt(receipt, manifest, saved, project, organizationId) {
  check(manifest.saveOperationId === saved.operationId && manifest.revision === saved.publishedRevision && manifest.configChecksum === saved.checksum &&
    Number(manifest.projectId) === Number(project.id) && Number(manifest.organizationId) === organizationId &&
    manifest.rendererVersion === 'maono-png-v2' && typeof manifest.editorSessionId === 'string' && Number.isSafeInteger(manifest.editGeneration) &&
    manifest.editGeneration >= 0 && typeof manifest.captureMethod === 'string', 'Manifesto PNG não corresponde ao recibo JSON e editor.');
  check(receipt && Object.entries(manifest).every(([key, value]) => receipt[key] === value) && typeof receipt.artifactId === 'string' &&
    typeof receipt.committedAt === 'string', 'Recibo PNG não corresponde ao manifesto imutável.');
}

export async function readPngEvidence(page, ctx, project, receipt) {
  const path = `/api/projects/${encodeURIComponent(project.slug)}/thumbnail?v=${receipt.revision}&artifactId=${encodeURIComponent(receipt.artifactId)}`;
  const evidence = await page.evaluate(async ({ path, timeoutMs, maxBytes }) => {
    const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0] !== 'image/png') throw new Error('PNG_READ_FAILED');
    const reader = response.body.getReader(), bytes = new Uint8Array(maxBytes);
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        if (size + part.value.length > maxBytes) throw new Error('PNG_READ_OVERSIZED');
        bytes.set(part.value, size); size += part.value.length;
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const blob = new Blob([bytes.subarray(0, size)], { type: 'image/png' });
    const image = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaquePixels = 0, changedPixels = 0, fixtureColorPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] > 0) opaquePixels++;
        if (pixels[offset] > 170 && pixels[offset + 1] < 100 && pixels[offset + 2] > 110 && pixels[offset + 3] > 0) fixtureColorPixels++;
        if ([0, 1, 2].some(channel => pixels[offset + channel] !== pixels[channel])) changedPixels++;
      }
      return { width: image.width, height: image.height, sizeBytes: size, opaquePixels, changedPixels, fixtureColorPixels,
        imageChecksum: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join(''),
        revision: response.headers.get('x-maono-thumbnail-revision'), artifactId: response.headers.get('x-maono-thumbnail-artifact'),
        etag: response.headers.get('etag'), cache: response.headers.get('cache-control'), vary: response.headers.get('vary') };
    } finally { image.close(); }
  }, { path, timeoutMs: ctx.requestTimeoutMs(30_000), maxBytes: MAX_PNG_BYTES });
  check(evidence.width === 960 && evidence.height === 540 && evidence.sizeBytes === receipt.sizeBytes && evidence.imageChecksum === receipt.imageChecksum &&
    evidence.opaquePixels > 0 && evidence.changedPixels > 0 && evidence.fixtureColorPixels >= 10, 'GET PNG não comprovou bytes, decode e pixels não vazios.');
  check(Number(evidence.revision) === receipt.revision && evidence.artifactId === receipt.artifactId && evidence.etag === `"png-${receipt.imageChecksum}"` &&
    /private/.test(evidence.cache || '') && /no-cache/.test(evidence.cache || '') && /cookie/i.test(evidence.vary || '') && /authorization/i.test(evidence.vary || ''), 'GET PNG perdeu identidade ou cache privado.');
  return evidence;
}

export async function saveAndCapture(page, ctx, project, expectedRevision) {
  const root = `/api/projects/${encodeURIComponent(project.slug)}`;
  const observed = { saves: [], previews: [], json: [], png: [] };
  const listener = request => {
    const url = new URL(request.url()), method = request.method();
    if (url.origin !== new URL(ctx.baseUrl).origin) return;
    if (url.pathname === `${root}/save-operations` && method === 'POST') observed.saves.push(request.postDataJSON());
    if (url.pathname.startsWith(`${root}/save-operations/`) && url.pathname.endsWith('/payload') && method === 'PUT') observed.json.push({ id: decodeURIComponent(url.pathname.split('/').at(-2)), bytes: request.postDataBuffer() });
    if (url.pathname === `${root}/thumbnail` && method === 'POST') observed.previews.push(request.postDataJSON());
    if (url.pathname === `${root}/thumbnail` && method === 'PUT') observed.png.push({ id: url.searchParams.get('operationId'), bytes: request.postDataBuffer() });
  };
  page.on('request', listener);
  try {
    ctx.assertAdmission();
    await page.locator('#maono-map-engine-panel .maono-layer-panel__save-button').click({ timeout: ctx.requestTimeoutMs(30_000) });
    await waitUntil(ctx, () => observed.saves.length && observed.json.length && observed.previews.length && observed.png.length, 'Save/capture real');
    const saveManifest = observed.saves[0], preview = observed.previews[0];
    check(saveManifest.operation === 'update' && saveManifest.expectedConfigRevision === expectedRevision, 'Save do editor iniciou revisão inesperada.');
    check(new Set(observed.saves.map(value => value.operationId)).size === 1 && new Set(observed.previews.map(value => value.operationId)).size === 1, 'Um clique gerou múltiplas operações.');
    const json = observed.json.find(value => value.id === saveManifest.operationId)?.bytes;
    const bytes = observed.png.find(value => value.id === preview.operationId)?.bytes;
    check(Buffer.isBuffer(json) && Buffer.isBuffer(bytes) && bytes.length <= MAX_PNG_BYTES, 'Bytes reais do envio não observados.');
    const saved = await waitUntil(ctx, async () => {
      const value = ok(await ctx.api('creator', `${root}/save-operations/${encodeURIComponent(saveManifest.operationId)}`, { headers: saveHeaders(project) })).operation;
      if (value?.state === 'PUBLISHED') return value.receipt;
      check(!value?.terminal, 'Operação JSON terminou sem publicação.');
      return null;
    }, 'Recibo JSON');
    verifySaveReceipt(saved, saveManifest, project, ctx.organizationId, json);
    const receipt = await waitUntil(ctx, async () => {
      const value = ok(await ctx.api('creator', `${root}/thumbnail/status?operationId=${encodeURIComponent(preview.operationId)}`)).operation;
      if (value?.state === 'READY') return value.receipt;
      check(!value?.terminal, 'Operação PNG terminou sem publicação.');
      return null;
    }, 'Recibo PNG');
    verifyPreviewReceipt(receipt, preview, saved, project, ctx.organizationId);
    const checked = await validatePreviewPng(bytes);
    check(checked.sizeBytes === preview.sizeBytes && checked.imageChecksum === preview.imageChecksum, 'PNG enviado diverge do manifesto.');
    const image = await readPngEvidence(page, ctx, project, receipt);
    await page.locator('#maono-map-engine-panel .maono-layer-panel__save-message').filter({ hasText: `Projeto salvo na revisão ${saved.publishedRevision}. A visualização PNG já foi atualizada.` }).waitFor({ timeout: ctx.requestTimeoutMs(30_000) });
    return { saved, preview, receipt, bytes, image };
  } finally { page.off('request', listener); }
}

export async function verifyNegativePreviewCases(page, ctx, project, first, latest) {
  const root = `/api/projects/${encodeURIComponent(project.slug)}`, thumbnail = `${root}/thumbnail`;
  const status = () => ctx.api('creator', `${thumbnail}/status`).then(response => ok(response));
  const baseline = await status();
  check(baseline.configRevision === latest.saved.publishedRevision && baseline.artifactId === latest.receipt.artifactId && baseline.thumbnailStatus === 'READY', 'Ponteiro inicial PNG divergente.');
  const beforeSave = ok(await ctx.api('creator', `${root}/save-operations/${encodeURIComponent(latest.saved.operationId)}`, { headers: saveHeaders(project) })).operation.receipt;
  const stale = await ctx.api('creator', thumbnail, { method: 'POST', json: { ...first.preview, operationId: `qa-preview:${randomUUID()}` } });
  check(stale.status === 409 && stale.body?.error?.code === 'PROJECT_PREVIEW_SUPERSEDED', 'Revisão antiga não foi recusada.');
  const replay = ok(await ctx.api('creator', `${thumbnail}?operationId=${encodeURIComponent(first.preview.operationId)}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: first.bytes }));
  check(same(replay.operation?.receipt, first.receipt), 'Replay histórico alterou recibo.');
  const historical = await readPngEvidence(page, ctx, project, first.receipt);
  check(historical.imageChecksum === first.image.imageChecksum, 'Imagem histórica mudou.');
  check((await status()).artifactId === baseline.artifactId, 'Resposta histórica substituiu ponteiro atual.');
  const older = { ...latest.preview, operationId: `qa-preview:${randomUUID()}` };
  const newer = { ...latest.preview, operationId: `qa-preview:${randomUUID()}` };
  ok(await ctx.api('creator', thumbnail, { method: 'POST', json: older }), 201);
  ok(await ctx.api('creator', thumbnail, { method: 'POST', json: newer }), 201);
  const late = await ctx.api('creator', `${thumbnail}?operationId=${encodeURIComponent(older.operationId)}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: latest.bytes });
  check(late.status === 409 && late.body?.operation?.state === 'SUPERSEDED', 'Upload fora de ordem não foi recusado.');
  const accepted = await ctx.api('creator', `${thumbnail}?operationId=${encodeURIComponent(newer.operationId)}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: latest.bytes });
  check([200, 202].includes(accepted.status) && accepted.body?.ok === true, 'Substituição PNG não foi aceita.');
  const replacement = await waitUntil(ctx, async () => {
    const value = ok(await ctx.api('creator', `${thumbnail}/status?operationId=${encodeURIComponent(newer.operationId)}`)).operation;
    if (value?.state === 'READY') return value.receipt;
    check(!value?.terminal, 'Substituição PNG terminou sem publicação.');
    return null;
  }, 'PNG mais recente');
  verifyPreviewReceipt(replacement, newer, latest.saved, project, ctx.organizationId);
  await readPngEvidence(page, ctx, project, replacement);
  baseline.artifactId = replacement.artifactId;
  check((await status()).artifactId === replacement.artifactId, 'Ponteiro não pertence à última operação.');
  ctx.record('PNG-ORDER', 'PASS', { staleRevisionRejected: true, lateUploadSuperseded: true, newestArtifactPublished: true,
    historicalReceiptStable: true, historicalImageVerified: true, currentPointerPreserved: true });

  // A scoped client-side bad payload, not a provider outage or network-chaos claim.
  const invalid = Buffer.from('synthetic-invalid-png');
  const bad = { ...latest.preview, operationId: `qa-preview:${randomUUID()}`, imageChecksum: sha256(invalid), sizeBytes: invalid.length };
  ok(await ctx.api('creator', thumbnail, { method: 'POST', json: bad }), 201);
  const rejected = await ctx.api('creator', `${thumbnail}?operationId=${encodeURIComponent(bad.operationId)}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: invalid });
  check(rejected.status === 422 && rejected.body?.error?.code === 'INVALID_THUMBNAIL_PNG', 'PNG inválido não foi recusado.');
  const failed = ok(await ctx.api('creator', `${thumbnail}/status?operationId=${encodeURIComponent(bad.operationId)}`)).operation;
  check(failed?.state === 'FAILED_FINAL' && !failed.receipt, 'PNG inválido fabricou recibo ou ficou pendente.');
  const after = await status();
  check(after.configRevision === baseline.configRevision && after.thumbnailStatus === 'READY' && after.artifactId === baseline.artifactId, 'Falha PNG alterou JSON ou removeu fallback READY.');
  const afterSave = ok(await ctx.api('creator', `${root}/save-operations/${encodeURIComponent(latest.saved.operationId)}`, { headers: saveHeaders(project) })).operation.receipt;
  check(same(afterSave, beforeSave), 'Falha PNG alterou recibo JSON confirmado.');
  await readPngEvidence(page, ctx, project, replacement);
  ctx.record('PNG-FAILURE', 'PASS', { invalidPngRejected: true, jsonReceiptPreserved: true, readyFallbackPreserved: true, providerOutageTested: false });
}
