import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { validateOrganizationEvidence, verifyOrganizationEvidence } from '../../scripts/acceptance/organization-functional-evidence.mjs';

// This exercises the actual compiled UI and the exact human collector. All HTTP
// and accounts are synthetic; it is not an authorized remote acceptance run.
const runId = '11111111-1111-4111-8111-111111111111';
const deployment = '33333333-3333-4333-8333-333333333333';
const operationId = '22222222-2222-4222-8222-222222222222';
const name = `QA Auditoria ${runId}`;
const failures = new WeakMap<Page, string[]>();
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { release, promise }; }
type Method = 'start' | 'capture' | 'begin' | 'finish' | 'stop' | 'export';
async function collector(page: Page, method: Method, argument?: unknown) {
  return page.evaluate(async ({ method, argument }) => {
    const api = (window as unknown as { MaonoOrganizationEvidence: Record<Method, (...args: unknown[]) => Promise<unknown>> }).MaonoOrganizationEvidence;
    return method === 'start' || method === 'begin' ? api[method](argument) : api[method]();
  }, { method, argument });
}
async function install(page: Page, requestedCases: string[], mode = 'functional') {
  await page.addScriptTag({ content: await readFile(new URL('../../scripts/acceptance/organization-functional-evidence.js', import.meta.url), 'utf8') });
  return collector(page, 'start', { runId, organizationId: 11, expectedCommit: 'a'.repeat(40), expectedDeploymentId: deployment, mode, requestedCases });
}
// Independent frame-boundary diagnostic, with no input values or private text.
// It is attached beside the collector export; it does not replace its evidence.
async function startFrameProbe(page: Page) {
  await page.evaluate(() => {
    const probe = { started: performance.now(), active: true, frames: [] as unknown[], previous: '', handle: 0 };
    Object.assign(window, { organizationFrameProbe: probe });
    const sample = () => {
      if (!probe.active) return;
      const dialog = document.querySelector('dialog[open]'), body = dialog?.querySelector('.aog-dialog-body,.audit-detail-content');
      const rect = dialog?.getBoundingClientRect(), focused = document.activeElement;
      const value = { busy: body?.getAttribute('aria-busy') === 'true',
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        focusTag: focused?.tagName || null, focusInDialog: Boolean(dialog?.contains(focused)),
        focusedButton: focused?.matches('button') ? ['Consultar resultado', 'Salvar dados', 'Atualizar detalhes'].find(label => focused.textContent?.trim() === label) || 'other' : null,
        toast: Boolean(document.querySelector('.aog-deletion-toast,.aog-deletion-error-toast,.audit-command-success,.audit-command-error')) };
      const key = JSON.stringify(value);
      if (key !== probe.previous) { probe.frames.push({ t: performance.now() - probe.started, ...value }); probe.previous = key; }
      probe.handle = requestAnimationFrame(sample);
    };
    sample();
  });
}
async function stopFrameProbe(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { organizationFrameProbe: { active: boolean; handle: number; frames: unknown[] } }).organizationFrameProbe;
    probe.active = false; cancelAnimationFrame(probe.handle); return probe.frames;
  });
}
async function setup(page: Page, { error = false, audit = false } = {}) {
  const errors: string[] = []; failures.set(page, errors); page.on('pageerror', value => errors.push(value.message));
  const wait = deferred(), writes: string[] = [];
  let org = { id: 11, name, slug: 'qa-auditoria-sintetica', description: 'PRIVATE_INITIAL_DRAFT', active: false, version: 3, plan: 'free',
    owner: { id: 9, name: 'PRIVATE_OWNER', email: 'private@example.test' }, projectCount: 0, userCount: 1, fileCount: 0, storageStatus: 'DISABLED', updatedAt: '2026-01-01T12:00:00Z', lastActivityAt: null };
  let payload: Record<string, unknown> = {}, completed = false, queried = false;
  let actionTime = new Date(Date.now() - 60_000).toISOString();
  const prior = { id: 'frame:1', createdAt: new Date(Date.now() - 60_000).toISOString(), actor: { id: 1, name: 'PRIVATE_ACTOR', kind: 'user' }, organization: { id: 11, name, slug: org.slug },
    route: '/admin', origin: 'api:POST:/api/admin/organization-management/operations', category: 'organization', action: 'organization.update',
    resource: { type: 'organization', id: '11', label: name }, result: 'failed', summary: 'Esta tentativa falhou.', legacy: false };
  const newest = () => ({ ...prior, id: 'frame:2', createdAt: actionTime, result: queried ? 'unknown' : error ? 'blocked' : 'succeeded',
    summary: queried ? 'Consulta registrada.' : error ? 'A tentativa foi impedida.' : 'Operação concluída.' });
  const operation = (done: boolean) => ({ id: operationId, kind: 'change', createdAt: actionTime, done,
    items: [{ index: 0, label: '#11', state: done ? (error || queried ? 'failed' : 'succeeded') : 'pending', attempts: 1,
      result: done && !error && !queried ? { id: 11 } : null, error: error ? 'A organização mudou. Consulte a versão atual.' : null,
      code: error ? 'ORGANIZATION_VERSION_CONFLICT' : null, retryable: queried }] });
  const detail = (id: string) => ({ ok: true, capabilities: { operations: true }, entry: id === 'frame:2' ? newest() : prior,
    changes: [], attempts: [], nextHistoryBefore: null,
    technical: { operationId, source: id === 'frame:2' && queried ? 'organization_operation_inspection' : 'organization_operation', eventId: id.slice(6), code: null,
      originalActor: { id: 1, name: 'PRIVATE_ACTOR', kind: 'user' }, requestedBy: prior.actor, executor: 'user', version: 3 },
    actions: audit ? [{ kind: 'query', enabled: true, reason: null, organizationId: 11, operationId, expectedVersion: 3, itemIndex: 0 }] : [] });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() === 'GET') {
      if (path === '/api/session') return route.fulfill({ json: { authenticated: true, user: { id: 1, name: 'PRIVATE_ACTOR', email: 'private@example.test', role: 'super_admin', activeOrganizationId: 11 }, organizations: [org], activeOrganization: org, projects: [] } });
      if (path === '/api/admin/organization-management/organizations') return route.fulfill({ json: { ok: true, organizations: [org], pagination: { total: 1, page: 1, size: 10, pages: 1 },
        summary: { organizations: 1, active: 0, users: 1, files: 0, requests: 0 }, capabilities: { edits: true, projectQuotaEnforced: true, permanentDelete: true, auditOperations: true } } });
      if (path === '/api/admin/organization-management/organizations/11') return route.fulfill({ json: { ok: true, organization: org,
        policy: { plan: 'free', projects: 5, storageMb: 500, projectOverride: null, used: 0, reserved: 0, remaining: 5, storageUsedMb: 0, projectQuotaEnforced: true, informational: [] } } });
      if (path.endsWith('/deletion-preview')) return route.fulfill({ json: { ok: true, organizationId: 11, name, eligible: true, version: org.version, blockers: [], waitUntil: null, confirmation: 'EXCLUIR PERMANENTEMENTE' } });
      if (path === '/api/admin/audit') return route.fulfill({ json: { ok: true, entries: completed || queried ? [newest(), prior] : [prior], nextBefore: null, capabilities: { operations: true } } });
      if (path.startsWith('/api/admin/audit/')) return route.fulfill({ json: detail(decodeURIComponent(path.split('/').at(-1)!)) });
      if (path.endsWith(`/operations/${operationId}`)) return route.fulfill({ json: { ok: true, ...operation(completed) } });
      return route.fulfill({ json: { ok: true, enabled: false, projects: [], users: [], organizations: [org], access: [], notifications: [], unreadCount: 0, operations: [] } });
    }
    writes.push(`${request.method()} ${path}`);
    if (path === '/api/admin/organization-management/operations') {
      const body = request.postDataJSON(); expect(body.kind).toBe('change'); payload = body.items[0]; actionTime = new Date().toISOString();
      return route.fulfill({ json: { ok: true, ...operation(false) } });
    }
    if (path.endsWith(`/operations/${operationId}/step`)) {
      await wait.promise;
      if (!error) org = { ...org, description: String(payload.description), version: 4 };
      completed = true; return route.fulfill({ json: { ok: true, ...operation(true) } });
    }
    if (audit && path.endsWith('/retry')) {
      expect(request.postDataJSON().action).toBe('query'); actionTime = new Date().toISOString(); await wait.promise; queried = true;
      return route.fulfill({ json: { ok: true, operation: operation(true), reconciled: false } });
    }
    errors.push(`UNEXPECTED_WRITE:${request.method()}:${path}`); return route.fulfill({ status: 403, json: { ok: false } });
  });
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  await page.goto(audit ? '/admin?section=audit&audit_org=11' : '/admin?section=organizations');
  if (!audit) await page.getByRole('button', { name, exact: true }).click();
  else {
    await page.locator('.audit-details-trigger').first().click();
    await expect(page.getByRole('dialog', { name: 'Detalhes da operação' })).toContainText('Esta tentativa falhou.');
  }
  return { wait, writes };
}
test.afterEach(async ({ page }) => expect(failures.get(page) || []).toEqual([]));

test('collector reads the compiled organization screen without any mutation or invented UI proof', async ({ page }) => {
  const fixture = await setup(page);
  await install(page, ['snapshot'], 'diagnostic');
  const evidence = await collector(page, 'export');
  const result = verifyOrganizationEvidence(evidence);
  expect(result.cases).toEqual([{ id: 'snapshot', status: 'OBSERVED', findings: [] }]);
  expect(result.complete).toBe(false); expect(result.environment.matched).toBe(false);
  expect(fixture.writes).toEqual([]); expect(JSON.stringify(evidence)).not.toMatch(/PRIVATE_|private@example/);
});

for (const error of [false, true]) test(`actual ${error ? 'error' : 'success'} flow produces measured mounted loading, corner toast and correlated domain evidence`, async ({ page }, testInfo) => {
  const fixture = await setup(page, { error });
  const dialog = page.getByRole('dialog', { name, exact: true });
  await dialog.getByLabel('Descrição', { exact: true }).fill('PRIVATE_UNSAVED_DRAFT');
  await dialog.getByLabel('Justificativa', { exact: true }).fill('PRIVATE_JUSTIFICATION');
  const caseId = error ? 'save_error' : 'save_success';
  await install(page, [caseId]); await startFrameProbe(page); await collector(page, 'begin', caseId);
  await dialog.getByRole('button', { name: 'Salvar dados', exact: true }).click();
  await expect(dialog.locator('.aog-dialog-loading-overlay')).toBeVisible();
  // Hold the synthetic reply long enough to obtain multiple independent DOM
  // samples; this delay exists only in the local fixture, not the collector.
  await page.waitForTimeout(350); fixture.wait.release();
  const toast = page.locator(error ? '.aog-deletion-error-toast' : '.aog-deletion-toast');
  await expect(toast).toBeVisible(); await expect(toast).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(500);
  await collector(page, 'finish'); const evidence = await collector(page, 'export');
  await testInfo.attach(`synthetic-${caseId}-evidence`, { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await testInfo.attach(`synthetic-${caseId}-frame-boundaries`, { body: JSON.stringify(await stopFrameProbe(page), null, 2), contentType: 'application/json' });
  const result = verifyOrganizationEvidence(evidence);
  expect(result.cases).toEqual([{ id: caseId, status: 'OBSERVED', findings: [] }]);
  expect(result.complete).toBe(false); expect(result.cleanupVerified).toBe(false); expect(result.restorationVerified).toBe(false);
  expect(fixture.writes).toHaveLength(2); expect(JSON.stringify(evidence)).not.toMatch(/PRIVATE_|private@example/);
  await expect(dialog).toBeVisible();
});

test('actual anchored Audit query yields a new observation without pretending that GETs executed recovery', async ({ page }, testInfo) => {
  const fixture = await setup(page, { audit: true });
  const dialog = page.getByRole('dialog', { name: 'Detalhes da operação' });
  await install(page, ['recovery_query']); await startFrameProbe(page); await collector(page, 'begin', 'recovery_query');
  await dialog.getByRole('button', { name: 'Consultar resultado', exact: true }).click();
  await expect(dialog.locator('.audit-detail-busy')).toBeVisible();
  await page.waitForTimeout(350); fixture.wait.release();
  await expect(dialog.locator('.audit-command-success')).toBeVisible();
  await expect(dialog.locator('.audit-command-success')).toHaveCount(0); await page.waitForTimeout(500);
  await collector(page, 'finish'); const evidence = await collector(page, 'export');
  await testInfo.attach('synthetic-recovery-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await testInfo.attach('synthetic-recovery-frame-boundaries', { body: JSON.stringify(await stopFrameProbe(page), null, 2), contentType: 'application/json' });
  const keyboardFocus = [];
  for (let index = 0; index < 3; index++) {
    await page.keyboard.press('Tab');
    keyboardFocus.push(await page.evaluate(() => ({
      tag: document.activeElement?.tagName, documentHasFocus: document.hasFocus(),
      inDialog: Boolean(document.querySelector('.admin-audit-detail[open]')?.contains(document.activeElement)),
    })));
  }
  await testInfo.attach('synthetic-recovery-focus-after-tab', { body: JSON.stringify(keyboardFocus), contentType: 'application/json' });
  validateOrganizationEvidence(evidence);
  expect(verifyOrganizationEvidence(evidence).cases).toEqual([{ id: 'recovery_query', status: 'OBSERVED', findings: [] }]);
  expect(fixture.writes).toHaveLength(1); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar detalhes', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.audit-details-trigger').first()).toBeFocused();
});
