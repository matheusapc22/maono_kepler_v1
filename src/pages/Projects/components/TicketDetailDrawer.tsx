import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";

import TicketAttachmentList from "./TicketAttachmentList";
import TicketErrorNotice from "./TicketErrorNotice";
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
  onUpdate: (payload: UpdateTicketPayload) => Promise<void>;
};

const EVENT_LABELS: Record<string, string> = {
  "ticket.created": "Chamado criado",
  "ticket.status.changed": "Situação alterada",
  "ticket.assigned": "Atendente alterado",
  "ticket.due.changed": "Prazo alterado",
  "ticket.priority.changed": "Prioridade alterada",
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
}: TicketDetailDrawerProps) {
  const [status, setStatus] = useState<TicketStatus>("open");
  const [priority, setPriority] = useState("normal");
  const [category, setCategory] = useState("support");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [saveError, setSaveError] = useState<TicketApiError | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!detail?.ticket) return;
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
  }, [detail?.ticket]);

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
    if (!ticket) return;
    setSaveError(null);
    try {
      await onUpdate({
        status,
        priority: priority as typeof ticket.priority,
        category: category as typeof ticket.category,
        dueAt: dateInputToIso(dueDate),
        assignedTo: assignedTo || null,
      });
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

        {loading ? (
          <div className="ticket-detail-loading" aria-busy="true">
            <span />
            <span />
            <span />
            <span />
            <p className="mm-sr-only" role="status">
              Carregando detalhes do chamado.
            </p>
          </div>
        ) : error ? (
          <div className="ticket-detail-error" role="alert">
            <TicketErrorNotice error={error} onRetry={onRetry} />
          </div>
        ) : ticket && detail ? (
          <div className="ticket-detail-content">
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
                  <dt>Categoria</dt>
                  <dd>{CATEGORY_LABELS[ticket.category]}</dd>
                </div>
              </dl>
            </section>

            {canManage ? (
              <section className="ticket-detail-management">
                <h4>Gerenciar chamado</h4>
                <div>
                  <label>
                    <span>Situação</span>
                    <select
                      value={status}
                      onChange={(event) =>
                        setStatus(event.target.value as TicketStatus)
                      }
                    >
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Prioridade</span>
                    <select
                      value={priority}
                      onChange={(event) => setPriority(event.target.value)}
                    >
                      {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Categoria</span>
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
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
                      onChange={(event) => setDueDate(event.target.value)}
                    />
                  </label>

                  <label>
                    <span>Atendente</span>
                    <select
                      value={assignedTo}
                      onChange={(event) => setAssignedTo(event.target.value)}
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

                {saveError ? (
                  <TicketErrorNotice error={saveError} compact />
                ) : null}

                <button
                  type="button"
                  className="ticket-primary-action"
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? "Salvando..." : "Salvar alterações"}
                </button>
              </section>
            ) : null}

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
