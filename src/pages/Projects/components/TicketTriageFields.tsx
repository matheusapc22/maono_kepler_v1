import { useEffect, useRef, useState } from "react";
import type { Ticket, TicketDemandNature, TicketPerson } from "./ticket-types";
import { formatTicketDateTime, ticketPersonName } from "./ticket-format";
import {
  changeTicketDemandNature,
  DEMAND_NATURE_LABELS,
  getTicketTriageQuestions,
  IMPACT_LABELS,
  TICKET_TRIAGE_LIMITS,
  URGENCY_LABELS,
  type TicketTriageFieldError,
  type TicketTriageForm,
} from "./ticket-triage-form";
import "./ticket-triage.css";

type Props = {
  value: TicketTriageForm;
  onChange: (value: TicketTriageForm) => void;
  idPrefix: string;
  reasonRequired: boolean;
  disabled?: boolean;
  error?: TicketTriageFieldError | null;
};

export default function TicketTriageFields({
  value, onChange, idPrefix, reasonRequired, disabled = false, error,
}: Props) {
  const [pendingNature, setPendingNature] = useState<TicketDemandNature | "" | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const natureRef = useRef<HTMLSelectElement | null>(null);
  useEffect(() => { setPendingNature(null); }, [value.demandNature, idPrefix]);

  function fieldId(key: string) { return `${idPrefix}-${key}`; }
  function describedBy(key: string) {
    return `${fieldId(key)}-help${error?.field === key ? ` ${idPrefix}-error` : ""}`;
  }
  function textField(key: "expectedResult" | "context" | "priorityReason", label: string, help: string, required: boolean) {
    return (
      <label className="ticket-triage-wide" htmlFor={fieldId(key)}>
        <span>{label}{required ? " *" : " (opcional)"}</span>
        <textarea
          id={fieldId(key)} value={value[key]} required={required} rows={3}
          maxLength={TICKET_TRIAGE_LIMITS[key]} disabled={disabled}
          aria-describedby={describedBy(key)} aria-invalid={error?.field === key || undefined}
          onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        />
        <small id={`${fieldId(key)}-help`}>{help} · {value[key].length}/{TICKET_TRIAGE_LIMITS[key]}</small>
      </label>
    );
  }

  return (
    <fieldset className="ticket-triage" disabled={disabled}>
      <legend>Informações para o atendimento</legend>
      <p className="ticket-triage-help">A natureza descreve o que você precisa; o domínio indica a área afetada.</p>
      <div className="ticket-triage-grid">
        <label className="ticket-triage-wide" htmlFor={fieldId("demandNature")}>
          <span>Natureza da demanda *</span>
          <select
            ref={natureRef} id={fieldId("demandNature")} value={value.demandNature} required
            aria-describedby={describedBy("demandNature")} aria-invalid={error?.field === "demandNature" || undefined}
            onChange={(event) => {
              const next = event.target.value as TicketDemandNature | "";
              if (next === value.demandNature) return;
              if (Object.values(value.triageAnswers).some((answer) => answer.trim())) {
                setPendingNature(next);
              } else {
                onChange(changeTicketDemandNature(value, next));
                setAnnouncement("Natureza alterada. Confira o resultado esperado e as perguntas desta demanda.");
              }
            }}
          >
            <option value="">Selecione a natureza</option>
            {Object.entries(DEMAND_NATURE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <small id={`${fieldId("demandNature")}-help`}>Escolha a natureza pelo trabalho necessário. Alterar o domínio não muda essa escolha.</small>
        </label>
        {pendingNature !== null ? (
          <div className="ticket-triage-change ticket-triage-wide" role="group" aria-label="Confirmar mudança de natureza">
            <p>Trocar para {pendingNature ? DEMAND_NATURE_LABELS[pendingNature] : "nenhuma natureza"}?</p>
            <p>As respostas específicas e a justificativa anteriores serão limpas deste formulário. O resultado esperado e o contexto serão mantidos. As alterações só serão gravadas ao salvar.</p>
            <div className="ticket-triage-actions">
              <button type="button" className="ticket-secondary-action" onClick={() => {
                onChange(changeTicketDemandNature(value, pendingNature));
                setPendingNature(null);
                setAnnouncement("Natureza alterada. Preencha as novas perguntas e explique a reclassificação.");
                natureRef.current?.focus();
              }}>Trocar e limpar respostas</button>
              <button type="button" className="ticket-secondary-action" onClick={() => {
                setPendingNature(null); natureRef.current?.focus();
              }}>Manter natureza atual</button>
            </div>
          </div>
        ) : null}
        {textField("expectedResult", "Resultado esperado", "O que você precisa conseguir fazer ao final do atendimento?", true)}
        <label htmlFor={fieldId("impact")}>
          <span>Quem foi afetado? *</span>
          <select id={fieldId("impact")} value={value.impact} required aria-describedby={describedBy("impact")}
            aria-invalid={error?.field === "impact" || undefined} onChange={(event) => onChange({ ...value, impact: event.target.value as TicketTriageForm["impact"] })}>
            <option value="">Selecione o impacto</option>
            {Object.entries(IMPACT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <small id={`${fieldId("impact")}-help`}>Considere o alcance da dificuldade.</small>
        </label>
        <label htmlFor={fieldId("urgency")}>
          <span>A atividade pode continuar? *</span>
          <select id={fieldId("urgency")} value={value.urgency} required aria-describedby={describedBy("urgency")}
            aria-invalid={error?.field === "urgency" || undefined} onChange={(event) => onChange({ ...value, urgency: event.target.value as TicketTriageForm["urgency"] })}>
            <option value="">Selecione a urgência</option>
            {Object.entries(URGENCY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <small id={`${fieldId("urgency")}-help`}>Isso ajuda a triagem e não define um prazo de atendimento.</small>
        </label>
        {getTicketTriageQuestions(value.demandNature).map((question) => (
          <label className="ticket-triage-wide" key={question.key} htmlFor={fieldId(question.key)}>
            <span>{question.label}{question.required ? " *" : " (opcional)"}</span>
            <textarea id={fieldId(question.key)} rows={3} value={value.triageAnswers[question.key] || ""}
              required={question.required} maxLength={TICKET_TRIAGE_LIMITS.answer}
              aria-describedby={describedBy(question.key)} aria-invalid={error?.field === question.key || undefined}
              onChange={(event) => onChange({ ...value, triageAnswers: { ...value.triageAnswers, [question.key]: event.target.value } })} />
            <small id={`${fieldId(question.key)}-help`}>{question.help} · {(value.triageAnswers[question.key] || "").length}/{TICKET_TRIAGE_LIMITS.answer}</small>
          </label>
        ))}
        {textField("priorityReason", "Justificativa da classificação e prioridade", "Explique a escolha. Impacto e urgência não alteram a prioridade automaticamente.", reasonRequired)}
        {textField("context", "Contexto adicional", "Inclua apenas o necessário: tela, projeto, camada, horário ou referência do erro. Não envie senhas, tokens ou dados pessoais desnecessários.", false)}
      </div>
      {error ? <p id={`${idPrefix}-error`} className="ticket-triage-error" role="alert">{error.message}</p> : null}
      <span className="ticket-triage-sr-only" role="status">{announcement}</span>
    </fieldset>
  );
}

export function TicketTriageSummary({ ticket, people }: { ticket: Ticket; people: TicketPerson[] }) {
  const author = people.find((person) => String(person.id) === String(ticket.triagedBy));
  const nature = ticket.demandNature && DEMAND_NATURE_LABELS[ticket.demandNature];
  return (
    <section className="ticket-triage-summary" aria-label="Classificação do chamado">
      <h4>Classificação do chamado</h4>
      <p className="ticket-triage-provenance">
        {ticket.needsTriage || !nature ? "Classificação pendente" : nature}
        {ticket.triageSource === "legacy" ? " · chamado anterior à classificação estruturada" : null}
      </p>
      <dl>
        <div><dt>Natureza</dt><dd>{nature || "Ainda não informada"}</dd></div>
        <div><dt>Impacto</dt><dd>{ticket.impact ? IMPACT_LABELS[ticket.impact] : "Não informado"}</dd></div>
        <div><dt>Urgência</dt><dd>{ticket.urgency ? URGENCY_LABELS[ticket.urgency] : "Não informada"}</dd></div>
        <div className="ticket-triage-wide"><dt>Resultado esperado</dt><dd>{ticket.expectedResult || "Ainda não informado"}</dd></div>
        {ticket.context ? <div className="ticket-triage-wide"><dt>Contexto adicional</dt><dd>{ticket.context}</dd></div> : null}
        {getTicketTriageQuestions(ticket.demandNature || "").map((question) => ticket.triageAnswers?.[question.key] ? (
          <div key={question.key} className="ticket-triage-wide"><dt>{question.label}</dt><dd>{ticket.triageAnswers[question.key]}</dd></div>
        ) : null)}
        {ticket.priorityReason ? <div className="ticket-triage-wide"><dt>Justificativa da classificação e prioridade</dt><dd>{ticket.priorityReason}</dd></div> : null}
        {ticket.triageSource === "human" ? <>
          <div><dt>Classificado por</dt><dd>{author ? ticketPersonName(author) : ticket.triagedBy ? `Usuário #${ticket.triagedBy}` : "Pessoa responsável"}</dd></div>
          <div><dt>Classificado em</dt><dd>{formatTicketDateTime(ticket.triagedAt)}</dd></div>
        </> : null}
      </dl>
    </section>
  );
}
