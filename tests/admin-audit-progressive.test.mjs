import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createAdminAuditHandler } from '../functions/api/admin/audit/index.js';
import { auditCursor, readAdminAuditPage } from '../functions/_lib/admin-audit-reader.js';
import { parseAuditPage } from '../src/pages/Admin/components/admin-audit-model.ts';
import { restoreApprovedAdminWorkspace, adminWorkspaceBaseline } from './helpers/admin-workspace-preservation.mjs';

function database(rows, fail = false) {
  const calls = [];
  return { calls, prepare(sql) { calls.push({ sql, params: [] }); const q = { bind(...params) { calls.at(-1).params = params; return q; }, async all() { if (fail) throw new Error('PRIVATE_DATABASE_SECRET'); return { results: rows }; } }; return q; } };
}
const request = (query = '', method = 'GET') => new Request(`https://example.test/api/admin/audit${query}`, { method });
const rows = Array.from({ length: 26 }, (_, i) => ({ id: 100 - i, action: i === 0 ? 'ticket.created' : 'PRIVATE_CREDENTIAL', created_at: '2026-10-27 12:00:00', user_id: 9, project_id: 4, details: '{"token":"PRIVATE_SECRET"}' }));

test('audit is GET-only and authenticates before reading any records', async () => {
  for (const role of ['viewer', 'editor', 'owner', 'admin', null]) {
    const db = database(rows);
    const response = await createAdminAuditHandler(async () => ({ role }))({ request: request(), env: { DB: db } });
    assert.equal(response.status, 403); assert.equal(db.calls.length, 0);
  }
  const db = database(rows);
  const denied = createAdminAuditHandler(async () => { throw Object.assign(new Error('private'), { status: 401 }); });
  assert.equal((await denied({ request: request(), env: { DB: db } })).status, 401);
  assert.equal((await denied({ request: request('', 'POST'), env: { DB: db } })).status, 405);
  assert.equal(db.calls.length, 0);
});

test('bounded projection omits raw actions, details, identities and inferred organizations', async () => {
  const db = database(rows);
  const response = await createAdminAuditHandler(async () => ({ role: 'super_admin' }))({ request: request(), env: { DB: db } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Cookie');
  assert.equal(body.entries.length, 25); assert.equal(body.nextBefore, 76);
  assert.deepEqual(body.entries[0], { id: 100, event: 'ticket_create', createdAt: '2026-10-27T12:00:00.000Z' });
  assert.equal(body.entries[1].event, 'other');
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE|user_id|project_id|details|organization/);
  assert.equal(db.calls[0].sql, 'SELECT id, action, created_at FROM audit_logs ORDER BY id DESC LIMIT 26');
  assert.deepEqual(parseAuditPage(body).entries, body.entries);
  const nextDb = database(rows.slice(25));
  await readAdminAuditPage(nextDb, 76);
  assert.deepEqual(nextDb.calls[0].params, [76]);
  assert.match(nextDb.calls[0].sql, /WHERE id < \? ORDER BY id DESC LIMIT 26/);
});

test('invalid cursors and unsupported filters cannot broaden the global query', async () => {
  for (const query of ['?before=0', '?before=-1', '?before=1e2', '?before=01', '?before=9007199254740992', '?before=1&before=2', '?organizationId=1', '?limit=999999', '?before=1%20OR%201=1']) {
    assert.throws(() => auditCursor(request(query).url));
    const db = database(rows);
    assert.equal((await createAdminAuditHandler(async () => ({ role: 'super_admin' }))({ request: request(query), env: { DB: db } })).status, 400);
    assert.equal(db.calls.length, 0);
  }
});

test('schema/read errors are unavailable, and invalid timestamps have no fabricated dates', async () => {
  const response = await createAdminAuditHandler(async () => ({ role: 'super_admin' }))({ request: request(), env: { DB: database([], true) } });
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE|entries/);
  const page = await readAdminAuditPage(database([{ id: 2, action: 'ticket.created', created_at: '2026-02-31 12:00:00' }, { id: 1, action: 'anything', created_at: '<private>' }]), null);
  assert.ok(page.entries.every(entry => entry.createdAt === null));
  assert.deepEqual(await readAdminAuditPage(database([]), null), { entries: [], nextBefore: null });
  await assert.rejects(readAdminAuditPage(database([{ id: 1 }, { id: 2 }]), null));
  await assert.rejects(readAdminAuditPage(database([{ id: 76 }]), 76));
});

test('client validation rejects oversized/invalid pages and never echoes unknown event text', () => {
  assert.throws(() => parseAuditPage({ ok: true, entries: rows, nextBefore: 76 }));
  assert.throws(() => parseAuditPage({ ok: false, entries: [], nextBefore: null }));
  assert.throws(() => parseAuditPage({ ok: true, entries: [{ id: 1 }], nextBefore: 12 }));
  assert.deepEqual(parseAuditPage({ ok: true, entries: [{ id: 1, event: '<SECRET>', createdAt: 'PRIVATE' }], nextBefore: null }), { entries: [{ id: 1, event: 'other', createdAt: null }], nextBefore: null });
});

test('audit extraction retains exact historical gates and aborts scoped reads', () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const source = read('src/pages/Admin.tsx');
  assert.equal(createHash('sha256').update(restoreApprovedAdminWorkspace('src/pages/Admin.tsx', source)).digest('hex'), adminWorkspaceBaseline);
  assert.throws(() => restoreApprovedAdminWorkspace('src/pages/Admin.tsx', source.replace('sessionAvailable={!error}', 'sessionAvailable={true}')));
  const component = read('src/pages/Admin/components/AdminAudit.tsx');
  assert.match(component, /controller.signal.aborted/); assert.match(component, /return \(\) => controller.abort\(\)/);
  assert.match(component, /\[401, 403, 404\].includes\(status\)/);
  assert.doesNotMatch(component, /localStorage|sessionStorage|setInterval|dangerouslySetInnerHTML/);
});
