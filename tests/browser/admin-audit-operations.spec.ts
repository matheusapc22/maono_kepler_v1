import { expect, test, type Page, type Route } from '@playwright/test';
import { deferred, expectAdminFixtureIntegrity, setupAdmin } from './fixtures/admin-workspace';

const actor = { id: 7, name: 'Operador histórico', kind: 'user' };
const organization = { id: 42, name: 'Organização histórica excluída', slug: 'historica-excluida' };
const row = (id = 100) => ({ id: `frame:${id}`, createdAt: '2026-11-25T12:34:56.000Z', actor, organization,
  route: '/admin', origin: 'api:POST:/api/admin/organization-management/operations', category: 'organization', action: 'organization.pause',
  resource: { type: 'organization', id: '42', label: 'Organização histórica excluída' }, result: 'failed', summary: 'Esta tentativa falhou.', legacy: false });
const entries = Array.from({ length: 25 }, (_, index) => row(100 - index));
const pageData = (items = entries, nextBefore: string | null = 'cursor_older_76') => ({ ok: true, entries: items, nextBefore, capabilities: { operations: true } });
const detailData = (id = 'frame:100') => ({ ok: true, entry: { ...row(), id }, changes: [{ field: 'Nome', before: 'Nome anterior', after: 'Nome posterior' }],
  attempts: [{ id: 'attempt-one', parentId: null, itemIndex: 0, originalActor: actor, requestedBy: actor, executor: 'user',
    startedAt: '2026-11-25T12:00:00.000Z', endedAt: '2026-11-25T12:34:56.000Z', result: 'failed', stages: [{ id: 'frame:100', createdAt: '2026-11-25T12:34:56.000Z', result: 'failed', summary: 'Falha confirmada.' }] }],
  nextHistoryBefore: null as number | null,
  technical: { operationId: 'logical-operation-keep-private', source: 'organization_management_operations', eventId: '100', code: 'CONFIRMED_FAILURE', originalActor: actor, requestedBy: actor, executor: 'user', version: 2 },
  actions: [], capabilities: { operations: true } });

async function openAudit(page: Page, handler?: (route: Route) => Promise<unknown>) {
  const fixture = await setupAdmin(page);
  const auditRequests: string[] = [];
  await page.route(url => url.pathname === '/api/admin/audit' || url.pathname.startsWith('/api/admin/audit/'), async route => {
    expect(route.request().headers()['x-maono-audit']).toBe('operations-v1');
    expect(route.request().headers()['x-maono-ui-route']).toBe('/admin');
    auditRequests.push(route.request().url());
    if (handler) return handler(route);
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/organizations')) return route.fulfill({ json: { ok: true, organizations: [organization], hasMore: false, capabilities: { operations: true } } });
    if (url.pathname !== '/api/admin/audit') return route.fulfill({ json: detailData(decodeURIComponent(url.pathname.split('/').at(-1)!)) });
    return route.fulfill({ json: pageData() });
  });
  await page.getByRole('navigation', { name: 'Navegação administrativa' }).getByRole('button', { name: 'Auditoria', exact: true }).click();
  return { ...fixture, auditRequests };
}

test.afterEach(async ({ page }) => { await expectAdminFixtureIntegrity(page); });

test('nine columns show persisted snapshots, explicit Brasília offset and honest legacy gaps', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const legacy = { ...row(), id: 'legacy:5', actor: { id: 7, name: null, kind: 'user' }, organization: { id: 42, name: null, slug: null }, route: null, origin: null,
    resource: { type: 'organization', id: '42', label: null }, result: 'legacy_unproven', legacy: true };
  await openAudit(page, route => route.fulfill({ json: pageData([row(), legacy], null) }));
  const panel = page.locator('.admin-audit-operations');
  await expect(panel.locator('thead th')).toHaveText(['Data e hora', 'Usuário', 'Organização', 'Rota', 'Categoria da ação', 'Ação', 'Recurso', 'Resultado', 'Detalhes']);
  await expect(panel.locator('tbody tr')).toHaveCount(2);
  await expect(panel.locator('tbody tr').first()).toContainText('Operador histórico');
  await expect(panel.locator('tbody tr').first()).toContainText('Organização histórica excluída');
  await expect(panel.locator('tbody tr').first()).toContainText('09:34:56 GMT-3');
  await expect(panel.locator('tbody tr').last()).toContainText('Resultado não comprovado no registro legado');
  await expect(panel.locator('tbody')).not.toContainText('Operador sintético');
  await expect(panel.locator('tbody')).not.toContainText('Organização pronta');
  await page.screenshot({ path: testInfo.outputPath('audit-nine-columns-desktop.png') });
});

test('date and historical organization filters use UTC boundaries and reset cursor', async ({ page }) => {
  const fixture = await openAudit(page);
  await expect(page.locator('.admin-audit tbody tr')).toHaveCount(25);
  await page.getByRole('button', { name: 'Registros anteriores' }).click();
  await expect(page).toHaveURL(/audit_before=cursor_older_76/);
  await page.getByLabel('De', { exact: true }).fill('2026-11-25');
  await page.getByLabel('Até', { exact: true }).fill('2026-11-25');
  await page.getByRole('combobox', { name: 'Resultado', exact: true }).selectOption('failed');
  await page.getByLabel('Organização', { exact: true }).fill('histórica');
  await page.locator('.audit-organization-options').getByRole('button', { name: /Organização histórica excluída/ }).click();
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page).toHaveURL(/audit_org=42/);
  await expect(page).not.toHaveURL(/audit_before/);
  await expect.poll(() => fixture.auditRequests.filter(url => new URL(url).pathname === '/api/admin/audit').at(-1)).toContain('organizationId=42');
  const last = new URL(fixture.auditRequests.filter(url => new URL(url).pathname === '/api/admin/audit').at(-1)!);
  expect(last.searchParams.get('from')).toBe('2026-11-25T03:00:00.000Z');
  expect(last.searchParams.get('to')).toBe('2026-11-26T03:00:00.000Z');
  expect(last.searchParams.get('result')).toBe('failed');
});

test('details preserve filters, page, table position and keyboard focus; technical IDs stay in disclosure', async ({ page }, testInfo) => {
  const fixture = await openAudit(page);
  await expect(page.locator('.admin-audit tbody tr')).toHaveCount(25);
  await page.getByRole('button', { name: 'Registros anteriores' }).click();
  const trigger = page.locator('.audit-details-trigger').nth(8);
  await trigger.scrollIntoViewIfNeeded(); await trigger.focus();
  const scroll = await page.evaluate(() => window.scrollY);
  const count = fixture.auditRequests.filter(url => new URL(url).pathname === '/api/admin/audit').length;
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Detalhes da operação' });
  await expect(dialog).toBeVisible(); await expect(dialog).toContainText('Nome anterior');
  await expect(dialog.locator('.audit-technical')).not.toHaveAttribute('open');
  await expect(dialog.getByText('logical-operation-keep-private')).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('audit-details-desktop.png') });
  await dialog.getByText('Informações técnicas', { exact: true }).click();
  await expect(dialog.getByText('logical-operation-keep-private')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/audit_before=cursor_older_76/);
  expect(fixture.auditRequests.filter(url => new URL(url).pathname === '/api/admin/audit')).toHaveLength(count);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - scroll)).toBeLessThanOrEqual(1);
});

test('history pages merge stages and never reset the audit table', async ({ page }) => {
  const fixture = await openAudit(page, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/audit') return route.fulfill({ json: pageData() });
    const data = detailData();
    if (!url.searchParams.has('historyBefore')) data.nextHistoryBefore = 100;
    else { data.attempts[0].stages = [{ id: 'frame:99', createdAt: '2026-11-25T12:00:00.000Z', result: 'running', summary: 'Etapa inicial confirmada.' }]; data.attempts[0].result = 'running'; }
    return route.fulfill({ json: data });
  });
  await page.locator('.audit-details-trigger').first().click();
  const dialog = page.getByRole('dialog', { name: 'Detalhes da operação' });
  await dialog.getByRole('button', { name: 'Carregar etapas anteriores' }).click();
  await expect(dialog).toContainText('Etapa inicial confirmada.'); await expect(dialog).toContainText('Falha confirmada.');
  await expect(dialog.locator('.audit-attempt-list > li')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Carregar etapas anteriores' })).toHaveCount(0);
  expect(fixture.auditRequests.filter(url => new URL(url).pathname === '/api/admin/audit')).toHaveLength(1);
});

for (const status of [401, 403, 404]) test(`details denial ${status} clears private rows and closes dialog`, async ({ page }) => {
  await openAudit(page, route => route.fulfill(new URL(route.request().url()).pathname === '/api/admin/audit'
    ? { json: pageData() } : { status, json: { ok: false } }));
  await expect(page.locator('.admin-audit tbody tr')).toHaveCount(25);
  await page.locator('.audit-details-trigger').first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.admin-audit tbody tr')).toHaveCount(0);
  await expect(page.locator('.admin-audit')).toContainText('Consulta indisponível para este acesso.');
  await expect(page.locator('.admin-audit').getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
});

test('unsupported contract is unavailable, never a fabricated empty list', async ({ page }) => {
  await openAudit(page, route => route.fulfill({ json: { ok: true, entries: [], nextBefore: null } }));
  await expect(page.locator('.admin-audit')).toContainText('Não foi possível consultar a auditoria.');
  await expect(page.locator('.admin-audit')).not.toContainText('Nenhum registro encontrado');
});

test('closing a pending detail cancels its private response; mobile panel stays in viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const gate = deferred(); let details = 0;
  await openAudit(page, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/audit') return route.fulfill({ json: pageData(entries.slice(0, 2), null) });
    const attempt = ++details;
    if (attempt === 1) await gate.promise;
    const data = detailData(decodeURIComponent(url.pathname.split('/').at(-1)!));
    data.entry.summary = attempt === 1 ? 'STALE_PRIVATE_RESULT' : 'Consulta atual.';
    return route.fulfill({ json: data });
  });
  await page.locator('.audit-details-trigger').first().click();
  await page.getByRole('button', { name: 'Fechar detalhes' }).click();
  await page.locator('.audit-details-trigger').last().click();
  const dialog = page.getByRole('dialog', { name: 'Detalhes da operação' });
  await expect(dialog).toContainText('Consulta atual.'); gate.release();
  await expect(dialog).not.toContainText('STALE_PRIVATE_RESULT');
  const box = await dialog.boundingBox(); expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(321);
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(801);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('audit-details-mobile.png'), fullPage: true });
});

test('lost recovery response preserves one intention until explicit query allows a new key', async ({ page }) => {
  const keys: string[] = [], commands: string[] = []; let complete = false;
  await openAudit(page, async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/admin/audit') return route.fulfill({ json: pageData([row()], null) });
    if (request.method() === 'POST') {
      expect(request.headers()['x-maono-management']).toBe('1');
      const body = request.postDataJSON(); commands.push(body.action);
      if (body.action === 'retry') {
        keys.push(body.requestKey);
        if (keys.length === 1) return route.fulfill({ status: 503, json: { ok: false } });
        complete = true;
      }
      return route.fulfill({ json: { ok: true, operation: { id: 'logical-operation-keep-private', done: true, items: [{ state: complete ? 'succeeded' : 'failed' }] } } });
    }
    const data = detailData();
    return route.fulfill({ json: { ...data, actions: complete ? [] : ['query', 'retry'].map(kind => ({ kind, enabled: true, reason: null, operationId: data.technical.operationId, organizationId: 42, expectedVersion: 2, itemIndex: 0 })) } });
  });
  await page.locator('.audit-details-trigger').first().click();
  const dialog = page.getByRole('dialog', { name: 'Detalhes da operação' });
  await dialog.getByRole('button', { name: 'Tentar novamente', exact: true }).dblclick();
  await expect(dialog.locator('.audit-command-error')).toBeVisible();
  expect(keys).toHaveLength(1);
  await expect(dialog.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Consultar resultado', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(dialog.locator('.audit-command-success')).toContainText('Operação concluída.');
  expect(commands).toEqual(['retry', 'query', 'retry']); expect(keys).toHaveLength(2); expect(keys[0]).not.toBe(keys[1]);
  await expect(dialog).toBeVisible();
});

test('deletion recovery requires exact fresh confirmation and keeps dialog open', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await openAudit(page, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/audit') return route.fulfill({ json: pageData([row()], null) });
    if (route.request().method() === 'POST') { commands.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true, deletion: { id: 'logical-operation-keep-private', state: 'completed', errorCode: null } } }); }
    const data = detailData();
    return route.fulfill({ json: { ...data, actions: commands.length ? [] : [{ kind: 'resume', enabled: true, reason: null, operationId: data.technical.operationId, deletionId: data.technical.operationId, organizationId: 42, expectedVersion: 2, confirmationRequired: true }] } });
  });
  await page.locator('.audit-details-trigger').first().click();
  const dialog = page.getByRole('dialog', { name: 'Detalhes da operação' });
  const resume = dialog.getByRole('button', { name: 'Retomar etapa pendente', exact: true });
  await expect(resume).toBeDisabled();
  await dialog.getByLabel('Digite EXCLUIR PERMANENTEMENTE para retomar a exclusão').fill('excluir permanentemente');
  await expect(resume).toBeDisabled();
  await dialog.getByLabel('Digite EXCLUIR PERMANENTEMENTE para retomar a exclusão').fill('EXCLUIR PERMANENTEMENTE');
  await resume.click(); await expect(dialog.locator('.audit-command-success')).toContainText('Operação concluída.');
  expect(commands).toHaveLength(1); expect(commands[0].confirmation).toBe('EXCLUIR PERMANENTEMENTE'); expect(commands[0].expectedVersion).toBe(2);
  await expect(dialog).toBeVisible();
});

test('incomplete successful HTTP response keeps recovery uncertain until explicit valid query', async ({ page }) => {
  const commands: string[] = [];
  await openAudit(page, async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/admin/audit') return route.fulfill({ json: pageData([row()], null) });
    if (request.method() === 'POST') {
      const action = request.postDataJSON().action; commands.push(action);
      return route.fulfill({ json: action === 'retry' ? { ok: true } : { ok: true, operation: { id: 'logical-operation-keep-private', done: true, items: [{ state: 'failed' }] } } });
    }
    const data = detailData();
    return route.fulfill({ json: { ...data, actions: ['query', 'retry'].map(kind => ({ kind, enabled: true, reason: null, operationId: data.technical.operationId, organizationId: 42, expectedVersion: 2, itemIndex: 0 })) } });
  });
  await page.locator('.audit-details-trigger').first().click();
  const dialog = page.getByRole('dialog', { name: 'Detalhes da operação' });
  await dialog.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(dialog.locator('.audit-command-error')).toBeVisible();
  await expect(dialog.locator('.audit-command-success')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Consultar resultado', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeEnabled();
  expect(commands).toEqual(['retry', 'query']); await expect(dialog).toBeVisible();
});

test('hung recovery request times out without closing the form and leaves explicit query available', async ({ page }) => {
  const gate = deferred(), commands: string[] = [];
  await page.clock.install({ time: new Date('2026-11-25T12:00:00.000Z') });
  // Advance the browser's active-time abort deterministically, while retaining
  // native AbortSignal.any and the application's real fetch/catch/finally path.
  await page.addInitScript(() => Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: (delay: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), delay);
    return controller.signal;
  } }));
  await openAudit(page, async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/admin/audit') return route.fulfill({ json: pageData([row()], null) });
    if (request.method() === 'POST') {
      const action = request.postDataJSON().action; commands.push(action);
      if (action === 'retry') await gate.promise;
      return route.fulfill({ json: { ok: true, operation: { id: 'logical-operation-keep-private', done: true, items: [{ state: 'failed' }] } } });
    }
    const data = detailData();
    return route.fulfill({ json: { ...data, actions: ['query', 'retry'].map(kind => ({ kind, enabled: true, reason: null, operationId: data.technical.operationId, organizationId: 42, expectedVersion: 2, itemIndex: 0 })) } });
  });
  await page.locator('.audit-details-trigger').first().click();
  const dialog = page.getByRole('dialog', { name: 'Detalhes da operação' });
  await expect(dialog.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeEnabled();
  await page.clock.pauseAt(new Date('2026-11-25T12:01:00.000Z'));
  await dialog.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(dialog.locator('.audit-detail-busy')).toBeVisible();
  await expect.poll(() => commands).toEqual(['retry']);
  await page.clock.fastForward(19999); await expect(dialog.locator('.audit-detail-busy')).toBeVisible();
  await page.clock.fastForward(1);
  await expect(dialog.locator('.audit-detail-busy')).toHaveCount(0);
  await expect(dialog.locator('.audit-command-error')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Fechar detalhes' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Consultar resultado', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeEnabled();
  expect(commands).toEqual(['retry', 'query']); await expect(dialog).toBeVisible();
  gate.release();
});
