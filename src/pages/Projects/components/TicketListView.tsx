import {
  formatTicketDate,
  formatTicketDateTime,
  isTicketOverdue,
  ticketPersonName,
} from "./ticket-format";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Ticket,
  type TicketPagination,
  type TicketStatus,
} from "./ticket-types";

type TicketListViewProps = {
  tickets: Ticket[];
  pagination: TicketPagination;
  canManage: boolean;
  busyTicketIds: ReadonlySet<string>;
  onOpen: (ticket: Ticket) => void;
  onStatusChange: (ticket: Ticket, status: TicketStatus) => void;
  onPageChange: (page: number) => void;
};

export const TICKET_LIST_HEADERS = [
  "Código",
  "Solicitante",
  "Assunto",
  "Situação",
  "Última atualização",
  "Atendente",
  "Cadastrado em",
  "Ações",
];

export default function TicketListView({
  tickets,
  pagination,
  canManage,
  busyTicketIds,
  onOpen,
  onStatusChange,
  onPageChange,
}: TicketListViewProps) {
  return (
    <section className="ticket-list-region" aria-label="Lista de chamados">
      <div className="ticket-list-scroll">
        <table className="ticket-list-table">
          <thead>
            <tr>
              {TICKET_LIST_HEADERS.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => {
              const busy = busyTicketIds.has(String(ticket.id));
              const overdue = isTicketOverdue(ticket);

              return (
                <tr key={ticket.id} className={overdue ? "is-overdue" : ""}>
                  <td>
                    <strong className="ticket-code">{ticket.code}</strong>
                    {overdue ? (
                      <span className="ticket-overdue-label">Vencido</span>
                    ) : null}
                  </td>
                  <td>{ticketPersonName(ticket.createdBy)}</td>
                  <td>
                    <button
                      type="button"
                      className="ticket-subject-button"
                      onClick={() => onOpen(ticket)}
                    >
                      {ticket.subject}
                    </button>
                  </td>
                  <td>
                    <span
                      className={`ticket-status-badge status-${ticket.status}`}
                    >
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </td>
                  <td title={formatTicketDateTime(ticket.updatedAt)}>
                    {formatTicketDate(ticket.updatedAt)}
                  </td>
                  <td>{ticketPersonName(ticket.assignedTo)}</td>
                  <td title={formatTicketDateTime(ticket.createdAt)}>
                    {formatTicketDate(ticket.createdAt)}
                  </td>
                  <td>
                    <div className="ticket-row-actions">
                      <button
                        type="button"
                        className="ticket-table-action"
                        onClick={() => onOpen(ticket)}
                      >
                        Abrir
                      </button>
                      {canManage ? (
                        <label>
                          <span className="mm-sr-only">
                            Alterar situação de {ticket.code}
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
                            <option value="new">Novo</option>
                            <option value="open">Aberto</option>
                            <option value="in_progress">Em andamento</option>
                            <option value="in_review">Em revisão</option>
                            <option value="closed">Concluído</option>
                          </select>
                        </label>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="ticket-pagination">
        <span>
          Página {pagination.page} de {pagination.totalPages} ·{" "}
          {pagination.total} chamado(s)
        </span>
        <div>
          <button
            type="button"
            disabled={pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={!pagination.hasMore}
            onClick={() => onPageChange(pagination.page + 1)}
          >
            Próxima
          </button>
        </div>
      </footer>

      <span className="mm-sr-only">
        Prioridades disponíveis: {Object.values(PRIORITY_LABELS).join(", ")}.
      </span>
    </section>
  );
}

