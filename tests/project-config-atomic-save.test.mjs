import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { processProjectSaveOperation, markProjectSavePayloadStored, acquireProjectSaveUpload } from '../functions/_lib/project-save-operations.js';
import { uploadProjectSaveOperationPayload } from '../functions/_lib/project-save-operation-payload.js';
import { readPublishedProjectConfig } from '../functions/_lib/project-config-service.js';
import { fixture, localStorage, storeConfig, stored, process, register, artifact, count } from './helpers/project-save-operation-fixture.mjs';
const config = label => ({ version: 'v1', config: { visState: { layers: [] }, label }, datasets: [] });

test('operation object is immutable and an idempotent upload preserves the exact verified bytes', async t => {
  const f = localStorage(fixture(t));
  const saved = await storeConfig(f, config('A'), 'atomic-operation-one');
  const retried = await uploadProjectSaveOperationPayload(f.env, { project: f.project(), operation: saved, body: new TextEncoder().encode(JSON.stringify(config('A'))) });
  assert.equal(retried.idempotent, true);
  assert.equal(retried.contentVerified, true);
  await assert.rejects(register(f, saved.operation_id, { manifest: { checksumAlgorithm: saved.checksum_algorithm,
    checksum: 'b'.repeat(64), sizeBytes: saved.size_bytes, serializationVersion: 1 } }), { code: 'OPERATION_PAYLOAD_MISMATCH' });
  assert.equal(count(f, 'local_storage_objects'), 1);
});
test('sequential durable saves publish N+1, retain each immutable revision, and reopen exact configs', async t => {
  const f = localStorage(fixture(t));
  for (let revision = 1; revision <= 3; revision += 1) {
    const expected = config(`revision-${revision}`);
    const saved = await storeConfig(f, expected, `atomic-operation-${revision}`);
    const result = await processProjectSaveOperation(f.env, { operation: saved });
    assert.equal(result.state, 'PUBLISHED');
    assert.equal(f.project().config_revision, revision);
    assert.equal(count(f, 'project_config_revisions'), revision);
    assert.equal(count(f, 'local_storage_objects'), revision);
    const reopened = await readPublishedProjectConfig(f.env, f.project());
    assert.deepEqual(reopened.config, expected);
  }
  const rows = f.sqlite.prepare('SELECT * FROM project_config_revisions ORDER BY revision').all();
  assert.ok(rows.every(row => row.status === 'READY' && row.published_at && row.save_operation_id));
  assert.equal(new Set(rows.map(row => row.storage_ref)).size, 3);
});
test('corrupt stored bytes become terminal integrity failure and preserve the prior HEAD', async t => {
  const f = localStorage(fixture(t));
  const first = await storeConfig(f, config('published'), 'atomic-initial-save');
  assert.equal((await processProjectSaveOperation(f.env, { operation: first })).state, 'PUBLISHED');
  const next = await storeConfig(f, config('candidate'), 'atomic-corrupt-save');
  f.sqlite.prepare('UPDATE local_storage_objects SET content = ? WHERE path <> (SELECT path FROM local_storage_objects ORDER BY rowid LIMIT 1)')
    .run(new TextEncoder().encode(JSON.stringify(config('tampered!'))));
  const failed = await processProjectSaveOperation(f.env, { operation: next });
  assert.equal(failed.state, 'FAILED_FINAL');
  assert.equal(f.project().config_revision, 1);
  assert.deepEqual((await readPublishedProjectConfig(f.env, f.project())).config, config('published'));
});
test('an unverified uploader attestation never enters the durable outbox', async t => {
  const f = fixture(t), operation = await acquireProjectSaveUpload(f.env, { operation: await register(f) });
  await assert.rejects(markProjectSavePayloadStored(f.env, { operation, artifact: { ...artifact(operation), contentVerified: false } }), { code: 'PROJECT_SAVE_PAYLOAD_INTEGRITY_FAILED' });
  assert.equal(count(f, 'project_save_outbox'), 0);
  assert.equal(f.project().config_revision, 0);
});
test('all atomic batch failure points roll back pointer, lineage and receipt', async t => {
  for (let index = 0; index < 8; index += 1) {
    const f = fixture(t), operation = await stored(f);
    f.failAt(index);
    const result = await process(f, operation);
    assert.equal(result.state, 'RETRY_WAIT', `statement ${index}`);
    assert.equal(f.project().config_revision, 0, `statement ${index}`);
    assert.equal(count(f, 'project_config_revisions'), 0, `statement ${index}`);
    assert.equal(result.receipt_json, null, `statement ${index}`);
  }
});
test('new publication path contains guarded D1 batches and no old writer orchestration', () => {
  const source = readFileSync(new URL('../functions/_lib/project-save-operations.js', import.meta.url), 'utf8');
  const upload = readFileSync(new URL('../functions/_lib/project-save-operation-payload.js', import.meta.url), 'utf8');
  assert.match(source, /await db\.batch\(statements\)/);
  assert.match(source, /CASE WHEN changes\(\) = 1 THEN 1 ELSE 0 END/);
  assert.doesNotMatch(source, /saveVersionedProjectConfig|reserveProjectConfigRevision|publishProjectConfigRevision/);
  assert.match(upload, /writeMode: "create"/);
  assert.doesNotMatch(upload, /writeMode: "overwrite"|deleteDropbox/);
});
