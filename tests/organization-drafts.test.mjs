import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOrganizationDraft, creationDraftIsDirty, isOrganizationDraftDetail,
  organizationChangeMatchesDetail, organizationDraftIsDirty, reconcileOrganizationDraft,
} from '../src/pages/Admin/organizations/organization-drafts.ts';

function detail(overrides = {}) {
  return {
    organization: {
      id: 11, name: 'Organização Alfa', slug: 'alfa', description: 'Descrição inicial', active: true,
      version: 3, plan: 'free', owner: { id: 7, name: 'Pessoa Alfa', email: 'owner@example.test' },
      projectCount: 1, userCount: 1, fileCount: 0, storageStatus: 'READY',
      updatedAt: '2026-11-26T12:00:00Z', lastActivityAt: null,
      ...overrides.organization,
    },
    policy: {
      plan: 'free', projects: 5, storageMb: 500, projectOverride: null, projectSource: 'plan',
      used: 1, reserved: 0, remaining: 4, storageUsedMb: 0, projectQuotaEnforced: true,
      informational: [], ...overrides.policy,
    },
  };
}
const change = (values = {}) => ({ id: 11, version: 3, reason: 'Justificativa confirmada', ...values });

test('loaded values are clean; meaningful edits and each section reason require discard protection', () => {
  const initial = createOrganizationDraft(detail());
  assert.equal(organizationDraftIsDirty(initial), false);
  for (const [key, value] of Object.entries({ name: 'Outro nome', description: 'Outra descrição', owner: '8', plan: 'pro', customLimit: true })) {
    const edited = { ...initial, values: { ...initial.values, [key]: value } };
    assert.equal(organizationDraftIsDirty(edited), true, key);
    assert.equal(organizationDraftIsDirty({ ...edited, values: { ...edited.values, [key]: initial.values[key] } }), false, `${key} reverted`);
  }
  for (const section of ['general', 'people', 'policy']) {
    assert.equal(organizationDraftIsDirty({ ...initial, reasons: { ...initial.reasons, [section]: 'Motivo a preservar' } }), true, section);
    assert.equal(organizationDraftIsDirty({ ...initial, reasons: { ...initial.reasons, [section]: ' \n ' } }), false, `${section} whitespace`);
  }
});

test('dirty comparison follows text and quota semantics without treating inactive numeric drafts as changes', () => {
  const initial = createOrganizationDraft(detail());
  assert.equal(organizationDraftIsDirty({ ...initial, values: { ...initial.values, name: ' Organização Alfa ', description: 'Descrição inicial\n', limit: '17' } }), false);
  const custom = createOrganizationDraft(detail({ policy: { projects: 10, projectOverride: 10, projectSource: 'organization' } }));
  assert.equal(organizationDraftIsDirty({ ...custom, values: { ...custom.values, limit: '010' } }), false);
  for (const limit of ['', 'not a number', '11']) {
    assert.equal(organizationDraftIsDirty({ ...custom, values: { ...custom.values, limit } }), true, `active limit ${JSON.stringify(limit)}`);
  }
  const refreshed = reconcileOrganizationDraft(initial, detail({ organization: { version: 4 } }));
  assert.equal(organizationDraftIsDirty(refreshed), false, 'a version number is not a user edit');
});

test('refresh merges untouched fields while retaining edited values and reasons across sections', () => {
  const initial = createOrganizationDraft(detail());
  const edited = {
    ...initial,
    values: { ...initial.values, name: 'Rascunho local', plan: 'pro' },
    reasons: { ...initial.reasons, general: 'Motivo geral', policy: 'Motivo de política' },
  };
  const updated = detail({ organization: { name: 'Nome concorrente', description: 'Descrição remota', version: 4, owner: { id: 8, name: 'Pessoa Beta', email: 'beta@example.test' } } });
  const result = reconcileOrganizationDraft(edited, updated);
  assert.equal(result.values.name, 'Rascunho local');
  assert.equal(result.values.description, 'Descrição remota');
  assert.equal(result.values.owner, '8');
  assert.equal(result.values.plan, 'pro');
  assert.equal(result.reasons.general, 'Motivo geral');
  assert.equal(result.reasons.policy, 'Motivo de política');
  assert.equal(organizationDraftIsDirty(result), true);
  const reverted = { ...result, values: { ...result.values, name: updated.organization.name, plan: updated.organization.plan }, reasons: { general: '', people: '', policy: '' } };
  assert.equal(organizationDraftIsDirty(reverted), false, 'the fresh valid server result becomes the new baseline');
});

test('observing matching server fields alone never consumes the unsent reason', () => {
  const initial = createOrganizationDraft(detail());
  const edited = { ...initial, values: { ...initial.values, name: 'Nome salvo' }, reasons: { ...initial.reasons, general: 'Motivo sem recibo' } };
  const observed = reconcileOrganizationDraft(edited, detail({ organization: { name: 'Nome salvo', version: 4 } }));
  assert.equal(observed.reasons.general, 'Motivo sem recibo');
  assert.equal(organizationDraftIsDirty(observed), true);
});

test('a verified policy receipt reconciles policy while retaining general and owner drafts', () => {
  const initial = createOrganizationDraft(detail());
  const edited = {
    ...initial, values: { ...initial.values, name: 'Nome local', owner: '8', plan: 'pro' },
    reasons: { general: 'Motivo geral', people: 'Motivo de pessoas', policy: 'Justificativa confirmada' },
  };
  const updated = detail({ organization: { version: 4, plan: 'pro' }, policy: { plan: 'pro' } });
  const result = reconcileOrganizationDraft(edited, updated, { receipt: 1, item: change({ plan: 'pro' }) });
  assert.equal(result.values.plan, 'pro');
  assert.equal(result.reasons.policy, '');
  assert.equal(result.values.name, 'Nome local');
  assert.equal(result.values.owner, '8');
  assert.equal(result.reasons.general, 'Motivo geral');
  assert.equal(result.reasons.people, 'Motivo de pessoas');
  assert.equal(organizationDraftIsDirty(result), true);
});

test('a confirmed no-op can clear its submitted reason, but cannot clear later edits or reuse a receipt', () => {
  const initial = createOrganizationDraft(detail());
  const item = change({ name: initial.values.name, description: initial.values.description });
  const sent = { ...initial, reasons: { ...initial.reasons, general: item.reason } };
  const receipt = { receipt: 1, item };
  const confirmed = reconcileOrganizationDraft(sent, detail(), receipt);
  assert.equal(organizationDraftIsDirty(confirmed), false, 'no-op success may keep the same server version');
  const later = { ...confirmed, values: { ...confirmed.values, name: 'Edição posterior' }, reasons: { ...confirmed.reasons, general: 'Novo motivo' } };
  const replay = reconcileOrganizationDraft(later, detail(), receipt);
  assert.equal(replay.values.name, 'Edição posterior');
  assert.equal(replay.reasons.general, 'Novo motivo');
  assert.equal(organizationDraftIsDirty(replay), true);
});

test('mismatched organization, version or saved values cannot serve as a confirmation', () => {
  assert.equal(organizationChangeMatchesDetail(change({ name: 'Nome esperado' }), detail({ organization: { name: 'Outro nome', version: 4 } })), false);
  assert.equal(organizationChangeMatchesDetail(change({ name: 'Organização Alfa' }), detail({ organization: { id: 12, version: 4 } })), false);
  assert.equal(organizationChangeMatchesDetail(change({ name: 'Organização Alfa' }), detail({ organization: { version: 2 } })), false);
  const initial = createOrganizationDraft(detail());
  const edited = { ...initial, values: { ...initial.values, name: 'Nome esperado' }, reasons: { ...initial.reasons, general: 'Justificativa confirmada' } };
  const mismatch = reconcileOrganizationDraft(edited, detail({ organization: { version: 4 } }), { receipt: 1, item: change({ name: 'Nome esperado' }) });
  assert.equal(mismatch.values.name, 'Nome esperado');
  assert.equal(mismatch.reasons.general, 'Justificativa confirmada');
  assert.equal(organizationDraftIsDirty(mismatch), true);
});

test('changing identity discards old fields and all section reasons', () => {
  const initial = createOrganizationDraft(detail());
  const edited = { ...initial, values: { ...initial.values, name: 'Dado privado anterior' }, reasons: { general: 'A', people: 'B', policy: 'C' } };
  const other = detail({ organization: { id: 12, name: 'Outra organização', description: 'Outro contexto' } });
  const result = reconcileOrganizationDraft(edited, other);
  assert.equal(result.organizationId, 12);
  assert.equal(result.values.name, 'Outra organização');
  assert.equal(result.values.description, 'Outro contexto');
  assert.deepEqual(result.reasons, { general: '', people: '', policy: '' });
  assert.equal(organizationDraftIsDirty(result), false);
});

test('only a complete detail for the expected identity is eligible to become a baseline', () => {
  assert.equal(isOrganizationDraftDetail(detail(), 11), true);
  for (const value of [null, {}, { ok: true }, { organization: { id: 11 } }, detail({ organization: { id: 12 } }), detail({ organization: { version: Number.NaN } }), detail({ policy: { projects: Number.NaN } })]) {
    assert.equal(isOrganizationDraftDetail(value, 11), false, JSON.stringify(value));
  }
});

test('creation distinguishes initial values, a selected owner, confirmation and complete reversion', () => {
  const initial = { name: '', description: '', plan: 'free', email: '', ownerId: null, confirmed: false };
  assert.equal(creationDraftIsDirty(initial), false);
  assert.equal(creationDraftIsDirty({ ...initial, name: '  ', description: '\n', email: ' ' }), false);
  for (const [key, value] of Object.entries({ name: 'Nova', description: 'Rascunho', plan: 'pro', email: 'owner@example.test', ownerId: 7, confirmed: true })) {
    assert.equal(creationDraftIsDirty({ ...initial, [key]: value }), true, key);
    assert.equal(creationDraftIsDirty({ ...initial, [key]: initial[key] }), false, `${key} reverted`);
  }
});
