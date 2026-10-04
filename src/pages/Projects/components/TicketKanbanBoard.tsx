import { isRegionAccessDenied, isRegionAuthenticationError } from "../../../components/loading/region-loading-policy";
import { useEffect, useRef, useState } from 'react';
import TicketKanbanView from './TicketKanbanView';
import TicketErrorNotice from './TicketErrorNotice';
import { getTicketDetails, listTickets, toTicketApiError, type TicketApiError } from './tickets-api';
import { matchesTicketFilters, projectTicketColumn, ticketQueryKey, type TicketChange } from './ticket-live-state';
import type { Ticket, TicketFilters, TicketPagination, TicketStatus } from './ticket-types';

const queues = ['open', 'in_progress', 'in_review', 'closed'];
type Column = { tickets: Ticket[]; total: number; hasMore: boolean; loading: boolean; loadingMore?: boolean; revision: number; pagination?: TicketPagination; error?: TicketApiError };
const emptyColumn = (): Column => ({ tickets: [], total: 0, hasMore: false, loading: false, revision: 0 });

export default function TicketKanbanBoard({ organizationId, snapshot, refreshKey = 0, filters, changes, canManage, busyTicketIds, onOpen, onStatusChange }: {
  organizationId: number | string; snapshot?: string | null; refreshKey?: number; filters: TicketFilters; changes: TicketChange[]; canManage: boolean;
  busyTicketIds: ReadonlySet<string>; onOpen: (ticket: Ticket) => void; onStatusChange: (ticket: Ticket, status: TicketStatus) => void;
}) {
  const [columns, setColumns] = useState<Record<string, Column>>(() => Object.fromEntries(queues.map(queue => [queue, { ...emptyColumn(), loading: true }])));
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [verifiedPins, setVerifiedPins] = useState(new Map<string, Ticket>());
  const current = useRef(columns); current.current = columns;
  const controllers = useRef(new Map<string, AbortController>());
  const generation = useRef(0);
  const revision = changes.at(-1)?.revision ?? 0;
  const latestRevision = useRef(revision); latestRevision.current = revision;
  const pending = useRef(busyTicketIds.size > 0); pending.current = busyTicketIds.size > 0;

  function invalidateAccess(failure: TicketApiError, queue: string) {
    generation.current += 1;
    for (const active of controllers.current.values()) active.abort();
    setAccessRevoked(true); setVerifiedPins(new Map());
    setColumns(Object.fromEntries(queues.map(id => [id, { ...emptyColumn(), ...(id === queue ? { error: failure } : {}) }])));
  }

  async function load(queue: string, more = false, sharedSnapshot: string | null | undefined = null, commit = true) {
    if (pending.current) return;
    controllers.current.get(queue)?.abort();
    const controller = new AbortController(); controllers.current.set(queue, controller);
    const epoch = generation.current, requestRevision = latestRevision.current;
    const previous = current.current[queue] || emptyColumn();
    const page = more ? (previous.pagination?.page || 0) + 1 : 1;
    // Preserve the number of loaded pages during reconciliation, with one new
    // snapshot shared by page 1 and every following page of this queue.
    const lastPage = more ? page : Math.max(1, previous.pagination?.page || 1);
    setColumns(state => ({ ...state, [queue]: { ...(state[queue] || emptyColumn()), loading: true, loadingMore: more, error: undefined } }));
    let querySnapshot = more ? previous.pagination?.snapshot : sharedSnapshot;
    let loaded = more ? previous.tickets : [];
    try {
      for (let nextPage = page; nextPage <= lastPage; nextPage += 1) {
        const data = await listTickets(organizationId, filters, nextPage, controller.signal, { limit: 25, includeUndated: true, queue, snapshot: querySnapshot });
        if (controller.signal.aborted || epoch !== generation.current || requestRevision !== latestRevision.current || pending.current) return;
        loaded = [...new Map([...loaded, ...data.tickets].map(ticket => [String(ticket.id), ticket])).values()];
        querySnapshot = data.pagination.snapshot;
        if (nextPage === lastPage || !data.pagination.hasMore) {
          const column = { tickets: loaded, total: data.pagination.total, hasMore: data.pagination.hasMore, loading: false, loadingMore: false, pagination: data.pagination, revision: more ? previous.revision : requestRevision };
          if (commit) setColumns(state => ({ ...state, [queue]: column }));
          return { snapshot: data.pagination.snapshot || null, column };
        }
      }
    } catch (error) {
      if (controller.signal.aborted || epoch !== generation.current || requestRevision !== latestRevision.current) return;
      const failure = toTicketApiError(error);
      if (isRegionAccessDenied(failure) || failure.status === 404) {
        invalidateAccess(failure, queue);
        return;
      }
      setColumns(state => ({ ...state, [queue]: { ...(isRegionAccessDenied(failure) || failure.status === 404 ? emptyColumn() : state[queue] || emptyColumn()), loading: false, error: failure } }));
    }
  }

  async function reconcile(forceFresh = false) {
    const epoch = generation.current, requestRevision = latestRevision.current;
    setColumns(state => Object.fromEntries(queues.map(queue => [queue, { ...(state[queue] || emptyColumn()), loading: true, loadingMore: false }])));
    // Only mutation reconciliation needs the atomic snapshot/overlay swap.
    // Initial authorized queues can reveal independently once the first token exists.
    const hasQueryChanges = changes.some(change => change.queryKey === ticketQueryKey(filters));
    const revealPendingQueue = (queue: string) => !hasQueryChanges && !current.current[queue]?.pagination;
    const first = await load(queues[0], false, requestRevision === 0 && !forceFresh ? snapshot : null, revealPendingQueue(queues[0]));
    if (epoch !== generation.current || pending.current) return;
    if (!first) {
      setColumns(state => Object.fromEntries(Object.entries(state).map(([queue, column]) => [queue, { ...column, loading: false }])));
      return;
    }
    const rest = await Promise.all(queues.slice(1).map(queue => load(queue, false, first.snapshot, revealPendingQueue(queue))));
    if (epoch !== generation.current || requestRevision !== latestRevision.current || pending.current) return;
    if (rest.some(result => !result)) {
      setColumns(state => Object.fromEntries(Object.entries(state).map(([queue, column]) => [queue, { ...column, loading: false }])));
      return;
    }
    const next: Record<string, Column> = Object.fromEntries([first, ...rest].map((result, index) => [queues[index], result!.column]));
    const visibleIds = new Set(Object.values(next).flatMap(column => column.tickets.map(ticket => String(ticket.id))));
    const latestChanges = new Map(changes.filter(change => change.queryKey === ticketQueryKey(filters)).map(change => [String((change.ticket || change.previous)!.id), change]));
    const pins = new Map<string, Ticket>();
    const controller = new AbortController(); controllers.current.set('pins', controller);
    for (const [id, change] of latestChanges) {
      if (visibleIds.has(id) || !change.ticket || change.retain === false || !matchesTicketFilters(change.ticket, filters)) continue;
      // A row outside the loaded page might also have lost ticket-level access.
      // Re-authorize every retained pin before installing a new snapshot.
      try {
        const detail = await getTicketDetails(organizationId, id, controller.signal);
        if (matchesTicketFilters(detail.ticket, filters)) pins.set(id, detail.ticket);
      } catch (error) {
        if (controller.signal.aborted) return;
        const failure = toTicketApiError(error);
        if (isRegionAuthenticationError(failure)) {
          invalidateAccess(failure, change.ticket.status === 'new' ? 'open' : change.ticket.status);
          return;
        }
        if (!isRegionAccessDenied(failure) && failure.status !== 404) {
          const queue = change.ticket.status === 'new' ? 'open' : change.ticket.status;
          next[queue] = { ...next[queue], error: failure };
        }
      }
    }
    if (controller.signal.aborted || epoch !== generation.current || requestRevision !== latestRevision.current || pending.current) return;
    setAccessRevoked(false);
    setVerifiedPins(pins);
    setColumns(next);
  }

  useEffect(() => {
    const activeControllers = controllers.current;
    generation.current += 1;
    for (const controller of activeControllers.values()) controller.abort();
    setColumns(state => Object.fromEntries(Object.entries(state).map(([queue, column]) => [queue, { ...column, loading: false }])));
    if (!pending.current) void reconcile(refreshKey > 0);
    return () => { generation.current += 1; for (const controller of activeControllers.values()) controller.abort(); };
    // Query/organization remount the board; same-query refresh and mutations reconcile in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, busyTicketIds.size, refreshKey]);

  const freshTickets = new Map(verifiedPins);
  const latestById = new Map(changes.map(change => [String((change.ticket || change.previous)!.id), change]));
  for (const [id, change] of latestById) {
    for (const column of Object.values(columns)) {
      if (column.revision < change.revision) continue;
      const ticket = column.tickets.find(item => String(item.id) === id);
      if (ticket) freshTickets.set(id, ticket);
    }
  }
  const rawQueues = new Map(Object.entries(columns).flatMap(([queue, column]) => column.tickets.map(ticket => [String(ticket.id), queue] as const)));
  const visible = Object.fromEntries(queues.map(queue => {
    const column = columns[queue] || emptyColumn();
    // A revoked queue must not expose tickets retained by local overlays.
    return [queue, accessRevoked ? emptyColumn() : isRegionAccessDenied(column.error) || column.error?.status === 404 ? column : projectTicketColumn(column, queue, changes, filters, freshTickets, rawQueues)];
  }));
  const tickets = Object.values(visible).flatMap(column => column.tickets);
  return <>{queues.map(queue => columns[queue]?.error ? <TicketErrorNotice key={queue} error={columns[queue].error!} onRetry={() => void reconcile(true)} /> : null)}
    <TicketKanbanView tickets={tickets} columnPages={visible} totals={{ new: 0, open: 0, in_progress: 0, in_review: 0, closed: 0 }}
      hasMore={false} loading={pending.current} onLoadMore={queue => void load(queue, true)}
      canManage={canManage} busyTicketIds={busyTicketIds} onOpen={onOpen} onStatusChange={onStatusChange} />
  </>;
}
