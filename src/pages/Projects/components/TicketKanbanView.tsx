import { LoadingStatus, Skeleton } from "../../../components/loading/Skeleton";
import { useSkeletonCount } from "../../../components/loading/useSkeletonCount";
import { TicketCardSkeleton } from "./TicketLoadingSkeletons";
import { MaonoSelect } from "../../../components/selection/MaonoSelect";
import { ticketQueueAge } from "./ticket-navigation";
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
  type TicketPagination,
} from "./ticket-types";

type TicketKanbanViewProps = {
  tickets: Ticket[];
  columnPages?: Record<string, { tickets: Ticket[]; total: number; hasMore: boolean; loading: boolean; loadingMore?: boolean; pagination?: TicketPagination; error?: unknown }>;
  totals: Record<TicketStatus, number>;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: (column: string) => void;
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
  tickets, columnPages, totals, hasMore, loading, onLoadMore,
  canManage,
  busyTicketIds,
  onOpen,
  onStatusChange,
}: TicketKanbanViewProps) {
  const skeletonCount = useSkeletonCount({ layout: "list", itemHeight: 280, reservedHeight: 400, pageSize: 25, maxCount: 3 });
  function ticketFromDrag(event: React.DragEvent) {
    const id = event.dataTransfer.getData("text/ticket-id");
    return tickets.find((ticket) => String(ticket.id) === id);
  }

  return (
    <section className="ticket-kanban" aria-label="Kanban de chamados">
      {COLUMNS.map((column) => {
        const columnTickets = columnPages?.[column.id]?.tickets || tickets.filter((ticket) =>
          column.statuses.includes(ticket.status),
        );

        const page = columnPages?.[column.id];
        const initialLoading = Boolean(page?.loading && !page.pagination && columnTickets.length === 0);
        const totalKnown = !page || Boolean(page.pagination);
        const total = columnPages?.[column.id]?.total ?? column.statuses.reduce((sum, status) => sum + (totals[status] || 0), 0);
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
              if (ticket && !busyTicketIds.has(String(ticket.id)) && !column.statuses.includes(ticket.status)) {
                onStatusChange(ticket, column.target);
              }
            }}
          >
            <header>
              <h3 id={`ticket-column-${column.id}`}>{column.label}</h3>
              <span aria-label={totalKnown ? `${columnTickets.length} carregados de ${total} acessíveis` : undefined}>
                {totalKnown ? `${columnTickets.length} / ${total}` : initialLoading ? <Skeleton width={42} height={14} /> : "—"}
              </span>
            </header>

            {(columnPages?.[column.id]?.hasMore ?? hasMore) ? <button type="button" disabled={loading || (columnPages?.[column.id]?.loading ?? false)} onClick={() => onLoadMore(column.id)}>Carregar mais nesta fila</button> : null}
            <LoadingStatus loading={Boolean(page?.loading)} refreshing={!initialLoading} label={`Carregando fila ${column.label}.`} refreshingLabel={page?.loadingMore ? `Carregando mais chamados em ${column.label}.` : `Atualizando fila ${column.label}.`} />
            <div className="ticket-kanban-stack" aria-busy={Boolean(page?.loading)}>
              {initialLoading ? <TicketCardSkeleton count={skeletonCount} /> : columnTickets.length === 0 && !page?.error && totalKnown ? (
                <p className="ticket-kanban-empty">{total > 0 ? "Chamados ainda não carregados" : "Nenhum chamado acessível"}</p>
              ) : (
                columnTickets.map((ticket) => {
                  const overdue = isTicketOverdue(ticket);
                  const busy = busyTicketIds.has(String(ticket.id));

                  return (
                    <article
                      key={ticket.id}
                      className={`ticket-kanban-card priority-${ticket.priority}${overdue ? " is-overdue" : ""}`}
                      aria-busy={busy}
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

                      {!column.statuses.includes(ticket.status) ? <p role="status">Situação atual: {STATUS_LABELS[ticket.status]}. Atualize a consulta para reposicionar.</p> : null}
                      <dl>
                        <div><dt>Próxima ação</dt><dd>{ticket.nextAction || 'Não informada'}</dd></div>
                        <div><dt>Idade na fila</dt><dd>{ticketQueueAge(ticket.queueEnteredAt)}</dd></div>
                        {ticket.wait ? <div><dt>Espera</dt><dd>{ticket.wait.reason}</dd></div> : null}
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
                            <MaonoSelect
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
                            </MaonoSelect>
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
              {page?.loading && page.loadingMore ? <TicketCardSkeleton count={Math.min(skeletonCount, Math.max(0, total - columnTickets.length))} /> : null}
            </div>
          </section>
        );
      })}
    </section>
  );
}

