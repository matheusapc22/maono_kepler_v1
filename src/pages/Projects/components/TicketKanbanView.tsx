import {
  formatTicketDate,
  isTicketOverdue,
  ticketPersonName,
} from "./ticket-format";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Ticket,
  type TicketStatus,
} from "./ticket-types";

type TicketKanbanViewProps = {
  tickets: Ticket[];
  canManage: boolean;
  busyTicketIds: ReadonlySet<string>;
  onOpen: (ticket: Ticket) => void;
  onStatusChange: (ticket: Ticket, status: TicketStatus) => void;
};

const COLUMNS: Array<{
  id: string;
  label: string;
  statuses: TicketStatus[];
  target: TicketStatus;
}> = [
  {
    id: "open",
    label: "Novo / Aberto",
    statuses: ["new", "open"],
    target: "open",
  },
  {
    id: "in_progress",
    label: "Em andamento",
    statuses: ["in_progress"],
    target: "in_progress",
  },
  {
    id: "in_review",
    label: "Em revisão",
    statuses: ["in_review"],
    target: "in_review",
  },
  {
    id: "closed",
    label: "Concluído",
    statuses: ["closed"],
    target: "closed",
  },
];

export default function TicketKanbanView({
  tickets,
  canManage,
  busyTicketIds,
  onOpen,
  onStatusChange,
}: TicketKanbanViewProps) {
  function ticketFromDrag(event: React.DragEvent) {
    const id = event.dataTransfer.getData("text/ticket-id");
    return tickets.find((ticket) => String(ticket.id) === id);
  }

  return (
    <section className="ticket-kanban" aria-label="Kanban de chamados">
      {COLUMNS.map((column) => {
        const columnTickets = tickets.filter((ticket) =>
          column.statuses.includes(ticket.status),
        );

        return (
          <section
            key={column.id}
            className={`ticket-kanban-column column-${column.id}`}
            aria-labelledby={`ticket-column-${column.id}`}
            onDragOver={(event) => {
              if (!canManage) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              if (!canManage) return;
              event.preventDefault();
              const ticket = ticketFromDrag(event);
              if (ticket && !column.statuses.includes(ticket.status)) {
                onStatusChange(ticket, column.target);
              }
            }}
          >
            <header>
              <h3 id={`ticket-column-${column.id}`}>{column.label}</h3>
              <span aria-label={`${columnTickets.length} chamados`}>
                {columnTickets.length}
              </span>
            </header>

            <div className="ticket-kanban-stack">
              {columnTickets.length === 0 ? (
                <p className="ticket-kanban-empty">Nenhum chamado</p>
              ) : (
                columnTickets.map((ticket) => {
                  const overdue = isTicketOverdue(ticket);
                  const busy = busyTicketIds.has(String(ticket.id));

                  return (
                    <article
                      key={ticket.id}
                      className={`ticket-kanban-card priority-${ticket.priority}${overdue ? " is-overdue" : ""}`}
                      draggable={canManage && !busy}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          "text/ticket-id",
                          String(ticket.id),
                        );
                        event.dataTransfer.effectAllowed = "move";
                      }}
                    >
                      <div className="ticket-kanban-card-topline">
                        <strong>{ticket.code}</strong>
                        <span
                          className={`ticket-priority priority-${ticket.priority}`}
                        >
                          {PRIORITY_LABELS[ticket.priority]}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="ticket-kanban-subject"
                        onClick={() => onOpen(ticket)}
                      >
                        {ticket.subject}
                      </button>

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
                          <dt>Prazo</dt>
                          <dd>
                            {formatTicketDate(ticket.dueAt)}
                            {overdue ? (
                              <span className="ticket-overdue-inline">
                                {" "}· Vencido
                              </span>
                            ) : null}
                          </dd>
                        </div>
                      </dl>

                      <footer>
                        <span>
                          {ticket.attachmentsCount > 0
                            ? `▣ ${ticket.attachmentsCount} anexo(s)`
                            : "Sem anexos"}
                        </span>

                        {canManage ? (
                          <label>
                            <span className="mm-sr-only">
                              Mover {ticket.code} para
                            </span>
                            <select
                              value={ticket.status}
                              disabled={busy}
                              onChange={(event) =>
                                onStatusChange(
                                  ticket,
                                  event.target.value as TicketStatus,
                                )
                              }
                            >
                              {Object.entries(STATUS_LABELS).map(
                                ([status, label]) => (
                                  <option key={status} value={status}>
                                    Mover para {label}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                        ) : (
                          <button
                            type="button"
                            className="ticket-table-action"
                            onClick={() => onOpen(ticket)}
                          >
                            Abrir
                          </button>
                        )}
                      </footer>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </section>
  );
}

