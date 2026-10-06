import { readFile } from 'node:fs/promises';
import { manifest as durable, prepare as prepareDurable, verifyPreflight as verifyDurablePreflight, createSyntheticProjectForPreview } from './durable-project-save.mjs';
import { check, installBrowserWriteGuard, saveAndCapture, readPngEvidence, verifyNegativePreviewCases, revocableBrowserScope } from '../preview-browser.mjs';

export const manifest = Object.freeze({
  id: 'durable-project-preview', version: 1,
  description: 'Actual editor capture and authenticated private PNG publication bound to durable JSON receipts',
  mutationMode: 'controlled_mutation', mutationBudgetMs: 45 * 60_000, requiresBrowser: true,
  requiredProfiles: [...durable.requiredProfiles], requiredRoles: durable.requiredRoles,
  requiredOrganization: durable.requiredOrganization,
  requiredPermissions: { creator: ['project.create', 'project.view', 'project.save', 'project.map.edit'], administrator: ['admin.panel.access'] },
  managedFlags: {
    ...durable.managedFlags,
    PROJECT_PREVIEW_OPERATIONS_V1: { requiredBefore: false, activeValue: true, safeValue: false },
    PROJECT_PREVIEW_PROCESSOR_ENABLED: { requiredBefore: false, activeValue: true, safeValue: false },
    VITE_PROJECT_PREVIEW_OPERATIONS_V1: { requiredBefore: false, activeValue: true, safeValue: false },
  },
  prerequisites: [
    ...durable.prerequisites,
    'Migration 0040 separately audited, authorized, applied and post-validated after 0039',
    'Existing map shell, layer manager, overlay and async thumbnail settings explicitly true in configured and canonical Pages environment',
    'Explicit approval of the temporary frontend PNG capture and local spool retention window; Pages flags affect the whole deployment, not only QA9; permanent rollout remains separate',
    'Chromium real WebGL renderer available; absence fails closed rather than using a mock PNG',
    'JSON Worker recovery separately active; this suite does not configure Worker flags or prove independent preview-cron recovery',
  ],
  cleanup: { ...durable.cleanup, resources: 'One new QA Durable run-ID-scoped small project and its generated organization-file record; no existing project input',
    retention: 'Private immutable JSON/PNG objects, historical receipts and operation tombstones retained; browser profile discarded; no public links or storage garbage collection' },
  cases: ['PNG-CAPTURE', 'PNG-REFRESH', 'PNG-ORDER', 'PNG-FAILURE', 'DS-CLEANUP'],
});

export function verifyPreflight(project, options) {
  verifyDurablePreflight(project, options);
  for (const container of [project.raw.deployment_configs.production.env_vars, project.raw.canonical_deployment.env_vars]) {
    for (const name of ['VITE_MAONO_MAP_SHELL_V1', 'VITE_MAONO_LAYER_MANAGER_V1', 'VITE_MAONO_MAP_OVERLAY_V1', 'VITE_ASYNC_PROJECT_THUMBNAIL']) {
      check(container[name]?.type === 'plain_text' && container[name]?.value === 'true',
        `Prerequisito ${name} não comprovado; a suite não o ativa implicitamente.`, 'PNG_PREREQUISITE_UNVERIFIED');
    }
  }
}
export const prepare = prepareDurable;

export function boundedBrowserOwner(browser, closeTimeoutMs = 10_000) {
  let closing = null, closed = false;
  return {
    get closed() { return closed; },
    close() {
      if (!closing) closing = (async () => {
        let timer;
        try {
          await Promise.race([browser.close(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('Fechamento do navegador não confirmado.'),
              { name: 'AcceptanceBudgetError', code: 'PNG_BROWSER_CLOSURE_UNVERIFIED' })), closeTimeoutMs);
          })]);
          closed = true;
        } finally { clearTimeout(timer); }
      })();
      return closing;
    },
  };
}
export async function withBrowserDeadline(owner, timeoutMs, perform) {
  let timer, expired = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      void owner.close().then(() => reject(Object.assign(new Error('Navegador excedeu a janela; seguir para fechamento.'),
        { name: 'AcceptanceBudgetError', code: 'PNG_BROWSER_TIMEOUT' })), reject);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([perform(), deadline]);
    check(!expired, 'Navegador terminou depois do prazo.', 'PNG_BROWSER_TIMEOUT');
    return result;
  } finally { clearTimeout(timer); await owner.close(); }
}

export async function run(ctx) {
  const body = await readFile(new URL('../fixtures/preview-points.kepler.json', import.meta.url), 'utf8');
  let owner = null;
  const seeded = await createSyntheticProjectForPreview(ctx, body, { beforeCleanup: async () => {
    if (owner) await owner.close();
    check(!owner || owner.closed, 'Cleanup bloqueado: navegador ainda pode escrever.', 'PNG_BROWSER_CLOSURE_UNVERIFIED');
  } });
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true, timeout: ctx.requestTimeoutMs(30_000), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const scoped = revocableBrowserScope(ctx);
  const processOwner = boundedBrowserOwner(browser);
  owner = boundedBrowserOwner({ close: async () => {
    scoped.stop();
    await processOwner.close();
    await scoped.drain();
  } }, 45_000);
  const browserCtx = scoped.scope;
  ctx.registerCleanup(() => owner.close());
  await withBrowserDeadline(owner, ctx.requestTimeoutMs(25 * 60_000), async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR', serviceWorkers: 'block' });
    context.setDefaultTimeout(30_000); context.setDefaultNavigationTimeout(60_000);
    const rawCookie = ctx.profiles.creator.cookie, separator = rawCookie.indexOf('=');
    await context.addCookies([{ name: rawCookie.slice(0, separator), value: rawCookie.slice(separator + 1), url: ctx.baseUrl, httpOnly: true, secure: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const checkGuard = await installBrowserWriteGuard(page, browserCtx, seeded.project);
    const open = async () => {
      await page.goto(`${ctx.baseUrl}/projects/${encodeURIComponent(seeded.project.slug)}/edit`, { waitUntil: 'domcontentloaded', timeout: ctx.requestTimeoutMs(60_000) });
      await page.locator('.maono-map-runtime[data-map-ready="true"][data-map-loading="false"]').waitFor({ timeout: ctx.requestTimeoutMs(60_000) });
      await page.locator('.maono-map-sidebar').getByRole('button', { name: 'Camadas', exact: true }).click();
      await page.locator('#maono-map-engine-panel').getByRole('tab', { name: /^Camadas/ }).click();
      check(await page.locator('#maono-map-engine-panel .maono-layer-row').count() === 1, 'Fixture carregada não possui sua camada sintética.');
    };
    await open();
    const first = await saveAndCapture(page, browserCtx, seeded.project, 1);
    ctx.record('PNG-CAPTURE', 'PASS', { revision: first.saved.publishedRevision, sizeBytes: first.image.sizeBytes, imageChecksum: first.image.imageChecksum,
      width: first.image.width, height: first.image.height, captureMethod: first.preview.captureMethod,
      renderer: 'Chromium headless / ANGLE SwiftShader', realEditor: true, realHttpStorage: true, mocks: false });
    await open(); // Full navigation reconstructs the editor from persisted JSON.
    const reloaded = await readPngEvidence(page, browserCtx, seeded.project, first.receipt);
    check(reloaded.imageChecksum === first.image.imageChecksum, 'Refresh perdeu o PNG publicado.');
    const second = await saveAndCapture(page, browserCtx, seeded.project, 2);
    check(second.saved.publishedRevision === 3 && second.preview.editorSessionId !== first.preview.editorSessionId, 'Refresh não produziu nova sessão com revisão persistida.');
    ctx.record('PNG-REFRESH', 'PASS', { persistedRevision: 2, nextRevision: 3, imageAfterReload: true, newEditorSession: true });
    await verifyNegativePreviewCases(page, browserCtx, seeded.project, first, second);
    checkGuard();
  });
}
