import { isRegionAccessDenied, isRegionAuthenticationError } from "../../../components/loading/region-loading-policy";
import TicketFeedbackPanel from "./TicketFeedbackPanel";
import TicketKnowledgePanel from "./TicketKnowledgePanel";
import TicketMetricsPanel from './TicketMetricsPanel';
import TicketExportsPanel from './TicketExportsPanel';
import TicketCasesPanel from './TicketCasesPanel';
import "./ticket-flow.css";
import "./ticket-center-visual.css";
import { DocumentActionMenu } from "./DocumentsUi";
import TicketFlowSettings from "./TicketFlowSettings";
import { readTicketNavigation, ticketNavigationUrl } from "./ticket-navigation";
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
  LoadingStatus, Skeleton,
} from "../../../components/loading/Skeleton";
import NewTicketPopover from "./NewTicketPopover";
import TicketCalendarView from "./TicketCalendarView";
import TicketDetailDrawer from "./TicketDetailDrawer";
import TicketKanbanBoard from "./TicketKanbanBoard";
import { changeTicketFacets, matchesTicketFilters, ticketQueryKey, type TicketChange } from "./ticket-live-state";
import TicketListView from "./TicketListView";
import TicketsToolbar from "./TicketsToolbar";
import TicketNotifications from "./TicketNotifications";
import TicketErrorNotice from "./TicketErrorNotice";
import {
  getTicketDetails,
  runTicketCommand,
  listTickets,
  TicketApiError,
  toTicketApiError,
  updateTicket,
} from "./tickets-api";
import {
  DEFAULT_TICKET_ATTACHMENT_LIMITS,
  type Ticket,
  type TicketCommand,
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
  onHome: () => void;
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

export default function TicketsSection(props: TicketsSectionProps) {
  return <TicketsSectionContent key={JSON.stringify([props.organizationId, props.user?.id, props.user?.role, props.user?.permissions, props.user?.deniedPermissions, props.user?.scopes])} {...props} />;
}

function TicketsSectionContent({
  user,
  organizationId,
  organizationName,
  onHome,
}: TicketsSectionProps) {
  const navigation = useRef(readTicketNavigation(window.location.href, String(organizationId ?? ''))).current;
  const snapshotRef = useRef<string | null>(null);
  const snapshotQueryKeyRef = useRef<string | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [exportOpenSignal, setExportOpenSignal] = useState(0);
  const [exportAvailable, setExportAvailable] = useState(false);
  const [flowEnabled, setFlowEnabled] = useState(false);
  const [queuePolicies, setQueuePolicies] = useState<import('./ticket-types').TicketQueuePolicy[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [triageEnabled, setTriageEnabled] = useState(false);
  const [lifecycleEnabled, setLifecycleEnabled] = useState(false);
  const [suggestedStatus, setSuggestedStatus] = useState<TicketStatus | null>(null);
  const [filters, setFilters] = useState<TicketFilters>(
    navigation.filters,
  );
  const [debouncedFilters, setDebouncedFilters] = useState<TicketFilters>(
    navigation.filters,
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
    new URL(window.location.href).searchParams.get("cc_org") === String(organizationId) ? navigation.view : storedViewMode(organizationId),
  );
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasLoadedQuery, setHasLoadedQuery] = useState(false);
  const [error, setError] = useState<TicketApiError | null>(null);
  const [queryAccessRevoked, setQueryAccessRevoked] = useState(false);
  const queryAccessRevokedRef = useRef(false);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<
    number | string | null
  >(navigation.ticketId);
  const [detail, setDetail] = useState<TicketDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<TicketApiError | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [busyTicketIds, setBusyTicketIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [ticketChanges, setTicketChanges] = useState<TicketChange[]>([]);
  const [boardRefresh, setBoardRefresh] = useState(0);
  const mutationLocks = useRef(new Set<string>());
  const mutationRevision = useRef(0);
  const mounted = useRef(true);
  const liveFiltersRef = useRef(debouncedFilters); liveFiltersRef.current = debouncedFilters;
  const knownTicketsRef = useRef(new Map<string, Ticket>());
  const queryKeyRef = useRef(ticketQueryKey(debouncedFilters));
  queryKeyRef.current = ticketQueryKey(debouncedFilters);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [toast, setToast] = useState<string | null>(null);

  const listRequestSequenceRef = useRef(0);
  const listControllerRef = useRef<AbortController | null>(null);
  const detailRequestSequenceRef = useRef(0);
  const detailControllerRef = useRef<AbortController | null>(null);
  const organizationKeyRef = useRef(String(organizationId ?? ""));
  const newTicketButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectedTicketKeyRef = useRef(String(selectedTicketId ?? ""));
  selectedTicketKeyRef.current = String(selectedTicketId ?? "");

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
    setViewMode(new URL(window.location.href).searchParams.get("cc_org") === String(organizationId) ? navigation.view : storedViewMode(organizationId));
  }, [organizationId, navigation.view]);

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

  useEffect(() => { setTriageEnabled(false); setLifecycleEnabled(false); }, [organizationId]);

  const invalidateQueryAccess = useCallback(() => {
    queryAccessRevokedRef.current = true;
    listRequestSequenceRef.current += 1;
    listControllerRef.current?.abort();
    detailRequestSequenceRef.current += 1;
    detailControllerRef.current?.abort();
    setInitialLoading(false); setRefreshing(false); setLoadingMore(false); setDetailLoading(false);
    setQueryAccessRevoked(true); setHasLoadedQuery(false);
    setDetail(null); setSelectedTicketId(null); setSuggestedStatus(null); setNewTicketOpen(false);
    knownTicketsRef.current.clear(); setTicketChanges([]);
    setTickets([]); setFacets(EMPTY_FACETS); setPagination(EMPTY_PAGINATION); setAssignees([]);
    snapshotRef.current = null;
  }, []);

  const loadTicketsPage = useCallback(
    async (
      targetPage = 1,
      options: { append?: boolean; background?: boolean; reuseSnapshot?: boolean; preserveError?: boolean } = {},
    ) => {
      if (mutationLocks.current.size) return;
      if (!organizationId || !canView) {
        setTickets([]);
        return;
      }

      listRequestSequenceRef.current += 1;
      const requestSequence = listRequestSequenceRef.current;
      const requestRevision = mutationRevision.current;
      const requestOrganizationKey = String(organizationId);
      listControllerRef.current?.abort();
      const controller = new AbortController();
      listControllerRef.current = controller;

      setLoadingMore(Boolean(options.append));
      if (options.background || options.append || targetPage > 1) {
        setRefreshing(true);
      } else {
        setInitialLoading(true);
      }
      if (!options.preserveError) setError(null);

      try {
        const response = await listTickets(
          organizationId,
          debouncedFilters,
          targetPage,
          controller.signal,
          {
            limit: viewModeRef.current === "list" ? pageSize : 50,
            includeUndated: true,
            snapshot: targetPage > 1 || options.reuseSnapshot ? snapshotRef.current : null,
          },
        );

        if (
          requestSequence !== listRequestSequenceRef.current || requestRevision !== mutationRevision.current || !mounted.current ||
          requestOrganizationKey !== organizationKeyRef.current
        ) {
          return;
        }

        if (!response.pagination.snapshot && response.pagination.page > response.pagination.totalPages) {
          const lastPage = Math.max(1, response.pagination.totalPages);
          const clamped = await listTickets(organizationId, debouncedFilters, lastPage, controller.signal, {
            limit: viewModeRef.current === "list" ? pageSize : 50, includeUndated: true,
          });
          if (requestSequence !== listRequestSequenceRef.current || requestRevision !== mutationRevision.current || !mounted.current || requestOrganizationKey !== organizationKeyRef.current) return;
          Object.assign(response, clamped);
        }

        queryAccessRevokedRef.current = false;
        setHasLoadedQuery(true);
        setQueryAccessRevoked(false);
        for (const ticket of response.tickets) knownTicketsRef.current.set(String(ticket.id), ticket);
        setTickets((current) =>
          options.append
            ? mergeTickets(current, response.tickets)
            : response.tickets,
        );
        snapshotRef.current = response.pagination.snapshot || null;
        snapshotQueryKeyRef.current = ticketQueryKey(debouncedFilters);
        setFlowEnabled(response.flowEnabled === true);
        setQueuePolicies(response.queuePolicies || []);
        setTriageEnabled(response.triageEnabled === true);
        setLifecycleEnabled(response.lifecycleEnabled === true);
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
          requestSequence !== listRequestSequenceRef.current || requestRevision !== mutationRevision.current || !mounted.current ||
          requestOrganizationKey !== organizationKeyRef.current
        ) {
          return;
        }

        const listFailure = toTicketApiError(requestError, "Não foi possível carregar os chamados.");
        if (isRegionAccessDenied(listFailure) || listFailure.status === 404) {
          invalidateQueryAccess();
        }
        setError(listFailure);
      } finally {
        if (
          requestSequence === listRequestSequenceRef.current &&
          requestOrganizationKey === organizationKeyRef.current
        ) {
          setInitialLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
          listControllerRef.current = null;
        }
      }
    },
    [canView, debouncedFilters, organizationId, pageSize, invalidateQueryAccess],
  );

  useEffect(() => {
    snapshotRef.current = null;
    setHasLoadedQuery(false);
    setTickets([]);
    setPagination(EMPTY_PAGINATION);
    setFacets(EMPTY_FACETS);
    void loadTicketsPage(1);

    return () => {
      listRequestSequenceRef.current += 1;
      listControllerRef.current?.abort();
    };
  }, [loadTicketsPage]);

  const previousView = useRef(viewMode);
  useEffect(() => {
    if (previousView.current === viewMode) return;
    previousView.current = viewMode;
    if (viewMode !== 'kanban') void loadTicketsPage(1, { background: true, reuseSnapshot: true });
  }, [viewMode, loadTicketsPage]);

  const reloadListRef = useRef(loadTicketsPage);
  reloadListRef.current = loadTicketsPage;

  const recordTicketChange = useCallback((previous: Ticket | null, ticket: Ticket | null, queryKey = queryKeyRef.current, retain = true) => {
    if (!mounted.current || queryAccessRevokedRef.current) return;
    const revision = ++mutationRevision.current;
    setTicketChanges(current => [...current, { revision, queryKey, previous, ticket, retain }]);
    if (ticket) knownTicketsRef.current.set(String(ticket.id), ticket);
    else if (previous) knownTicketsRef.current.delete(String(previous.id));
    if (queryKey !== queryKeyRef.current) return;
    const id = String((ticket || previous)!.id);
    setTickets(current => {
      const without = current.filter(item => String(item.id) !== id);
      return ticket && matchesTicketFilters(ticket, liveFiltersRef.current) ? replaceTicket(without, ticket) : without;
    });
    setFacets(current => changeTicketFacets(current, previous, ticket, liveFiltersRef.current, Boolean(snapshotRef.current)));
  }, []);

  function lockTicket(ticketId: number | string) {
    const id = String(ticketId);
    if (mutationLocks.current.has(id)) return false;
    mutationLocks.current.add(id);
    setBusyTicketIds(new Set(mutationLocks.current));
    listRequestSequenceRef.current += 1;
    listControllerRef.current?.abort();
    setRefreshing(false);
    if (selectedTicketKeyRef.current === id) {
      detailRequestSequenceRef.current += 1;
      detailControllerRef.current?.abort();
      setDetailLoading(false);
    }
    return true;
  }

  function unlockTicket(ticketId: number | string) {
    mutationLocks.current.delete(String(ticketId));
    if (!mounted.current) return;
    setBusyTicketIds(new Set(mutationLocks.current));
    if (!mutationLocks.current.size) void reloadListRef.current(1, { background: true, preserveError: true });
  }

  const loadDetail = useCallback(
    async (ticketId: number | string) => {
      if (!organizationId) return;

      detailRequestSequenceRef.current += 1;
      const requestSequence = detailRequestSequenceRef.current;
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
          requestSequence !== detailRequestSequenceRef.current || !mounted.current ||
          requestOrganizationKey !== organizationKeyRef.current
        ) {
          return;
        }

        setDetail(response);
        const known = knownTicketsRef.current.get(String(ticketId));
        if (!mutationLocks.current.has(String(ticketId)) && known && JSON.stringify(known) !== JSON.stringify(response.ticket)) {
          recordTicketChange(known, response.ticket);
          void reloadListRef.current(1, { background: true, preserveError: true });
        }
        knownTicketsRef.current.set(String(ticketId), response.ticket);
        setLifecycleEnabled(response.lifecycleEnabled === true);
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
          requestSequence !== detailRequestSequenceRef.current || !mounted.current ||
          requestOrganizationKey !== organizationKeyRef.current
        ) {
          return;
        }

        const detailFailure = toTicketApiError(
          requestError,
          "Não foi possível carregar o chamado.",
        );
        if (isRegionAuthenticationError(detailFailure)) {
          invalidateQueryAccess();
          setError(detailFailure);
          return;
        }
        if (detailFailure.status === 404 || isRegionAccessDenied(detailFailure)) {
          const removed = knownTicketsRef.current.get(String(ticketId));
          if (removed) {
            recordTicketChange(removed, null);
            void reloadListRef.current(1, { background: true, preserveError: true });
          }
          setDetail(null);
          setSelectedTicketId(null);
          setSuggestedStatus(null);
          setDetailError(null);
          setToast("O chamado não está mais disponível para seu acesso.");
          return;
        }
        setDetailError(detailFailure);
      } finally {
        if (requestSequence === detailRequestSequenceRef.current) {
          setDetailLoading(false);
          detailControllerRef.current = null;
        }
      }
    },
    [organizationId, recordTicketChange, invalidateQueryAccess],
  );

  const openTicket = useCallback(
    (ticket: Ticket) => {
      knownTicketsRef.current.set(String(ticket.id), ticket);
      setSelectedTicketId(ticket.id);
      setSuggestedStatus(null);
      setDetail(null);
      void loadDetail(ticket.id);
    },
    [loadDetail],
  );

  const closeDetail = useCallback(() => {
    detailRequestSequenceRef.current += 1;
    detailControllerRef.current?.abort();
    setSelectedTicketId(null);
    setSuggestedStatus(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  const closeNewTicket = useCallback(() => {
    setNewTicketOpen(false);
  }, []);

  async function changeStatus(ticket: Ticket, status: TicketStatus) {
    if (!organizationId || !canManage || ticket.status === status || mutationLocks.current.has(String(ticket.id))) return;
    if (lifecycleEnabled) {
      openTicket(ticket);
      setSuggestedStatus(status);
      setToast("Complete os campos e confirme a mudança no detalhe do chamado.");
      return;
    }
    if (!lockTicket(ticket.id)) return;
    const queryKey = queryKeyRef.current;
    const optimistic = { ...ticket, status };
    recordTicketChange(ticket, optimistic, queryKey);
    setError(null);
    try {
      const updated = await updateTicket(organizationId, ticket.id, { status }, undefined, { etag: ticket.etag });
      if (!mounted.current) return;
      recordTicketChange(optimistic, updated, queryKey);
      if (String(ticket.id) === selectedTicketKeyRef.current) void loadDetail(ticket.id);
    } catch (requestError) {
      if (!mounted.current) return;
      const statusError = toTicketApiError(requestError, "Não foi possível alterar a situação.");
      const unavailable = isRegionAccessDenied(statusError) || statusError.status === 404;
      recordTicketChange(optimistic, unavailable ? null : ticket, queryKey, false);
      if (unavailable && String(ticket.id) === selectedTicketKeyRef.current) closeDetail();
      if (queryKey === queryKeyRef.current) setError(statusError);
    } finally {
      unlockTicket(ticket.id);
    }
  }

  async function mutateSelectedTicket(write: (organization: number | string, ticketId: number | string) => Promise<Ticket>) {
    if (!organizationId || !selectedTicketId || !canManage || detailSaving || !lockTicket(selectedTicketId)) return;
    setDetailSaving(true);
    const requestTicketId = selectedTicketId;
    const previous = detail?.ticket || tickets.find(ticket => String(ticket.id) === String(requestTicketId)) || null;
    const queryKey = queryKeyRef.current;
    try {
      const updated = await write(organizationId, requestTicketId);
      if (!mounted.current) return;
      recordTicketChange(previous, updated, queryKey);
      if (String(requestTicketId) === selectedTicketKeyRef.current) {
        setDetail(current => current && String(current.ticket.id) === String(requestTicketId) ? { ...current, ticket: updated } : current);
        await loadDetail(requestTicketId);
      }
      setToast(`${updated.code}: ação registrada no chamado.`);
    } catch (requestError) {
      if (!mounted.current) throw requestError;
      const mutationFailure = toTicketApiError(requestError, "Não foi possível atualizar o chamado.");
      if (mutationFailure.status === 404 || isRegionAccessDenied(mutationFailure)) {
        if (previous) recordTicketChange(previous, null, queryKey);
        if (String(requestTicketId) === selectedTicketKeyRef.current) {
          closeDetail();
        }
        setToast("O chamado não está mais disponível para seu acesso.");
      }
      throw mutationFailure;
    } finally {
      if (mounted.current) setDetailSaving(false);
      unlockTicket(requestTicketId);
    }
  }

  async function updateSelectedTicket(payload: UpdateTicketPayload, etag?: string) {
    await mutateSelectedTicket((organization, ticketId) => updateTicket(organization, ticketId, payload, undefined, { etag }));
  }

  async function commandSelectedTicket(command: TicketCommand, etag: string) {
    await mutateSelectedTicket((organization, ticketId) => runTicketCommand(organization, ticketId, command, etag));
  }

  function refreshTickets() {
    if (mutationLocks.current.size) return;
    snapshotRef.current = null;
    setBoardRefresh(current => current + 1);
    setTicketChanges([]);
    void loadTicketsPage(1, { background: true });
  }

  function handleCreated(ticket: Ticket, failedFiles: File[]) {
    if (String(ticket.organizationId) !== organizationKeyRef.current) return;
    recordTicketChange(null, ticket);
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

  useEffect(() => {
    const restore = () => {
      // The parent router owns leaving this organization / returning Home.
      if (new URL(window.location.href).searchParams.get("cc_org") !== String(organizationId)) return;
      const next = readTicketNavigation(window.location.href, String(organizationId ?? ''));
      setFilters(next.filters); setDebouncedFilters(next.filters); setViewMode(next.view);
      setSelectedTicketId(next.ticketId); setDetail(null); setSuggestedStatus(null);
      detailControllerRef.current?.abort(); detailRequestSequenceRef.current += 1;
      if (next.ticketId) void loadDetail(next.ticketId);
    };
    if (navigation.ticketId) void loadDetail(navigation.ticketId);
    window.addEventListener('popstate',restore);
    return () => { window.removeEventListener('popstate',restore); detailRequestSequenceRef.current += 1; detailControllerRef.current?.abort(); };
  }, [organizationId, loadDetail, navigation]);
  const navigationInitialized = useRef(false);
  useEffect(() => {
    const next = ticketNavigationUrl(window.location.href, String(organizationId ?? ''), debouncedFilters, viewMode, selectedTicketId);
    if (next !== window.location.href) {
      if (navigationInitialized.current) window.history.pushState(window.history.state, '', next);
      else window.history.replaceState(window.history.state, '', next);
    }
    navigationInitialized.current = true;
  }, [debouncedFilters, viewMode, selectedTicketId, organizationId]);

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
    facets.byStatus.open;
  const showInitialSkeleton = initialLoading && tickets.length === 0;

  return (
    <section className="ticket-center-shell ticket-center-final">
      <TicketsToolbar
        organizationId={organizationId}
        organizationName={organizationName}
        filters={filters}
        assignees={assignees}
        viewMode={viewMode}
        canCreate={canCreate}
        onFiltersChange={setFilters}
        onViewModeChange={setViewMode}
        onHome={onHome}
        onNewTicket={() => setNewTicketOpen(true)}
        newTicketButtonRef={newTicketButtonRef}
      />

      <LoadingStatus loading={initialLoading || refreshing || filters !== debouncedFilters} refreshing={hasLoadedQuery} label="Carregando resumo dos chamados." refreshingLabel="Atualizando resumo dos chamados." />
        <section
          className="ticket-metrics"
          aria-label="Resumo dos chamados"
          aria-busy={initialLoading || refreshing || filters !== debouncedFilters}
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
            <span className="ticket-metric-copy"><span>Abertos</span><strong>{!hasLoadedQuery ? initialLoading ? <Skeleton width={38} height={25} /> : "—" : openCount}</strong></span>
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
            <span className="ticket-metric-copy"><span>Em andamento</span><strong>{!hasLoadedQuery ? initialLoading ? <Skeleton width={38} height={25} /> : "—" : facets.byStatus.in_progress}</strong></span>
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
            <span className="ticket-metric-copy"><span>Em revisão</span><strong>{!hasLoadedQuery ? initialLoading ? <Skeleton width={38} height={25} /> : "—" : facets.byStatus.in_review}</strong></span>
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
            <span className="ticket-metric-copy"><span>Vencidos</span><strong>{!hasLoadedQuery ? initialLoading ? <Skeleton width={38} height={25} /> : "—" : facets.overdue}</strong></span>
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
            <span className="ticket-metric-copy"><span>Concluídos</span><strong>{!hasLoadedQuery ? initialLoading ? <Skeleton width={38} height={25} /> : "—" : facets.byStatus.closed}</strong></span>
          </button>
        </section>

      <TicketNotifications key={`notifications:${organizationId}:${user?.id}`} organizationId={organizationId} operator={user?.role === "super_admin"} onOpen={(id) => {
        setSelectedTicketId(id); setSuggestedStatus(null); setDetail(null); void loadDetail(id);
      }} />
      <TicketFeedbackPanel key={`feedback:${organizationId}:${user?.id}`} organizationId={organizationId} canManage={canManage} onOpen={id=>{setSelectedTicketId(id);setSuggestedStatus(null);setDetail(null);void loadDetail(id);}} />
      <TicketMetricsPanel organizationId={organizationId} canManage={canManage} />
      <TicketKnowledgePanel key={`knowledge:${organizationId}:${user?.id}`} organizationId={organizationId} canManage={canManage} reviewers={assignees} />
      <TicketCasesPanel key={`cases:${organizationId}:${user?.id}`} organizationId={organizationId} canManage={canManage} />
      {can(user, PERMISSION.EXPORT_VIEW, permissionContext) && <TicketExportsPanel key={`exports:${organizationId}:${user?.id}`} organizationId={organizationId} canCreate={can(user, PERMISSION.EXPORT_CREATE, permissionContext)} canDownload={can(user, PERMISSION.EXPORT_DOWNLOAD, permissionContext)} openSignal={exportOpenSignal} onAvailabilityChange={setExportAvailable} />}
      {flowEnabled && canManage ? <TicketFlowSettings organizationId={organizationId} policies={queuePolicies} onSaved={() => void loadTicketsPage(1, { background: true })} /> : null}
      {hasLoadedQuery ? <p className="mm-sr-only" role="status">
        {viewMode === "kanban" ? "Carregamento por fila. " : ""}{pagination.total} acessíveis nesta consulta.
        {pagination.snapshotAt ? " Ordem preservada por até 15 minutos; use Atualizar consulta no menu para incluir novos chamados." : ""}
      </p> : null}
      {error ? (
        <TicketErrorNotice
          error={error}
          onRetry={() => void loadTicketsPage(1)}
        />
      ) : null}

      <div
        className="ticket-view-region"
      >
        {viewMode !== "list" ? <div className="ticket-view-actions"><DocumentActionMenu label="Mais opções dos chamados" disabled={initialLoading} actions={[{ label: "Atualizar consulta", onSelect: refreshTickets, disabled: refreshing || filters !== debouncedFilters }]} /></div> : null}
        {queryAccessRevoked && viewMode === "kanban" ? null : viewMode === "list" ? (
          <TicketListView
            selectionScope={`${JSON.stringify(debouncedFilters)}:${pagination.page}:${pageSize}`}
            tickets={tickets}
            pagination={pagination}
            pageSize={pageSize}
            loading={initialLoading || refreshing || filters !== debouncedFilters}
            initialLoading={showInitialSkeleton}
            error={Boolean(error)}
            canCreate={canCreate}
            onNewTicket={() => setNewTicketOpen(true)}
            busyTicketIds={busyTicketIds}
            onOpen={openTicket}
            onPageSizeChange={setPageSize}
            onRefresh={refreshTickets}
            canExport={can(user, PERMISSION.EXPORT_VIEW, permissionContext)}
            exportAvailable={exportAvailable}
            onExport={() => setExportOpenSignal(current => current + 1)}
            onPageChange={(targetPage) =>
              void loadTicketsPage(targetPage, { background: true, reuseSnapshot: true })
            }
          />
        ) : viewMode === "kanban" ? (
          <TicketKanbanBoard
            key={`${organizationId}:${ticketQueryKey(debouncedFilters)}`}
            refreshKey={boardRefresh}
            organizationId={organizationId}
            filters={debouncedFilters}
            snapshot={boardRefresh || snapshotQueryKeyRef.current !== ticketQueryKey(debouncedFilters) ? null : pagination.snapshot}
            changes={ticketChanges}
            canManage={canManage}
            busyTicketIds={busyTicketIds}
            onOpen={openTicket}
            onStatusChange={(ticket, status) =>
              void changeStatus(ticket, status)
            }
          />
        ) : (
          <TicketCalendarView
            from={filters.from}
            loading={initialLoading || refreshing || filters !== debouncedFilters}
            initialLoading={showInitialSkeleton}
            loadingMore={loadingMore}
            error={Boolean(error)}
            tickets={tickets}
            onOpen={openTicket}
            onRangeChange={handleCalendarRange}
          />
        )}

        {!showInitialSkeleton &&
        viewMode === "calendar" &&
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

      {toast ? (
        <div className="ticket-toast" role="status">
          {toast}
        </div>
      ) : null}

      <NewTicketPopover
        key={String(organizationId)}
        open={newTicketOpen}
        organizationId={organizationId}
        assignees={assignees}
        triageEnabled={triageEnabled}
        lifecycleEnabled={lifecycleEnabled}
        onRefreshCapabilities={() => void loadTicketsPage(pagination.page, { background: true })}
        canManage={canManage}
        attachmentLimits={attachmentLimits}
        onClose={closeNewTicket}
        onCreated={handleCreated}
      />

      <TicketDetailDrawer
        key={`detail:${organizationId}:${selectedTicketId ?? "closed"}`}
        open={selectedTicketId !== null}
        organizationId={organizationId}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        saving={detailSaving || busyTicketIds.has(String(selectedTicketId))}
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
        onCommand={commandSelectedTicket}
        suggestedStatus={suggestedStatus}
      />
    </section>
  );
}
