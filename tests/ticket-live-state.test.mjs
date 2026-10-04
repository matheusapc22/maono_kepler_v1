import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { changeTicketFacets, matchesTicketFilters, projectTicketColumn, ticketQueryKey, ticketQueue } from '../src/pages/Projects/components/ticket-live-state.ts';

const filters = { q: '', status: '', priority: '', assigneeId: '', from: '', to: '', sort: 'updated_desc', overdueOnly: false };
const initial = { id: 1, organizationId: 1, code: 'CH-1', subject: 'Mapa especial', description: 'Dados _ 100%', status: 'new', priority: 'normal', assignedTo: null, dueAt: null, updatedAt: '2026-01-01', version: 1 };
const moved = { ...initial, status: 'in_progress' };
const saved = { ...moved, version: 2, updatedAt: '2026-10-04' };
const column = (tickets = [], total = tickets.length, revision = 0) => ({ tickets, total, revision, hasMore: total > tickets.length, pagination: { page: 2, snapshot: 'frozen', hasMore: true } });
const change = (previous, ticket, revision, query = filters, retain = true) => ({ previous, ticket, revision, queryKey: ticketQueryKey(query), retain });
const pending = change(initial, moved, 1);
const success = change(moved, saved, 2);
const project = (raw, queue, changes, query = filters, fresh) => projectTicketColumn(raw, queue, changes, query, fresh);

test('pending status moves immediately with source/destination totals and untouched server paging', () => {
  const source = column([initial], 26);
  const open = project(source, 'open', [pending]);
  const progress = project(column([], 18), 'in_progress', [pending]);
  assert.deepEqual(open.tickets, []); assert.equal(open.total, 25);
  assert.deepEqual(progress.tickets, [moved]); assert.equal(progress.total, 19);
  assert.equal(open.pagination, source.pagination); assert.deepEqual(source.tickets, [initial]);
});
test('success replaces optimistic payload without a second count delta', () => {
  const changes = [pending, success];
  assert.equal(project(column([initial], 26), 'open', changes).total, 25);
  const target = project(column([], 18), 'in_progress', changes);
  assert.equal(target.total, 19); assert.deepEqual(target.tickets, [saved]);
});
test('rollback affects only failed ID and preserves concurrent successful move', () => {
  const other = { ...initial, id: 2 }, otherMoved = { ...other, status: 'in_review' };
  const changes = [pending, change(other, otherMoved, 2), change(moved, initial, 3, filters, false)];
  assert.deepEqual(project(column([initial, other]), 'open', changes).tickets.map(t => t.id), [1]);
  assert.deepEqual(project(column(), 'in_progress', changes).tickets, []);
  assert.deepEqual(project(column(), 'in_review', changes).tickets, [otherMoved]);
});
test('stale frozen page content cannot restore moved card or duplicate a returned ID', () => {
  const source = column([initial, { ...initial, id: '1' }], 26);
  assert.equal(project(source, 'open', [pending, success]).tickets.length, 0);
  assert.equal(project(column([moved]), 'in_progress', [pending, success]).tickets.length, 1);
});
test('fresh snapshot absorbs deltas while a moved card stays visible beyond destination page', () => {
  assert.equal(project(column([], 25, 2), 'open', [pending, success]).total, 25);
  const target = project(column([], 19, 2), 'in_progress', [pending, success], filters, new Map([['1', saved]]));
  assert.equal(target.total, 19); assert.deepEqual(target.tickets, [saved]);
});
test('fresh canonical row wins over confirmed local copy, including another actor status', () => {
  const canonical = { ...saved, status: 'in_review', version: 3 };
  const fresh = new Map([['1', canonical]]);
  assert.equal(project(column([], 0, 2), 'in_progress', [pending, success], filters, fresh).tickets.length, 0);
  assert.deepEqual(project(column([canonical], 1, 2), 'in_review', [pending, success], filters, fresh).tickets, [canonical]);
});
test('failed stale ETag rollback stops pinning after authoritative reload', () => {
  const rollback = change(moved, initial, 2, filters, false);
  const canonical = { ...initial, status: 'closed', version: 3 };
  assert.deepEqual(project(column([], 0, 2), 'open', [pending, rollback]).tickets, []);
  assert.deepEqual(project(column([canonical], 1, 2), 'closed', [pending, rollback]).tickets, [canonical]);
});
test('403/404 tombstone removes source and optimistic target without resurrecting private rows', () => {
  const denied = change(moved, null, 2, filters, false);
  assert.deepEqual(project(column([initial]), 'open', [pending, denied]).tickets, []);
  assert.deepEqual(project(column(), 'in_progress', [pending, denied]).tickets, []);
});
test('status filter removes moved ticket instead of leaking it into excluded target', () => {
  const query = { ...filters, status: 'new' }, events = [change(initial, moved, 1, query)];
  assert.equal(project(column([initial]), 'open', events, query).total, 0);
  assert.equal(project(column(), 'in_progress', events, query).total, 0);
  assert.deepEqual(project(column(), 'in_progress', events, query).tickets, []);
});
test('events from old query do not inject cards after filter navigation', () => {
  assert.deepEqual(project(column(), 'in_progress', [pending, success], { ...filters, q: 'unrelated' }).tickets, []);
});
test('new to open changes label but preserves combined queue count', () => {
  const opened = { ...initial, status: 'open' };
  assert.equal(ticketQueue(initial), 'open');
  const result = project(column([initial], 30), 'open', [change(initial, opened, 1)]);
  assert.equal(result.total, 30); assert.deepEqual(result.tickets, [opened]);
});
test('created and drawer-updated tickets share projection with status movements', () => {
  const created = { ...initial, id: 2 };
  const renamed = { ...saved, subject: 'Assunto novo' };
  assert.deepEqual(project(column(), 'open', [change(null, created, 1)]).tickets, [created]);
  assert.deepEqual(project(column([initial]), 'in_progress', [change(initial, renamed, 1)]).tickets, [renamed]);
});
test('API-equivalent filters use literal per-field search and exact status', () => {
  for (const q of ['mapa', '_', '100%', 'CH-1']) assert.equal(matchesTicketFilters(initial, { ...filters, q }), true);
  assert.equal(matchesTicketFilters(initial, { ...filters, q: 'CH-1 Mapa' }), false);
  assert.equal(matchesTicketFilters(initial, { ...filters, status: 'open' }), false);
  assert.equal(matchesTicketFilters(initial, { ...filters, assigneeId: 'unassigned' }), true);
  assert.equal(matchesTicketFilters(initial, { ...filters, assigneeId: '2' }), false);
  assert.equal(matchesTicketFilters({ ...initial, assignedTo: { id: 2 } }, { ...filters, assigneeId: '2' }), true);
  assert.equal(matchesTicketFilters(initial, { ...filters, priority: 'high' }), false);
});
test('UTC date boundaries include undated and overdue excludes closed', () => {
  const query = { ...filters, from: '2026-10-01', to: '2026-10-01' };
  assert.equal(matchesTicketFilters(initial, query), true);
  for (const dueAt of ['2026-10-01T00:00:00.000Z', '2026-10-01T23:59:59.999Z']) assert.equal(matchesTicketFilters({ ...initial, dueAt }, query), true);
  assert.equal(matchesTicketFilters({ ...initial, dueAt: '2026-10-02T00:00:00.000Z' }, query), false);
  const overdue = { ...initial, dueAt: '2026-09-01T12:00:00.000Z' };
  assert.equal(matchesTicketFilters(overdue, { ...filters, overdueOnly: true }), true);
  assert.equal(matchesTicketFilters({ ...overdue, status: 'closed' }, { ...filters, overdueOnly: true }), false);
});
test('summary counts move synchronously and rollback restores them', () => {
  const facets = { byStatus: { new: 1, open: 0, in_progress: 0, in_review: 0, closed: 0 }, overdue: 0 };
  const optimistic = changeTicketFacets(facets, initial, moved, filters);
  assert.equal(optimistic.byStatus.new, 0); assert.equal(optimistic.byStatus.in_progress, 1);
  assert.deepEqual(changeTicketFacets(optimistic, moved, initial, filters), facets);
});
test('sort pins follow chosen order without mutating source rows', () => {
  const older = { ...initial, id: 2, status: 'in_progress', updatedAt: '2025-01-01', priority: 'high' };
  const raw = column([older]);
  assert.deepEqual(project(raw, 'in_progress', [success]).tickets.map(t => t.id), [1, 2]);
  const query = { ...filters, sort: 'updated_asc' };
  assert.deepEqual(project(raw, 'in_progress', [change(moved, saved, 1, query)], query).tickets.map(t => t.id), [2, 1]);
  assert.deepEqual(raw.tickets, [older]);
});

test('fresh snapshot never resurrects a retained pin absent from reauthorized rows', () => {
  assert.deepEqual(project(column([], 0, 2), 'in_progress', [pending, success]).tickets, []);
});

test('frozen loaded queue provenance wins over live status for source count deltas', () => {
  const external = { ...initial, status: 'in_progress' }, review = { ...external, status: 'in_review' };
  const events = [change(external, review, 1)];
  const origins = new Map([['1', 'open']]);
  assert.equal(projectTicketColumn(column([external]), 'open', events, filters, new Map(), origins).total, 0);
  assert.equal(projectTicketColumn(column([], 5), 'in_progress', events, filters, new Map(), origins).total, 5);
  assert.equal(projectTicketColumn(column([], 2), 'in_review', events, filters, new Map(), origins).total, 3);
});

test('canonical live status after snapshot freeze adjusts source and destination totals', () => {
  const canonical = { ...saved, status: 'in_review', version: 3 };
  const fresh = new Map([['1', canonical]]), origins = new Map([['1', 'in_progress']]);
  const events = [pending, success];
  const source = projectTicketColumn(column([canonical], 1, 2), 'in_progress', events, filters, fresh, origins);
  const target = projectTicketColumn(column([], 0, 2), 'in_review', events, filters, fresh, origins);
  assert.equal(source.tickets.length, 0); assert.equal(source.total, 0);
  assert.deepEqual(target.tickets, [canonical]); assert.equal(target.total, 1);
});

test('board receives a broad snapshot only when it belongs to its current filters', () => {
  const section = readFileSync(new URL('../src/pages/Projects/components/TicketsSection.tsx', import.meta.url), 'utf8');
  assert.match(section, /snapshotQueryKeyRef\.current = ticketQueryKey\(debouncedFilters\)/);
  assert.match(section, /snapshot=\{boardRefresh \|\| snapshotQueryKeyRef\.current !== ticketQueryKey\(debouncedFilters\) \? null : pagination\.snapshot\}/);
});
