import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { getTicketReviewLink, parseInboxOptions, reviewPath } from '../functions/_lib/project-change-request-inbox.js';
import { onRequest } from '../functions/api/projects/[slug]/change-requests/inbox.js';

const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/0020_project_change_requests.sql', import.meta.url), 'utf8');
function fixture(t, role = 'editor') {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(schema);
  db.exec(migration);
  db.exec(`
    INSERT INTO organizations (id,name,slug,dropbox_root_path) VALUES (1,'Org A','a','/a'),(2,'Org B','b','/b');
    INSERT INTO users (id,email,name,role,password_hash) VALUES (1,'editor@test','Editor','${role}','x'),(2,'viewer@test','Viewer','viewer','x');
    INSERT INTO organization_users (organization_id,user_id,access_level) VALUES (1,1,'editor'),(1,2,'viewer');
    INSERT INTO projects (id,name,slug,organization_id,dropbox_root_path) VALUES (10,'Mapa','mapa',1,'/a/mapa'),(20,'Outro','outro',2,'/b/outro');
    INSERT INTO user_projects (user_id,project_id,access_level) VALUES (1,10,'editor'),(2,10,'viewer');
    INSERT INTO organization_tickets (id,organization_id,code,subject,description,created_by) VALUES
      (100,1,'TKT-1','Alterar mapa','Motivo',2),(200,2,'TKT-2','Outro mapa','Motivo',2);
    INSERT INTO project_change_requests (id,organization_id,project_id,requested_by_user_id,ticket_id,base_revision,status,reason,idempotency_key,submission_hash,created_at) VALUES
      ('cr-1',1,10,2,100,0,'submitted','Pedido 1','key1','hash1','2026-09-06 10:00:00'),
      ('cr-2',1,10,2,NULL,0,'approved','Pedido 2','key2','hash2','2026-09-06 10:00:00'),
      ('cr-3',1,10,2,NULL,0,'applied','Pedido 3','key3','hash3','2026-09-06 09:00:00'),
      ('cr-other',2,20,2,200,0,'submitted','Segredo','key4','hash4','2026-09-06 11:00:00');
    INSERT INTO project_change_operations (id,change_request_id,sequence,operation_type,operation_json) VALUES ('op-1','cr-1',0,'point.create','{"secret":"not-for-inbox"}');
  `);
  const token = 'inbox-test';
  db.prepare('INSERT INTO sessions (token_hash,user_id,active_organization_id,expires_at) VALUES (?,1,1,?)')
    .run(createHash('sha256').update(token).digest('hex'), '2099-01-01T00:00:00.000Z');
  const env = { DB: { prepare(sql) {
    const statement = db.prepare(sql);
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { return statement.run(...args); },
    };
  } } };
  const request = (query = '', authenticated = true) => new Request(`https://test/api/projects/mapa/change-requests/inbox${query}`, {
    headers: authenticated ? { Cookie: `maono_session=${token}` } : {},
  });
  return { db, env, request };
}

async function inbox(f, query = '', slug = 'mapa', authenticated = true) {
  return onRequest({ env: f.env, request: f.request(query, authenticated), params: { slug } });
}

test('Editor sees other requesters, stable pages and lightweight ticket metadata', async t => {
  const f = fixture(t);
  const first = await inbox(f, '?limit=1');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
  const a = await first.json();
  assert.deepEqual(a.items.map(x => x.id), ['cr-2']);
  assert.equal(a.pagination.hasMore, true);
  assert.equal(a.items[0].ticket, null);
  const b = await (await inbox(f, '?limit=1&page=2')).json();
  assert.equal(b.items[0].ticket.code, 'TKT-1');
  assert.equal(b.items[0].requesterName, 'Viewer');
  assert.equal(b.items[0].operationCount, 1);
  assert.equal(b.items[0].reviewUrl, '/projects/mapa/review/cr-1');
  assert.equal(b.pagination.hasMore, false);
  assert.doesNotMatch(JSON.stringify(b), /secret|operation_json|operations|config|Segredo/);
});

test('status filters include history and return empty pages', async t => {
  const f = fixture(t);
  const applied = await (await inbox(f, '?status=applied')).json();
  assert.deepEqual(applied.items.map(x => x.id), ['cr-3']);
  const all = await (await inbox(f, '?status=all')).json();
  assert.equal(all.items.length, 3);
  const empty = await (await inbox(f, '?status=rejected')).json();
  assert.deepEqual(empty.items, []);
});

test('unauthenticated, Viewer and another organization cannot access inbox', async t => {
  const f = fixture(t, 'viewer');
  assert.equal((await inbox(f, '', 'mapa', false)).status, 401);
  assert.equal((await inbox(f)).status, 403);
  assert.equal((await inbox(f, '', 'outro')).status, 404);
  assert.equal(await getTicketReviewLink(f.env, f.request(), 1, 100), null);
});

test('ticket link uses stored relation and checks project access', async t => {
  const f = fixture(t);
  assert.deepEqual(await getTicketReviewLink(f.env, f.request(), 1, 100), {
    id: 'cr-1', status: 'submitted', reviewUrl: '/projects/mapa/review/cr-1',
  });
  assert.equal(await getTicketReviewLink(f.env, f.request(), 1, 200), null);
  assert.equal(await getTicketReviewLink(f.env, f.request(), 2, 200), null);
  f.db.exec('DELETE FROM user_projects WHERE user_id = 1');
  assert.equal(await getTicketReviewLink(f.env, f.request(), 1, 100), null);
});

test('invalid options reject, links encode segments, writes reject', async t => {
  for (const query of ['?status=bogus', '?page=0', '?page=1.2', '?limit=101', '?limit=NaN']) {
    assert.throws(() => parseInboxOptions(new URL(`https://test/${query}`)), { code: 'CHANGE_REQUEST_INBOX_INVALID_OPTIONS' });
  }
  assert.equal(reviewPath('a/b', 'cr?x'), '/projects/a%2Fb/review/cr%3Fx');
  const f = fixture(t);
  assert.equal((await inbox(f, '?page=0')).status, 400);
  const response = await onRequest({ env: f.env, request: new Request('https://test', { method: 'POST' }), params: { slug: 'mapa' } });
  assert.equal(response.status, 405);
});

test('explicit edit denial blocks inbox and hides ticket Review', async t => {
  const f = fixture(t);
  f.db.exec("INSERT INTO user_permission_denials (user_id,organization_id,permission) VALUES (1,1,'project.map.edit')");
  assert.equal((await inbox(f)).status, 403);
  assert.equal(await getTicketReviewLink(f.env, f.request(), 1, 100), null);
});

test('regular tickets work before the change request migration', async t => {
  const f = fixture(t);
  f.db.exec('DROP TABLE project_change_operations; DROP TABLE project_change_requests;');
  assert.equal(await getTicketReviewLink(f.env, f.request(), 1, 100), null);
});
