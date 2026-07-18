import type {
  TicketFilters,
  TicketPerson,
  TicketViewMode,
} from "./ticket-types";

type TicketsToolbarProps = {
  organizationId: number | string;
  filters: TicketFilters;
  assignees: TicketPerson[];
  viewMode: TicketViewMode;
  canCreate: boolean;
  onFiltersChange: (filters: TicketFilters) => void;
  onViewModeChange: (viewMode: TicketViewMode) => void;
  onNewTicket: () => void;
  newTicketButtonRef?: React.RefObject<HTMLButtonElement | null>;
};

function assigneeLabel(assignee: TicketPerson) {
  return assignee.name || assignee.email || `Usuário ${assignee.id}`;
}

export default function TicketsToolbar({
  organizationId,
  filters,
  assignees,
  viewMode,
  canCreate,
  onFiltersChange,
  onViewModeChange,
  onNewTicket,
  newTicketButtonRef,
}: TicketsToolbarProps) {
  function updateFilter<Key extends keyof TicketFilters>(
    key: Key,
    value: TicketFilters[Key],
  ) {
    onFiltersChange({ ...filters, [key]: value });
  }

  const hasFilters = Object.entries(filters).some(
    ([key, value]) => key !== "sort" && Boolean(value),
  );

  return (
    <>
      <header className="ticket-center-header">
        <div className="ticket-center-heading">
          <div className="ticket-center-heading-meta">
            <span className="ticket-center-eyebrow">Atendimento operacional</span>
            <span className="ticket-organization-chip">
              Organização #{organizationId}
            </span>
          </div>
          <h2>Central de Chamados</h2>
          <p>Consulte, priorize e acompanhe solicitações operacionais.</p>
        </div>

        <div className="ticket-center-actions">
          {canCreate ? (
            <button
              ref={newTicketButtonRef}
              type="button"
              className="ticket-primary-action"
              onClick={onNewTicket}
            >
              <span aria-hidden="true">＋</span>
              Novo chamado
            </button>
          ) : null}

          <label className="ticket-view-control">
            <span className="mm-sr-only">Visualização ativa</span>
            <span aria-hidden="true">▦</span>
            <select
              value={viewMode}
              aria-label="Visualização dos chamados"
              onChange={(event) =>
                onViewModeChange(event.target.value as TicketViewMode)
              }
            >
              <option value="list">Lista</option>
              <option value="kanban">Kanban</option>
              <option value="calendar">Calendário</option>
            </select>
          </label>
        </div>
      </header>

      <section className="ticket-filter-surface" aria-label="Filtros de chamados">
        <header className="ticket-filter-header">
          <div>
            <strong>Filtros</strong>
            <span>Encontre chamados por contexto, responsável ou período.</span>
          </div>
          <button
            type="button"
            className="ticket-filter-clear"
            disabled={!hasFilters}
            onClick={() =>
              onFiltersChange({
                q: "",
                status: "",
                priority: "",
                assigneeId: "",
                from: "",
                to: "",
                sort: filters.sort,
              })
            }
          >
            Limpar filtros
          </button>
        </header>

        <div className="ticket-filter-bar">
          <label className="ticket-filter-search">
            <span className="ticket-filter-label">Buscar</span>
            <span className="ticket-filter-input-wrap">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={filters.q}
                placeholder="Código, assunto ou descrição"
                onChange={(event) => updateFilter("q", event.target.value)}
              />
            </span>
          </label>

          <label>
            <span className="ticket-filter-label">Situação</span>
            <select
              value={filters.status}
              onChange={(event) =>
                updateFilter(
                  "status",
                  event.target.value as TicketFilters["status"],
                )
              }
            >
              <option value="">Todas as situações</option>
              <option value="new">Novo</option>
              <option value="open">Aberto</option>
              <option value="in_progress">Em andamento</option>
              <option value="in_review">Em revisão</option>
              <option value="closed">Concluído</option>
            </select>
          </label>

          <label>
            <span className="ticket-filter-label">Prioridade</span>
            <select
              value={filters.priority}
              onChange={(event) =>
                updateFilter(
                  "priority",
                  event.target.value as TicketFilters["priority"],
                )
              }
            >
              <option value="">Todas as prioridades</option>
              <option value="high">Alta</option>
              <option value="normal">Normal</option>
              <option value="low">Baixa</option>
            </select>
          </label>

          <label>
            <span className="ticket-filter-label">Atendente</span>
            <select
              value={filters.assigneeId}
              onChange={(event) =>
                updateFilter("assigneeId", event.target.value)
              }
            >
              <option value="">Todos os atendentes</option>
              <option value="unassigned">Não atribuído</option>
              {assignees.map((assignee) => (
                <option key={assignee.id} value={String(assignee.id)}>
                  {assigneeLabel(assignee)}
                </option>
              ))}
            </select>
          </label>

          <label className="ticket-date-filter">
            <span className="ticket-filter-label">De</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => updateFilter("from", event.target.value)}
            />
          </label>

          <label className="ticket-date-filter">
            <span className="ticket-filter-label">Até</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => updateFilter("to", event.target.value)}
            />
          </label>

          <label>
            <span className="ticket-filter-label">Ordenar por</span>
            <select
              value={filters.sort}
              onChange={(event) =>
                updateFilter(
                  "sort",
                  event.target.value as TicketFilters["sort"],
                )
              }
            >
              <option value="updated_desc">Atualizados recentemente</option>
              <option value="updated_asc">Atualizados há mais tempo</option>
              <option value="due_asc">Prazo mais próximo</option>
              <option value="priority_desc">Maior prioridade</option>
            </select>
          </label>
        </div>
      </section>
    </>
  );
}
