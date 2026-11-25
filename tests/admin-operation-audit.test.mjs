import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createAdminAuditHandler } from '../functions/api/admin/audit/index.js';
import { createAuditOrganizationsHandler } from '../functions/api/admin/audit/organizations.js';
import { operationAuditQuery, readOperationAuditPage, readOperationAuditDetail, readAuditOrganizations, auditEventId, publicAuditEntry, auditTime } from '../functions/_lib/admin-operation-audit-reader.js';

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  let reads = 0;
  const DB = { prepare(sql) {
    reads++; let params = [];
    return { bind(...values) { params = values; return this; }, async all() { return { results: sqlite.prepare(sql).all(...params) }; }, async first() { return sqlite.prepare(sql).get(...params) || null; } };
  } };
  const env = { DB, ADMIN_AUDIT_OPERATIONS_V1: 'true' };
  function frame(values = {}) {
    const row = { source: 'organization_management_operations', source_event_id: crypto.randomUUID(), operation_id: 'op-1', event_type: 'attempt_finished', outcome: 'succeeded',
      actor_id: 7, actor_name: 'Operadora registrada', original_actor_id: 7, original_actor_name: 'Operadora registrada', executor_kind: 'user', organization_id: 42,
      organization_name: 'Organização histórica', organization_slug: 'historica', category: 'organizations', action: 'organization.update', resource_type: 'organization', resource_id: '42', resource_label: 'Organização histórica',
      ui_route: '/admin', technical_origin: 'api:POST:/api/admin/organization-management/operations', occurred_at: '2026-11-25T15:00:00.000Z', ...values };
    return Number(sqlite.prepare(`INSERT INTO audit_operation_frames(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row)).lastInsertRowid);
  }
  function legacy(action = 'organization.update', details = '{}', time = '2026-11-25 15:00:00') {
    return Number(sqlite.prepare('INSERT INTO audit_logs(action,details,created_at) VALUES(?,?,?)').run(action, details, time).lastInsertRowid);
  }
  return { sqlite, env, frame, legacy, get reads() { return reads; } };
}
const request = (query = '', headers = {}) => new Request(`https://example.test/api/admin/audit${query}`, { headers: { 'X-Maono-Audit': 'operations-v1', ...headers } });

test('union cursor is stable across equal timestamps, namespaces and new insertions', async t => {
  const f = fixture(t), initial = new Set();
  for (let i = 0; i < 30; i++) { initial.add(`frame:${f.frame()}`); initial.add(`legacy:${f.legacy()}`); }
  let query = operationAuditQuery(request().url);
  const first = await readOperationAuditPage(f.env, query);
  assert.equal(first.entries.length, 25); assert.ok(first.nextBefore); assert.deepEqual(first.capabilities, { operations: true });
  f.frame({ occurred_at: '2026-11-25T16:00:00.000Z' }); f.legacy('organization.update', '{}', '2026-11-25 16:00:00');
  const collected = [...first.entries]; let next = first.nextBefore;
  while (next) { query = operationAuditQuery(request(`?before=${next}`).url); const page = await readOperationAuditPage(f.env, query); collected.push(...page.entries); next = page.nextBefore; }
  assert.equal(collected.length, 60); assert.equal(new Set(collected.map(row => row.id)).size, 60);
  assert.deepEqual(new Set(collected.map(row => row.id)), initial);
});

test('period is [from,to), organization and outcome filters execute server-side', async t => {
  const f = fixture(t);
  const expected = f.frame({ outcome: 'failed' });
  f.frame({ organization_id: 43, outcome: 'failed' });
  f.frame({ outcome: 'failed', occurred_at: '2026-11-26T03:00:00.000Z' });
  f.frame({ outcome: 'failed', occurred_at: '2026-11-25T02:59:59.000Z' });
  f.frame({ outcome: 'succeeded' });
  const page = await readOperationAuditPage(f.env, operationAuditQuery(request('?from=2026-11-25T03%3A00%3A00.000Z&to=2026-11-26T03%3A00%3A00.000Z&result=failed&organizationId=42').url));
  assert.deepEqual(page.entries.map(row => row.id), [`frame:${expected}`]);
  const noop = f.frame({ outcome: 'no_change' });
  assert.deepEqual((await readOperationAuditPage(f.env, operationAuditQuery(request('?result=noop').url))).entries.map(row => row.id), [`frame:${noop}`]);
});

test('cursor binds its filters; invalid parameters never become SQL or unbounded reads', async t => {
  const f = fixture(t);
  for (let i = 0; i < 30; i++) f.frame();
  const page = await readOperationAuditPage(f.env, operationAuditQuery(request('?organizationId=42').url));
  assert.throws(() => operationAuditQuery(request(`?before=${page.nextBefore}&organizationId=43`).url));
  for (const query of ['?from=2026-02-31T00:00:00.000Z', '?from=tomorrow', '?from=2026-11-26T00:00:00.000Z&to=2026-11-25T00:00:00.000Z', '?to=', '?result=success', '?organizationId=01', '?organizationId=9007199254740992', '?organizationId=42%20OR%201=1', '?limit=1000', '?before=anything', '?result=failed&result=succeeded']) {
    assert.throws(() => operationAuditQuery(request(query).url), query);
  }
  for (const id of ['frame:0', 'frame:01', 'legacy:9007199254740992', 'other:4', 'frame:1 OR 1=1']) assert.throws(() => auditEventId(id));
});

test('legacy success remains unproven; only explicit authorization phase is known', async t => {
  const f = fixture(t);
  f.legacy('organization.update', JSON.stringify({ organizationId: 42, resourceType: 'organization', resourceId: 42, result: 'success', metadata: { token: 'PRIVATE_SECRET', uiRoute: '/admin' }, userAgent: 'PRIVATE_HEADER' }));
  f.legacy('organization.update', JSON.stringify({ auditVersion: 2, phase: 'authorization', result: 'authorized' }));
  f.legacy('organization.update', JSON.stringify({ auditVersion: 2, phase: 'authorization', result: 'denied' }));
  f.legacy('PRIVATE_RAW_ACTION', '{invalid:PRIVATE_RAW_BODY');
  const { entries } = await readOperationAuditPage(f.env, operationAuditQuery(request().url));
  assert.deepEqual(entries.map(row => row.result), ['legacy_unproven', 'denied', 'authorized', 'legacy_unproven']);
  const old = entries.at(-1);
  assert.deepEqual(old.organization, { id: 42, name: null, slug: null });
  assert.deepEqual(old.actor, { id: null, name: null, kind: 'unrecorded' });
  assert.equal(old.route, null); assert.equal(old.summary, 'Resultado não comprovado no registro legado.');
  assert.doesNotMatch(JSON.stringify(entries), /PRIVATE|token|userAgent/);
});

test('projection and detail expose allowlisted changes and correlated immutable attempts only', async t => {
  const f = fixture(t);
  const start = f.frame({ attempt_id: 'try-a', event_type: 'attempt_started', outcome: 'running', occurred_at: '2026-11-25T15:00:00.000Z' });
  const finish = f.frame({ attempt_id: 'try-a', outcome: 'failed', code: 'ORGANIZATION_VERSION_CONFLICT', occurred_at: '2026-11-25T15:01:00.000Z',
    before_json: JSON.stringify({ name: 'Antes', token: 'PRIVATE_SECRET', headers: 'PRIVATE_HEADER' }), after_json: JSON.stringify({ name: 'Depois', password: 'PRIVATE_PASSWORD' }),
    details_json: JSON.stringify({ error: 'PRIVATE_SQL', request: { token: 'PRIVATE_TOKEN' } }) });
  f.frame({ operation_id: 'another-operation', attempt_id: 'other-try', details_json: JSON.stringify({ token: 'PRIVATE_OTHER' }) });
  const actions = [{ kind: 'query', enabled: true, operationId: 'op-1' }];
  let observed;
  const detail = await readOperationAuditDetail(f.env, `frame:${finish}`, { id: 7, role: 'super_admin' }, async (_env, actor, row) => { observed = { actor, row }; return actions; });
  assert.equal(observed.row.id, finish); assert.equal(observed.actor.id, 7);
  assert.deepEqual(detail.changes, [{ field: 'Nome', before: 'Antes', after: 'Depois' }]);
  assert.deepEqual(detail.actions, actions); assert.equal(detail.attempts.length, 1);
  assert.deepEqual(detail.attempts[0].stages.map(row => row.id), [`frame:${start}`, `frame:${finish}`]);
  assert.equal(detail.attempts[0].startedAt, '2026-11-25T15:00:00.000Z'); assert.equal(detail.attempts[0].endedAt, '2026-11-25T15:01:00.000Z');
  assert.equal(detail.technical.code, 'ORGANIZATION_VERSION_CONFLICT');
  assert.doesNotMatch(JSON.stringify(detail), /PRIVATE|password|token|headers/);
  assert.throws(() => f.sqlite.prepare('UPDATE audit_operation_frames SET outcome=? WHERE id=?').run('succeeded', finish), /APPEND_ONLY/);
  assert.throws(() => f.sqlite.prepare('DELETE FROM audit_operation_frames WHERE id=?').run(finish), /APPEND_ONLY/);
  const old = f.legacy('organization.update', '{}');
  assert.deepEqual((await readOperationAuditDetail(f.env, `legacy:${old}`, { id: 7 }, () => { throw new Error('No legacy retry'); })).actions, []);
});

test('historical facets include deleted organizations without joining current business rows', async t => {
  const f = fixture(t);
  f.frame({ organization_name: 'Nome anterior', organization_slug: 'org-excluida' });
  f.frame({ organization_name: 'Nome registrado depois', organization_slug: 'org-excluida' });
  f.legacy('organization.update', JSON.stringify({ organizationId: 99 }));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organizations WHERE id=42').get().n, 0);
  assert.deepEqual((await readAuditOrganizations(f.env, 'Nome anterior')).organizations, [{ id: 42, name: 'Nome registrado depois', slug: 'org-excluida' }]);
  assert.deepEqual((await readAuditOrganizations(f.env, '99')).organizations, [{ id: 99, name: null, slug: null }]);
  assert.deepEqual((await readAuditOrganizations(f.env, '%')).organizations, []);
  const response = await createAuditOrganizationsHandler(async () => ({ id: 7, role: 'super_admin' }))({ env: f.env, request: new Request('https://example.test/api/admin/audit/organizations?search=org-excluida') });
  assert.equal(response.status, 200); assert.equal((await response.json()).organizations.length, 1);
});

test('authentication precedes queries and feature/schema failures never become an empty success', async t => {
  const f = fixture(t);
  for (const role of ['owner', 'admin', 'viewer', 'system', null]) {
    const before = f.reads;
    assert.equal((await createAdminAuditHandler(async () => ({ role }))({ env: f.env, request: request() })).status, 403);
    assert.equal(f.reads, before);
  }
  f.frame();
  const handler = createAdminAuditHandler(async () => ({ id: 7, role: 'super_admin' }));
  f.env.ADMIN_AUDIT_OPERATIONS_V1 = 'false';
  assert.equal((await handler({ env: f.env, request: request() })).status, 503);
  // Deployed legacy clients negotiate no new header and continue reading the old contract.
  const legacy = await handler({ env: f.env, request: new Request('https://example.test/api/admin/audit') });
  assert.deepEqual(await legacy.json(), { ok: true, entries: [], nextBefore: null });
  f.env.ADMIN_AUDIT_OPERATIONS_V1 = 'true';
  f.sqlite.exec('DROP TRIGGER audit_frames_no_delete');
  const response = await handler({ env: f.env, request: request() });
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /entries|sqlite|SELECT/);
});

test('invalid dates, routes, unknown actor and technical strings are never reconstructed', () => {
  const entry = publicAuditEntry({ row_source: 'frame', id: 1, action: 'PRIVATE_ACTION', outcome: 'unknown', executor_kind: 'unknown', occurred_at: '2026-02-31 12:00:00', ui_route: '/admin?token=PRIVATE_SECRET', technical_origin: 'PRIVATE_SECRET', resource_type: 'PRIVATE_TYPE', resource_id: '/PRIVATE_FILE' });
  assert.equal(entry.createdAt, null); assert.equal(entry.route, null); assert.equal(entry.origin, null); assert.equal(entry.actor.kind, 'unrecorded');
  assert.doesNotMatch(JSON.stringify(entry), /PRIVATE/);
  assert.equal(auditTime('2026-11-25 12:00:00'), '2026-11-25T12:00:00.000Z');
});
