import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeletionBlocker, isDeletionPreview } from '../src/pages/Admin/organizations/organization-deletion-contract.ts';

test('structured blocker only accepts known domain actions, safe identities and its organization', () => {
  const blocker = { code: 'UNRESOLVED_OPERATION', count: 1, description: 'Consulte a operação anterior.', action: { kind: 'query', enabled: true, organizationId: 11, operationId: '22222222-2222-4222-8222-222222222222', itemIndex: 0 } };
  const preview = { organizationId: 11, name: 'Organização sintética', version: 3, eligible: false, blockers: [blocker], confirmation: 'EXCLUIR PERMANENTEMENTE' };
  assert.equal(isDeletionBlocker(blocker), true); assert.equal(isDeletionPreview(preview, 11), true);
  assert.equal(isDeletionBlocker({ ...blocker, action: { ...blocker.action, kind: 'execute_url' } }), false);
  assert.equal(isDeletionBlocker({ ...blocker, action: { ...blocker.action, operationId: '../private' } }), false);
  assert.equal(isDeletionPreview({ ...preview, blockers: [{ ...blocker, action: { ...blocker.action, organizationId: 99 } }] }, 11), false);
  assert.equal(isDeletionPreview({ ...preview, eligible: true }, 11), false);
});

test('legacy code/count previews remain valid without fabricating a resolver action', () => {
  const blocker = { code: 'LINKED_DATA', count: 2 };
  assert.equal(isDeletionBlocker(blocker), true); assert.equal(blocker.action, undefined);
  assert.equal(isDeletionPreview({ organizationId: 11, name: 'Legada', version: 0, eligible: false, blockers: [blocker], confirmation: 'EXCLUIR PERMANENTEMENTE' }, 11), true);
});
