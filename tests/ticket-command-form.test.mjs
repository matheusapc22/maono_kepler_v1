import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTicketCommand, createTicketCommandForm, ticketCreationDefinitelyRejected,
  ticketCreationIntent, ticketDraftSnapshot, ticketTransitionTargets,
  ticketWriteNeedsReview, validateTicketCommandForm,
} from '../src/pages/Projects/components/ticket-command-form.ts';

function ticket(status = 'in_progress', extra = {}) {
  return { id: 12, organizationId: 3, subject: 'Solicitação', status, assignedTo: { id: 7 }, nextAction: 'Conferir resultado', etag: '"opaque-core-v1"', cycle: { number: 1, origin: 'created', openedAt: '2026-09-25T12:00:00Z' }, ...extra };
}
function closing(extra = {}) {
  return { ...createTicketCommandForm(ticket()), status: 'closed', outcomeCode: 'resolved', summary: 'Resultado confirmado', evidence: 'Teste reproduzido com resultado esperado', communication: 'Resultado comunicado no atendimento', ...extra };
}
test('cinco estados conservados: reabertura não aparece como PATCH livre de status', () => {
  assert.deepEqual(ticketTransitionTargets('new'), ['open', 'closed']);
  assert.deepEqual(ticketTransitionTargets('open'), ['in_progress', 'closed']);
  assert.deepEqual(ticketTransitionTargets('in_progress'), ['open', 'in_review', 'closed']);
  assert.deepEqual(ticketTransitionTargets('in_review'), ['in_progress', 'closed']);
  assert.deepEqual(ticketTransitionTargets('closed'), []);
  assert.equal(createTicketCommandForm(ticket('closed')).action, 'reopen');
  assert.equal(validateTicketCommandForm({ ...closing(), status: 'new' }, ticket()).field, 'status');
});
test('avançar exige responsável e próxima ação; revisão exige evidência, retorno exige motivo', () => {
  const current = ticket('new');
  const open = { ...createTicketCommandForm(current), nextAction: 'Orientar a pessoa' };
  assert.equal(validateTicketCommandForm(open, current), null);
  assert.equal(validateTicketCommandForm(open, { ...current, assignedTo: null }).field, 'status');
  assert.equal(validateTicketCommandForm({ ...open, nextAction: ' ' }, current).field, 'nextAction');
  const review = { ...createTicketCommandForm(ticket()), status: 'in_review' };
  assert.equal(validateTicketCommandForm(review, ticket()).field, 'evidence');
  assert.equal(validateTicketCommandForm({ ...review, evidence: 'Operação testada' }, ticket()), null);
  assert.equal(validateTicketCommandForm(createTicketCommandForm(ticket('in_review')), ticket('in_review')).field, 'reason');
  assert.equal(validateTicketCommandForm(createTicketCommandForm(ticket()), ticket()).field, 'reason');
});
test('fechamento exige resultado, evidência e comunicação em todos outcomes, inclusive sem execução', () => {
  for (const outcomeCode of ['resolved', 'answered', 'fulfilled', 'rejected', 'duplicate', 'withdrawn', 'no_action']) {
    assert.equal(validateTicketCommandForm(closing({ outcomeCode }), ticket()), null);
    for (const field of ['summary', 'evidence', 'communication']) {
      assert.equal(validateTicketCommandForm(closing({ outcomeCode, [field]: '  ' }), ticket()).field, field);
    }
  }
  assert.equal(validateTicketCommandForm(closing(), ticket(), true).field, 'pendingChangeAcknowledged');
  assert.equal(validateTicketCommandForm(closing({ pendingChangeAcknowledged: true }), ticket(), true), null);
  const command = buildTicketCommand(closing({ pendingChangeAcknowledged: true }));
  assert.equal(command.kind, 'transition');
  assert.deepEqual(Object.keys(command.payload).sort(), ['closure', 'status']);
  assert.equal(command.payload.closure.pendingChangeAcknowledged, true);
  assert.equal('changeRequestId' in command.payload.closure, false);
});
test('espera é comando independente, requer responsável, não muda estado nem configura SLA', () => {
  const form = { ...createTicketCommandForm(ticket()), action: 'wait_start', reason: 'Aguardando informação', responsibleId: '7', nextAction: 'Solicitante envia evidência', expectedAt: '2026-09-26T10:30' };
  assert.equal(validateTicketCommandForm(form, ticket()), null);
  assert.equal(validateTicketCommandForm({ ...form, responsibleId: '' }, ticket()).field, 'responsibleId');
  assert.equal(validateTicketCommandForm(form, ticket('closed')).field, 'action');
  assert.equal(validateTicketCommandForm(form, ticket('open', { wait: { id: 1 } })).field, 'action');
  assert.equal(validateTicketCommandForm({ ...form, expectedAt: 'inválida' }, ticket()).field, 'expectedAt');
  const command = buildTicketCommand(form);
  assert.equal(command.kind, 'wait');
  assert.equal(command.payload.action, 'start');
  assert.equal('status' in command.payload, false);
  assert.equal('pauseSla' in command.payload, false);
  assert.equal(command.payload.expectedAt, new Date(form.expectedAt).toISOString());
  assert.equal(validateTicketCommandForm({ ...form, action: 'wait_end' }, ticket()).field, 'action');
});
test('reabrir exige motivo e próximo passo e não reenvia fechamento ou histórico anterior', () => {
  const current = ticket('closed', { closure: { evidence: 'Histórico a preservar' } });
  const form = { ...createTicketCommandForm(current), reason: 'O mesmo problema voltou', nextAction: 'Verificar ocorrência' };
  assert.equal(validateTicketCommandForm(form, current), null);
  assert.equal(validateTicketCommandForm({ ...form, reason: '' }, current).field, 'reason');
  assert.equal(validateTicketCommandForm({ ...form, nextAction: '' }, current).field, 'nextAction');
  assert.deepEqual(buildTicketCommand(form), { kind: 'reopen', payload: { reason: form.reason, nextAction: form.nextAction } });
  assert.equal(current.closure.evidence, 'Histórico a preservar');
});
test('limites coincidem com comandos sem truncar campos silenciosamente', () => {
  for (const [field, limit] of [['summary', 2000], ['evidence', 2000], ['communication', 2000]]) {
    assert.equal(validateTicketCommandForm(closing({ [field]: 'a'.repeat(limit) }), ticket()), null);
    assert.equal(validateTicketCommandForm(closing({ [field]: 'a'.repeat(limit + 1) }), ticket()).field, field);
  }
  const current = ticket('closed');
  const form = { ...createTicketCommandForm(current), reason: 'Mesmo problema' };
  assert.equal(validateTicketCommandForm({ ...form, nextAction: 'a'.repeat(1001) }, current).field, 'nextAction');
  assert.equal(validateTicketCommandForm({ ...form, reason: 'a'.repeat(1001) }, current).field, 'reason');
});
test('rascunho sujo conserva token core original após reload e conflito; nova identidade nunca herda token', () => {
  const original = ticket(), current = ticket('in_review', { etag: '"opaque-core-v2"' });
  assert.equal(ticketDraftSnapshot(original, current, true), original);
  assert.equal(ticketDraftSnapshot(original, current, true).etag, '"opaque-core-v1"');
  assert.equal(ticketDraftSnapshot(original, current, false), current);
  const another = { ...current, organizationId: 4 };
  assert.equal(ticketDraftSnapshot(original, another, true), another);
  assert.equal(ticketWriteNeedsReview({ status: 412 }), true);
  assert.equal(ticketWriteNeedsReview({ status: 428 }), true);
  assert.equal(ticketWriteNeedsReview({ status: 503 }), false);
});
test('resposta perdida repete intenção e payload congelados sem gerar chave nova ou incorporar edições', () => {
  let generated = 0;
  const payload = { subject: 'Dúvida', description: 'Objetivo original', triageAnswers: { contexto: 'Original' } };
  const intent = ticketCreationIntent(null, payload, () => `intent-${++generated}`);
  payload.subject = 'Mudança posterior'; payload.triageAnswers.contexto = 'Alterado';
  const retried = ticketCreationIntent(intent, payload, () => `intent-${++generated}`);
  assert.equal(retried, intent);
  assert.equal(retried.key, 'intent-1');
  assert.equal(retried.payload.subject, 'Dúvida');
  assert.equal(retried.payload.triageAnswers.contexto, 'Original');
  assert.equal(generated, 1);
  const explicitlyNew = ticketCreationIntent(null, payload, () => `intent-${++generated}`);
  assert.equal(explicitlyNew.key, 'intent-2');
  assert.equal(explicitlyNew.payload.subject, 'Mudança posterior');
});
test('incerteza nunca autoriza nova intenção por erro posterior de sessão; apenas rejeição inicial definitiva', () => {
  for (const status of [0, 408, 409, 500, 502, 503]) assert.equal(ticketCreationDefinitelyRejected({ status }), false);
  assert.equal(ticketCreationDefinitelyRejected(new DOMException('aborted', 'AbortError')), false);
  assert.equal(ticketCreationDefinitelyRejected({ status: 422 }), true);
  assert.equal(ticketCreationDefinitelyRejected({ status: 428 }), true);
  assert.equal(ticketCreationDefinitelyRejected({ status: 401 }, true), false);
  assert.equal(ticketCreationDefinitelyRejected({ status: 422 }, true), false);
});
