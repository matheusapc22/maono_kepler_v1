import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";

import TicketAttachmentList from "./TicketAttachmentList";
import TicketErrorNotice from "./TicketErrorNotice";
import TicketLifecyclePanel from "./TicketLifecyclePanel";
import { ticketDraftSnapshot, ticketWriteNeedsReview } from "./ticket-command-form";
import TicketTriageFields, { TicketTriageSummary } from "./TicketTriageFields";
import {
  buildTicketTriagePayload,
  createTicketTriageForm,
  ticketTriageReasonRequired,
  TICKET_TRIAGE_LIMITS,
  validateTicketTriageForm,
  type TicketTriageFieldError,
} from "./ticket-triage-form";
import {
  TicketApiError,
  toTicketApiError,
} from "./tickets-api";
import {
  dateInputToIso,
  dateInputValue,
  formatTicketDateTime,
  ticketPersonName,
} from "./ticket-format";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TicketDetailResponse,
  type Ticket,
  type TicketCommand,
  type TicketAttachmentLimits,
  type TicketStatus,
  type UpdateTicketPayload,
} from "./ticket-types";

type TicketDetailDrawerProps = {
  open: boolean;
  organizationId: number | string;
  detail: TicketDetailResponse | null;
  loading: boolean;
  error: TicketApiError | null;
  saving: boolean;
  canManage: boolean;
  canUpload: boolean;
  attachmentLimits: TicketAttachmentLimits;
  currentUserId?: number | string | null;
  onClose: () => void;
  onRetry: () => void;
  onReload: () => void;
  onUpdate: (payload: UpdateTicketPayload, etag?: string) => Promise<void>;
  onCommand: (command: TicketCommand, etag: string) => Promise<void>;
  suggestedStatus?: TicketStatus | null;
};

const EVENT_LABELS: Record<string, string> = {
  "ticket.created": "Chamado criado",
  "ticket.transitioned": "Etapa do atendimento alterada",
  "ticket.closed": "Conclusão registrada",
  "ticket.reopened": "Chamado reaberto em novo ciclo",
  "ticket.wait.started": "Espera iniciada",
  "ticket.wait.ended": "Espera encerrada",
  "ticket.history.corrected": "Correção registrada no histórico",
  "ticket.status.changed": "Situação alterada",
  "ticket.assigned": "Atendente alterado",
  "ticket.due.changed": "Prazo alterado",
  "ticket.priority.changed": "Prioridade alterada",
  "ticket.category.changed": "Domínio alterado",
  "ticket.triage.classified": "Classificação registrada",
  "ticket.triage.changed": "Classificação alterada",
  "ticket.attachment.added": "Anexo adicionado",
  "ticket.attachment.deleted": "Anexo excluído",
};

export default function TicketDetailDrawer({
  open,
  organizationId,
  detail,
  loading,
  error,
  saving,
  canManage,
  canUpload,
  attachmentLimits,
  currentUserId,
  onClose,
  onRetry,
  onReload,
  onUpdate,
  onCommand,
  suggestedStatus,
}: TicketDetailDrawerProps) {
  const [status, setStatus] = useState<TicketStatus>("open");
  const [priority, setPriority] = useState("normal");
  const [category, setCategory] = useState("support");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [saveError, setSaveError] = useState<TicketApiError | string | null>(null);
  const [triageForm, setTriageForm] = useState(createTicketTriageForm);
  const [triageEditing, setTriageEditing] = useState(false);
  const [triageError, setTriageError] = useState<TicketTriageFieldError | null>(null);
  const [priorityReason, setPriorityReason] = useState("");
  const [savedDraftVersion, setSavedDraftVersion] = useState(0);
  const dirtyRef = useRef(false);
  const writeSnapshotRef = useRef<Ticket | null>(null);
  const [attributeDraftDirty, setAttributeDraftDirty] = useState(false);
  const [lifecycleDraftDirty, setLifecycleDraftDirty] = useState(false);
  const lifecycleEnabled = detail?.lifecycleEnabled === true;
  function markDirty() { dirtyRef.current = true; setAttributeDraftDirty(true); }
  const formTicketKeyRef = useRef("");
  const triageEnabled = detail?.triageEnabled === true;
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => { if (!lifecycleEnabled) setLifecycleDraftDirty(false); }, [lifecycleEnabled]);

  useEffect(() => {
    if (!detail?.ticket) return;
    const key = `${detail.ticket.organizationId}:${detail.ticket.id}`;
    writeSnapshotRef.current = ticketDraftSnapshot(writeSnapshotRef.current, detail.ticket, formTicketKeyRef.current === key && dirtyRef.current);
    if (formTicketKeyRef.current === key && dirtyRef.current) return;
    formTicketKeyRef.current = key;
    dirtyRef.current = false;
    setAttributeDraftDirty(false);
    setTriageForm(createTicketTriageForm(detail.ticket));
    setTriageEditing(false);
    setTriageError(null);
    setPriorityReason("");
    setStatus(detail.ticket.status);
    setPriority(detail.ticket.priority);
    setCategory(detail.ticket.category);
    setDueDate(dateInputValue(detail.ticket.dueAt));
    setAssignedTo(
      detail.ticket.assignedTo
        ? String(detail.ticket.assignedTo.id)
        : "",
    );
    setSaveError(null);
  }, [detail?.ticket, savedDraftVersion]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    window.setTimeout(() => {
      drawerRef.current?.querySelector<HTMLElement>("button")?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const ticket = detail?.ticket;

  async function handleSave() {
    if (!ticket || saving || lifecycleDraftDirty) return;
    const original = writeSnapshotRef.current || ticket;
    if (lifecycleEnabled && !original.etag) {
      setSaveError("Atualize o chamado antes de salvar as alterações."); onReload(); return;
    }
    setSaveError(null);
    setTriageError(null);
    const classificationChanged = priority !== original.priority || category !== original.category;
    let triagePayload: Partial<UpdateTicketPayload> = {};
    if (triageEnabled && triageEditing) {
      const validation = validateTicketTriageForm(triageForm, {
        priority: priority as typeof original.priority,
        reasonRequired: ticketTriageReasonRequired(priority as typeof original.priority, original, triageForm.demandNature, category as typeof original.category),
      });
      if (validation) {
        setTriageError(validation);
        document.getElementById(`detail-ticket-triage-${validation.field}`)?.focus();
        return;
      }
      triagePayload = buildTicketTriagePayload(triageForm);
    } else if (triageEnabled && classificationChanged) {
      if (!priorityReason.trim() || priorityReason.length > TICKET_TRIAGE_LIMITS.priorityReason) {
        setSaveError("Explique a mudança de classificação ou prioridade em até 1.000 caracteres.");
        document.getElementById("ticket-priority-change-reason")?.focus();
        return;
      }
      triagePayload = { priorityReason: priorityReason.trim() };
    }
    try {
      const payload: UpdateTicketPayload = { ...triagePayload };
      if (!lifecycleEnabled && status !== original.status) payload.status = status;
      if (priority !== original.priority) payload.priority = priority as typeof original.priority;
      if (category !== original.category) payload.category = category as typeof original.category;
      if (dueDate !== dateInputValue(original.dueAt)) payload.dueAt = dateInputToIso(dueDate);
      if (assignedTo !== (original.assignedTo ? String(original.assignedTo.id) : "")) payload.assignedTo = assignedTo || null;
      if (Object.keys(payload).length === 0) {
        setSaveError("Nenhuma alteração para salvar.");
        return;
      }
      await onUpdate(payload, lifecycleEnabled ? original.etag : undefined);
      dirtyRef.current = false;
      setAttributeDraftDirty(false);
      setTriageEditing(false);
      setSavedDraftVersion((current) => current + 1);
    } catch (requestError) {
      setSaveError(
        toTicketApiError(requestError, "Não foi possível salvar as alterações."),
      );
    }
  }

  return (
    <div
      className="ticket-drawer-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="ticket-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-detail-title"
      >
        <header className="ticket-panel-header">
          <div>
            <span className="ticket-center-eyebrow">
              {ticket?.code || "Detalhes do chamado"}
            </span>
            <h3 id="ticket-detail-title">
              {ticket?.subject || "Carregando chamado..."}
            </h3>
          </div>
          <button
            type="button"
            className="ticket-icon-button"
            aria-label="Fechar detalhes"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {loading && !ticket ? (
          <div className="ticket-detail-loading" aria-busy="true">
            <span />
            <span />
            <span />
            <span />
            <p className="mm-sr-only" role="status">
              Carregando detalhes do chamado.
            </p>
          </div>
        ) : error && !ticket ? (
          <div className="ticket-detail-error" role="alert">
            <TicketErrorNotice error={error} onRetry={onRetry} />
          </div>
        ) : ticket && detail ? (
          <div className="ticket-detail-content" aria-busy={loading || saving}>
            {loading ? <p role="status">Atualizando versão do chamado. Seus rascunhos serão preservados.</p> : null}
            {error ? <TicketErrorNotice error={error} onRetry={onRetry} /> : null}
            <section className="ticket-detail-summary">
              <div>
                <span
                  className={`ticket-status-badge status-${ticket.status}`}
                >
                  {STATUS_LABELS[ticket.status]}
                </span>
                <span
                  className={`ticket-priority priority-${ticket.priority}`}
                >
                  {PRIORITY_LABELS[ticket.priority]}
                </span>
              </div>

              <p>{ticket.description}</p>
              {detail.changeRequest ? (
                <Link className="ticket-primary-action" to={detail.changeRequest.reviewUrl}>
                  Abrir Review
                </Link>
              ) : null}

              <dl>
                <div>
                  <dt>Solicitante</dt>
                  <dd>{ticketPersonName(ticket.createdBy)}</dd>
                </div>
                <div>
                  <dt>Atendente</dt>
                  <dd>{ticketPersonName(ticket.assignedTo)}</dd>
                </div>
                <div>
                  <dt>Criado em</dt>
                  <dd>{formatTicketDateTime(ticket.createdAt)}</dd>
                </div>
                <div>
                  <dt>Atualizado em</dt>
                  <dd>{formatTicketDateTime(ticket.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Prazo</dt>
                  <dd>{formatTicketDateTime(ticket.dueAt)}</dd>
                </div>
                <div>
                  <dt>{triageEnabled ? "Domínio afetado" : "Categoria"}</dt>
                  <dd>{CATEGORY_LABELS[ticket.category]}</dd>
                </div>
              </dl>
            </section>

            {triageEnabled ? <TicketTriageSummary ticket={ticket} people={detail.assignees} /> : null}

            {canManage ? (
              <section className="ticket-detail-management">
                <h4>Gerenciar chamado</h4>
                {lifecycleDraftDirty ? <p role="status">Conclua ou descarte o rascunho da ação de atendimento antes de salvar outros campos.</p> : null}
                <div>
                  {!lifecycleEnabled ? <label>
                    <span>Situação</span>
                    <select
                      value={status}
                      disabled={saving || loading || lifecycleDraftDirty}
                      onChange={(event) => {
                        markDirty();
                        setStatus(event.target.value as TicketStatus);
                      }}
                    >
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label> : null}

                  <label>
                    <span>Prioridade</span>
                    <select
                      value={priority}
                      disabled={saving || loading || lifecycleDraftDirty}
                      onChange={(event) => {
                        markDirty();
                        setPriority(event.target.value);
                        setPriorityReason("");
                        setTriageForm((current) => ({ ...current, priorityReason: "" }));
                        setSaveError(null);
                      }}
                    >
                      {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>{triageEnabled ? "Domínio afetado" : "Categoria"}</span>
                    <select
                      value={category}
                      disabled={saving || loading || lifecycleDraftDirty}
                      onChange={(event) => {
                        markDirty();
                        setCategory(event.target.value);
                        setPriorityReason("");
                        setTriageForm((current) => ({ ...current, priorityReason: "" }));
                        setSaveError(null);
                      }}
                    >
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Prazo</span>
                    <input
                      type="date"
                      value={dueDate}
                      disabled={saving || loading || lifecycleDraftDirty}
                      onChange={(event) => { markDirty(); setDueDate(event.target.value); }}
                    />
                  </label>

                  <label>
                    <span>Atendente</span>
                    <select
                      value={assignedTo}
                      disabled={saving || loading || lifecycleDraftDirty}
                      onChange={(event) => { markDirty(); setAssignedTo(event.target.value); }}
                    >
                      <option value="">Não atribuído</option>
                      {detail.assignees.map((assignee) => (
                        <option key={assignee.id} value={String(assignee.id)}>
                          {ticketPersonName(assignee)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {triageEnabled ? (
                  <>
                    <div className="ticket-triage-edit-actions">
                      <button type="button" className="ticket-secondary-action" disabled={saving || loading || lifecycleDraftDirty}
                        onClick={() => {
                          setTriageForm({ ...createTicketTriageForm(ticket), ...(priority !== ticket.priority || category !== ticket.category ? { priorityReason } : {}) });
                          setTriageError(null);
                          setTriageEditing((current) => !current);
                        }}>
                        {triageEditing ? "Cancelar edição da classificação" : ticket.needsTriage || !ticket.demandNature ? "Classificar chamado" : "Editar classificação"}
                      </button>
                    </div>
                    {triageEditing ? (
                      <TicketTriageFields
                        value={triageForm}
                        onChange={(next) => { markDirty(); setTriageForm(next); setTriageError(null); setSaveError(null); }}
                        idPrefix="detail-ticket-triage"
                        reasonRequired={ticketTriageReasonRequired(priority as typeof ticket.priority, ticket, triageForm.demandNature, category as typeof ticket.category)}
                        disabled={saving || loading || lifecycleDraftDirty}
                        validationIssue={triageError}
                      />
                    ) : priority !== ticket.priority || category !== ticket.category ? (
                      <label className="ticket-triage-reason" htmlFor="ticket-priority-change-reason">
                        <span>Motivo da mudança de classificação ou prioridade *</span>
                        <textarea id="ticket-priority-change-reason" value={priorityReason} rows={3} required
                          maxLength={TICKET_TRIAGE_LIMITS.priorityReason} disabled={saving || loading || lifecycleDraftDirty}
                          aria-describedby="ticket-priority-change-help"
                          onChange={(event) => { markDirty(); setPriorityReason(event.target.value); setSaveError(null); }} />
                        <small id="ticket-priority-change-help">Explique a nova classificação ou prioridade. A natureza e o prazo permanecem independentes. · {priorityReason.length}/1.000</small>
                      </label>
                    ) : null}
                  </>
                ) : null}

                {saveError ? (
                  <TicketErrorNotice error={saveError} compact />
                ) : null}

                {lifecycleEnabled && ticketWriteNeedsReview(saveError) ? <div className="ticket-command-conflict" role="status">
                  <strong>Seu rascunho foi preservado.</strong><p>Consulte a versão atual e revise os campos antes de salvar novamente.</p>
                  <button type="button" className="ticket-secondary-action" disabled={loading || saving} onClick={onReload}>Consultar versão atual</button>
                  {ticket.etag && ticket !== writeSnapshotRef.current ? <>
                    <p>Situação atual: {STATUS_LABELS[ticket.status]}. Responsável: {ticketPersonName(ticket.assignedTo)}. Prazo: {formatTicketDateTime(ticket.dueAt)}.</p>
                    <button type="button" className="ticket-secondary-action" disabled={loading || saving} onClick={() => { writeSnapshotRef.current = ticket; setSaveError(null); setTriageError(null); }}>Usar versão atual e manter rascunho</button>
                  </> : null}
                </div> : null}
                <button
                  type="button"
                  className="ticket-primary-action"
                  disabled={saving || loading || lifecycleDraftDirty || lifecycleEnabled && ticketWriteNeedsReview(saveError)}
                  onClick={() => void handleSave()}
                >
                  {saving ? "Salvando..." : "Salvar alterações"}
                </button>
                {lifecycleEnabled && attributeDraftDirty ? <button type="button" className="ticket-secondary-action" disabled={saving || loading || lifecycleDraftDirty} onClick={() => { dirtyRef.current = false; setAttributeDraftDirty(false); setSavedDraftVersion((version) => version + 1); }}>Descartar rascunho dos campos</button> : null}
              </section>
            ) : null}

            {lifecycleEnabled ? <TicketLifecyclePanel detail={detail} canManage={canManage} saving={saving} refreshing={loading}
              attributeDraftDirty={attributeDraftDirty} suggestedStatus={suggestedStatus} onDirtyChange={setLifecycleDraftDirty}
              onReload={onReload} onCommand={onCommand} /> : null}

            <TicketAttachmentList
              organizationId={organizationId}
              ticket={ticket}
              attachments={detail.attachments}
              canUpload={canUpload}
              canManage={canManage}
              attachmentLimits={attachmentLimits}
              currentUserId={currentUserId}
              onChanged={onReload}
            />

            <section className="ticket-history" aria-labelledby="ticket-history-title">
              <header>
                <h4 id="ticket-history-title">Histórico</h4>
                <span>{detail.events.length}</span>
              </header>

              {detail.events.length === 0 ? (
                <p>Nenhuma movimentação registrada.</p>
              ) : (
                <ol>
                  {detail.events.map((event) => (
                    <li key={event.id}>
                      <span aria-hidden="true" />
                      <div>
                        <strong>
                          {EVENT_LABELS[event.type] || event.type}
                        </strong>
                        <small>
                          {ticketPersonName(event.actor)} ·{" "}
                          {formatTicketDateTime(event.createdAt)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
