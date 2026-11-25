import assert from 'node:assert/strict';
import test from 'node:test';
import { publicAuditEntry } from '../functions/_lib/admin-operation-audit-reader.js';
import { auditDayBoundary, auditFilterErrorLabel, auditQuery, auditDateLabel, parseAuditPage, parseAuditDetail, parseAuditRecoveryResult, mergeAuditHistory } from '../src/pages/Admin/components/admin-audit-operations-model.ts';

const actor = { id: 7, name: 'Operador histórico', kind: 'user' };
const frame = { id: 9, row_source: 'frame', occurred_at: '2026-11-25 12:34:56', actor_id: 7, actor_name: actor.name,
  organization_id: 11, organization_name: 'Organização excluída', organization_slug: 'historica',
  ui_route: '/admin', technical_origin: 'api:POST:/api/admin/organization-management/operations',
  action: 'organization.pause', resource_type: 'organization', resource_id: '11', resource_label: 'Organização excluída',
  outcome: 'failed', executor_kind: 'user', token: 'MUST_NOT_LEAK' };
const entry = () => publicAuditEntry(frame);
const page = entries => ({ ok: true, entries, nextBefore: null, capabilities: { operations: true } });
const detail = () => ({ ok: true, entry: entry(), changes: [{ field: 'Ativa', before: true, after: false }], attempts: [], nextHistoryBefore: null,
  technical: { operationId: 'logical-operation', source: 'organization_management_operations', eventId: '9', code: 'CONFIRMED_FAILURE', originalActor: actor, requestedBy: actor, executor: 'user', version: 2 },
  actions: [], capabilities: { operations: true } });

test('new client consumes actual server projection, snapshots and proven result; strips excess fields', () => {
  const data = parseAuditPage({ ...page([{ ...entry(), token: 'MUST_NOT_LEAK' }]), cookie: 'MUST_NOT_LEAK' });
  assert.equal(data.entries[0].organization.name, 'Organização excluída');
  assert.equal(data.entries[0].actor.name, 'Operador histórico');
  assert.equal(data.entries[0].result, 'failed');
  assert.equal(data.entries[0].createdAt, '2026-11-25T12:34:56.000Z');
  assert.doesNotMatch(JSON.stringify(data), /MUST_NOT_LEAK|cookie|token/);
  assert.match(auditDateLabel(data.entries[0].createdAt), /09:34:56.*GMT-3/);
});

test('legacy gaps are preserved and only explicit authorization-v2 facts are accepted as authorization', () => {
  const legacy = publicAuditEntry({ row_source: 'legacy', id: 5, action: 'organization.pause', user_id: 7, details: '{"organizationId":11,"result":"success"}', created_at: '2026-11-25 12:00:00' });
  const parsed = parseAuditPage(page([legacy])).entries[0];
  assert.equal(parsed.result, 'legacy_unproven'); assert.equal(parsed.actor.name, null); assert.equal(parsed.organization.name, null); assert.equal(parsed.route, null);
  for (const result of ['authorized', 'denied']) {
    const proven = publicAuditEntry({ row_source: 'legacy', id: 5, action: 'organization.pause', user_id: 7, details: JSON.stringify({ auditVersion: 2, phase: 'authorization', result }), created_at: '2026-11-25 12:00:00' });
    assert.equal(parseAuditPage(page([proven])).entries[0].result, result);
  }
  assert.throws(() => parseAuditPage(page([{ ...legacy, result: 'succeeded' }])));
});

test('missing capability, unsupported result, duplicate rows and legacy spoofing fail closed', () => {
  assert.throws(() => parseAuditPage({ ok: true, entries: [], nextBefore: null }));
  assert.throws(() => parseAuditPage({ ...page([]), capabilities: { operations: false } }));
  assert.throws(() => parseAuditPage(page([{ ...entry(), result: 'maybe' }])));
  assert.throws(() => parseAuditPage(page([entry(), entry()])));
  assert.throws(() => parseAuditPage(page([{ ...entry(), id: 'legacy:9', legacy: false }])));
  assert.throws(() => parseAuditPage({ ...page([entry()]), nextBefore: 'incomplete-page-cursor' }));
  assert.throws(() => parseAuditPage(page([{ ...entry(), createdAt: '2026-02-31T12:00:00.000Z' }])));
});

test('Brasília calendar filters produce UTC half-open boundaries including historical offsets', () => {
  assert.equal(auditDayBoundary('2026-11-25'), '2026-11-25T03:00:00.000Z');
  assert.equal(auditDayBoundary('2026-11-25', true), '2026-11-26T03:00:00.000Z');
  assert.equal(auditDayBoundary('2018-12-01'), '2018-12-01T02:00:00.000Z');
  assert.throws(() => auditDayBoundary('2026-02-31'));
  const params = new URLSearchParams(auditQuery({ from: '2026-11-25', to: '2026-11-25', result: 'failed', organizationId: '11' }, 'opaque_cursor-9'));
  assert.equal(params.get('from'), '2026-11-25T03:00:00.000Z'); assert.equal(params.get('to'), '2026-11-26T03:00:00.000Z');
  assert.equal(params.get('organizationId'), '11'); assert.equal(params.get('before'), 'opaque_cursor-9');
  assert.throws(() => auditQuery({ from: '2026-11-26', to: '2026-11-25', result: '', organizationId: '' }, null));
  assert.throws(() => auditQuery({ from: '', to: '', result: '', organizationId: '1 OR 1' }, null));
});

test('detail validates selected identity and domain command allowlist, never raw replay data', () => {
  const payload = detail();
  payload.actions = [{ kind: 'query', enabled: true, reason: 'Consulte a mesma operação.', organizationId: 11, operationId: 'logical-operation', deletionId: null, sql: 'MUST_NOT_LEAK' }];
  const parsed = parseAuditDetail(payload, 'frame:9');
  assert.equal(parsed.actions[0].kind, 'query'); assert.equal(parsed.technical.originalActor.name, actor.name);
  assert.doesNotMatch(JSON.stringify(parsed), /MUST_NOT_LEAK|sql/);
  assert.throws(() => parseAuditDetail(payload, 'frame:8'));
  assert.throws(() => parseAuditDetail({ ...payload, capabilities: { operations: false } }, 'frame:9'));
  assert.throws(() => parseAuditDetail({ ...payload, actions: [{ ...payload.actions[0], kind: 'execute_sql' }] }, 'frame:9'));
});

test('filter validation uses local allowed messages and never arbitrary exception text', () => {
  assert.equal(auditFilterErrorLabel(new Error('PRIVATE_DB_HOST_AND_TOKEN')), 'Confira os filtros e tente novamente.');
  assert.equal(auditFilterErrorLabel({ issue: 'invalid_date', message: 'PRIVATE_DB_HOST_AND_TOKEN' }), 'Confira os filtros e tente novamente.');
  let issue;
  try { auditQuery({ from: '2026-11-26', to: '2026-11-25', result: '', organizationId: '' }, null); } catch (cause) { issue = cause; }
  assert.equal(auditFilterErrorLabel(issue), 'A data final deve ser igual ou posterior à inicial.');
});

test('recovery success requires the matching domain, known states and consistent completion', () => {
  const action = { operationId: 'logical-operation', deletionId: null };
  const operation = { id: action.operationId, done: true, items: [{ state: 'failed', message: 'PRIVATE_DETAIL' }] };
  assert.equal(parseAuditRecoveryResult({ ok: true, operation }, action).operation.items[0].state, 'failed');
  assert.doesNotMatch(JSON.stringify(parseAuditRecoveryResult({ ok: true, operation }, action)), /PRIVATE_DETAIL/);
  for (const response of [{ ok: true }, { ok: true, operation: { ...operation, id: 'other-operation' } }, { ok: true, operation: { ...operation, done: false } }, { ok: true, operation: { ...operation, items: [{ state: 'maybe' }] } }, { ok: true, operation, deletion: {} }]) assert.throws(() => parseAuditRecoveryResult(response, action));
  const deletionAction = { operationId: 'deletion-operation', deletionId: 'deletion-operation' };
  const deletion = { id: deletionAction.deletionId, state: 'pending', errorCode: 'PROVIDER_RESULT_UNKNOWN' };
  assert.equal(parseAuditRecoveryResult({ ok: true, deletion }, deletionAction).deletion.errorCode, 'PROVIDER_RESULT_UNKNOWN');
  assert.throws(() => parseAuditRecoveryResult({ ok: true, operation }, deletionAction));
  assert.throws(() => parseAuditRecoveryResult({ ok: true, deletion: { ...deletion, state: 'maybe' } }, deletionAction));
});

test('history pages combine one attempt without losing its failure or duplicating stages', () => {
  const attempt = { id: 'attempt-1', parentId: null, itemIndex: 0, originalActor: actor, requestedBy: actor, executor: 'user', startedAt: null, endedAt: '2026-11-25T12:34:56.000Z', result: 'failed', stages: [{ id: 'frame:9', createdAt: '2026-11-25T12:34:56.000Z', result: 'failed', summary: 'Falhou.' }] };
  const first = parseAuditDetail({ ...detail(), attempts: [attempt], nextHistoryBefore: 9 }, 'frame:9');
  const second = parseAuditDetail({ ...detail(), attempts: [{ ...attempt, startedAt: '2026-11-25T12:00:00.000Z', endedAt: null, result: 'running', stages: [{ id: 'frame:8', createdAt: '2026-11-25T12:00:00.000Z', result: 'running', summary: 'Execução iniciada.' }] }] }, 'frame:9');
  const merged = mergeAuditHistory(first, second);
  assert.equal(merged.attempts.length, 1); assert.deepEqual(merged.attempts[0].stages.map(stage => stage.id), ['frame:8', 'frame:9']);
  assert.equal(merged.attempts[0].result, 'failed'); assert.equal(merged.attempts[0].startedAt, '2026-11-25T12:00:00.000Z');
  assert.equal(merged.nextHistoryBefore, null);
});
