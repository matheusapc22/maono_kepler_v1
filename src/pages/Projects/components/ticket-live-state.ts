import type { Ticket, TicketFacets, TicketFilters } from './ticket-types';

export type TicketChange = {
  revision: number;
  queryKey: string;
  previous: Ticket | null;
  ticket: Ticket | null;
  retain?: boolean;
};
export const ticketQueue = (ticket: Ticket) => ticket.status === 'new' ? 'open' : ticket.status;
export const ticketQueryKey = (filters: TicketFilters) => JSON.stringify(filters);

export function matchesTicketFilters(ticket: Ticket, filters: TicketFilters, includeStatus = true, now = Date.now()) {
  const q = filters.q.trim().toLowerCase();
  const date = ticket.dueAt?.slice(0, 10);
  return (!q || [ticket.code, ticket.subject, ticket.description].some(value => value?.toLowerCase().includes(q))) &&
    (!includeStatus || !filters.status || ticket.status === filters.status) &&
    (!filters.priority || ticket.priority === filters.priority) &&
    (!filters.assigneeId || (filters.assigneeId === 'unassigned' ? !ticket.assignedTo : String(ticket.assignedTo?.id) === filters.assigneeId)) &&
    (!filters.overdueOnly || (ticket.status !== 'closed' && Boolean(ticket.dueAt) && Date.parse(ticket.dueAt!) < now)) &&
    (!date || ((!filters.from || date >= filters.from) && (!filters.to || date <= filters.to)));
}

function sortTickets(tickets: Ticket[], sort: TicketFilters['sort']) {
  const recent = (a: Ticket, b: Ticket) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || Number(b.id) - Number(a.id);
  const ranks = { high: 0, normal: 1, low: 2 };
  return tickets.sort((a, b) => sort === 'updated_asc' ? -recent(a, b) : sort === 'priority_desc' ? ranks[a.priority] - ranks[b.priority] || recent(a, b) : sort === 'due_asc' ?
    Number(!a.dueAt) - Number(!b.dueAt) || String(a.dueAt || '').localeCompare(String(b.dueAt || '')) || recent(a, b) : recent(a, b));
}

// Keep raw server pages and their frozen queue ordinals separate from local
// changes. Every column records the revision its fresh snapshot incorporates.
export function projectTicketColumn<T extends { tickets: Ticket[]; total: number; revision: number }>(column: T, queue: string, changes: TicketChange[], filters: TicketFilters, freshTickets = new Map<string, Ticket>(), rawQueues = new Map(column.tickets.map(ticket => [String(ticket.id), queue]))): T {
  let total = column.total;
  const tickets = new Map(column.tickets.map(ticket => [String(ticket.id), ticket]));
  const queryKey = ticketQueryKey(filters);
  const latest = new Map<string, TicketChange>();
  const projectedIds = new Set<string>();
  for (const change of changes) {
    if (change.queryKey !== queryKey) continue;
    const id = String((change.ticket || change.previous)!.id);
    const before = change.previous && matchesTicketFilters(change.previous, filters) && ticketQueue(change.previous) === queue;
    const after = change.ticket && matchesTicketFilters(change.ticket, filters) && ticketQueue(change.ticket) === queue;
    if (change.revision > column.revision) {
      const inSource = !projectedIds.has(id) && rawQueues.has(id) ? rawQueues.get(id) === queue : before;
      total += Number(Boolean(after)) - Number(Boolean(inSource));
      projectedIds.add(id);
    }
    latest.set(id, change);
  }
  for (const [id, change] of latest) {
    if (change.revision <= column.revision && change.retain === false) continue;
    const ticket = change.revision <= column.revision ? freshTickets.get(id) || null : change.ticket;
    if (change.revision <= column.revision && rawQueues.has(id)) {
      const after = ticket && matchesTicketFilters(ticket, filters) && ticketQueue(ticket) === queue;
      total += Number(Boolean(after)) - Number(rawQueues.get(id) === queue);
    }
    // Confirmed changes stay visible beyond the destination's loaded page, but
    // a fresh authorized server row always wins over an older local copy.
    tickets.delete(id);
    if (ticket && matchesTicketFilters(ticket, filters) && ticketQueue(ticket) === queue) tickets.set(id, ticket);
  }
  return { ...column, tickets: sortTickets([...tickets.values()], filters.sort), total: Math.max(0, total) };
}

export function changeTicketFacets(facets: TicketFacets, previous: Ticket | null, ticket: Ticket | null, filters: TicketFilters, includeStatus = false) {
  const next = { byStatus: { ...facets.byStatus }, overdue: facets.overdue };
  for (const [item, delta] of [[previous, -1], [ticket, 1]] as const) {
    if (!item || !matchesTicketFilters(item, filters, includeStatus)) continue;
    next.byStatus[item.status] = Math.max(0, next.byStatus[item.status] + delta);
    if (item.status !== 'closed' && item.dueAt && Date.parse(item.dueAt) < Date.now()) next.overdue = Math.max(0, next.overdue + delta);
  }
  return next;
}
