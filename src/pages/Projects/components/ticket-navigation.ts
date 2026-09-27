import { DEFAULT_TICKET_FILTERS, type TicketFilters, type TicketViewMode } from "./ticket-types.ts";
const prefix = "cc_";
export function readTicketNavigation(url: string, organizationId: string) {
  const params = new URL(url).searchParams;
  const filters = { ...DEFAULT_TICKET_FILTERS };
  if (params.get('cc_org') !== organizationId) return { filters, view: 'list' as TicketViewMode, ticketId: null as string | null };
  filters.q = (params.get('cc_q') || '').slice(0,160);
  const status = params.get('cc_status'), priority = params.get('cc_priority'), sort = params.get('cc_sort');
  if (['new','open','in_progress','in_review','closed'].includes(status || '')) filters.status = status as TicketFilters['status'];
  if (['low','normal','high'].includes(priority || '')) filters.priority = priority as TicketFilters['priority'];
  if (['updated_desc','updated_asc','due_asc','priority_desc'].includes(sort || '')) filters.sort = sort as TicketFilters['sort'];
  const assignee = params.get('cc_assigneeId') || '';
  if (assignee === 'unassigned' || /^[1-9]\d*$/.test(assignee)) filters.assigneeId = assignee;
  for (const key of ['from','to'] as const) {
    const date = params.get(prefix + key) || '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date) filters[key] = date;
  }
  filters.overdueOnly = params.get('cc_overdueOnly') === '1';
  const view = params.get('cc_view');
  const ticket = params.get('cc_ticket');
  return { filters, view: (view === 'kanban' || view === 'calendar' ? view : 'list') as TicketViewMode, ticketId: ticket && /^[1-9]\d*$/.test(ticket) ? ticket : null };
}
export function ticketNavigationUrl(url: string, organizationId: string, filters: TicketFilters, view: TicketViewMode, ticketId: string | number | null) {
  const target = new URL(url);
  for (const key of [...target.searchParams.keys()]) if (key.startsWith(prefix)) target.searchParams.delete(key);
  target.searchParams.set('cc_org',organizationId);
  target.searchParams.set('cc_view',view);
  for (const [key,value] of Object.entries(filters)) {
    if (value && value !== DEFAULT_TICKET_FILTERS[key as keyof TicketFilters]) target.searchParams.set(prefix + key, value === true ? '1' : String(value));
  }
  if (ticketId) target.searchParams.set('cc_ticket',String(ticketId));
  return target.href;
}
export function ticketQueueAge(enteredAt?: string | null, now = Date.now()) {
  if (!enteredAt || !Number.isFinite(Date.parse(enteredAt))) return 'Início não observado';
  const hours = Math.max(0, Math.floor((now - Date.parse(enteredAt)) / 3600000));
  return hours < 24 ? `${hours} h na fila` : `${Math.floor(hours / 24)} d na fila`;
}
