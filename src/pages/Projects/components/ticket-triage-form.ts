import type {
  Ticket,
  TicketDemandNature,
  TicketCategory,
  TicketImpact,
  TicketPriority,
  TicketTriagePayload,
  TicketUrgency,
} from "./ticket-types";

export const TICKET_TRIAGE_LIMITS = {
  expectedResult: 2000,
  context: 2000,
  priorityReason: 1000,
  answer: 2000,
} as const;

export const DEMAND_NATURE_LABELS: Record<TicketDemandNature, string> = {
  question_request: "Dúvida / solicitação",
  incident: "Incidente",
  defect: "Defeito",
  improvement_change: "Melhoria / mudança",
  recurring_problem: "Problema recorrente",
};

export const IMPACT_LABELS: Record<TicketImpact, string> = {
  individual: "Uma pessoa",
  team: "Parte da equipe",
  organization: "Toda a organização",
};

export const URGENCY_LABELS: Record<TicketUrgency, string> = {
  flexible: "A atividade pode continuar",
  soon: "Existe uma alternativa limitada",
  blocked: "A atividade está interrompida",
};

export type TicketTriageQuestion = {
  key: string;
  label: string;
  help: string;
  required: boolean;
};

const QUESTIONS: Record<TicketDemandNature, TicketTriageQuestion[]> = {
  question_request: [],
  incident: [
    { key: "startedAt", label: "Quando a interrupção começou?", help: "Informe data, horário e fuso se souber. Se não souber, escreva “horário não identificado”.", required: true },
    { key: "impactDescription", label: "O que deixou de funcionar e quem foi afetado?", help: "Descreva a atividade interrompida ou degradada.", required: true },
    { key: "workaround", label: "Há uma alternativa para continuar?", help: "Se houver, descreva a alternativa temporária e suas limitações.", required: false },
  ],
  defect: [
    { key: "stepsToReproduce", label: "Passos para reproduzir", help: "Descreva, em ordem, o que você fez antes da falha.", required: true },
    { key: "actualResult", label: "O que aconteceu?", help: "Informe o comportamento observado. O comportamento desejado vai em Resultado esperado.", required: true },
    { key: "affectedVersion", label: "Versão ou contexto da ocorrência", help: "Informe a versão se conhecida ou a tela, operação e momento da ocorrência. Não invente uma versão.", required: true },
  ],
  improvement_change: [
    { key: "problemToSolve", label: "Qual problema a mudança deve resolver?", help: "Explique a necessidade atual, antes de descrever a solução.", required: true },
    { key: "expectedBenefit", label: "Qual benefício é esperado?", help: "Descreva como a tarefa deve melhorar. Registrar o pedido não aprova nem executa uma mudança.", required: true },
  ],
  recurring_problem: [
    { key: "recurrenceFrequency", label: "Com que frequência o problema ocorre?", help: "Descreva quando se repete ou os episódios conhecidos.", required: true },
    { key: "relatedContext", label: "Quais ocorrências parecem relacionadas?", help: "Informe os códigos conhecidos ou o contexto comum; se não houver outros chamados identificados, diga isso.", required: true },
  ],
};

export type TicketTriageForm = {
  demandNature: TicketDemandNature | "";
  expectedResult: string;
  context: string;
  impact: TicketImpact | "";
  urgency: TicketUrgency | "";
  priorityReason: string;
  triageAnswers: Record<string, string>;
};

export type TicketTriageFieldError = { field: string; message: string };

export function getTicketTriageQuestions(nature: TicketDemandNature | "") {
  return nature ? QUESTIONS[nature] || [] : [];
}

export function createTicketTriageForm(ticket?: Ticket | null): TicketTriageForm {
  const nature = ticket?.demandNature && Object.hasOwn(DEMAND_NATURE_LABELS, ticket.demandNature)
    ? ticket.demandNature : "";
  const answers: Record<string, string> = {};
  for (const question of getTicketTriageQuestions(nature)) {
    const value = ticket?.triageAnswers?.[question.key];
    if (typeof value === "string") answers[question.key] = value;
  }
  return {
    demandNature: nature,
    expectedResult: ticket?.expectedResult || "",
    context: ticket?.context || "",
    impact: ticket?.impact && Object.hasOwn(IMPACT_LABELS, ticket.impact) ? ticket.impact : "",
    urgency: ticket?.urgency && Object.hasOwn(URGENCY_LABELS, ticket.urgency) ? ticket.urgency : "",
    priorityReason: ticket?.priorityReason || "",
    triageAnswers: answers,
  };
}

/** A different nature never inherits answers or the old classification reason. */
export function changeTicketDemandNature(
  form: TicketTriageForm,
  demandNature: TicketDemandNature | "",
): TicketTriageForm {
  return demandNature === form.demandNature ? form : {
    ...form, demandNature, triageAnswers: {}, priorityReason: "",
  };
}

export function ticketTriageReasonRequired(
  priority: TicketPriority,
  original?: Pick<Ticket, "priority" | "demandNature" | "category">,
  nature?: TicketDemandNature | "",
  category?: TicketCategory,
) {
  if (!original) return priority !== "normal";
  return priority !== original.priority || (category !== undefined && category !== original.category) || Boolean(original.demandNature && nature !== undefined && nature !== original.demandNature);
}

export function validateTicketTriageForm(
  form: TicketTriageForm,
  options: { priority: TicketPriority; reasonRequired?: boolean },
): TicketTriageFieldError | null {
  if (!form.demandNature || !Object.hasOwn(DEMAND_NATURE_LABELS, form.demandNature)) {
    return { field: "demandNature", message: "Selecione a natureza da demanda." };
  }
  if (!form.expectedResult.trim()) return { field: "expectedResult", message: "Descreva o resultado que você espera alcançar." };
  if (!form.impact || !Object.hasOwn(IMPACT_LABELS, form.impact)) return { field: "impact", message: "Informe quem foi afetado." };
  if (!form.urgency || !Object.hasOwn(URGENCY_LABELS, form.urgency)) return { field: "urgency", message: "Informe se a atividade pode continuar." };
  const reasonRequired = options.reasonRequired ?? options.priority !== "normal";
  if (reasonRequired && !form.priorityReason.trim()) return { field: "priorityReason", message: "Explique o motivo da classificação ou da prioridade escolhida." };
  for (const key of ["expectedResult", "context", "priorityReason"] as const) {
    if (form[key].length > TICKET_TRIAGE_LIMITS[key]) {
      return { field: key, message: `Reduza o texto para até ${TICKET_TRIAGE_LIMITS[key]} caracteres.` };
    }
  }
  for (const question of getTicketTriageQuestions(form.demandNature)) {
    const value = form.triageAnswers[question.key] || "";
    if (question.required && !value.trim()) return { field: question.key, message: `Preencha: ${question.label}` };
    if (value.length > TICKET_TRIAGE_LIMITS.answer) return { field: question.key, message: `Reduza a resposta para até ${TICKET_TRIAGE_LIMITS.answer} caracteres.` };
  }
  return null;
}

/** Call only after validation; serialize only questions belonging to this nature. */
export function buildTicketTriagePayload(form: TicketTriageForm): TicketTriagePayload {
  const answers: Record<string, string> = {};
  for (const { key } of getTicketTriageQuestions(form.demandNature)) {
    const value = (form.triageAnswers[key] || "").trim();
    if (value) answers[key] = value;
  }
  return {
    demandNature: form.demandNature as TicketDemandNature,
    expectedResult: form.expectedResult.trim(),
    context: form.context.trim(),
    impact: form.impact as TicketImpact,
    urgency: form.urgency as TicketUrgency,
    priorityReason: form.priorityReason.trim(),
    triageAnswers: answers,
    triageFormVersion: 1,
  };
}
