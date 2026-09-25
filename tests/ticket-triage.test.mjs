import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTicketTriageWriteReady,
  getTicketTriageCapability,
  hasTicketTriagePayload,
  isTicketTriageEnabled,
  normalizeTicketTriage,
  publicTicketTriage,
  TICKET_DEMAND_NATURES,
  TICKET_TRIAGE_COLUMNS,
} from "../functions/_lib/ticket-triage.js";

const answers = {
  question_request: {},
  incident: { startedAt: "Horário ainda não identificado", impactDescription: "Equipe sem acesso" },
  defect: { stepsToReproduce: "Abrir o projeto", actualResult: "Tela vazia", affectedVersion: "Versão observada no suporte" },
  improvement_change: { problemToSolve: "Exportação insuficiente", expectedBenefit: "Analisar o recorte" },
  recurring_problem: { recurrenceFrequency: "Três vezes nesta semana", relatedContext: "Relatos da mesma tarefa, ainda em avaliação" },
};
function payload(nature = "question_request") {
  return {
    demandNature: nature, expectedResult: "Concluir a tarefa", context: "Projeto autorizado",
    impact: "individual", urgency: "flexible", triageFormVersion: 1,
    triageAnswers: answers[nature],
  };
}
function normalized(input, options = {}) {
  return normalizeTicketTriage(input, {
    creating: true, priority: "normal", actorId: 9, now: "2026-09-25T15:00:00.000Z", ...options,
  });
}
function capabilityDb(columns = TICKET_TRIAGE_COLUMNS) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      return { bind() { return this; }, first() { return { name: "organization_tickets" }; }, all() { return { results: columns.map((name) => ({ name })) }; } };
    },
  };
}

test("CT-03: cinco naturezas independentes do domínio, sem mudar os cinco estados", () => {
  assert.equal(TICKET_DEMAND_NATURES.length, 5);
  for (const nature of TICKET_DEMAND_NATURES) {
    for (const category of ["map", "database"]) {
      const result = normalized({ ...payload(nature), category });
      assert.equal(result.updates.demand_nature, nature);
      assert.equal(result.updates.triage_source, "human");
      assert.equal(result.updates.triaged_by, 9);
      assert.equal(result.updates.triage_form_version, 1);
      assert.deepEqual(JSON.parse(result.updates.triage_answers), answers[nature]);
      assert.equal("category" in result.updates, false);
      assert.equal("status" in result.updates, false);
    }
  }
});

test("formulário progressivo exige perguntas da natureza e rejeita mistura/versão futura", () => {
  assert.doesNotThrow(() => normalized(payload()));
  assert.throws(() => normalized({ ...payload("defect"), triageAnswers: {} }), (e) => e.code === "TICKET_TRIAGE_INVALID");
  assert.throws(() => normalized({ ...payload(), triageAnswers: { stepsToReproduce: "não pertence" } }), (e) => e.code === "TICKET_TRIAGE_INVALID");
  assert.throws(() => normalized({ ...payload(), triageFormVersion: 2 }), (e) => e.code === "TICKET_TRIAGE_FORM_VERSION_INVALID");
  assert.throws(() => normalized({ ...payload(), triageFormVersion: "1" }), (e) => e.code === "TICKET_TRIAGE_FORM_VERSION_INVALID");
  for (const triageAnswers of [null, [], "{}", { constructor: "não permitido" }]) {
    assert.throws(() => normalized({ ...payload(), triageAnswers }));
  }
});

test("limites, enums e respostas vazias são validados sem truncar evidências", () => {
  assert.doesNotThrow(() => normalized({ ...payload(), context: "a".repeat(2000) }));
  for (const [key, value] of [
    ["expectedResult", " "], ["context", "x".repeat(2001)], ["priorityReason", "x".repeat(1001)],
    ["impact", "everyone"], ["urgency", "now"], ["demandNature", "map"], ["context", 12],
  ]) assert.throws(() => normalized({ ...payload(), [key]: value }), (e) => e.status === 400);
  assert.throws(() => normalized({ ...payload("incident"), triageAnswers: { ...answers.incident, impactDescription: "x".repeat(2001) } }));
});

test("JSON serializado também respeita o limite antes de chegar ao banco", () => {
  const escaped = "x" + "\u0000".repeat(1998) + "x";
  assert.throws(() => normalized({
    ...payload("defect"), triageAnswers: {
      stepsToReproduce: escaped, actualResult: escaped, affectedVersion: escaped,
    },
  }), (error) => error.status === 400 && error.code === "TICKET_TRIAGE_INVALID");
});

test("CT-04: prioridade, domínio e reclassificação exigem motivo humano novo", () => {
  const current = { ...normalized(payload()).updates, priority: "normal", category: "map" };
  for (const [input, options] of [
    [{ priority: "high" }, { priority: "high" }],
    [{ category: "database" }, { category: "database" }],
    [{ demandNature: "incident", triageAnswers: answers.incident }, {}],
  ]) assert.throws(() => normalized(input, { creating: false, current, ...options }), (e) => e.code === "TICKET_TRIAGE_REASON_REQUIRED");
  const changed = normalized({ demandNature: "incident", triageAnswers: answers.incident, priorityReason: "Interrupção confirmada pela equipe" }, { creating: false, current });
  assert.equal(changed.updates.demand_nature, "incident");
  assert.equal(changed.updates.priority_reason, "Interrupção confirmada pela equipe");
  assert.throws(() => normalized({ demandNature: "incident", priorityReason: "Reclassificação" }, { creating: false, current }), (e) => e.code === "TICKET_TRIAGE_INVALID");
  for (const priority of ["low", "high"]) {
    assert.throws(() => normalized(payload(), { priority }), (e) => e.code === "TICKET_TRIAGE_REASON_REQUIRED");
    assert.doesNotThrow(() => normalized({ ...payload(), priorityReason: "Impacto avaliado" }, { priority }));
  }
});

test("CT-05: legado/cliente antigo permanece sem classificação; alteração de domínio não infere natureza", () => {
  const current = { id: 17, category: "map", priority: "normal" };
  assert.deepEqual(normalized({ subject: "Legado", category: "map", priority: "high" }, { priority: "high" }), { updates: {}, hasChanges: false });
  const changed = normalized({ category: "database", priorityReason: "Investigação identificou a base" }, { creating: false, current, category: "database" });
  assert.deepEqual(changed.updates, { priority_reason: "Investigação identificou a base" });
  const visible = publicTicketTriage({ ...current, ...changed.updates });
  assert.equal(visible.demandNature, null);
  assert.equal(visible.needsTriage, true);
  assert.equal(visible.triageSource, "legacy");
  assert.equal(visible.triagedBy, null);
  assert.throws(() => normalized({ context: "Parcial não classifica" }, { creating: false, current }));
  assert.throws(() => normalized({ expectedResult: "Campo isolado" }));
});

test("edição parcial preserva campos não escritos e registra autor/instante humano", () => {
  const current = normalized(payload("defect")).updates;
  const result = normalized({ context: "Somente contexto mudou" }, { creating: false, current, actorId: 12 });
  assert.deepEqual(result.updates, {
    context: "Somente contexto mudou", triage_source: "human",
    triaged_at: "2026-09-25T15:00:00.000Z", triaged_by: 12,
  });
});

test("flag desligada não consulta schema; campos novos são recusados explicitamente", async () => {
  const DB = { prepare() { throw new Error("Não pode consultar schema novo"); } };
  assert.equal(isTicketTriageEnabled({}), false);
  assert.equal(isTicketTriageEnabled({ MAONO_TICKET_TRIAGE_ENABLED: "false" }), false);
  assert.equal(await getTicketTriageCapability({ DB }), false);
  assert.equal(await assertTicketTriageWriteReady({ DB }, { subject: "Antigo" }), false);
  for (const value of [undefined, null, "question_request"]) {
    const input = { demandNature: value };
    assert.equal(hasTicketTriagePayload(input), true);
    await assert.rejects(() => assertTicketTriageWriteReady({ DB }, input), (e) => e.code === "TICKET_TRIAGE_DISABLED" && e.status === 503);
  }
});

test("capability só aparece quando flag e todas colunas estão presentes; escrita falha antes de DML", async () => {
  const old = capabilityDb(["id", "organization_id"]);
  const env = { DB: old, MAONO_TICKET_TRIAGE_ENABLED: "true" };
  assert.equal(await getTicketTriageCapability(env), false);
  await assert.rejects(() => assertTicketTriageWriteReady(env, { subject: "Cliente antigo" }), (e) => e.code === "TICKET_TRIAGE_SCHEMA_OUTDATED" && e.status === 503);
  assert.ok(old.calls.every((sql) => /SELECT|PRAGMA/.test(sql)));
  assert.equal(await getTicketTriageCapability({ DB: capabilityDb(), MAONO_TICKET_TRIAGE_ENABLED: "true" }), true);
  assert.equal(await getTicketTriageCapability({ DB: capabilityDb(), MAONO_TICKET_TRIAGE_ENABLED: "false" }), false);
});
