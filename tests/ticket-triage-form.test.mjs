import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTicketTriagePayload,
  changeTicketDemandNature,
  createTicketTriageForm,
  getTicketTriageQuestions,
  ticketTriageReasonRequired,
  validateTicketTriageForm,
} from '../src/pages/Projects/components/ticket-triage-form.ts';

function complete(nature = 'question_request') {
  return {
    ...createTicketTriageForm(),
    demandNature: nature,
    expectedResult: 'Retomar a tarefa de trabalho',
    impact: 'individual',
    urgency: 'flexible',
    triageAnswers: Object.fromEntries(getTicketTriageQuestions(nature).filter((question) => question.required).map((question) => [question.key, 'Contexto necessário para atendimento'])),
  };
}

test('legado sem classificação não ganha natureza inferida pelo domínio ou texto', () => {
  const form = createTicketTriageForm({ category: 'map', subject: 'Erro no mapa', demandNature: null, needsTriage: true });
  assert.equal(form.demandNature, '');
  assert.deepEqual(form.triageAnswers, {});
  assert.equal(validateTicketTriageForm(form, { priority: 'normal' }).field, 'demandNature');
});

test('as cinco naturezas têm o pacote mínimo progressivo acordado com a API', () => {
  const required = {
    question_request: [],
    incident: ['startedAt', 'impactDescription'],
    defect: ['stepsToReproduce', 'actualResult', 'affectedVersion'],
    improvement_change: ['problemToSolve', 'expectedBenefit'],
    recurring_problem: ['recurrenceFrequency', 'relatedContext'],
  };
  for (const [nature, keys] of Object.entries(required)) {
    assert.deepEqual(getTicketTriageQuestions(nature).filter((q) => q.required).map((q) => q.key), keys);
    const form = complete(nature);
    assert.equal(validateTicketTriageForm(form, { priority: 'normal' }), null, nature);
    for (const key of keys) {
      const missing = { ...form, triageAnswers: { ...form.triageAnswers, [key]: '   ' } };
      assert.equal(validateTicketTriageForm(missing, { priority: 'normal' }).field, key, `${nature}:${key}`);
    }
  }
});

test('dúvida permanece curta, mas resultado, impacto e urgência não podem ser vazios', () => {
  const form = complete();
  for (const key of ['expectedResult', 'impact', 'urgency']) {
    assert.equal(validateTicketTriageForm({ ...form, [key]: '' }, { priority: 'normal' }).field, key);
  }
  assert.deepEqual(buildTicketTriagePayload(form).triageAnswers, {});
});

test('prioridade inicial baixa/alta e alterações reais exigem justificativa nova', () => {
  const original = { priority: 'normal', demandNature: 'question_request', category: 'support' };
  assert.equal(ticketTriageReasonRequired('normal'), false);
  assert.equal(ticketTriageReasonRequired('low'), true);
  assert.equal(ticketTriageReasonRequired('high'), true);
  assert.equal(ticketTriageReasonRequired('normal', original, 'question_request', 'support'), false);
  assert.equal(ticketTriageReasonRequired('high', original, 'question_request', 'support'), true);
  assert.equal(ticketTriageReasonRequired('normal', original, 'incident', 'support'), true);
  assert.equal(ticketTriageReasonRequired('normal', original, 'question_request', 'map'), true);
  assert.equal(validateTicketTriageForm(complete(), { priority: 'high' }).field, 'priorityReason');
  assert.equal(validateTicketTriageForm(complete(), { priority: 'normal', reasonRequired: true }).field, 'priorityReason');
});

test('troca de natureza limpa respostas e motivo antigos, preservando o objetivo e contexto comuns', () => {
  const current = { ...complete('defect'), context: 'Tela de camadas', priorityReason: 'Motivo anterior' };
  const next = changeTicketDemandNature(current, 'incident');
  assert.deepEqual(next.triageAnswers, {});
  assert.equal(next.priorityReason, '');
  assert.equal(next.expectedResult, current.expectedResult);
  assert.equal(next.context, current.context);
  assert.equal(next.impact, current.impact);
  assert.equal(next.urgency, current.urgency);
  assert.equal(current.triageAnswers.stepsToReproduce, 'Contexto necessário para atendimento');
  assert.equal(changeTicketDemandNature(current, 'defect'), current);
});

test('serialização não envia respostas residuais de outra natureza e fixa a versão contratada', () => {
  const form = { ...complete('incident'), expectedResult: '  Recuperar acesso  ', triageAnswers: { startedAt: ' horário não identificado ', impactDescription: ' Equipe afetada ', workaround: '', stepsToReproduce: 'Não pertence a incidente' } };
  const payload = buildTicketTriagePayload(form);
  assert.equal(payload.triageFormVersion, 1);
  assert.equal(payload.expectedResult, 'Recuperar acesso');
  assert.deepEqual(payload.triageAnswers, { startedAt: 'horário não identificado', impactDescription: 'Equipe afetada' });
  assert.equal('category' in payload, false);
  assert.equal('status' in payload, false);
  assert.equal('dueAt' in payload, false);
});

test('limites de texto coincidem com API sem truncar conteúdo silenciosamente', () => {
  const form = complete('defect');
  for (const [field, limit] of [['expectedResult', 2000], ['context', 2000], ['priorityReason', 1000]]) {
    assert.equal(validateTicketTriageForm({ ...form, [field]: 'a'.repeat(limit) }, { priority: 'normal' }), null);
    assert.equal(validateTicketTriageForm({ ...form, [field]: 'a'.repeat(limit + 1) }, { priority: 'normal' }).field, field);
  }
  const tooLong = { ...form, triageAnswers: { ...form.triageAnswers, actualResult: 'x'.repeat(2001) } };
  assert.equal(validateTicketTriageForm(tooLong, { priority: 'normal' }).field, 'actualResult');
});

test('carregar triagem filtra dados desconhecidos sem reutilizar perguntas de outra natureza', () => {
  const form = createTicketTriageForm({ demandNature: 'incident', expectedResult: 'Voltar a funcionar', impact: 'team', urgency: 'blocked', triageAnswers: { startedAt: 'Hoje pela manhã', impactDescription: 'Mapa indisponível', actualResult: 'Campo de defeito', __unexpected: 'Ignorar' } });
  assert.deepEqual(form.triageAnswers, { startedAt: 'Hoje pela manhã', impactDescription: 'Mapa indisponível' });
  assert.equal(form.demandNature, 'incident');
});
