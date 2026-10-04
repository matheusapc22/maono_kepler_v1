import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TableSkeleton } from "../../../components/loading/Skeleton";
import DocumentsPagination from "./DocumentsPagination";
import { DocumentActionMenu, DocumentIcon } from "./DocumentsUi";
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
} from "./ticket-types";

type TicketListViewProps = {
  tickets: Ticket[];
  pagination: TicketPagination;
  busyTicketIds: ReadonlySet<string>;
  onOpen: (ticket: Ticket) => void;
  onPageChange: (page: number) => void;
  selectionScope: string; pageSize: number; loading: boolean; initialLoading: boolean; error: boolean;
  canCreate: boolean; onNewTicket: () => void;
  onPageSizeChange: (size: number) => void; onRefresh: () => void;
  canExport: boolean; exportAvailable: boolean; onExport: () => void;
};

const TICKET_LIST_HEADERS = [
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
  busyTicketIds,
  onOpen,
  onPageChange,
  selectionScope, pageSize, loading, initialLoading, error, canCreate, onNewTicket,
  onPageSizeChange, onRefresh, canExport, exportAvailable, onExport,
}: TicketListViewProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const regionRef = useRef<HTMLElement>(null);
  const pendingFocusRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { setSelected(new Set()); }, [selectionScope]);
  useEffect(() => {
    if (loading) return;
    const target = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (target?.isConnected && (document.activeElement === document.body || document.activeElement === target)) {
      const available = target instanceof HTMLButtonElement && target.disabled
        ? regionRef.current?.querySelector<HTMLElement>(".mm-docs-page-controls button:not(:disabled)") || regionRef.current?.querySelector<HTMLElement>(".mm-docs-page-controls select:not(:disabled)")
        : target;
      available?.focus({ preventScroll: true });
    }
  }, [loading]);
  function navigate(action: () => void) {
    const active = document.activeElement;
    pendingFocusRef.current = active instanceof HTMLElement && regionRef.current?.contains(active) ? active : null;
    action();
  }
  const selectAllRef = useRef<HTMLInputElement>(null);
  const visibleIds = tickets.map(ticket => String(ticket.id));
  const selectedCount = visibleIds.filter(id => selected.has(id)).length;
  const allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
  }, [selectedCount, allSelected]);
  // Never retain a selection for an item no longer present in an authorized response.
  useEffect(() => {
    const allowed = new Set(tickets.map(ticket => String(ticket.id)));
    setSelected(current => new Set([...current].filter(id => allowed.has(id))));
  }, [tickets]);
  return (
    <section ref={regionRef} className="ticket-list-region" aria-label="Lista de chamados">
      <header className="ticket-list-header">
        <h3><DocumentIcon name="list" />Lista de chamados</h3>
        <div>
          {canExport ? <button type="button" className="ticket-list-tool" onClick={onExport} disabled={!exportAvailable} title={exportAvailable ? "Abrir relatórios e exportações" : "Exportações indisponíveis para esta organização"}>
            <DocumentIcon name="upload" /> Exportar
          </button> : null}
          <DocumentActionMenu label="Mais opções dos chamados" disabled={initialLoading} actions={[{ label: "Atualizar consulta", onSelect: onRefresh, disabled: loading }]} />
        </div>
      </header>
      <span className="mm-sr-only" role="status">{selectedCount} chamado(s) selecionado(s) nesta página.</span>
      {initialLoading ? <TableSkeleton headers={TICKET_LIST_HEADERS} rows={7} /> : tickets.length === 0 && !error ? (
        <div className="ticket-empty-state">
          <DocumentIcon name="list" /><h3>{pagination.total > 0 ? "Nenhum chamado acessível nesta página" : "Nenhum chamado encontrado"}</h3>
          <p>{pagination.total > 0 ? "Continue pelas páginas ou atualize a consulta para reorganizar os resultados disponíveis." : "Ajuste os filtros ou registre a primeira solicitação desta organização."}</p>
          {canCreate && pagination.total === 0 ? <button type="button" className="ticket-primary-action" onClick={onNewTicket}>Novo chamado</button> : null}
        </div>
      ) : <div className="ticket-list-scroll" role="region" aria-label="Tabela de chamados" tabIndex={0}>
        <table className="ticket-list-table">
          <thead>
            <tr>
              {TICKET_LIST_HEADERS.map((header, index) => (
                <th key={header} scope="col">
                  {index === 0 ? (
                    <label className="ticket-select-control"><input ref={selectAllRef} type="checkbox" aria-label="Selecionar todos os chamados desta página" checked={allSelected} disabled={loading || tickets.length === 0} onChange={event => setSelected(event.target.checked ? new Set(visibleIds) : new Set())} /></label>
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
                  <td><label className="ticket-select-control"><input type="checkbox" aria-label={`Selecionar ${ticket.code}`} checked={selected.has(String(ticket.id))} disabled={loading} onChange={event => { const checked = event.target.checked; setSelected(current => { const next = new Set(current); if (checked) next.add(String(ticket.id)); else next.delete(String(ticket.id)); return next; }); }} /></label></td>
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
                      {busy ? (
                        <span className="mm-sr-only">Atualizando chamado</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}

      <DocumentsPagination status={loading ? "Atualizando chamados." : `Exibindo ${tickets.length}/${pagination.total}.`} page={pagination.page} pageSize={pageSize} canGoPrevious={pagination.page > 1} canGoNext={pagination.hasMore} disabled={loading} disablePageSize={loading} onPageSize={size => navigate(() => onPageSizeChange(size))} onPrevious={() => navigate(() => onPageChange(pagination.page - 1))} onNext={() => navigate(() => onPageChange(pagination.page + 1))} />

      <span className="mm-sr-only">
        Prioridades disponíveis: {Object.values(PRIORITY_LABELS).join(", ")}.
      </span>
    </section>
  );
}
