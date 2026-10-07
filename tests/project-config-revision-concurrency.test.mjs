import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { acquireProjectSaveUpload, failProjectSaveUpload, markProjectSavePayloadStored, processProjectSaveOperation } from '../functions/_lib/project-save-operations.js';
import { readPublishedProjectConfig } from '../functions/_lib/project-config-service.js';
import { fixture, register, stored, artifact, process, count, localStorage, storeConfig } from './helpers/project-save-operation-fixture.mjs';

function seedOldCandidate(f, status = 'FAILED') {
  f.sqlite.prepare(`INSERT INTO project_config_revisions(project_id,revision,status,checksum_algorithm,checksum,storage_provider,storage_ref,
    schema_name,schema_version,size_bytes,content_type,transition_id,updated_at)
    VALUES(1,1,?,'sha256','old','dropbox','maono:project:1:revision:1','legacy-kepler',1,10,'application/json','old-attempt','2000-01-01 00:00:00')`).run(status);
}
function barrier() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('a failed legacy candidate can be replaced atomically without deleting its external object', async t => {
  const f = fixture(t); seedOldCandidate(f);
  const result = await process(f, await stored(f));
  assert.equal(result.state, 'PUBLISHED');
  const row = f.row('SELECT * FROM project_config_revisions');
  assert.equal(row.save_operation_id, result.id);
  assert.equal(row.storage_ref, result.storage_ref);
  assert.notEqual(row.storage_ref, 'maono:project:1:revision:1');
  assert.equal(count(f, 'project_config_revisions'), 1);
});
test('an old READY candidate is never reclaimed by timeout or blindly deleted', async t => {
  const f = fixture(t); seedOldCandidate(f, 'READY');
  const result = await process(f, await stored(f));
  assert.equal(result.state, 'FAILED_FINAL');
  assert.equal(result.error_code, 'PROJECT_SAVE_LEGACY_CANDIDATE_RECONCILIATION_REQUIRED');
  assert.equal(result.attempts, 1);
  assert.equal(f.project().config_revision, 0);
  assert.equal(f.row('SELECT storage_ref FROM project_config_revisions').storage_ref, 'maono:project:1:revision:1');
});
test('concurrent HEAD publication wins CAS without reclaiming its READY lineage', async t => {
  const f = fixture(t), operation = await stored(f);
  f.beforeBatch(db => db.exec("UPDATE projects SET config_revision=1,config_checksum='other' WHERE id=1"));
  const result = await process(f, operation);
  assert.equal(result.state, 'CONFLICT');
  assert.equal(result.error_code, 'PROJECT_CONFIG_REVISION_CONFLICT');
  assert.equal(result.receipt_json, null);
  assert.equal(f.project().config_checksum, 'other');
});
test('only one upload lease receives bytes when simultaneous callers use the same ID', async t => {
  const f = fixture(t), operation = await register(f);
  const results = await Promise.allSettled([acquireProjectSaveUpload(f.env, { operation }), acquireProjectSaveUpload(f.env, { operation })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected')[0].reason.code, 'PROJECT_SAVE_UPLOAD_BUSY');
  assert.equal(f.row('SELECT upload_epoch FROM project_save_operations').upload_epoch, 1);
});
test('a stale worker resuming after lease takeover cannot publish or roll back the new owner', async t => {
  const f = fixture(t), operation = await stored(f), entered = barrier(), release = barrier();
  const slow = process(f, operation, { verifyPayload: async (_env, { operation }) => { entered.resolve(); await release.promise; return { ...artifact(operation), storageRef: operation.storage_ref }; } });
  await entered.promise;
  f.sqlite.exec('UPDATE project_save_operations SET lease_until=0');
  const replacement = await process(f, operation);
  assert.equal(replacement.state, 'PUBLISHED');
  release.resolve();
  const late = await slow;
  assert.equal(late.state, 'PUBLISHED');
  assert.equal(late.receipt_json, replacement.receipt_json);
  assert.equal(count(f, 'project_config_revisions'), 1);
});
test('a delayed uploader failure cannot finalize or release a newer upload lease', async t => {
  const f = fixture(t), old = await acquireProjectSaveUpload(f.env, { operation: await register(f) });
  await failProjectSaveUpload(f.env, { operation: old, error: new Error('interruption') });
  const fresh = await acquireProjectSaveUpload(f.env, { operation: old, recoverPayload: async () => null });
  await failProjectSaveUpload(f.env, { operation: old, error: Object.assign(new Error('old checksum'), { status: 422, code: 'PROJECT_SAVE_PAYLOAD_INTEGRITY_FAILED' }) });
  const row = f.row('SELECT * FROM project_save_operations');
  assert.equal(row.state, 'RECEIVING');
  assert.equal(row.lease_epoch, fresh.lease_epoch);
  await assert.rejects(markProjectSavePayloadStored(f.env, { operation: old, artifact: artifact(old) }), /CHECK constraint/);
});
test('same bytes with distinct operation IDs do not silently rebase onto a later revision', async t => {
  const f = fixture(t), first = await stored(f), second = await stored(f, 'same-content-new-id');
  assert.equal((await process(f, first)).state, 'PUBLISHED');
  assert.equal((await process(f, second)).state, 'CONFLICT');
  assert.equal(f.project().config_revision, 1);
});
test('old READY and failure callbacks cannot change a durable published revision', async t => {
  const f = fixture(t), operation = await process(f, await stored(f));
  assert.throws(() => f.sqlite.exec("UPDATE project_config_revisions SET storage_provider_version='late-old-version'"), /REVISION_IMMUTABLE/);
  assert.throws(() => f.sqlite.exec("UPDATE project_config_revisions SET status='FAILED'"), /REVISION_IMMUTABLE/);
  assert.throws(() => f.sqlite.exec('DELETE FROM project_config_revisions'), /REVISION_IMMUTABLE/);
  assert.equal(f.row('SELECT save_operation_id FROM project_config_revisions').save_operation_id, operation.id);
});
test('published result is permanently terminal even after later failures or a newer save', async t => {
  const f = fixture(t), upload = await acquireProjectSaveUpload(f.env, { operation: await register(f) });
  const operation = await markProjectSavePayloadStored(f.env, { operation: upload, artifact: artifact(upload) });
  const published = await process(f, operation);
  await failProjectSaveUpload(f.env, { operation: upload, error: Object.assign(new Error('late'), { status: 422 }) });
  assert.equal(f.row('SELECT receipt_json FROM project_save_operations').receipt_json, published.receipt_json);
  assert.throws(() => f.sqlite.exec("UPDATE project_save_operations SET state='FAILED_FINAL'"), /TERMINAL_IMMUTABLE/);
});
test('golden maps survive operation saves, sequential revisions and verified reopening', async t => {
  const f = localStorage(fixture(t)); let revision = 0;
  for (const name of ['map-point-basic','map-geojson-polygon','map-filters-smart-histogram','map-isochrone-persisted','map-point-cluster-v2-current','map-empty']) {
    const config = JSON.parse(readFileSync(new URL(`./fixtures/maps/golden/${name}.kepler.json`, import.meta.url), 'utf8'));
    const operation = await storeConfig(f, config, `golden-map-save-${++revision}`);
    const result = await processProjectSaveOperation(f.env, { operation });
    assert.equal(result.state, 'PUBLISHED', name);
    assert.deepEqual((await readPublishedProjectConfig(f.env, f.project())).config, config, name);
    assert.equal(count(f, 'project_config_revisions'), revision);
  }
});
