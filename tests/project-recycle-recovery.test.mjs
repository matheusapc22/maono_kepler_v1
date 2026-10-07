import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dropboxContentHashHex } from '../functions/_lib/dropbox-content-hash.js';
import {
  acquireProjectSaveUpload, failProjectSaveUpload, recoverProjectSaveUpload,
  markProjectSavePayloadStored, processProjectSaveOperation, reconcileProjectSaveOperations,
} from '../functions/_lib/project-save-operations.js';
import { uploadProjectSaveOperationPayload } from '../functions/_lib/project-save-operation-payload.js';
import { readPublishedProjectConfig } from '../functions/_lib/project-config-service.js';
import { fixture, localStorage, register, count } from './helpers/project-save-operation-fixture.mjs';
const config = value => ({ version: 'v1', config: { visState: { layers: [] }, value }, datasets: [] });
async function preparing(f, value = 'candidate', id = 'recover-operation-0001') {
  const bytes = new TextEncoder().encode(JSON.stringify(config(value)));
  const operation = await register(f, id, { manifest: { serializationVersion: 1, checksumAlgorithm: 'dropbox-content-hash',
    checksum: await dropboxContentHashHex(bytes), sizeBytes: bytes.byteLength, configVersion: 'v1', datasetCount: 0 } });
  const upload = await acquireProjectSaveUpload(f.env, { operation });
  return { operation: upload, bytes };
}
const providerUpload = (f, value) => uploadProjectSaveOperationPayload(f.env, { project: f.project(), ...value, body: value.bytes });

test('storage completion followed by lost D1 response is recovered without deleting or reuploading', async t => {
  const f = localStorage(fixture(t)), pending = await preparing(f);
  const artifact = await providerUpload(f, pending);
  f.failAt(2);
  await assert.rejects(markProjectSavePayloadStored(f.env, { operation: pending.operation, artifact }), /INJECTED/);
  await failProjectSaveUpload(f.env, { operation: pending.operation, error: new Error('lost DB result') });
  const before = f.sqlite.prepare('SELECT path,hex(content) AS hex FROM local_storage_objects').all();
  const result = await reconcileProjectSaveOperations(f.env);
  assert.equal(result.published, 1);
  assert.deepEqual(f.sqlite.prepare('SELECT path,hex(content) AS hex FROM local_storage_objects').all(), before);
  assert.deepEqual((await readPublishedProjectConfig(f.env, f.project())).config, config('candidate'));
  assert.equal(count(f, 'project_config_revisions'), 1);
});
test('verified absent upload permits same operation retry using a new private epoch', async t => {
  const f = localStorage(fixture(t)), pending = await preparing(f);
  await failProjectSaveUpload(f.env, { operation: pending.operation, error: new Error('upload never completed') });
  const upload = await acquireProjectSaveUpload(f.env, { operation: pending.operation });
  assert.equal(upload.upload_epoch, pending.operation.upload_epoch + 1);
  const artifact = await providerUpload(f, { ...pending, operation: upload });
  const ready = await markProjectSavePayloadStored(f.env, { operation: upload, artifact });
  assert.equal((await processProjectSaveOperation(f.env, { operation: ready })).state, 'PUBLISHED');
  assert.equal(count(f, 'local_storage_objects'), 1);
  await assert.rejects(markProjectSavePayloadStored(f.env, { operation: pending.operation, artifact: { ...artifact, checksum: '0'.repeat(64) } }), { code: 'PROJECT_SAVE_PAYLOAD_INTEGRITY_FAILED' });
});
test('late older upload can create only its orphan object and cannot replace the newer published artifact', async t => {
  const f = localStorage(fixture(t)), old = await preparing(f);
  await failProjectSaveUpload(f.env, { operation: old.operation, error: new Error('uncertain old upload') });
  const newer = await acquireProjectSaveUpload(f.env, { operation: old.operation });
  const currentArtifact = await providerUpload(f, { ...old, operation: newer });
  const ready = await markProjectSavePayloadStored(f.env, { operation: newer, artifact: currentArtifact });
  const published = await processProjectSaveOperation(f.env, { operation: ready });
  const olderArtifact = await providerUpload(f, old);
  assert.notEqual(olderArtifact.storageRef, currentArtifact.storageRef);
  const late = await markProjectSavePayloadStored(f.env, { operation: old.operation, artifact: olderArtifact });
  assert.equal(late.storage_ref, currentArtifact.storageRef);
  assert.equal(late.receipt_json, published.receipt_json);
  assert.equal(count(f, 'local_storage_objects'), 2, 'no blind orphan deletion during active recovery');
});
test('uncertain provider inspection keeps the old epoch fenced and retries before new upload', async t => {
  const f = localStorage(fixture(t)), pending = await preparing(f);
  await providerUpload(f, pending);
  await failProjectSaveUpload(f.env, { operation: pending.operation, error: new Error('lost response') });
  const failed = await recoverProjectSaveUpload(f.env, { operation: pending.operation, recoverPayload: async () => { throw Object.assign(new Error('provider unavailable'), { status: 503, code: 'DROPBOX_UNAVAILABLE' }); } });
  assert.equal(failed.state, 'RECEIVING');
  assert.equal(failed.upload_epoch, pending.operation.upload_epoch);
  assert.ok(failed.lease_until > Date.now());
  await assert.rejects(acquireProjectSaveUpload(f.env, { operation: failed }), { code: 'PROJECT_SAVE_UPLOAD_BUSY' });
  f.sqlite.exec('UPDATE project_save_operations SET lease_until=0');
  const recovered = await recoverProjectSaveUpload(f.env, { operation: failed });
  assert.equal(recovered.state, 'PAYLOAD_STORED');
  assert.equal(count(f, 'local_storage_objects'), 1);
});
test('tampered orphan never becomes received or published during recovery', async t => {
  const f = localStorage(fixture(t)), pending = await preparing(f);
  await providerUpload(f, pending);
  f.sqlite.prepare('UPDATE local_storage_objects SET content = ?').run(new TextEncoder().encode(JSON.stringify(config('tampered!'))));
  await failProjectSaveUpload(f.env, { operation: pending.operation, error: new Error('lost confirmation') });
  const result = await recoverProjectSaveUpload(f.env, { operation: pending.operation });
  assert.equal(result.state, 'FAILED_FINAL');
  assert.equal(result.payload_stored_at, null);
  assert.equal(f.project().config_revision, 0);
  assert.equal(count(f, 'local_storage_objects'), 1);
});
test('recovery code never runs the retired 30-second recycler or deletes operation objects', () => {
  const source = readFileSync(new URL('../functions/_lib/project-save-operations.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /ABANDONED_READY|deleteDropbox|DELETE FROM local_storage_objects|recover-verified-absent/);
  assert.match(source, /recoverStoredProjectSaveOperation/);
  assert.match(source, /PROJECT_SAVE_RECOVERY_EXHAUSTED/);
});
