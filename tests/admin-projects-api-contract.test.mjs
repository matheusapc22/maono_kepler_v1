import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { publicProjectLifecycle } from '../functions/_lib/project-lifecycle.js';

// Exercise the real handler, SQL construction and DTO with synthetic auth/D1.
// No connection to D1, Dropbox or Production is made by this harness.
const source = readFileSync(new URL('../functions/api/admin/projects/index.js', import.meta.url), 'utf8');
function harness({ status, rows = [] } = {}) {
  const reads = [], permissions = [];
  const env = { DB: { prepare(sql) { const entry = { sql, bindings: [] }; reads.push(entry); return { bind(...bindings) { entry.bindings = bindings; return this; }, async all() { return { results: rows }; } }; } } };
  const deps = {
    errorResponse: (message, status, code) => Response.json({ ok: false, error: { message, code } }, { status }),
    jsonResponse: data => Response.json(data), methodNotAllowed: () => new Response('', { status: 405 }),
    readJsonBody: () => { throw Error('Unexpected body'); }, requireSession: () => { throw Error('Unexpected session mutation path'); },
    requirePermission: async (_env, _request, permission, context) => { permissions.push({ permission, context }); if (status) throw Object.assign(new Error('Synthetic auth failure'), { status, code: status === 401 ? 'AUTH_SESSION_EXPIRED' : 'AUTH_PERMISSION_DENIED' }); },
    createProjectRecord: () => { throw Error('Unexpected write'); }, serializeProjectActor: (row, kind) => ({ name: row[`${kind}_by_name_snapshot`] || null }),
    logAudit: () => { throw Error('Unexpected write'); }, publicProjectLifecycle,
  };
  const code = source.replace(/import[\s\S]*?from\s+"[^"]+";/g, '').replace('export async function onRequest', 'async function onRequest');
  const handler = new Function(...Object.keys(deps), `${code}\nreturn onRequest;`)(...Object.values(deps));
  return { reads, permissions, run: path => handler({ env, request: new Request(`https://local.test${path}`) }) };
}

test('global response returns full DTO and explicit scope without invented paging metadata', async () => {
  const h = harness({ rows: [{ id: 1, name: 'Rascunho', slug: 'rascunho', organization_id: 2, organization_name: 'Org', active: 0, lifecycle_state: 'DRAFT', lifecycle_version: 1, metadata_version: 4, created_by_name_snapshot: 'Criador', updated_at: '2026-10-27 10:00:00', access_count: 0 }] });
  const response = await h.run('/api/admin/projects');
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.scope, 'global');
  assert.deepEqual(h.permissions, [{ permission: 'admin.panel.access', context: { scopeType: 'global' } }]);
  assert.equal(data.projects[0].lifecycle.state, 'DRAFT'); assert.equal(data.projects[0].active, false);
  assert.equal(data.projects[0].organization.id, 2); assert.equal(data.projects[0].metadataVersion, 4);
  assert.equal(data.projects[0].createdBy.name, 'Criador'); assert.equal(data.projects[0].accessCount, 0);
  assert.equal(data.total, undefined); assert.equal(data.pagination, undefined);
  assert.doesNotMatch(h.reads[0].sql, /LIMIT|OFFSET/);
});

test('organization filter retains contextual authorization and parameterized isolation', async () => {
  for (const key of ['organizationId', 'organization_id']) {
    const h = harness(); const data = await (await h.run(`/api/admin/projects?${key}=2`)).json();
    assert.equal(data.scope, 'organization'); assert.equal(data.organizationId, 2);
    assert.deepEqual(h.permissions[0].context, { organizationId: 2, scopeType: 'organization' });
    assert.match(h.reads[0].sql, /WHERE projects\.organization_id = \?/); assert.deepEqual(h.reads[0].bindings, [2]);
  }
});

test('invalid organization never widens scope or reads database', async () => {
  for (const value of ['', '0', '-1', '1.5', 'bad']) {
    const h = harness(); assert.equal((await h.run(`/api/admin/projects?organizationId=${value}`)).status, 400);
    assert.equal(h.reads.length, 0); assert.equal(h.permissions.length, 0);
  }
});

test('401 and 403 terminate before any inventory read', async () => {
  for (const status of [401, 403]) {
    const h = harness({ status }); const response = await h.run('/api/admin/projects?organizationId=2');
    assert.equal(response.status, status); assert.equal(h.reads.length, 0); assert.equal((await response.json()).ok, false);
  }
});
