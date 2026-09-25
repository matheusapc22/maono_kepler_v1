import { useEffect, useRef, useState } from "react";
import TicketErrorNotice from "./TicketErrorNotice";
import { toTicketApiError, type TicketApiError } from "./tickets-api";
import { formatTicketDateTime, ticketPersonName } from "./ticket-format";
import {
  buildTicketCommand, createTicketCommandForm, ticketDraftSnapshot,
  ticketTransitionTargets, ticketWriteNeedsReview, validateTicketCommandForm,
  TICKET_CLOSURE_LABELS, TICKET_COMMAND_LIMITS,
  type TicketCommandForm, type TicketCommandValidationIssue,
} from "./ticket-command-form";
import { STATUS_LABELS, type Ticket, type TicketCommand, type TicketDetailResponse } from "./ticket-types";
import "./ticket-lifecycle.css";

type Props = {
  detail: TicketDetailResponse;
  canManage: boolean;
  saving: boolean;
  refreshing?: boolean;
  attributeDraftDirty: boolean;
  suggestedStatus?: Ticket["status"] | null;
  onDirtyChange: (dirty: boolean) => void;
  onReload: () => void;
  onCommand: (command: TicketCommand, etag: string) => Promise<void>;
};

export default function TicketLifecyclePanel({ detail, canManage, saving, refreshing = false, attributeDraftDirty, suggestedStatus, onDirtyChange, onReload, onCommand }: Props) {
  const ticket = detail.ticket;
  const [snapshot, setSnapshot] = useState(ticket);
  const [form, setForm] = useState(() => createTicketCommandForm(ticket));
  const [validationIssue, setValidationIssue] = useState<TicketCommandValidationIssue | null>(null);
  const [requestError, setRequestError] = useState<TicketApiError | null>(null);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState("");
  const dirtyRef = useRef(false);
  const submittingRef = useRef(false);
  const pendingSuggestion = useRef(suggestedStatus);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (dirtyRef.current) return;
    setSnapshot(ticketDraftSnapshot(null, ticket, false));
    const next = createTicketCommandForm(ticket);
    if (pendingSuggestion.current && ticketTransitionTargets(ticket.status).includes(pendingSuggestion.current)) {
      next.status = pendingSuggestion.current;
      pendingSuggestion.current = null;
    }
    setForm(next);
  }, [ticket, dirty]);

  function edit<Key extends keyof TicketCommandForm>(key: Key, value: TicketCommandForm[Key]) {
    dirtyRef.current = true; setDirty(true); onDirtyChange(true);
    setForm((current) => ({ ...current, [key]: value }));
    setValidationIssue(null); setFeedback("");
  }
  function discard() {
    dirtyRef.current = false; setDirty(false); onDirtyChange(false);
    setSnapshot(ticket); setForm(createTicketCommandForm(ticket));
    setValidationIssue(null); setRequestError(null); setFeedback("Rascunho descartado; versão atual carregada.");
  }
  async function submit() {
    if (saving || refreshing || attributeDraftDirty || submittingRef.current || !canManage) return;
    setValidationIssue(null); setFeedback("");
    if (!snapshot.etag) { setValidationIssue({ field: "action", message: "Atualize o chamado antes de executar esta ação." }); onReload(); return; }
    const issue = validateTicketCommandForm(form, snapshot, detail.hasPendingChange === true);
    if (issue) { setValidationIssue(issue); document.getElementById(`ticket-command-${issue.field}`)?.focus(); return; }
    dirtyRef.current = true; setDirty(true); onDirtyChange(true); submittingRef.current = true;
    setRequestError(null);
    try {
      await onCommand(buildTicketCommand(form), snapshot.etag);
      dirtyRef.current = false; setDirty(false); onDirtyChange(false);
      setFeedback("Ação registrada no chamado. Nenhuma alteração vinculada foi aprovada ou aplicada.");
      headingRef.current?.focus();
    } catch (error) {
      setRequestError(toTicketApiError(error));
    } finally { submittingRef.current = false; }
  }
  const close = form.action === "transition" && form.status === "closed";
  const review = form.action === "transition" && form.status === "in_review";
  const returning = form.action === "transition" && (snapshot.status === "in_review" || snapshot.status === "in_progress" && form.status === "open");
  const conflict = ticketWriteNeedsReview(requestError);
  const hasCurrentSnapshot = Boolean(ticket.etag && ticket !== snapshot);
  const disabled = saving || refreshing || attributeDraftDirty;
  function textField(field: "nextAction" | "reason" | "evidence" | "summary" | "communication", label: string, hint?: string) {
    return <label className="ticket-command-field" htmlFor={`ticket-command-${field}`}>
      <span>{label}</span>
      <textarea id={`ticket-command-${field}`} value={form[field]} rows={3} maxLength={TICKET_COMMAND_LIMITS[field]} disabled={disabled}
        aria-invalid={validationIssue?.field === field || undefined} aria-describedby={hint ? `ticket-command-${field}-hint` : undefined}
        onChange={(event) => edit(field, event.target.value)} />
      {hint ? <small id={`ticket-command-${field}-hint`}>{hint}</small> : null}
    </label>;
  }

  return <section className="ticket-lifecycle" aria-labelledby="ticket-lifecycle-title">
    <h4 id="ticket-lifecycle-title" ref={headingRef} tabIndex={-1}>Acompanhamento do atendimento</h4>
    <dl className="ticket-lifecycle-summary">
      <div><dt>Ciclo</dt><dd>{ticket.cycle?.number ?? "A confirmar"}{ticket.cycle?.origin === "observed_baseline" ? " · início observado" : ""}</dd></div>
      <div><dt>Responsável</dt><dd>{ticketPersonName(ticket.assignedTo)}</dd></div>
      <div><dt>Próxima ação</dt><dd>{ticket.nextAction || "Ainda não informada"}</dd></div>
    </dl>
    {ticket.wait ? <div className="ticket-lifecycle-wait" role="status"><strong>Espera em andamento</strong><p>{ticket.wait.reason}</p>
      <p>Quem acompanha: {ticketPersonName(detail.assignees.find((person) => String(person.id) === String(ticket.wait?.responsibleId)) || { id: ticket.wait.responsibleId })}</p>
      <p>Próxima ação: {ticket.wait.nextAction}</p><small>Desde {formatTicketDateTime(ticket.wait.startedAt)}{ticket.wait.expectedAt ? ` · Verificação prevista: ${formatTicketDateTime(ticket.wait.expectedAt)}` : ""}. A espera não cria outro estado nem pausa um SLA automaticamente.</small></div> : null}
    {ticket.closure ? <div className="ticket-lifecycle-closure"><strong>{TICKET_CLOSURE_LABELS[ticket.closure.outcomeCode]}</strong><p>{ticket.closure.summary}</p><dl><dt>Evidência / resultado</dt><dd>{ticket.closure.evidence}</dd><dt>Comunicação registrada</dt><dd>{ticket.closure.communication}</dd></dl><small>{formatTicketDateTime(ticket.closure.closedAt)} · Este registro não comprova envio de e-mail.</small></div> : null}
    {(detail.closureHistory?.length || 0) > 0 ? <details><summary>Conclusões dos ciclos anteriores</summary>{detail.closureHistory!.map((closure, index) => <div className="ticket-lifecycle-closure" key={`${closure.cycleNumber}:${closure.closedAt}:${index}`}><strong>Ciclo {closure.cycleNumber ?? index + 1} · {TICKET_CLOSURE_LABELS[closure.outcomeCode]}</strong><p>{closure.summary}</p><p>Evidência: {closure.evidence}</p><p>Comunicação registrada: {closure.communication}</p><small>{formatTicketDateTime(closure.closedAt)}</small></div>)}</details> : null}
    {canManage ? <div className="ticket-command-form">
      {attributeDraftDirty ? <p className="ticket-lifecycle-help" role="status">Salve ou descarte as alterações de classificação, responsável e prazo antes de executar uma ação de atendimento.</p> : null}
      <label className="ticket-command-field" htmlFor="ticket-command-action"><span>Ação de atendimento</span><select id="ticket-command-action" value={form.action} disabled={disabled}
        onChange={(event) => edit("action", event.target.value as TicketCommandForm["action"])}>
        {snapshot.status === "closed" ? <option value="reopen">Reabrir em novo ciclo</option> : <><option value="transition">Mudar situação / concluir</option>{snapshot.wait ? <option value="wait_end">Encerrar espera</option> : <option value="wait_start">Registrar espera</option>}</>}
      </select></label>
      {form.action === "transition" ? <label className="ticket-command-field" htmlFor="ticket-command-status"><span>Próxima situação</span><select id="ticket-command-status" value={form.status} disabled={disabled} onChange={(event) => edit("status", event.target.value as Ticket["status"])}>{ticketTransitionTargets(snapshot.status).map((status) => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}</select></label> : null}
      {!close ? textField("nextAction", "Próxima ação *", "Descreva o que acontecerá em seguida. Não prometa um prazo sem fundamento.") : null}
      {form.action === "reopen" || form.action === "wait_start" || form.action === "wait_end" || returning ? textField("reason", `Motivo${form.action === "wait_end" ? " (opcional)" : " *"}`, form.action === "reopen" ? "Reabra pelo mesmo problema. O histórico e a conclusão anterior serão preservados." : undefined) : null}
      {form.action === "wait_start" ? <><label className="ticket-command-field" htmlFor="ticket-command-responsibleId"><span>Quem acompanha a espera *</span><select id="ticket-command-responsibleId" value={form.responsibleId} disabled={disabled} onChange={(event) => edit("responsibleId", event.target.value)}><option value="">Selecione</option>{detail.assignees.map((person) => <option key={person.id} value={String(person.id)}>{ticketPersonName(person)}</option>)}</select></label><label className="ticket-command-field" htmlFor="ticket-command-expectedAt"><span>Próxima verificação (opcional)</span><input id="ticket-command-expectedAt" type="datetime-local" value={form.expectedAt} disabled={disabled} onChange={(event) => edit("expectedAt", event.target.value)} /><small>Horário local do navegador. Não representa um compromisso de SLA.</small></label></> : null}
      {review ? textField("evidence", "Resultado / evidência para verificação *", "Informe o resultado a ser verificado. O responsável atual acompanha a revisão.") : null}
      {close ? <><label className="ticket-command-field" htmlFor="ticket-command-outcomeCode"><span>Resultado da conclusão *</span><select id="ticket-command-outcomeCode" value={form.outcomeCode} disabled={disabled} onChange={(event) => edit("outcomeCode", event.target.value as TicketCommandForm["outcomeCode"])}>{Object.entries(TICKET_CLOSURE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {textField("summary", "Motivo e resultado da conclusão *")}{textField("evidence", "Evidência / resultado verificável *", "Para recusa, duplicidade ou desistência, registre a justificativa verificável; não invente uma execução.")}{textField("communication", "Comunicação registrada ao solicitante *", "Descreva a comunicação realizada ou registrada no chamado. Esta ação não envia e-mail.")}
        {detail.hasPendingChange === true ? <div className="ticket-lifecycle-wait"><p>Há trabalho de mudança pendente. Concluir o atendimento não cancela, aprova ou aplica essa mudança.</p><label className="ticket-command-check"><input id="ticket-command-pendingChangeAcknowledged" type="checkbox" checked={form.pendingChangeAcknowledged} disabled={disabled} onChange={(event) => edit("pendingChangeAcknowledged", event.target.checked)} /><span>Estou ciente e quero registrar a conclusão do atendimento mantendo a mudança independente.</span></label></div> : null}
        {ticket.wait ? <p className="ticket-lifecycle-help">A conclusão encerrará a espera ativa com motivo de fechamento, preservando o intervalo no histórico.</p> : null}
      </> : null}
      {validationIssue ? <p className="ticket-command-validation" role="alert">{validationIssue.message}</p> : null}
      {requestError ? <TicketErrorNotice error={requestError} compact /> : null}
      {conflict ? <div className="ticket-command-conflict" role="status"><strong>Seu rascunho foi preservado.</strong><p>Confira a versão atual antes de decidir como reaplicar a ação. Nenhuma repetição automática será feita.</p><button type="button" className="ticket-secondary-action" disabled={saving || refreshing} onClick={onReload}>Consultar versão atual</button>
        {hasCurrentSnapshot ? <><dl><dt>Situação atual</dt><dd>{STATUS_LABELS[ticket.status]}</dd><dt>Responsável atual</dt><dd>{ticketPersonName(ticket.assignedTo)}</dd><dt>Próxima ação atual</dt><dd>{ticket.nextAction || "Não informada"}</dd></dl><button type="button" className="ticket-secondary-action" disabled={saving || refreshing} onClick={() => { setSnapshot(ticket); setRequestError(null); setValidationIssue(null); setFeedback("Versão atual adotada explicitamente. Confira os campos e confirme a ação novamente."); }}>Usar versão atual e manter rascunho</button></> : null}</div> : null}
      <div className="ticket-command-actions"><button type="button" className="ticket-primary-action" disabled={disabled || conflict} onClick={() => void submit()}>{saving ? "Registrando..." : close ? "Registrar conclusão" : form.action === "reopen" ? "Reabrir chamado" : form.action === "wait_start" ? "Registrar espera" : form.action === "wait_end" ? "Encerrar espera" : "Confirmar mudança de situação"}</button>{dirty ? <button type="button" className="ticket-secondary-action" disabled={saving} onClick={discard}>Descartar rascunho da ação</button> : null}</div>
    </div> : null}
    <p role="status" className="ticket-lifecycle-feedback">{feedback}</p>
  </section>;
}
