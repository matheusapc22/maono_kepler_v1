import { expect, test, type Page } from '@playwright/test';
import { organizationDraftCases } from './organization-draft-cases';

organizationDraftCases(true);

const opId = '22222222-2222-4222-8222-222222222222';
const errors = new WeakMap<Page, string[]>(), unexpected = new WeakMap<Page, string[]>();
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { release, promise }; }
type Options = { audit?: boolean; active?: boolean; fail?: boolean; blockers?: string[]; wait?: ReturnType<typeof gate>; deletion?: boolean; existingDeletion?: boolean };
async function setup(page: Page, options: Options = {}) {
  errors.set(page, []); unexpected.set(page, []); page.on('pageerror', error => errors.get(page)!.push(error.message));
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let org = { id: 11, name: 'Organização sintética', slug: 'org-sintetica', description: 'Descrição inicial', active: options.active ?? false, version: 3, plan: 'free',
    owner: { id: 7, name: 'Proprietária', email: 'owner@example.test' }, projectCount: 0, userCount: 1, fileCount: 0, storageStatus: 'DISABLED', updatedAt: '2026-01-01T12:00:00Z', lastActivityAt: null };
  let input: { kind: string; items: Record<string, unknown>[] } = { kind: 'change', items: [] };
  let operation = { id: opId, kind: 'change', createdAt: '2026-11-25T12:00:00Z', done: true, items: [{ index: 0, label: '#11', state: 'failed', attempts: 1, result: null as { id: number } | null, error: 'A operação não foi confirmada.', code: 'INTERNAL_OPERATION_FAILED', retryable: false }] };
  let consulted = false;
  const preview = () => {
    const codes = org.active ? ['PAUSE_REQUIRED'] : consulted ? [] : options.blockers ?? [];
    const blockers = codes.map(code => ({ code, count: 1, key: code, organizationId: org.id,
      description: code === 'UNRESOLVED_OPERATION' ? 'Uma operação anterior precisa ter seu resultado consultado.' : code === 'PAUSE_REQUIRED' ? 'Pause a organização antes de solicitar a exclusão.' : 'Existem registros vinculados que precisam ser tratados.',
      action: code === 'UNRESOLVED_OPERATION' ? { kind: 'query', enabled: true, organizationId: org.id, operationId: opId, itemIndex: 0 } : code === 'PAUSE_REQUIRED' ? { kind: 'pause', enabled: true, organizationId: org.id, expectedVersion: org.version } : { kind: 'review', enabled: false, organizationId: org.id, reason: 'Este impedimento exige revisão administrativa; a resolução automática ainda não está disponível.' } }));
    return { ok: true, organizationId: org.id, name: org.name, version: org.version, eligible: !blockers.length, blockers, confirmation: 'EXCLUIR PERMANENTEMENTE', waitUntil: null };
  };
  const entry = { id: 'frame:9', createdAt: '2026-11-25T12:00:00.000Z', actor: { id: 1, name: 'Operador sintético', kind: 'user' }, organization: { id: 11, name: org.name, slug: org.slug }, route: '/admin', origin: null,
    category: 'organization', action: 'organization.update', resource: { type: 'organization', id: '11', label: org.name }, result: 'failed', summary: 'Esta tentativa falhou.', legacy: false };
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path.startsWith('/api/admin/organization-management/') || path.startsWith('/api/admin/audit')) expect(request.headers()['x-maono-ui-route']).toBe('/admin');
    if (request.method() === 'GET') {
      if (path === '/api/session') return route.fulfill({ json: { authenticated: true, user: { id: 1, name: 'Operador sintético', email: 'qa@example.test', role: 'super_admin', activeOrganizationId: 11 }, organizations: [org], activeOrganization: org, projects: [] } });
      if (path === '/api/admin/organization-management/organizations') return route.fulfill({ json: { ok: true, organizations: [org], pagination: { total: 1, page: 1, size: 10, pages: 1 }, summary: { organizations: 1, active: org.active ? 1 : 0, users: 1, files: 0, requests: 0 }, capabilities: { edits: true, projectQuotaEnforced: true, permanentDelete: true, auditOperations: options.audit !== false } } });
      if (/\/organization-management\/organizations\/\d+$/.test(path)) return route.fulfill({ json: { ok: true, organization: org, policy: { plan: 'free', projects: 5, storageMb: 500, projectOverride: null, used: 0, reserved: 0, remaining: 5, storageUsedMb: 0, projectQuotaEnforced: true, informational: [] }, creationConfirmed: input.kind === 'create', creationOperationId: input.kind === 'create' ? opId : null } });
      if (path.endsWith('/deletion-preview')) return route.fulfill({ json: preview() });
      if (path.endsWith(`/deletions/${opId}`)) return route.fulfill({ json: { ok: true, deletion: { id: opId, organizationId: 11, state: 'pending', errorCode: 'PROVIDER_RESULT_UNKNOWN', retryable: false, automatic: true, automaticBlocked: true, automaticPaused: false } } });
      if (path.endsWith('/people')) return route.fulfill({ json: { ok: true, people: [{ id: 7, name: 'Proprietária', email: 'owner@example.test', active: 1, accessLevel: 'owner' }] } });
      if (path.endsWith('/documents')) return route.fulfill({ json: { ok: true, files: [], hasMore: false } });
      if (path.endsWith('/activity')) return route.fulfill({ json: { ok: true, events: [], next: null } });
      if (path.endsWith('/name-availability')) return route.fulfill({ json: { ok: true, available: true } });
      if (path.endsWith('/candidates')) return route.fulfill({ json: { ok: true, users: [org.owner] } });
      if (path === '/api/admin/audit') return route.fulfill({ json: { ok: true, entries: [entry], nextBefore: null, capabilities: { operations: true } } });
      if (path.includes('/api/admin/audit/operations/')) return route.fulfill({ json: { ok: true, eventId: 'frame:9', capabilities: { operations: true } } });
      if (path === '/api/admin/audit/frame%3A9' || path === '/api/admin/audit/frame:9') return route.fulfill({ json: { ok: true, entry, changes: [], attempts: [], nextHistoryBefore: null, technical: { operationId: opId, source: 'observation', eventId: '9', code: null, originalActor: { id: 1, name: null, kind: 'user' }, requestedBy: entry.actor, executor: 'user', version: 3 }, actions: [], capabilities: { operations: true } } });
      if (path.endsWith(`/operations/${opId}`)) return route.fulfill({ json: { ok: true, ...operation } });
      return route.fulfill({ json: { ok: true, enabled: false, projects: [], users: [], organizations: [org], access: [], notifications: [], unreadCount: 0, operations: [] } });
    }
    const body = request.postDataJSON(); writes.push({ path, body });
    if (path === '/api/admin/organization-management/operations') {
      input = body; operation = { ...operation, kind: input.kind, done: false, items: [{ ...operation.items[0], state: 'pending', error: null as unknown as string }] };
      return route.fulfill({ json: { ok: true, ...operation } });
    }
    if (path.endsWith(`/operations/${opId}/step`)) {
      await options.wait?.promise;
      if (!options.fail) {
        const item = input.items[0] ?? {};
        if (input.kind === 'pause') org = { ...org, active: false, storageStatus: 'DISABLED', version: org.version + 1 };
        if (input.kind === 'resume') org = { ...org, active: true, storageStatus: 'READY', version: org.version + 1 };
        if (input.kind === 'change') org = { ...org, name: String(item.name ?? org.name), description: String(item.description ?? org.description), version: org.version + 1 };
        if (input.kind === 'create') org = { ...org, id: 12, name: String(item.name), active: true, storageStatus: 'READY', version: 1 };
      }
      operation = { ...operation, done: true, items: [{ ...operation.items[0], state: options.fail ? 'failed' : 'succeeded', result: options.fail ? null : { id: org.id }, error: options.fail ? 'A operação não foi confirmada.' : null as unknown as string }] };
      return route.fulfill({ json: { ok: true, ...operation } });
    }
    if (path.endsWith(`/operations/${opId}/consult`)) { consulted = true; return route.fulfill({ json: { ok: true, operation, reconciled: true, auditEventId: 'frame:9' } }); }
    unexpected.get(page)!.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 403, json: { ok: false } });
  });
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  await page.goto(options.deletion ? `/admin?section=organizations&org_id=11&org_mode=delete${options.existingDeletion ? `&org_deletion=${opId}` : ''}` : '/admin?section=organizations');
  return { writes };
}
test.afterEach(async ({ page }) => { expect(errors.get(page) ?? []).toEqual([]); expect(unexpected.get(page) ?? []).toEqual([]); });

test('technical blocker report is absent from all tabs and appears only in requested resolver', async ({ page }, testInfo) => {
  await setup(page, { blockers: ['UNRESOLVED_OPERATION', 'LINKED_DATA'] });
  await page.getByRole('button', { name: 'Organização sintética', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Organização sintética', exact: true });
  await expect(form.getByRole('button', { name: 'Resolver impedimentos (2)' })).toBeEnabled();
  await expect(form).not.toContainText(/UNRESOLVED_OPERATION|Há uma operação pendente|Referência:|Versão de edição/);
  for (const tab of ['Pessoas', 'Plano e limites', 'Documentos', 'Histórico']) {
    await form.getByRole('button', { name: tab, exact: true }).click();
    await expect(form).not.toContainText(/INTERNAL_OPERATION|Operação [a-z0-9-]+|Registro #|UNRESOLVED_OPERATION/);
  }
  await form.getByRole('button', { name: 'Resolver impedimentos (2)' }).click();
  const resolver = page.getByRole('dialog', { name: 'Resolver impedimentos', exact: true });
  await expect(resolver).toContainText('Uma operação anterior precisa ter seu resultado consultado.');
  await expect(resolver).not.toContainText(opId);
  await expect(resolver.getByRole('button', { name: 'Consultar operação', exact: true })).toBeEnabled();
  await expect(resolver.getByRole('button', { name: 'Revisão administrativa', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('organization-blocker-resolver.png') });
});

test('failed action keeps origin form, bounds and draft under gold overlay, then only corner error', async ({ page }, testInfo) => {
  const wait = gate(); await setup(page, { fail: true, wait });
  await page.getByRole('button', { name: 'Organização sintética', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Organização sintética', exact: true });
  await expect(dialog.getByRole('button', { name: 'Salvar dados', exact: true })).toBeEnabled();
  await dialog.getByLabel('Nome', { exact: true }).fill('Rascunho mantido');
  await dialog.getByLabel('Justificativa', { exact: true }).fill('Correção autorizada para teste');
  const node = await dialog.getByLabel('Nome', { exact: true }).elementHandle(), bounds = await dialog.boundingBox();
  await dialog.getByRole('button', { name: 'Salvar dados', exact: true }).click();
  await expect(dialog.locator('.aog-dialog-loading-overlay')).toBeVisible();
  expect(await node!.evaluate(element => element.isConnected)).toBe(true);
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Rascunho mantido');
  const during = await dialog.boundingBox();
  expect(Math.abs(during!.x - bounds!.x)).toBeLessThanOrEqual(1); expect(Math.abs(during!.y - bounds!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(during!.width - bounds!.width)).toBeLessThanOrEqual(1); expect(Math.abs(during!.height - bounds!.height)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('organization-mounted-gold-overlay.png') });
  wait.release();
  await expect(dialog.locator('.aog-dialog-loading-overlay')).toHaveCount(0);
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Rascunho mantido');
  await expect(dialog.locator('.aog-deletion-error-toast')).toBeVisible();
  await expect(dialog.locator('.aog-operation-items')).toHaveCount(0); await expect(dialog).not.toContainText(opId);
  await expect(dialog.getByRole('button', { name: 'Consultar resultado', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Ver detalhes na Auditoria', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar aviso de erro' }).click();
  await expect(dialog.locator('.aog-deletion-error-toast')).toHaveCount(0); await expect(dialog).toBeVisible();
});

test('legacy operation consultation creates an observation before opening Audit, without a technical report', async ({ page }) => {
  const state = await setup(page, { fail: true });
  await page.getByRole('button', { name: 'Organização sintética', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Organização sintética', exact: true });
  await dialog.getByLabel('Justificativa', { exact: true }).fill('Consulta autorizada para teste');
  await dialog.getByRole('button', { name: 'Salvar dados', exact: true }).click();
  page.once('dialog', async confirmation => {
    expect(confirmation.message()).toBe('Descartar as alterações não salvas?');
    await confirmation.accept();
  });
  await dialog.getByRole('button', { name: 'Ver detalhes na Auditoria', exact: true }).click();
  await expect(page).toHaveURL(/section=audit/); await expect(page).toHaveURL(/audit_event=frame%3A9/);
  dialog = page.getByRole('dialog', { name: 'Detalhes da operação' });
  await expect(dialog).toBeVisible();
  expect(state.writes.filter(write => write.path.endsWith('/consult'))).toHaveLength(1);
  await expect(dialog.locator('.audit-technical')).not.toHaveAttribute('open');
});

test('resolver pauses active organization and preserves requested panel until user leaves it', async ({ page }) => {
  const state = await setup(page, { active: true });
  await page.getByRole('button', { name: 'Organização sintética', exact: true }).click();
  await page.getByRole('button', { name: 'Resolver impedimentos (1)' }).click();
  const resolver = page.getByRole('dialog', { name: 'Resolver impedimentos', exact: true });
  page.once('dialog', confirm => confirm.accept());
  await resolver.getByRole('button', { name: 'Pausar organização', exact: true }).click();
  await expect(resolver).toBeVisible();
  await expect(resolver.getByRole('button', { name: 'Preparar exclusão permanente', exact: true })).toBeEnabled();
  expect(state.writes.find(write => write.path.endsWith('/operations'))?.body.kind).toBe('pause');
  expect(state.writes.some(write => write.path.includes('permanent-delete'))).toBe(false);
});

test('deletion confirmation retains consequences and exact phrase, while codes require explicit resolver', async ({ page }) => {
  await setup(page, { deletion: true, blockers: ['LINKED_DATA'] });
  const dialog = page.getByRole('dialog', { name: 'Excluir permanentemente organização', exact: true });
  await expect(dialog).toContainText('Não há opção de desfazer');
  await expect(dialog).not.toContainText(/Referência:|LINKED_DATA|organização #/);
  await dialog.getByRole('button', { name: 'Resolver impedimentos (1)' }).click();
  const resolver = dialog.getByRole('region', { name: 'Impedimentos de Organização sintética' });
  await expect(resolver).toContainText('Existem registros vinculados que precisam ser tratados.');
  await expect(resolver).not.toContainText('LINKED_DATA');
});

test('creation keeps mounted form under loading and opens confirmed organization instead of closing window', async ({ page }) => {
  const wait = gate(); await setup(page, { wait });
  await page.getByRole('button', { name: 'Nova organização', exact: false }).click();
  let dialog = page.getByRole('dialog', { name: 'Nova organização', exact: true });
  await dialog.getByLabel('Nome', { exact: true }).fill('Nova organização sintética');
  await dialog.getByRole('combobox', { name: 'E-mail do responsável' }).fill('owner@example.test');
  await dialog.getByRole('checkbox', { name: 'Confirmo o cadastro e o vínculo de proprietário.' }).check();
  await expect(dialog.getByRole('button', { name: 'Criar organização', exact: true })).toBeEnabled();
  const input = await dialog.getByLabel('Nome', { exact: true }).elementHandle();
  await dialog.getByRole('button', { name: 'Criar organização', exact: true }).click();
  await expect(dialog.locator('.aog-dialog-loading-overlay')).toBeVisible(); expect(await input!.evaluate(element => element.isConnected)).toBe(true);
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Nova organização sintética');
  wait.release();
  dialog = page.getByRole('dialog', { name: 'Nova organização sintética', exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Salvar dados', exact: true })).toBeVisible();
  await expect(dialog.locator('.aog-deletion-toast')).toContainText('Organização criada com sucesso.');
});

test('backend capability OFF preserves legacy recovery instead of hiding it behind unavailable Audit', async ({ page }) => {
  await setup(page, { audit: false, fail: true });
  await page.getByRole('button', { name: 'Organização sintética', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Organização sintética', exact: true });
  await dialog.getByLabel('Justificativa', { exact: true }).fill('Fluxo de compatibilidade');
  await dialog.getByRole('button', { name: 'Salvar dados', exact: true }).click();
  await expect(dialog.locator('.aog-operation-items')).toBeVisible();
  await expect(dialog).toContainText(opId);
  await expect(dialog.getByRole('button', { name: 'Ver detalhes na Auditoria', exact: true })).toHaveCount(0);
});

for (const audit of [true, false]) test(`deletion error toast keeps consultation and respects report gate ${audit ? 'ON' : 'OFF'}`, async ({ page }) => {
  await setup(page, { audit, deletion: true, existingDeletion: true });
  const dialog = page.getByRole('dialog', { name: 'Excluir permanentemente organização', exact: true });
  const toast = dialog.locator('.aog-deletion-error-toast');
  await expect(toast).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Consultar exclusão', exact: true })).toBeEnabled();
  if (audit) {
    await expect(toast).toContainText('Não foi possível confirmar a conclusão da exclusão.');
    await expect(dialog).not.toContainText(/PROVIDER_RESULT_UNKNOWN|Referência:/);
    await expect(dialog).not.toContainText(opId);
    await expect(dialog.getByRole('button', { name: 'Ver detalhes na Auditoria', exact: true })).toBeEnabled();
  } else await expect(toast).toContainText('Referência: PROVIDER_RESULT_UNKNOWN');
  await toast.getByRole('button', { name: 'Fechar aviso de erro' }).click();
  await expect(toast).toHaveCount(0); await expect(dialog).toBeVisible();
});
