import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { can, type AccessControlUser } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import {
  MetricsSkeleton,
  TableSkeleton,
} from "../../../components/loading/Skeleton";
import NewTicketPopover from "./NewTicketPopover";
import TicketCalendarView from "./TicketCalendarView";
import TicketDetailDrawer from "./TicketDetailDrawer";
import TicketKanbanView from "./TicketKanbanView";
import TicketListView, {
  TICKET_LIST_HEADERS,
} from "./TicketListView";
import TicketsToolbar from "./TicketsToolbar";
import TicketErrorNotice from "./TicketErrorNotice";
import {
  getTicketDetails,
  listTickets,
  TicketApiError,
  toTicketApiError,
  updateTicket,
} from "./tickets-api";
import {
  DEFAULT_TICKET_ATTACHMENT_LIMITS,
  DEFAULT_TICKET_FILTERS,
  type Ticket,
  type TicketAttachmentLimits,
  type TicketDetailResponse,
  type TicketFacets,
  type TicketFilters,
  type TicketPagination,
  type TicketStatus,
  type TicketViewMode,
  type UpdateTicketPayload,
} from "./ticket-types";

type TicketsSectionProps = {
  user?: AccessControlUser | null;
  organizationId?: number | string | null;
  organizationName?: string | null;
};

const EMPTY_FACETS: TicketFacets = {
  byStatus: {
    new: 0,
    open: 0,
    in_progress: 0,
    in_review: 0,
    closed: 0,
  },
  overdue: 0,
};

const EMPTY_PAGINATION: TicketPagination = {
  page: 1,
  limit: 50,
  total: 0,
  totalPages: 1,
  hasMore: false,
};

function mergeTickets(current: Ticket[], incoming: Ticket[]) {
  const byId = new Map(current.map((ticket) => [String(ticket.id), ticket]));
  for (const ticket of incoming) byId.set(String(ticket.id), ticket);
  return Array.from(byId.values());
}

function replaceTicket(current: Ticket[], updated: Ticket) {
  const exists = current.some(
    (ticket) => String(ticket.id) === String(updated.id),
  );
  if (!exists) return [updated, ...current];

  return current.map((ticket) =>
    String(ticket.id) === String(updated.id) ? updated : ticket,
  );
}

function storedViewMode(organizationId: number | string | null | undefined) {
  if (!organizationId || typeof window === "undefined") return "list";
  const stored = window.localStorage.getItem(
    `maono:ticket-view:${organizationId}`,
  );
  return stored === "kanban" || stored === "calendar" ? stored : "list";
}

export default function TicketsSection({
  user,
  organizationId,
  organizationName,
}: TicketsSectionProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filters, setFilters] = useState<TicketFilters>(
    DEFAULT_TICKET_FILTERS,
  );
  const [debouncedFilters, setDebouncedFilters] = useState<TicketFilters>(
    DEFAULT_TICKET_FILTERS,
  );
  const [facets, setFacets] = useState<TicketFacets>(EMPTY_FACETS);
  const [pagination, setPagination] =
    useState<TicketPagination>(EMPTY_PAGINATION);
  const [assignees, setAssignees] = useState<
    TicketDetailResponse["assignees"]
  >([]);
  const [attachmentLimits, setAttachmentLimits] =
    useState<TicketAttachmentLimits>(DEFAULT_TICKET_ATTACHMENT_LIMITS);
  const [viewMode, setViewMode] = useState<TicketViewMode>(() =>
    storedViewMode(organizationId),
  );
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<TicketApiError | null>(null);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<
    number | string | null
  >(null);
  const [detail, setDetail] = useState<TicketDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<TicketApiError | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [busyTicketIds, setBusyTicketIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [toast, setToast] = useState<string | null>(null);

  const listRequestIdRef = useRef(0);
  const listControllerRef = useRef<AbortController | null>(null);
  const detailRequestIdRef = useRef(0);
  const detailControllerRef = useRef<AbortController | null>(null);
  const organizationKeyRef = useRef(String(organizationId ?? ""));
  const newTicketButtonRef = useRef<HTMLButtonElement | null>(null);

  organizationKeyRef.current = String(organizationId ?? "");

  const permissionContext = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      organization: organizationId ? { id: organizationId } : undefined,
    }),
    [organizationId],
  );

  const canView = can(user, PERMISSION.TICKET_VIEW, permissionContext);
  const canCreate = can(user, PERMISSION.TICKET_CREATE, permissionContext);
  const canManage = can(user, PERMISSION.TICKET_MANAGE, permissionContext);
  const canUpload = canCreate || canManage;

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedFilters(filters),
      filters.q === debouncedFilters.q ? 0 : 250,
    );
    return () => window.clearTimeout(timeout);
  }, [debouncedFilters.q, filters]);

  useEffect(() => {
    setViewMode(storedViewMode(organizationId));
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId || typeof window === "undefined") return;
    window.localStorage.setItem(
      `maono:ticket-view:${organizationId}`,
      viewMode,
    );
  }, [organizationId, viewMode]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const loadTicketsPage = useCallback(
    async (
      targetPage = 1,
      options: { append?: boolean; background?: boolean } = {},
    ) => {
      if (!organizationId || !canView) {
        setTickets([]);
        return;
      }

      listRequestIdRef.current += 1;
      const requestId = listRequestIdRef.current;
      const requestOrganizationKey = String(organizationId);
      listControllerRef.current?.abort();
      const controller = new AbortController();
      listControllerRef.current = controller;

      if (options.background || options.append || targetPage > 1) {
        setRefreshing(true);
      } else {
        setInitialLoading(true);
      }
      setError(null);

      try {
        const response = await listTickets(
          organizationId,
          debouncedFilters,
          targetPage,
          controller.signal,
          {
            limit: viewMode === "list" ? 50 : 100,
            includeUndated: viewMode === "calendar",
          },
        );

        if (
          requestId !== listRequestIdRef.current ||
          requestOrganizationKey !== organizationKeyRef.current
        ) {
          return;
        }

        setTickets((current) =>
          options.append
            ? mergeTickets(current, response.tickets)
            : response.tickets,
        );
        setFacets(response.facets);
        setPagination(response.pagination);
        setAssignees(response.assignees);
        setAttachmentLimits(
          response.attachmentLimits || DEFAULT_TICKET_ATTACHMENT_LIMITS,
        );
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }
        if (
          requestId !== listRequestIdRef.current ||
          requestOrganizationKey !== organizationKeyRef.current
        ) {
          return;
        }

        setError(
          toTicketApiError(requestError, "Não foi possível carregar os chamados."),
        );
      } finally {
        if (
          requestId === listRequestIdRef.current &&
          requestOrganizationKey === organizationKeyRef.current
        ) {
          setInitialLoading(false);
          setRefreshing(false);
          listControllerRef.current = null;
        }
      }
    },
    [canView, debouncedFilters, organizationId, viewMode],
  );

  useEffect(() => {
    setTickets([]);
    setPagination(EMPTY_PAGINATION);
    setFacets(EMPTY_FACETS);
    void loadTicketsPage(1);

    return () => {
      listRequestIdRef.current += 1;
      listControllerRef.current?.abort();
    };
  }, [loadTicketsPage]);

  const loadDetail = useCallback(
    async (ticketId: number | string) => {
      if (!organizationId) return;

      detailRequestIdRef.current += 1;
      const requestId = detailRequestIdRef.current;
      const requestOrganizationKey = String(organizationId);
      detailControllerRef.current?.abort();
      const controller = new AbortController();
      detailControllerRef.current = controller;

      setDetailLoading(true);
      setDetailError(null);

      try {
        const response = await getTicketDetails(
          organizationId,
          ticketId,
          controller.signal,
        );

        if (
          requestId !== detailRequestIdRef.current ||
          requestOrganizationKey !== organizationKeyRef.current
        ) {
          return;
        }

        setDetail(response);
        setAttachmentLimits(
          response.attachmentLimits || DEFAULT_TICKET_ATTACHMENT_LIMITS,
        );
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }
        if (
          requestId !== detailRequestIdRef.current ||
          requestOrganizationKey !== organizationKeyRef.current
        ) {
          return;
        }

        setDetailError(
          toTicketApiError(requestError, "Não foi possível carregar o chamado."),
        );
      } finally {
        if (requestId === detailRequestIdRef.current) {
          setDetailLoading(false);
          detailControllerRef.current = null;
        }
      }
    },
    [organizationId],
  );

  const openTicket = useCallback(
    (ticket: Ticket) => {
      setSelectedTicketId(ticket.id);
      setDetail(null);
      void loadDetail(ticket.id);
    },
    [loadDetail],
  );

  const closeDetail = useCallback(() => {
    detailRequestIdRef.current += 1;
    detailControllerRef.current?.abort();
    setSelectedTicketId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  const closeNewTicket = useCallback(() => {
    setNewTicketOpen(false);
  }, []);

  async function changeStatus(ticket: Ticket, status: TicketStatus) {
    if (!organizationId || !canManage || ticket.status === status) return;

    const previous = ticket;
    const ticketKey = String(ticket.id);
    const requestOrganizationKey = String(organizationId);
    setBusyTicketIds((current) => new Set(current).add(ticketKey));
    setTickets((current) =>
      current.map((item) =>
        String(item.id) === ticketKey ? { ...item, status } : item,
      ),
    );
    setError(null);

    try {
      const updated = await updateTicket(
        organizationId,
        ticket.id,
        { status },
      );
      if (requestOrganizationKey !== organizationKeyRef.current) return;
      setTickets((current) => replaceTicket(current, updated));
      if (String(selectedTicketId) === ticketKey) {
        void loadDetail(ticket.id);
      }
    } catch (requestError) {
      if (requestOrganizationKey !== organizationKeyRef.current) return;
      setTickets((current) => replaceTicket(current, previous));
      setError(
        toTicketApiError(requestError, "Não foi possível alterar a situação."),
      );
    } finally {
      if (requestOrganizationKey === organizationKeyRef.current) {
        setBusyTicketIds((current) => {
          const next = new Set(current);
          next.delete(ticketKey);
          return next;
        });
      }
    }
  }

  async function updateSelectedTicket(payload: UpdateTicketPayload) {
    if (!organizationId || !selectedTicketId || !canManage) return;

    setDetailSaving(true);
    const requestOrganizationKey = String(organizationId);
    try {
      const updated = await updateTicket(
        organizationId,
        selectedTicketId,
        payload,
      );
      if (requestOrganizationKey !== organizationKeyRef.current) return;
      setTickets((current) => replaceTicket(current, updated));
      await loadDetail(selectedTicketId);
      setToast(`${updated.code} atualizado com sucesso.`);
    } finally {
      if (requestOrganizationKey === organizationKeyRef.current) {
        setDetailSaving(false);
      }
    }
  }

  function handleCreated(ticket: Ticket, failedFiles: File[]) {
    setTickets((current) => replaceTicket(current, ticket));
    setToast(
      failedFiles.length > 0
        ? `${ticket.code} criado; ${failedFiles.length} anexo(s) aguardam nova tentativa.`
        : `${ticket.code} criado com sucesso.`,
    );
    void loadTicketsPage(1, { background: true });
  }

  const handleCalendarRange = useCallback((from: string, to: string) => {
    setFilters((current) =>
      current.from === from && current.to === to
        ? current
        : { ...current, from, to, sort: "due_asc" },
    );
  }, []);

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Central de Chamados</h2>
        <p>Selecione uma organização para consultar chamados.</p>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Central de Chamados</h2>
        <p>Você não tem permissão para visualizar chamados desta organização.</p>
      </section>
    );
  }

  const openCount =
    facets.byStatus.new + facets.byStatus.open;
  const showInitialSkeleton = initialLoading && tickets.length === 0;

  return (
    <section className="ticket-center-shell">
      <TicketsToolbar
        organizationId={organizationId}
        organizationName={organizationName}
        filters={filters}
        assignees={assignees}
        viewMode={viewMode}
        canCreate={canCreate}
        onFiltersChange={setFilters}
        onViewModeChange={setViewMode}
        onNewTicket={() => setNewTicketOpen(true)}
        newTicketButtonRef={newTicketButtonRef}
      />

      {showInitialSkeleton ? (
        <MetricsSkeleton count={5} />
      ) : (
        <section
          className="ticket-metrics"
          aria-label="Resumo dos chamados"
          aria-busy={refreshing}
        >
          <button
            type="button"
            className={filters.status === "open" ? "is-active" : ""}
            aria-pressed={filters.status === "open" && !filters.overdueOnly}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                status: current.status === "open" && !current.overdueOnly ? "" : "open",
                overdueOnly: false,
              }))
            }
          >
            <span className="ticket-metric-icon metric-open" aria-hidden="true">▣</span>
            <span className="ticket-metric-copy"><span>Abertos</span><strong>{openCount}</strong></span>
          </button>
          <button
            type="button"
            className={filters.status === "in_progress" ? "is-active" : ""}
            aria-pressed={filters.status === "in_progress" && !filters.overdueOnly}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                status: "in_progress",
                overdueOnly: false,
              }))
            }
          >
            <span className="ticket-metric-icon metric-progress" aria-hidden="true">◔</span>
            <span className="ticket-metric-copy"><span>Em andamento</span><strong>{facets.byStatus.in_progress}</strong></span>
          </button>
          <button
            type="button"
            className={filters.status === "in_review" ? "is-active" : ""}
            aria-pressed={filters.status === "in_review" && !filters.overdueOnly}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                status: "in_review",
                overdueOnly: false,
              }))
            }
          >
            <span className="ticket-metric-icon metric-review" aria-hidden="true">◉</span>
            <span className="ticket-metric-copy"><span>Em revisão</span><strong>{facets.byStatus.in_review}</strong></span>
          </button>
          <button
            type="button"
            className={filters.overdueOnly ? "is-active" : ""}
            aria-pressed={filters.overdueOnly}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                status: "",
                overdueOnly: !current.overdueOnly,
              }))
            }
          >
            <span className="ticket-metric-icon metric-overdue" aria-hidden="true">⚠</span>
            <span className="ticket-metric-copy"><span>Vencidos</span><strong>{facets.overdue}</strong></span>
          </button>
          <button
            type="button"
            className={filters.status === "closed" ? "is-active" : ""}
            aria-pressed={filters.status === "closed" && !filters.overdueOnly}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                status: "closed",
                overdueOnly: false,
              }))
            }
          >
            <span className="ticket-metric-icon metric-closed" aria-hidden="true">✓</span>
            <span className="ticket-metric-copy"><span>Concluídos</span><strong>{facets.byStatus.closed}</strong></span>
          </button>
        </section>
      )}

      {error ? (
        <TicketErrorNotice
          error={error}
          onRetry={() => void loadTicketsPage(1)}
        />
      ) : null}

      <div
        className="ticket-view-region"
        aria-busy={initialLoading || refreshing}
      >
        {showInitialSkeleton ? (
          viewMode === "list" ? (
            <TableSkeleton headers={TICKET_LIST_HEADERS} rows={7} />
          ) : (
            <div className={`ticket-view-skeleton mode-${viewMode}`}>
              {Array.from({ length: viewMode === "kanban" ? 4 : 12 }).map(
                (_, index) => (
                  <span key={index} />
                ),
              )}
              <p className="mm-sr-only" role="status">
                Carregando chamados.
              </p>
            </div>
          )
        ) : tickets.length === 0 ? (
          <div className="ticket-empty-state">
            <span aria-hidden="true">▧</span>
            <h3>Nenhum chamado encontrado</h3>
            <p>
              Ajuste os filtros ou registre a primeira solicitação desta
              organização.
            </p>
            {canCreate ? (
              <button
                type="button"
                className="ticket-primary-action"
                onClick={() => setNewTicketOpen(true)}
              >
                Novo chamado
              </button>
            ) : null}
          </div>
        ) : viewMode === "list" ? (
          <TicketListView
            tickets={tickets}
            pagination={pagination}
            busyTicketIds={busyTicketIds}
            onOpen={openTicket}
            onPageChange={(targetPage) =>
              void loadTicketsPage(targetPage, { background: true })
            }
          />
        ) : viewMode === "kanban" ? (
          <TicketKanbanView
            tickets={tickets}
            canManage={canManage}
            busyTicketIds={busyTicketIds}
            onOpen={openTicket}
            onStatusChange={(ticket, status) =>
              void changeStatus(ticket, status)
            }
          />
        ) : (
          <TicketCalendarView
            tickets={tickets}
            onOpen={openTicket}
            onRangeChange={handleCalendarRange}
          />
        )}

        {!showInitialSkeleton &&
        viewMode !== "list" &&
        pagination.hasMore ? (
          <button
            type="button"
            className="ticket-load-more"
            disabled={refreshing}
            onClick={() =>
              void loadTicketsPage(pagination.page + 1, {
                append: true,
                background: true,
              })
            }
          >
            {refreshing ? "Carregando..." : "Carregar mais chamados"}
          </button>
        ) : null}
      </div>

      {refreshing ? (
        <span className="mm-sr-only" role="status">
          Atualizando chamados.
        </span>
      ) : null}

      {toast ? (
        <div className="ticket-toast" role="status">
          {toast}
        </div>
      ) : null}

      <NewTicketPopover
        open={newTicketOpen}
        organizationId={organizationId}
        assignees={assignees}
        canManage={canManage}
        attachmentLimits={attachmentLimits}
        onClose={closeNewTicket}
        onCreated={handleCreated}
      />

      <TicketDetailDrawer
        open={selectedTicketId !== null}
        organizationId={organizationId}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        saving={detailSaving}
        canManage={canManage}
        canUpload={canUpload}
        attachmentLimits={attachmentLimits}
        currentUserId={user?.id}
        onClose={closeDetail}
        onRetry={() => {
          if (selectedTicketId) void loadDetail(selectedTicketId);
        }}
        onReload={() => {
          if (selectedTicketId) {
            void loadDetail(selectedTicketId);
            void loadTicketsPage(pagination.page, { background: true });
          }
        }}
        onUpdate={updateSelectedTicket}
      />
    </section>
  );
}
