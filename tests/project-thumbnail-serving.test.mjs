import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import * as http from '../functions/_lib/http.js';
import * as preview from '../functions/_lib/project-preview.js';
import * as pngTools from '../functions/_lib/project-preview-png.js';
import * as payload from '../functions/_lib/project-preview-payload.js';
import * as operations from '../functions/_lib/project-preview-operations.js';
import { png as makePng } from './helpers/project-preview-fixture.mjs';
import * as dropbox from '../functions/_lib/dropbox.js';
import { uploadLocalStorageFile } from '../functions/_lib/local-storage.js';
import { reconcileLegacyProjectLifecycle } from '../functions/_lib/project-lifecycle-reconciler.js';

const thumbnailSource = await readFile(new URL('../functions/api/projects/[slug]/thumbnail/index.js', import.meta.url), 'utf8');
const reconcileSource = await readFile(new URL('../functions/api/admin/project-previews/reconcile.js', import.meta.url), 'utf8');
const png = makePng();

// Execute each complete endpoint with its real helpers/storage. Only session, ACL,
// audit and explicitly injected failure/concurrency boundaries are substituted.
function endpoint(source, dependencies, extra = '') {
  const executable = source.replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, '').replace(/^export /gm, '');
  return Function(...Object.keys(dependencies), `${executable}\nreturn { onRequest${extra} };`)(...Object.values(dependencies));
}

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  if (!database.prepare("SELECT name FROM sqlite_master WHERE name='project_save_operation_schema'").get()) {
    database.exec(readFileSync(new URL('../migrations/0039_project_save_operations.sql', import.meta.url), 'utf8'));
  }
  database.exec(`
    CREATE TABLE local_storage_objects(path TEXT PRIMARY KEY,content BLOB NOT NULL,content_type TEXT,size_bytes INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id,email,name,role,password_hash) VALUES(10,'synthetic@offline.invalid','Synthetic admin','super_admin','not-a-login');
    INSERT INTO organizations(id,name,slug,dropbox_root_path,storage_status) VALUES(7,'Synthetic','synthetic','/fixture','READY');
    INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(7,10,'owner');
    INSERT INTO projects(id,name,slug,organization_id,dropbox_root_path,active) VALUES(1,'Example','example',7,'/fixture',1);
    INSERT INTO user_projects(user_id,project_id,access_level) VALUES(10,1,'owner');
  `);
  const env = { APP_ENV: 'local', STORAGE_DRIVER: 'local-d1', PROJECT_DURABLE_SAVE_V1:'true', DB: { batch(statements) { database.exec('BEGIN IMMEDIATE'); try { const result=statements.map(statement=>statement.run()); database.exec('COMMIT'); return result; } catch(error) { database.exec('ROLLBACK'); throw error; } }, prepare(sql) {
    const statement = database.prepare(sql); let args = [];
    return { bind(...values) { args = values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this; },
      first() { return statement.get(...args) ?? null; }, run() { return statement.run(...args); }, all() { return { results: statement.all(...args) }; } };
  } } };
  const project = () => database.prepare('SELECT * FROM projects WHERE id = 1').get();
  const state = () => { const row = project(); return { config_revision: row.config_revision, preview_status: row.preview_status, preview_revision: row.preview_revision }; };
  const setState = (status, configRevision, previewRevision = null) => database.prepare('UPDATE projects SET preview_status = ?, config_revision = ?, preview_revision = ? WHERE id = 1').run(status, configRevision, previewRevision);
  const put = (name, bytes = png) => uploadLocalStorageFile(env, '/fixture', name, bytes, name.endsWith('.png') ? 'image/png' : 'application/json');
  const dependencies = { ...http, ...preview, ...dropbox, ...pngTools, ...payload, ...operations, requireSession: async () => ({ id: 10, role: 'super_admin' }), getAuthorizedProject: async () => project(), requireProjectPermission: async () => {}, recordAuditLog: async () => {}, getActiveOrganizationId: () => 7 };
  const get = (version = '0', overrides = {}) => endpoint(thumbnailSource, { ...dependencies, ...overrides }).onRequest({ env, params: { slug: 'example' }, request: new Request(`https://fixture.invalid/api/projects/example/thumbnail${version === null ? '' : `?v=${version}`}`) });
  const reconcile = (overrides = {}) => endpoint(reconcileSource, { ...dependencies, ...overrides }).onRequest({ env, request: new Request('https://fixture.invalid/api/admin/project-previews/reconcile', { method: 'POST', body: '{}' }) });
  return { database, env, project, state, setState, put, dependencies, get, reconcile };
}

async function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).error.code, code);
}

function providerError(status, code = 'DROPBOX_PATH_NOT_FOUND') {
  return Object.assign(new Error('path/not_found from synthetic provider'), { status, code });
}

test('legacy lifecycle reconciliation keeps the canonical preview readable on repeated GETs as revision zero', async () => {
  const f = fixture();
  await f.put('config.kepler.json', new TextEncoder().encode('{"version":"v1","config":{},"datasets":[]}'));
  await f.put('config.kepler.png');
  await reconcileLegacyProjectLifecycle(f.env, f.project(), { actorUserId: 10, transitionId: 'synthetic' });
  assert.deepEqual(f.state(), { config_revision: 1, preview_status: 'UNKNOWN', preview_revision: null });
  for (let i = 0; i < 2; i++) {
    const response = await f.get('0');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Maono-Thumbnail-Revision'), '0');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
    assert.deepEqual(f.state(), { config_revision: 1, preview_status: 'UNKNOWN', preview_revision: null });
  }
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM local_storage_objects WHERE path LIKE '%.png'").get().count, 1);
});

test('legacy UNKNOWN requested as a positive revision never returns canonical bytes under that revision', async () => {
  const f = fixture(); f.setState('UNKNOWN', 3); await f.put('config.kepler.png');
  const response = await f.get('3');
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, 'PROJECT_THUMBNAIL_REVISION_NOT_FOUND');
  assert.equal(body.error.details.thumbnailRevision, 0);
  assert.deepEqual(f.state(), { config_revision: 3, preview_status: 'UNKNOWN', preview_revision: null });
});

test('absent revisions remain distinct from the explicit legacy revision zero', () => {
  for (const value of [null, undefined, '', ' ']) assert.equal(preview.normalizePreviewRevision(value), null);
  assert.equal(preview.normalizePreviewRevision(0), 0);
  assert.equal(preview.normalizePreviewRevision('0'), 0);
  assert.equal(preview.normalizePreviewRevision(0, { allowZero: false }), null);
});

test('READY revisioned images do not silently fall back to a canonical legacy file', async () => {
  const f = fixture(); f.setState('READY', 3, 3); await f.put('config.kepler.png');
  await assertError(await f.get('3'), 404, 'PROJECT_THUMBNAIL_NOT_FOUND');
  assert.equal(f.state().preview_status, 'READY');
});

test('unversioned reads are not immutable cached', async () => {
  const f = fixture(); f.setState('READY', 1, 1); await f.put('config.kepler.r1.png');
  const response = await f.get(null); assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-cache');
});

test('a late missing old revision cannot mark a newer READY preview MISSING', async () => {
  const f = fixture(); f.setState('READY', 1, 1);
  const response = await f.get('1', { downloadDropboxBinaryFile: async () => { f.setState('READY', 2, 2); await f.put('config.kepler.r2.png'); throw providerError(409); } });
  await assertError(response, 404, 'PROJECT_THUMBNAIL_NOT_FOUND');
  assert.deepEqual(f.state(), { config_revision: 2, preview_status: 'READY', preview_revision: 2 });
});

test('missing compare-and-swap also protects a changed preview within the same config revision', async () => {
  const f = fixture(); f.setState('READY', 2, 1);
  await f.get('1', { downloadDropboxBinaryFile: async () => { f.setState('READY', 2, 2); throw providerError(409); } });
  assert.deepEqual(f.state(), { config_revision: 2, preview_status: 'READY', preview_revision: 2 });
});

test('a late missing UNKNOWN read cannot overwrite an unchanged status on a newer config', async () => {
  const f = fixture(); f.setState('UNKNOWN', 1);
  await f.get('0', { downloadDropboxBinaryFile: async () => { f.setState('UNKNOWN', 2); throw providerError(409); } });
  assert.deepEqual(f.state(), { config_revision: 2, preview_status: 'UNKNOWN', preview_revision: null });
});

test('a successful late legacy read cannot replace a concurrently published revision or return its stale bytes', async () => {
  const f = fixture(); f.setState('UNKNOWN', 1);
  await assertError(await f.get('0', { downloadDropboxBinaryFile: async () => { f.setState('READY', 1, 1); return new Response(png); } }), 404, 'PROJECT_THUMBNAIL_REVISION_NOT_FOUND');
  assert.deepEqual(f.state(), { config_revision: 1, preview_status: 'READY', preview_revision: 1 });
});

test('legacy ready compare-and-swap also protects a newer config with the same UNKNOWN status', async () => {
  const f = fixture(); f.setState('UNKNOWN', 1);
  await assertError(await f.get('0', { downloadDropboxBinaryFile: async () => { f.setState('UNKNOWN', 2); return new Response(png); } }), 404, 'PROJECT_THUMBNAIL_REVISION_NOT_FOUND');
  assert.deepEqual(f.state(), { config_revision: 2, preview_status: 'UNKNOWN', preview_revision: null });
});

test('two readonly readers retain the same legacy identity without reconciling metadata', async () => {
  const f = fixture(); f.setState('UNKNOWN', 1); await f.put('config.kepler.png');
  const responses = await Promise.all([f.get('0'), f.get('0')]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  assert.deepEqual(f.state(), { config_revision: 1, preview_status: 'UNKNOWN', preview_revision: null });
});

test('FAILED serves the exact persisted prior revision, including legacy zero, without changing failure state', async () => {
  for (const revision of [0, 1]) {
    const f = fixture(); f.setState('FAILED', 2, revision); await f.put(revision === 0 ? 'config.kepler.png' : 'config.kepler.r1.png');
    const response = await f.get(String(revision)); assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Maono-Thumbnail-Revision'), String(revision));
    assert.equal(f.state().preview_status, 'FAILED');
    await assertError(await f.get('2'), 404, 'PROJECT_THUMBNAIL_REVISION_NOT_FOUND');
    await assertError(await f.get(null), 404, 'PROJECT_THUMBNAIL_NOT_READY');
  }
});

test('FAILED with no known previous revision does not assume null means legacy zero', async () => {
  const f = fixture(); f.setState('FAILED', 2); await f.put('config.kepler.png');
  await assertError(await f.get('0'), 404, 'PROJECT_THUMBNAIL_NOT_READY');
});

test('missing previous preview does not overwrite the newer FAILED generation state', async () => {
  const f = fixture(); f.setState('FAILED', 2, 1);
  await assertError(await f.get('1'), 404, 'PROJECT_THUMBNAIL_NOT_FOUND');
  assert.equal(f.state().preview_status, 'FAILED');
});

test('session/ACL errors stop before storage reads and preserve preview metadata', async () => {
  for (const status of [401, 403]) {
    const f = fixture(); f.setState('UNKNOWN', 1); let downloads = 0;
    const boundary = status === 401 ? 'requireSession' : 'requireProjectPermission';
    const response = await f.get('0', { [boundary]: async () => { throw providerError(status, 'FORBIDDEN'); }, downloadDropboxBinaryFile: async () => { downloads++; return new Response(png); } });
    assert.equal(response.status, status); assert.equal(downloads, 0); assert.equal(f.state().preview_status, 'UNKNOWN');
  }
});

test('storage auth, transient and generic errors never become MISSING even with misleading not_found text', async () => {
  for (const status of [401, 403, 429, 500, 502, 503]) {
    const f = fixture(); f.setState('UNKNOWN', 1);
    const response = await f.get('0', { downloadDropboxBinaryFile: async () => { throw providerError(status, 'DROPBOX_DOWNLOAD_FAILED'); } });
    assert.equal(response.status, status); assert.equal(f.state().preview_status, 'UNKNOWN');
  }
});

test('already MISSING rows are not silently recovered without an explicit repair', async () => {
  const f = fixture(); f.setState('MISSING', 1, 1); let downloads = 0;
  await assertError(await f.get('1', { downloadDropboxBinaryFile: async () => { downloads++; return new Response(png); } }), 404, 'PROJECT_THUMBNAIL_NOT_READY');
  assert.equal(downloads, 0);
});

test('admin inventory includes UNKNOWN and MISSING but performs no project or audit writes', async () => {
  const f = fixture(); f.setState('UNKNOWN', 1); await f.put('config.kepler.png');
  const before = f.project();
  const response = await f.reconcile(); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.ready, 1); assert.equal(body.dryRun, true);
  assert.equal(body.records[0].imageRevision, 0); assert.deepEqual(f.project(), before);
  f.setState('MISSING', 1, 0);
  const restored = await f.reconcile(); const inspected = await restored.json();
  assert.equal(inspected.ready, 1); assert.equal(inspected.records[0].classification, 'VERIFIED_PNG');
  assert.equal(f.state().preview_status, 'MISSING');
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n, 0);
});

test('admin storage errors do not become absence or modify UNKNOWN', async () => {
  const f = fixture(); f.setState('UNKNOWN', 1);
  const response = await f.reconcile({ getDropboxMetadata: async () => { throw providerError(503, 'DROPBOX_UNAVAILABLE'); } });
  const body = await response.json(); assert.equal(body.errors, 1); assert.equal(body.missing, 0); assert.equal(f.state().preview_status, 'UNKNOWN');
});

test('thumbnail route cannot delete old, fallback or late operation artifacts', () => {
  assert.doesNotMatch(thumbnailSource, /deleteDropboxPathIfExists|cleanupPreviousPreview/);
});
