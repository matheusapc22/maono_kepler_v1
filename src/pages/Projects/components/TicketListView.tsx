import {
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
  "Selecionar",
  "Código",
  "Assunto",
  "Prioridade",
  "Situação",
  "Atendente",
  "Última atualização",
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
      <header className="ticket-list-header">
        <h3>Lista de chamados</h3>
        <div>
          <span>
            Exibindo {tickets.length} de {pagination.total}
          </span>
          <button type="button" className="ticket-list-tool">
            <span aria-hidden="true">⇧</span> Exportar
          </button>
          <button type="button" className="ticket-list-tool is-icon" aria-label="Mais opções">
            ⋮
          </button>
        </div>
      </header>
      <div className="ticket-list-scroll">
        <table className="ticket-list-table">
          <thead>
            <tr>
              {TICKET_LIST_HEADERS.map((header, index) => (
                <th key={header} scope="col">
                  {index === 0 ? (
                    <input type="checkbox" aria-label="Selecionar todos os chamados desta página" />
                  ) : header}
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
                  <td><input type="checkbox" aria-label={`Selecionar ${ticket.code}`} /></td>
                  <td>
                    <strong className="ticket-code">{ticket.code}</strong>
                    {overdue ? (
                      <span className="ticket-overdue-label">Vencido</span>
                    ) : null}
                  </td>
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
                    <span className={`ticket-priority-badge priority-${ticket.priority}`}>
                      <i aria-hidden="true" />{PRIORITY_LABELS[ticket.priority]}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`ticket-status-badge status-${ticket.status}`}
                    >
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </td>
                  <td>{ticketPersonName(ticket.assignedTo)}</td>
                  <td title={formatTicketDateTime(ticket.updatedAt)}>
                    {formatTicketDateTime(ticket.updatedAt)}
                  </td>
                  <td>
                    <div className="ticket-row-actions">
                      <button
                        type="button"
                        className="ticket-table-action"
                        onClick={() => onOpen(ticket)}
                        aria-label={`Abrir ${ticket.code}`}
                      >
                        ⋮
                      </button>
                      {canManage && busy ? (
                        <span className="mm-sr-only">Atualizando chamado</span>
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
