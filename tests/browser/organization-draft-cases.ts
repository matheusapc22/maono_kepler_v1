import { expect, test, type Page, type Locator } from '@playwright/test';

const BASE = '/api/admin/organization-management';
const discardMessage = 'Descartar as alterações não salvas?';
const runtimeErrors = new WeakMap<Page, string[]>();
const owners = [
  { id: 7, name: 'Responsável Alfa', email: 'alfa@example.test', active: 1, accessLevel: 'owner' },
  { id: 8, name: 'Responsável Beta', email: 'beta@example.test', active: 1, accessLevel: 'owner' },
];
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
type Failure = 'none' | 'failed' | 'empty-result' | 'invalid-detail' | 'network-timeout' | 'lost-step';

async function setupDrafts(page: Page, audit: boolean) {
  const org = {
    id: 11, name: 'Organização de rascunhos', slug: 'org-rascunhos', description: 'Descrição original',
    active: true, version: 3, plan: 'free', owner: owners[0], projectCount: 0, userCount: 2,
    fileCount: 0, storageStatus: 'READY', updatedAt: '2026-01-01T12:00:00Z', lastActivityAt: null,
  };
  const other = { ...org, id: 12, name: 'Outra organização', slug: 'outra-org', description: 'Outro contexto' };
  const policy = {
    plan: 'free', projects: 5, storageMb: 500, projectOverride: null as number | null,
    projectSource: 'plan', used: 0, reserved: 0, remaining: 5, storageUsedMb: 0,
    projectQuotaEnforced: true, informational: [],
  };
  const state = {
    org, policy, denied: false, failure: 'none' as Failure, stepGate: null as ReturnType<typeof deferred> | null,
    writes: [] as { path: string; body: { kind: string; items: Record<string, unknown>[] } }[],
    starts: 0, detailReads: 0, input: { kind: 'change', items: [] } as { kind: string; items: Record<string, unknown>[] },
  };
  let operation = {
    id: '77777777-7777-4777-8777-777777777777', kind: 'change', done: false, createdAt: '2026-11-26T12:00:00Z',
    items: [{ index: 0, label: org.name, state: 'pending', attempts: 0, result: null as { id: number } | null,
      error: null as string | null, code: null as string | null, retryable: false }],
  };
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === '/api/session') return route.fulfill({ json: {
      authenticated: true, user: { id: 1, name: 'Operador sintético', email: 'qa@example.test', role: 'super_admin', activeOrganizationId: 11 },
      organizations: [org, other], activeOrganization: org, projects: [],
    } });
    if (state.denied && path.startsWith(BASE)) return route.fulfill({ status: 403, json: { ok: false, error: { code: 'FORBIDDEN', message: 'Acesso revogado' } } });
    if (request.method() === 'GET') {
      if (path === `${BASE}/organizations`) return route.fulfill({ json: {
        ok: true, organizations: [org, other], pagination: { total: 2, page: 1, size: 10, pages: 1 },
        summary: { organizations: 2, active: 2, users: 2, files: 0, requests: 0 },
        capabilities: { edits: true, projectQuotaEnforced: true, permanentDelete: false, auditOperations: audit },
      } });
      if (path === `${BASE}/organizations/11` || path === `${BASE}/organizations/12`) {
        state.detailReads++;
        if (state.starts && state.failure === 'invalid-detail') return route.fulfill({ json: { ok: true, organization: { id: org.id } } });
        if (state.starts && state.failure === 'network-timeout') return route.abort('timedout');
        return route.fulfill({ json: { ok: true, organization: path.endsWith('/11') ? org : other, policy } });
      }
      if (path.endsWith('/people')) return route.fulfill({ json: { ok: true, people: owners } });
      if (path.endsWith('/documents')) return route.fulfill({ json: { ok: true, files: [], hasMore: false } });
      if (path.endsWith('/activity')) return route.fulfill({ json: { ok: true, events: [], next: null } });
      if (path.endsWith('/name-availability')) return route.fulfill({ json: { ok: true, available: true } });
      if (path.endsWith('/candidates')) return route.fulfill({ json: { ok: true, users: [owners[0]] } });
      if (path.endsWith(`/operations/${operation.id}`)) return route.fulfill({ json: { ok: true, ...operation } });
      return route.fulfill({ json: { ok: true, enabled: false, projects: [], users: [], organizations: [], access: [], notifications: [], unreadCount: 0, operations: [] } });
    }
    const body = request.postDataJSON();
    state.writes.push({ path, body });
    if (path === `${BASE}/operations`) {
      state.starts++;
      state.input = body;
      operation = { ...operation, kind: body.kind, done: false, items: [{ ...operation.items[0], state: 'pending', result: null, error: null }] };
      return route.fulfill({ json: { ok: true, ...operation } });
    }
    if (path.endsWith(`/operations/${operation.id}/step`)) {
      await state.stepGate?.promise;
      if (state.failure === 'empty-result') return route.fulfill({ json: { ok: true, ...operation, done: true, items: [] } });
      const item = state.input.items[0] ?? {};
      if (state.failure !== 'failed') {
        if ('name' in item) org.name = String(item.name).trim();
        if ('description' in item) org.description = String(item.description).trim();
        if ('ownerId' in item) org.owner = owners.find(owner => owner.id === Number(item.ownerId))!;
        if ('plan' in item) org.plan = policy.plan = String(item.plan);
        if ('projectLimit' in item) {
          policy.projectOverride = item.projectLimit === null ? null : Number(item.projectLimit);
          policy.projects = policy.projectOverride ?? 5;
          policy.projectSource = policy.projectOverride === null ? 'plan' : 'organization';
        }
        org.version++;
      }
      operation = { ...operation, done: true, items: [{ ...operation.items[0], state: state.failure === 'failed' ? 'failed' : 'succeeded',
        result: state.failure === 'failed' ? null : { id: org.id }, error: state.failure === 'failed' ? 'A operação não foi confirmada.' : null,
        retryable: state.failure === 'failed' }] };
      if (state.failure === 'lost-step') return route.abort('timedout');
      return route.fulfill({ json: { ok: true, ...operation } });
    }
    if (path.endsWith(`/operations/${operation.id}/consult`)) {
      return route.fulfill({ json: { ok: true, operation, reconciled: true, auditEventId: 'frame:1' } });
    }
    throw new Error(`Unexpected synthetic write: ${request.method()} ${path}`);
  });
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  await page.goto('/admin?section=organizations');
  await expect(page.getByRole('button', { name: org.name, exact: true })).toBeVisible();
  return state;
}

function confirmations(page: Page) {
  const state = { messages: [] as string[], accept: false };
  page.on('dialog', async dialog => {
    state.messages.push(dialog.message());
    if (state.accept) await dialog.accept(); else await dialog.dismiss();
  });
  return state;
}
async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Organização de rascunhos', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Organização de rascunhos');
  return dialog;
}
async function expectDiscard(page: Page, prompts: ReturnType<typeof confirmations>, action: () => Promise<unknown>) {
  const count = prompts.messages.length;
  await action();
  await expect.poll(() => prompts.messages.length).toBe(count + 1);
  expect(prompts.messages.at(-1)).toBe(discardMessage);
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function closeClean(dialog: Locator, prompts: ReturnType<typeof confirmations>) {
  const count = prompts.messages.length;
  await dialog.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(prompts.messages).toHaveLength(count);
}

/** The same public behavior runs in both compiled flags, through the existing CI configs. */
export function organizationDraftCases(audit: boolean) {
  test.describe(`organization draft contract ${audit ? 'ON' : 'OFF'}`, () => {
    test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page) ?? []).toEqual([]); });

    test('AU-UX01 pristine reading closes every tab without discard confirmation', async ({ page }) => {
      const state = await setupDrafts(page, audit), prompts = confirmations(page);
      for (const tab of ['Dados gerais', 'Pessoas', 'Plano e limites', 'Documentos', 'Histórico']) {
        const dialog = await openEditor(page);
        await dialog.getByRole('button', { name: tab, exact: true }).click();
        await closeClean(dialog, prompts);
      }
      const dialog = await openEditor(page);
      await dialog.getByRole('button', { name: 'Histórico', exact: true }).click();
      await dialog.getByRole('button', { name: 'Dados gerais', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      expect(prompts.messages).toEqual([]);
      expect(state.writes).toEqual([]);
    });

    test('AU-UX01 hidden draft stays protected in History and Documents and reversion becomes clean', async ({ page }) => {
      const state = await setupDrafts(page, audit), prompts = confirmations(page), dialog = await openEditor(page);
      await dialog.getByLabel('Nome', { exact: true }).fill('Nome ainda não salvo');
      for (const tab of ['Histórico', 'Documentos']) {
        await dialog.getByRole('button', { name: tab, exact: true }).click();
        await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
        await dialog.getByRole('button', { name: 'Dados gerais', exact: true }).click();
        await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Nome ainda não salvo');
      }
      await dialog.getByRole('button', { name: 'Pessoas', exact: true }).click();
      await expectDiscard(page, prompts, () => dialog.getByRole('button', { name: 'Gerenciar vínculos e permissões', exact: true }).click());
      await expect(page).toHaveURL(/section=organizations/);
      if (audit) {
        await dialog.getByRole('button', { name: 'Histórico', exact: true }).click();
        await expectDiscard(page, prompts, () => dialog.getByRole('button', { name: 'Abrir Auditoria da organização', exact: true }).click());
        await expect(page).toHaveURL(/section=organizations/);
      }
      await dialog.getByRole('button', { name: 'Dados gerais', exact: true }).click();
      await dialog.getByLabel('Nome', { exact: true }).fill('Organização de rascunhos');
      await closeClean(dialog, prompts);
      expect(prompts.messages).toHaveLength(audit ? 4 : 3);
      expect(state.writes).toEqual([]);
    });

    test('AU-UX01 editable fields and each justification participate in real dirty state', async ({ page }) => {
      await setupDrafts(page, audit);
      const prompts = confirmations(page), dialog = await openEditor(page);
      const choose = async (field: Locator, value: string) => {
        const label = await field.locator(`option[value="${value}"]`).innerText();
        await field.click();
        await page.getByRole('listbox').getByRole('option', { name: label, exact: true }).click();
        await expect(field).toHaveValue(value);
      };
      const changeAndRevert = async (field: Locator, edited: string, original: string, select = false) => {
        if (select) await choose(field, edited); else await field.fill(edited);
        await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
        if (select) await choose(field, original); else await field.fill(original);
      };
      await changeAndRevert(dialog.getByLabel('Descrição', { exact: true }), 'Descrição local', 'Descrição original');
      await changeAndRevert(dialog.getByLabel('Justificativa', { exact: true }), 'Justificativa geral', '');
      await dialog.getByRole('button', { name: 'Pessoas', exact: true }).click();
      await expect(dialog.getByLabel('Responsável principal', { exact: true })).toBeEnabled();
      await dialog.getByLabel('Responsável principal', { exact: true }).click();
      await expect(page.getByRole('listbox')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(dialog).toBeVisible();
      expect(prompts.messages).toHaveLength(2);
      await changeAndRevert(dialog.getByLabel('Responsável principal', { exact: true }), '8', '7', true);
      await changeAndRevert(dialog.getByLabel('Justificativa', { exact: true }), 'Justificativa de responsável', '');
      await dialog.getByRole('button', { name: 'Plano e limites', exact: true }).click();
      await changeAndRevert(dialog.getByLabel('Plano', { exact: true }), 'pro', 'free', true);
      const override = dialog.getByRole('checkbox', { name: 'Definir limite específico para esta organização' });
      await override.check();
      await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
      await dialog.getByLabel('Limite específico de projetos', { exact: true }).fill('17');
      await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
      await override.uncheck();
      await changeAndRevert(dialog.getByLabel('Justificativa', { exact: true }), 'Justificativa de política', '');
      await closeClean(dialog, prompts);
      expect(prompts.messages).toHaveLength(8);
    });

    test('AU-UX01 cancelling Escape keeps value, selection, focus and scroll on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 480 });
      await setupDrafts(page, audit);
      const prompts = confirmations(page), dialog = await openEditor(page);
      const reason = dialog.getByLabel('Justificativa', { exact: true });
      await reason.fill('Justificativa preservada ao cancelar');
      await reason.scrollIntoViewIfNeeded();
      await reason.focus();
      await reason.press('Home'); await reason.press('Shift+ArrowRight'); await reason.press('Shift+ArrowRight');
      const before = await reason.evaluate(input => ({ selection: [(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd],
        scroll: input.closest('.aog-dialog-body')!.scrollTop }));
      expect(before.scroll).toBeGreaterThan(0);
      await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
      // Repeated Escape must not bypass the discard guard without a new click.
      await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
      await expect(reason).toBeFocused();
      await expect(reason).toHaveValue('Justificativa preservada ao cancelar');
      const after = await reason.evaluate(input => ({ selection: [(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd],
        scroll: input.closest('.aog-dialog-body')!.scrollTop }));
      expect(after).toEqual(before);
      await expectDiscard(page, prompts, () => dialog.getByRole('button', { name: 'Fechar painel', exact: true }).click());
      await expect(reason).toBeFocused();
      expect(await reason.evaluate(input => ({ selection: [(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd],
        scroll: input.closest('.aog-dialog-body')!.scrollTop }))).toEqual(before);
      prompts.accept = true;
      await dialog.getByRole('button', { name: 'Fechar painel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(prompts.messages).toEqual([discardMessage, discardMessage, discardMessage, discardMessage]);
    });

    test('AU-UX01 new creation is clean and reverting all creation fields removes the guard', async ({ page }) => {
      const state = await setupDrafts(page, audit), prompts = confirmations(page);
      const create = page.getByRole('button', { name: 'Nova organização', exact: false });
      await create.click();
      let dialog = page.getByRole('dialog', { name: 'Nova organização', exact: true });
      await closeClean(dialog, prompts);
      await create.click(); dialog = page.getByRole('dialog', { name: 'Nova organização', exact: true });
      await dialog.getByLabel('Nome', { exact: true }).fill('Rascunho de criação');
      await dialog.getByRole('textbox', { name: 'Descrição', exact: true }).fill('Descrição a preservar');
      await dialog.getByLabel('Plano', { exact: true }).selectOption('pro');
      await dialog.getByRole('combobox', { name: 'E-mail do responsável' }).fill('alfa@example.test');
      await expect(dialog.getByText('Usuário ativo confirmado.', { exact: true })).toBeVisible();
      await dialog.getByRole('checkbox').check();
      await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
      await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Rascunho de criação');
      await dialog.getByLabel('Nome', { exact: true }).fill('');
      await dialog.getByRole('textbox', { name: 'Descrição', exact: true }).fill('');
      await dialog.getByLabel('Plano', { exact: true }).selectOption('free');
      await dialog.getByRole('combobox', { name: 'E-mail do responsável' }).fill('');
      await dialog.getByRole('checkbox').uncheck();
      await closeClean(dialog, prompts);
      expect(prompts.messages).toHaveLength(1); expect(state.writes).toEqual([]);
    });

    test('AU-UX01 refresh updates untouched values and retains edited fields and their guard', async ({ page }) => {
      const state = await setupDrafts(page, audit), prompts = confirmations(page), dialog = await openEditor(page);
      await dialog.getByLabel('Nome', { exact: true }).fill('Nome local');
      await dialog.getByLabel('Justificativa', { exact: true }).fill('Motivo local');
      state.org.description = 'Descrição nova no servidor'; state.org.owner = owners[1]; state.org.version++;
      await dialog.getByRole('button', { name: audit ? 'Atualizar dados' : 'Consultar versão atual', exact: true }).click();
      await expect(dialog.getByLabel('Descrição', { exact: true })).toHaveValue('Descrição nova no servidor');
      await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Nome local');
      await expect(dialog.getByLabel('Justificativa', { exact: true })).toHaveValue('Motivo local');
      await dialog.getByRole('button', { name: 'Pessoas', exact: true }).click();
      await expect(dialog.getByLabel('Responsável principal', { exact: true })).toHaveValue('8');
      await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
      await dialog.getByRole('button', { name: 'Dados gerais', exact: true }).click();
      await dialog.getByLabel('Nome', { exact: true }).fill(state.org.name);
      await dialog.getByLabel('Justificativa', { exact: true }).fill('');
      await closeClean(dialog, prompts); expect(state.writes).toEqual([]);
    });

    test('AU-UX01 successful policy save reconciles only that section and retains general draft', async ({ page }) => {
      const state = await setupDrafts(page, audit), prompts = confirmations(page), dialog = await openEditor(page);
      await dialog.getByLabel('Nome', { exact: true }).fill('Nome guardado em outra aba');
      await dialog.getByLabel('Justificativa', { exact: true }).fill('Justificativa dos dados gerais');
      await dialog.getByRole('button', { name: 'Plano e limites', exact: true }).click();
      await dialog.getByLabel('Plano', { exact: true }).selectOption('pro');
      await dialog.getByLabel('Justificativa', { exact: true }).fill('Justificativa somente da política');
      await dialog.getByRole('button', { name: 'Salvar plano e quota', exact: true }).click();
      await expect(dialog.locator('.aog-deletion-toast')).toContainText('Dados da organização atualizados');
      await expect(dialog.getByLabel('Justificativa', { exact: true })).toHaveValue('');
      await expect(dialog.getByLabel('Plano', { exact: true })).toHaveValue('pro');
      await dialog.getByRole('button', { name: 'Dados gerais', exact: true }).click();
      await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Nome guardado em outra aba');
      await expect(dialog.getByLabel('Justificativa', { exact: true })).toHaveValue('Justificativa dos dados gerais');
      await dialog.getByRole('button', { name: 'Histórico', exact: true }).click();
      await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
      await dialog.getByRole('button', { name: 'Dados gerais', exact: true }).click();
      await dialog.getByLabel('Nome', { exact: true }).fill(state.org.name);
      await dialog.getByLabel('Justificativa', { exact: true }).fill('');
      await closeClean(dialog, prompts);
      expect(state.starts).toBe(1);
      expect(state.input.items[0]).not.toHaveProperty('name');
      expect(state.input.items[0].reason).toBe('Justificativa somente da política');
    });

    test('AU-UX01 busy blocks closing and a confirmed save becomes clean', async ({ page }) => {
      const state = await setupDrafts(page, audit), prompts = confirmations(page), dialog = await openEditor(page);
      state.stepGate = deferred();
      const name = dialog.getByLabel('Nome', { exact: true }), origin = await name.elementHandle();
      await name.fill('Nome salvo'); await dialog.getByLabel('Justificativa', { exact: true }).fill('Alteração confirmada');
      await dialog.getByRole('button', { name: 'Salvar dados', exact: true }).click();
      await expect(dialog.locator('.aog-dialog-loading-overlay')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Fechar painel', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); expect(prompts.messages).toEqual([]);
      expect(await origin!.evaluate(element => element.isConnected)).toBe(true);
      state.stepGate.release();
      await expect(dialog.locator('.aog-dialog-loading-overlay')).toHaveCount(0);
      await expect(name).toHaveValue('Nome salvo');
      await expect(dialog.getByLabel('Justificativa', { exact: true })).toHaveValue('');
      await closeClean(dialog, prompts);
      expect(state.starts).toBe(1); expect(prompts.messages).toEqual([]);
    });

    for (const failure of ['failed', 'empty-result', 'invalid-detail', 'network-timeout'] as const) {
      test(`AU-UX01 ${failure} preserves draft until confirmed detail and recovery`, async ({ page }) => {
        const state = await setupDrafts(page, audit), prompts = confirmations(page), dialog = await openEditor(page);
        state.failure = failure;
        await dialog.getByLabel('Nome', { exact: true }).fill('Edição com resultado incerto');
        await dialog.getByLabel('Justificativa', { exact: true }).fill('Motivo preservado');
        await dialog.getByRole('button', { name: 'Salvar dados', exact: true }).click();
        await expect(dialog.locator('.aog-deletion-error-toast')).toBeVisible();
        await expect(dialog.locator('.aog-dialog-loading-overlay')).toHaveCount(0);
        await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Edição com resultado incerto');
        await expect(dialog.getByLabel('Justificativa', { exact: true })).toHaveValue('Motivo preservado');
        await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
        if (failure === 'failed') {
          state.failure = 'none';
          await dialog.getByRole('button', { name: 'Retomar próximo item recuperável', exact: true }).click();
          await expect(dialog.getByLabel('Justificativa', { exact: true })).toHaveValue('');
          await closeClean(dialog, prompts);
          expect(state.starts).toBe(1);
        }
        if (failure === 'invalid-detail' || failure === 'network-timeout') {
          state.failure = 'none';
          await dialog.getByRole('button', { name: audit ? 'Atualizar dados' : 'Consultar versão atual', exact: true }).click();
          await expect(dialog.getByLabel('Justificativa', { exact: true })).toHaveValue('');
          await closeClean(dialog, prompts);
          expect(state.starts).toBe(1);
        }
      });
    }

    if (audit) test('AU-UX01 lost step response is confirmed by consultation without replay or losing another draft', async ({ page }) => {
      const state = await setupDrafts(page, audit), prompts = confirmations(page), dialog = await openEditor(page);
      await dialog.getByLabel('Nome', { exact: true }).fill('Nome não enviado');
      await dialog.getByLabel('Justificativa', { exact: true }).fill('Motivo dos dados gerais preservado');
      await dialog.getByRole('button', { name: 'Plano e limites', exact: true }).click();
      await dialog.getByLabel('Plano', { exact: true }).selectOption('pro');
      await dialog.getByLabel('Justificativa', { exact: true }).fill('Motivo da política enviada');
      state.failure = 'lost-step';
      await dialog.getByRole('button', { name: 'Salvar plano e quota', exact: true }).click();
      await expect(dialog.locator('.aog-deletion-error-toast')).toBeVisible();
      await expect(dialog.locator('.aog-dialog-loading-overlay')).toHaveCount(0);
      await expect(dialog.getByLabel('Justificativa', { exact: true })).toHaveValue('Motivo da política enviada');
      expect(state.org.plan).toBe('pro');
      await dialog.getByRole('button', { name: 'Consultar resultado', exact: true }).click();
      await expect(dialog.getByLabel('Justificativa', { exact: true })).toHaveValue('');
      await expect(dialog.getByLabel('Plano', { exact: true })).toHaveValue('pro');
      await dialog.getByRole('button', { name: 'Dados gerais', exact: true }).click();
      await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Nome não enviado');
      await expect(dialog.getByLabel('Justificativa', { exact: true })).toHaveValue('Motivo dos dados gerais preservado');
      await expectDiscard(page, prompts, () => page.keyboard.press('Escape'));
      await dialog.getByLabel('Nome', { exact: true }).fill('Organização de rascunhos');
      await dialog.getByLabel('Justificativa', { exact: true }).fill('');
      await closeClean(dialog, prompts);
      expect(state.starts).toBe(1);
      expect(state.writes.filter(write => write.path.endsWith('/step'))).toHaveLength(1);
      expect(state.writes.filter(write => write.path.endsWith('/consult'))).toHaveLength(1);
      expect(state.input.items[0]).not.toHaveProperty('name');
      expect(prompts.messages).toEqual([discardMessage]);
    });

    test('AU-UX01 discarded and revoked drafts never leak into another organization', async ({ page }) => {
      const state = await setupDrafts(page, audit), prompts = confirmations(page), dialog = await openEditor(page);
      await dialog.getByLabel('Nome', { exact: true }).fill('Rascunho privado da organização A');
      prompts.accept = true;
      await dialog.getByRole('button', { name: 'Fechar painel', exact: true }).click();
      await expect(dialog).toHaveCount(0); expect(prompts.messages).toEqual([discardMessage]);
      await page.getByRole('button', { name: 'Outra organização', exact: true }).click();
      await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Outra organização');
      await dialog.getByLabel('Nome', { exact: true }).fill('Rascunho com acesso revogado');
      state.denied = true;
      await dialog.getByRole('button', { name: audit ? 'Atualizar dados' : 'Consultar versão atual', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Entrar novamente', exact: true })).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('Rascunho privado da organização A', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Rascunho com acesso revogado', { exact: true })).toHaveCount(0);
      expect(state.writes).toEqual([]);
    });
  });
}
