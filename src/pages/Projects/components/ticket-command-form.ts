import type {
  CreateTicketPayload, Ticket, TicketClosureOutcome, TicketCommand, TicketStatus,
} from "./ticket-types";

export const TICKET_COMMAND_LIMITS = { nextAction: 1000, reason: 1000, summary: 2000, evidence: 2000, communication: 2000 } as const;
export const TICKET_CLOSURE_LABELS: Record<TicketClosureOutcome, string> = {
  resolved: "Problema resolvido", answered: "Dúvida respondida", fulfilled: "Solicitação atendida",
  rejected: "Solicitação recusada", duplicate: "Chamado duplicado", withdrawn: "Solicitante desistiu", no_action: "Concluído sem ação",
};
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["open", "closed"], open: ["in_progress", "closed"],
  in_progress: ["open", "in_review", "closed"], in_review: ["in_progress", "closed"], closed: [],
};
export function ticketTransitionTargets(status: TicketStatus) { return TRANSITIONS[status] || []; }
export type TicketCommandForm = {
  action: "transition" | "wait_start" | "wait_end" | "reopen";
  status: TicketStatus;
  nextAction: string;
  reason: string;
  evidence: string;
  outcomeCode: TicketClosureOutcome;
  summary: string;
  communication: string;
  pendingChangeAcknowledged: boolean;
  responsibleId: string;
  expectedAt: string;
};
export type TicketCommandValidationIssue = { field: keyof TicketCommandForm; message: string };
export function createTicketCommandForm(ticket: Ticket): TicketCommandForm {
  return { action: ticket.status === "closed" ? "reopen" : "transition", status: ticketTransitionTargets(ticket.status)[0] || "open", nextAction: ticket.nextAction || "", reason: "", evidence: "", outcomeCode: "resolved", summary: "", communication: "", pendingChangeAcknowledged: false, responsibleId: ticket.assignedTo ? String(ticket.assignedTo.id) : "", expectedAt: "" };
}
export function validateTicketCommandForm(form: TicketCommandForm, ticket: Ticket, hasPendingChange = false): TicketCommandValidationIssue | null {
  const required = (field: keyof TicketCommandForm, message: string): TicketCommandValidationIssue | null => typeof form[field] === "string" && !String(form[field]).trim() ? { field, message } : null;
  let issue: TicketCommandValidationIssue | null;
  if (form.action === "transition") {
    if (!ticketTransitionTargets(ticket.status).includes(form.status)) return { field: "status", message: "Esta mudança de situação não está disponível. Confira o estado atual." };
    if (form.status === "closed") {
      if (!Object.hasOwn(TICKET_CLOSURE_LABELS, form.outcomeCode)) return { field: "outcomeCode", message: "Selecione o resultado da conclusão." };
      for (const [field, message] of [["summary", "Explique o motivo e o resultado da conclusão."], ["evidence", "Registre a evidência do resultado, inclusive quando não houve execução."], ["communication", "Registre a comunicação ao solicitante."]] as const) { issue = required(field, message); if (issue) return issue; }
      if (hasPendingChange && !form.pendingChangeAcknowledged) return { field: "pendingChangeAcknowledged", message: "Confirme que o trabalho de mudança permanece independente desta conclusão." };
    } else {
      if (!ticket.assignedTo?.id) return { field: "status", message: "Defina e salve um atendente antes de mudar a situação." };
      if ((issue = required("nextAction", "Informe a próxima ação do atendimento."))) return issue;
      if (form.status === "in_review" && (issue = required("evidence", "Registre a evidência do resultado que será verificado."))) return issue;
      if ((ticket.status === "in_review" || form.status === "open" && ticket.status === "in_progress") && (issue = required("reason", "Explique o motivo de retornar o atendimento."))) return issue;
    }
  } else if (form.action === "reopen") {
    if (ticket.status !== "closed") return { field: "action", message: "Somente um chamado concluído pode iniciar outro ciclo." };
    if ((issue = required("reason", "Explique por que o mesmo problema exige reabertura."))) return issue;
    if ((issue = required("nextAction", "Informe a próxima ação do novo ciclo."))) return issue;
  } else {
    if (ticket.status === "closed") return { field: "action", message: "Reabra o chamado antes de registrar espera." };
    if (form.action === "wait_start") {
      if (ticket.wait) return { field: "action", message: "Já existe uma espera ativa. Encerre-a antes de iniciar outra." };
      if ((issue = required("reason", "Informe o motivo da espera."))) return issue;
      if ((issue = required("responsibleId", "Selecione quem acompanha a espera."))) return issue;
      if (form.expectedAt && !Number.isFinite(new Date(form.expectedAt).getTime())) return { field: "expectedAt", message: "Informe uma data válida para a próxima verificação." };
    } else if (!ticket.wait) return { field: "action", message: "Não há espera ativa para encerrar." };
    if ((issue = required("nextAction", "Informe a próxima ação e quem deve realizá-la."))) return issue;
  }
  for (const field of Object.keys(TICKET_COMMAND_LIMITS) as (keyof typeof TICKET_COMMAND_LIMITS)[]) {
    if (form[field].length > TICKET_COMMAND_LIMITS[field]) return { field, message: `Use até ${TICKET_COMMAND_LIMITS[field]} caracteres.` };
  }
  return null;
}
export function buildTicketCommand(form: TicketCommandForm): TicketCommand {
  const nextAction = form.nextAction.trim(), reason = form.reason.trim();
  if (form.action === "reopen") return { kind: "reopen", payload: { reason, nextAction } };
  if (form.action === "wait_start") return { kind: "wait", payload: { action: "start", reason, responsibleId: form.responsibleId, nextAction, ...(form.expectedAt ? { expectedAt: new Date(form.expectedAt).toISOString() } : {}) } };
  if (form.action === "wait_end") return { kind: "wait", payload: { action: "end", reason, nextAction } };
  return { kind: "transition", payload: { status: form.status, ...(form.status === "closed" ? { closure: { outcomeCode: form.outcomeCode, summary: form.summary.trim(), evidence: form.evidence.trim(), communication: form.communication.trim(), pendingChangeAcknowledged: form.pendingChangeAcknowledged } } : { nextAction, ...(reason ? { reason } : {}), ...(form.status === "in_review" ? { evidence: form.evidence.trim() } : {}) }) } };
}
/** A refreshed envelope must not silently grant a newer write token to a dirty draft. */
export function ticketDraftSnapshot(current: Ticket | null, incoming: Ticket, dirty: boolean): Ticket {
  return current && String(current.organizationId) === String(incoming.organizationId) && String(current.id) === String(incoming.id) && dirty ? current : incoming;
}
export function ticketWriteNeedsReview(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 412 || status === 428;
}
export type TicketCreationIntent = { key: string; payload: CreateTicketPayload };
export function ticketCreationIntent(current: TicketCreationIntent | null, payload: CreateTicketPayload, generateKey: () => string): TicketCreationIntent {
  // An outstanding intention always wins, even if an input changed after a lost response.
  return current || { key: generateKey(), payload: JSON.parse(JSON.stringify(payload)) as CreateTicketPayload };
}
export function ticketCreationDefinitelyRejected(error: unknown, previouslyUncertain = false): boolean {
  if (previouslyUncertain) return false;
  const status = Number((error as { status?: unknown } | null)?.status);
  // Conflict/in-progress, timeouts, malformed responses and server/network failures remain uncertain.
  return [400, 401, 403, 404, 413, 422, 428, 429].includes(status);
}
