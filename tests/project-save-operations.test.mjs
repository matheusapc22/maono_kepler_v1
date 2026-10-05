import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  registerProjectSaveOperation, acquireProjectSaveUpload, markProjectSavePayloadStored,
  processProjectSaveOperation, getProjectSaveOperation, publicProjectSaveOperation,
  reconcileProjectSaveOperations, failProjectSaveUpload, recoverProjectSaveUpload,
} from '../functions/_lib/project-save-operations.js';

const migration = readFileSync(new URL('../migrations/0039_project_save_operations.sql', import.meta.url), 'utf8');
import { fixture, manifest, register, artifact, verify, stored, process, count } from './helpers/project-save-operation-fixture.mjs';

test('migration is additive and does not change the schema 19 writer contract', t => {
  const f = fixture(t);
  assert.equal(f.row('SELECT version FROM project_save_operation_schema').version, 1);
  assert.equal(f.row('PRAGMA quick_check').quick_check, 'ok');
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(/UPDATE\s+schema_versions|INSERT\s+INTO\s+schema_versions/i.test(migration), false);
});
test('same scoped ID+manifest returns historical identity; mutations and ID deletion are rejected', async t => {
  const f = fixture(t);
  const first = await register(f);
  assert.equal((await register(f)).id, first.id);
  for (const extras of [{ manifest: manifest('b') }, { expectedConfigRevision: 1 }, { project: f.project(2) }]) {
    await assert.rejects(register(f, first.operation_id, extras), { code: 'OPERATION_PAYLOAD_MISMATCH' });
  }
  assert.throws(() => f.sqlite.prepare('UPDATE project_save_operations SET checksum = ? WHERE id = ?').run('b'.repeat(64), first.id), /IDENTITY_IMMUTABLE/);
  assert.throws(() => f.sqlite.prepare('DELETE FROM project_save_operations WHERE id = ?').run(first.id), /RECEIPT_RETAINED/);
  assert.equal(await getProjectSaveOperation(f.env, { organizationId: 2, actorUserId: 1, operationId: first.operation_id }), null);
  assert.equal(await getProjectSaveOperation(f.env, { organizationId: 1, actorUserId: 2, operationId: first.operation_id }), null);
});
test('admission paused rejects new work, accepts same identity, and drains accepted bytes', async t => {
  const f = fixture(t);
  const operation = await stored(f);
  f.env.PROJECT_DURABLE_SAVE_V1 = 'false';
  assert.equal((await register(f)).id, operation.id);
  await assert.rejects(register(f, 'operation-save-new-02'), { code: 'PROJECT_DURABLE_SAVE_PAUSED' });
  assert.equal((await process(f, operation)).state, 'PUBLISHED');
});
test('upload and outbox are atomic; a failed outbox insertion never acknowledges stored', async t => {
  const f = fixture(t);
  const operation = await acquireProjectSaveUpload(f.env, { operation: await register(f) });
  f.failAt(2);
  await assert.rejects(markProjectSavePayloadStored(f.env, { operation, artifact: artifact(operation) }), /INJECTED/);
  assert.equal((await getProjectSaveOperation(f.env, { organizationId: 1, actorUserId: 1, operationId: operation.operation_id })).state, 'RECEIVING');
  assert.equal(count(f, 'project_save_outbox'), 0);
  const saved = await markProjectSavePayloadStored(f.env, { operation, artifact: artifact(operation) });
  assert.equal(saved.state, 'PAYLOAD_STORED');
  assert.equal(count(f, 'project_save_outbox'), 1);
});
test('zero-row publication CAS rolls back revision and receipt; current revision stays intact', async t => {
  const f = fixture(t);
  const operation = await stored(f);
  f.beforeBatch(db => db.exec('UPDATE projects SET config_revision = 1 WHERE id = 1'));
  const result = await process(f, operation);
  assert.equal(result.state, 'CONFLICT');
  assert.equal(result.error_code, 'PROJECT_CONFIG_REVISION_CONFLICT');
  assert.equal(result.receipt_json, null);
  assert.equal(count(f, 'project_config_revisions'), 0);
  assert.equal(f.project().config_revision, 1);
});
test('failure after project CAS rolls back everything; retry creates one publication', async t => {
  const f = fixture(t);
  const operation = await stored(f);
  f.failAt(4);
  const failed = await process(f, operation);
  assert.equal(failed.state, 'RETRY_WAIT');
  assert.equal(f.project().config_revision, 0);
  assert.equal(count(f, 'project_config_revisions'), 0);
  assert.equal(failed.receipt_json, null);
  f.sqlite.exec('UPDATE project_save_operations SET next_attempt_at = 0');
  const result = await process(f, failed);
  assert.equal(result.state, 'PUBLISHED');
  assert.equal(f.project().config_revision, 1);
  assert.equal(count(f, 'project_config_revisions'), 1);
});
test('lost response followed by N+2 returns N+1 historical receipt with current head separate', async t => {
  const f = fixture(t);
  const first = await process(f, await stored(f));
  assert.equal(first.state, 'PUBLISHED');
  const receipt = first.receipt_json;
  const second = await process(f, await stored(f, 'operation-save-0002', { expectedConfigRevision: 1, manifest: manifest('b') }));
  assert.equal(second.state, 'PUBLISHED');
  const recovered = await process(f, first);
  assert.equal(recovered.receipt_json, receipt);
  const publicState = publicProjectSaveOperation(recovered, f.project());
  assert.equal(publicState.receipt.publishedRevision, 1);
  assert.equal(publicState.currentRevision, 2);
  assert.equal(JSON.stringify(publicState).includes('storage_ref'), false);
  assert.equal(count(f, 'project_config_revisions'), 2);
});
test('two workers and two operations on one base cannot publish twice', async t => {
  const f = fixture(t);
  const first = await stored(f), second = await stored(f, 'operation-save-second', { manifest: manifest('b') });
  const results = await Promise.all([process(f, first), process(f, first), process(f, second)]);
  assert.equal(f.project().config_revision, 1);
  assert.equal(count(f, 'project_config_revisions'), 1);
  assert.ok(results.some(row => row.state === 'PUBLISHED'));
  assert.equal((await process(f, second)).state, 'CONFLICT');
});
test('ACL revocation between validation and commit cannot publish', async t => {
  for (const mutate of [
    'DELETE FROM organization_users WHERE organization_id = 1 AND user_id = 1',
    "INSERT INTO user_permission_denials(user_id,organization_id,permission) VALUES(1,1,'project.save')",
    'UPDATE users SET active = 0 WHERE id = 1',
    'UPDATE organizations SET active = 0 WHERE id = 1',
    "UPDATE user_projects SET access_level = 'viewer' WHERE user_id = 1 AND project_id = 1",
  ]) {
    const f = fixture(t), operation = await stored(f);
    f.beforeBatch(db => db.exec(mutate));
    const result = await process(f, operation);
    assert.equal(result.state, 'FAILED_FINAL', mutate);
    assert.equal(f.project().config_revision, 0, mutate);
    assert.equal(count(f, 'project_config_revisions'), 0, mutate);
  }
});
test('unrelated ACL generation change retries rather than losing a valid save', async t => {
  const f = fixture(t), operation = await stored(f);
  f.beforeBatch(db => db.exec("UPDATE users SET name = 'Updated viewer' WHERE id = 3"));
  const result = await process(f, operation);
  assert.equal(result.state, 'RETRY_WAIT');
  assert.equal(f.project().config_revision, 0);
  f.sqlite.exec('UPDATE project_save_operations SET next_attempt_at = 0');
  assert.equal((await process(f, result)).state, 'PUBLISHED');
});
test('archival and lifecycle changes racing commit are conflicts without receipts', async t => {
  const f = fixture(t), operation = await stored(f);
  f.beforeBatch(db => db.exec('UPDATE projects SET active = 0 WHERE id = 1'));
  assert.equal((await process(f, operation)).state, 'CONFLICT');
  assert.equal(f.project().config_revision, 0);
});
test('expired upload inspects deterministic object before accepting a new upload epoch', async t => {
  const f = fixture(t);
  const uploading = await acquireProjectSaveUpload(f.env, { operation: await register(f) });
  await failProjectSaveUpload(f.env, { operation: uploading, error: new Error('lost response') });
  const recovered = await acquireProjectSaveUpload(f.env, { operation: uploading, recoverPayload: async (_env, { operation }) => artifact(operation) });
  assert.equal(recovered.state, 'PAYLOAD_STORED');
  assert.equal(recovered.upload_epoch, 1);
  assert.equal((await process(f, recovered)).state, 'PUBLISHED');
});
test('stale upload callbacks cannot replace a newer epoch; absent object can be re-uploaded', async t => {
  const f = fixture(t);
  const old = await acquireProjectSaveUpload(f.env, { operation: await register(f) });
  await failProjectSaveUpload(f.env, { operation: old, error: new Error('broken connection') });
  const next = await acquireProjectSaveUpload(f.env, { operation: old, recoverPayload: async () => null });
  assert.equal(next.upload_epoch, 2);
  await assert.rejects(markProjectSavePayloadStored(f.env, { operation: old, artifact: artifact(old) }), /CHECK constraint/);
  assert.equal((await markProjectSavePayloadStored(f.env, { operation: next, artifact: artifact(next) })).upload_epoch, 2);
});
test('reconciler finishes a complete upload after client disappearance and audits independently', async t => {
  const f = fixture(t);
  const operation = await acquireProjectSaveUpload(f.env, { operation: await register(f) });
  await failProjectSaveUpload(f.env, { operation, error: new Error('connection gone') });
  const result = await reconcileProjectSaveOperations(f.env, { verifyPayload: verify, recoverPayload: async (_env, { operation }) => artifact(operation) });
  assert.equal(result.published, 1);
  assert.equal(result.audit, 1);
  assert.equal(count(f, 'audit_logs'), 1);
  await reconcileProjectSaveOperations(f.env, { verifyPayload: verify });
  assert.equal(count(f, 'audit_logs'), 1);
});
test('integrity failure is terminal, preserves object, and never publishes', async t => {
  const f = fixture(t), operation = await stored(f);
  const result = await process(f, operation, { verifyPayload: async () => { throw Object.assign(new Error('bad'), { code: 'PROJECT_SAVE_PAYLOAD_INTEGRITY_FAILED', status: 422 }); } });
  assert.equal(result.state, 'FAILED_FINAL');
  assert.equal(result.storage_ref, operation.storage_ref);
  assert.equal(f.project().config_revision, 0);
});
test('legacy promotion and first revision publish in the same transaction', async t => {
  const f = fixture(t);
  f.sqlite.exec('UPDATE projects SET lifecycle_state = NULL, lifecycle_version = 0 WHERE id = 1');
  const result = await process(f, await stored(f));
  assert.equal(result.state, 'PUBLISHED');
  assert.equal(f.project().lifecycle_state, 'ACTIVE');
  assert.equal(f.project().lifecycle_version, 1);
});

test('creation receipt, lifecycle, reservation, quota and ownership commit atomically', async t => {
  const f = fixture(t), creationKey = 'creation-save-0001';
  f.sqlite.exec(`UPDATE projects SET active = 0, lifecycle_state = 'PREPARING_STORAGE' WHERE id = 1;
    INSERT INTO organization_files(id,organization_id,project_id,name,file_name,dropbox_path,file_type,mime_type,size_bytes,status,idempotency_key,uploaded_by,is_project,active)
      VALUES(1,1,1,'Map','config.kepler.json','/a/map/config.kepler.json','json','application/json',0,'PROCESSING','${creationKey}',1,1,0);
    INSERT INTO organization_resource_reservations(id,organization_id,resource_type,idempotency_key,project_id,actor_user_id,status,expires_at)
      VALUES(1,1,'project','${creationKey}',1,1,'PROCESSING','2099-01-01');
    DELETE FROM user_projects WHERE user_id = 1 AND project_id = 1;`);
  const operation = await stored(f, creationKey, { kind: 'create', domain: { creationKey, reservationId: 1, quotaReservationId: 1 } });
  f.failAt(6); // fail after lifecycle+ledger+file CAS but before quota commit
  const failed = await process(f, operation);
  assert.equal(failed.state, 'RETRY_WAIT');
  assert.equal(f.project().active, 0);
  assert.equal(f.project().lifecycle_state, 'PREPARING_STORAGE');
  assert.equal(f.row('SELECT status FROM organization_files WHERE id=1').status, 'PROCESSING');
  assert.equal(f.row('SELECT status FROM organization_resource_reservations WHERE id=1').status, 'PROCESSING');
  assert.equal(failed.receipt_json, null);
  f.sqlite.exec('UPDATE project_save_operations SET next_attempt_at = 0');
  const result = await process(f, failed);
  assert.equal(result.state, 'PUBLISHED');
  assert.equal(f.project().active, 1);
  assert.equal(f.project().lifecycle_state, 'ACTIVE');
  assert.equal(f.row('SELECT status FROM organization_files WHERE id=1').status, 'ACTIVE');
  assert.equal(f.row('SELECT status FROM organization_resource_reservations WHERE id=1').status, 'COMMITTED');
  assert.equal(f.row('SELECT access_level FROM user_projects WHERE user_id=1 AND project_id=1').access_level, 'owner');
});
test('quota revocation racing creation rolls back activation and receipt', async t => {
  const f = fixture(t), creationKey = 'creation-save-quota';
  f.sqlite.exec(`UPDATE projects SET active = 0, lifecycle_state = 'PREPARING_STORAGE' WHERE id = 1;
    INSERT INTO organization_files(id,organization_id,project_id,name,file_name,dropbox_path,file_type,mime_type,size_bytes,status,idempotency_key,uploaded_by,is_project,active)
      VALUES(1,1,1,'Map','config.kepler.json','/a/map/config.kepler.json','json','application/json',0,'PROCESSING','${creationKey}',1,1,0);
    INSERT INTO organization_resource_reservations(id,organization_id,resource_type,idempotency_key,project_id,actor_user_id,status,expires_at)
      VALUES(1,1,'project','${creationKey}',1,1,'PROCESSING','2099-01-01');`);
  const operation = await stored(f, creationKey, { kind: 'create', domain: { creationKey, reservationId: 1, quotaReservationId: 1 } });
  f.beforeBatch(db => db.exec("UPDATE organization_resource_reservations SET status = 'RELEASED' WHERE id = 1"));
  const result = await process(f, operation);
  assert.notEqual(result.state, 'PUBLISHED');
  assert.equal(f.project().active, 0);
  assert.equal(f.project().config_revision, 0);
  assert.equal(result.receipt_json, null);
});
function changeRequest(f) {
  f.sqlite.exec(`INSERT INTO project_change_requests(id,organization_id,project_id,requested_by_user_id,base_revision,reason,idempotency_key,submission_hash)
    VALUES('change-1',1,1,3,0,'Please update','change-request-0001','${'a'.repeat(64)}');
    UPDATE project_change_requests SET status='under_review',lifecycle_version=1,transition_actor_user_id=1 WHERE id='change-1';
    UPDATE project_change_requests SET status='approved',lifecycle_version=2,decision='approved',decided_by_user_id=1,decided_at=CURRENT_TIMESTAMP,transition_actor_user_id=1 WHERE id='change-1';
    UPDATE project_change_requests SET status='applying',lifecycle_version=3,transition_actor_user_id=1 WHERE id='change-1';
    INSERT INTO project_change_request_apply_artifacts(change_request_id,checksum,size_bytes,base_revision,approved_by)
      VALUES('change-1','${'a'.repeat(64)}',100,0,1);`);
}
test('change request applied lineage and receipt are one transaction with journal', async t => {
  const f = fixture(t); changeRequest(f);
  const operation = await stored(f, 'change-apply-operation', { kind: 'change-request', domain: { changeRequestId: 'change-1', expectedChangeRequestVersion: 3 } });
  const result = await process(f, operation);
  assert.equal(result.state, 'PUBLISHED');
  const change = f.row("SELECT * FROM project_change_requests WHERE id='change-1'");
  assert.equal(change.status, 'applied');
  assert.equal(change.applied_revision, 1);
  assert.equal(change.lifecycle_version, 4);
  assert.equal(f.row("SELECT COUNT(*) AS n FROM project_change_request_events WHERE change_request_id='change-1' AND to_status='applied'").n, 1);
  assert.equal(f.row('SELECT save_operation_id, transition_id FROM project_config_revisions').save_operation_id, result.id);
  assert.equal(f.row('SELECT transition_id FROM project_config_revisions').transition_id, 'cc08:change-1');
});
test('change request lifecycle race prevents project CAS and false applied receipt', async t => {
  const f = fixture(t); changeRequest(f);
  const operation = await stored(f, 'change-apply-racing', { kind: 'change-request', domain: { changeRequestId: 'change-1', changeRequestVersion: 3 } });
  f.beforeBatch(db => db.exec("UPDATE project_change_requests SET status='conflict',lifecycle_version=4 WHERE id='change-1'"));
  const result = await process(f, operation);
  assert.equal(result.state, 'CONFLICT');
  assert.equal(f.project().config_revision, 0);
  assert.equal(count(f, 'project_config_revisions'), 0);
  assert.equal(result.receipt_json, null);
});
test('project and actor deletion preserve operation IDs and finalize pending work', async t => {
  for (const table of ['projects','users','organizations']) {
    const f = fixture(t), operation = await stored(f);
    f.sqlite.exec(`DELETE FROM ${table} WHERE id = 1`);
    const current = f.row('SELECT * FROM project_save_operations WHERE id = ?', operation.id);
    assert.equal(current.state, 'FAILED_FINAL', table);
    assert.equal(current.operation_id, operation.operation_id, table);
    assert.equal(f.row("SELECT state FROM project_save_outbox WHERE operation_id = ? AND effect = 'PROCESS'", operation.id).state, 'DONE');
    assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0, table);
  }
});
test('completed receipts survive deletion without freeing historical operation identity', async t => {
  const f = fixture(t), published = await process(f, await stored(f));
  f.sqlite.exec('DELETE FROM projects WHERE id=1');
  const result = await getProjectSaveOperation(f.env, { organizationId: 1, actorUserId: 1, operationId: published.operation_id });
  assert.equal(result.state, 'PUBLISHED');
  assert.equal(result.receipt_json, published.receipt_json);
  assert.equal(count(f, 'project_config_revisions'), 0);
});
test('grant expiry during commit is fenced even when no ACL row mutates', async t => {
  const f = fixture(t);
  f.sqlite.exec(`UPDATE users SET role='editor' WHERE id=1;
    UPDATE projects SET active=0,lifecycle_state='PREPARING_STORAGE' WHERE id=1;
    INSERT INTO organization_files(id,organization_id,project_id,name,file_name,dropbox_path,file_type,mime_type,size_bytes,status,idempotency_key,uploaded_by,is_project,active)
      VALUES(1,1,1,'Map','config.kepler.json','/a/map/config.kepler.json','json','application/json',0,'PROCESSING','creation-expiring-grant',1,1,0);`);
  f.sqlite.prepare("INSERT INTO user_permissions(user_id,permission,organization_id,active,expires_at) VALUES(1,'project.create',1,1,?)")
    .run(new Date(Date.now() + 250).toISOString());
  const operation = await stored(f, 'creation-expiring-grant', { kind:'create',domain:{reservationId:1,creationKey:'creation-expiring-grant'} });
  f.beforeBatch(async () => new Promise(resolve => setTimeout(resolve, 300)));
  const result = await process(f, operation);
  assert.equal(result.state, 'FAILED_FINAL');
  assert.equal(f.project().config_revision, 0);
});
test('retries and incomplete uploads reach explicit bounded terminal results', async t => {
  const f = fixture(t), operation = await stored(f);
  f.sqlite.exec('UPDATE project_save_operations SET attempts = 7');
  const result = await process(f, operation, { verifyPayload: async () => { throw new Error('offline'); } });
  assert.equal(result.state, 'FAILED_FINAL');
  assert.equal(result.error_code, 'PROJECT_SAVE_RETRY_EXHAUSTED');
  const pending = await register(f, 'operation-never-uploaded');
  f.sqlite.prepare("UPDATE project_save_operations SET created_at='2000-01-01 00:00:00' WHERE id=?").run(pending.id);
  await reconcileProjectSaveOperations(f.env);
  assert.equal(f.row('SELECT error_code FROM project_save_operations WHERE id=?', pending.id).error_code, 'PROJECT_SAVE_UPLOAD_EXPIRED');
});
test('late upload errors after durable acknowledgement cannot poison received payload', async t => {
  const f = fixture(t), upload = await acquireProjectSaveUpload(f.env, { operation: await register(f) });
  const accepted = await markProjectSavePayloadStored(f.env, { operation: upload, artifact: artifact(upload) });
  await failProjectSaveUpload(f.env, { operation: upload, error: Object.assign(new Error('late invalid result'), { code: 'PROJECT_SAVE_PAYLOAD_INTEGRITY_FAILED', status: 422 }) });
  assert.equal(f.row('SELECT state FROM project_save_operations').state, 'PAYLOAD_STORED');
  assert.equal((await process(f, accepted)).state, 'PUBLISHED');
});
test('storage path mutation between verification and commit cannot publish an unreadable reference', async t => {
  const f = fixture(t), operation = await stored(f);
  f.beforeBatch(db => db.exec("UPDATE projects SET dropbox_root_path='/different/root' WHERE id=1"));
  const result = await process(f, operation);
  assert.equal(result.state, 'RETRY_WAIT');
  assert.equal(f.project().config_revision, 0);
  assert.equal(result.receipt_json, null);
});
test('storage path mutation during full verification is an explicit conflict', async t => {
  const f = fixture(t), operation = await stored(f);
  const result = await process(f, operation, { verifyPayload: async (_env, { operation }) => {
    f.sqlite.exec("UPDATE projects SET dropbox_root_path='/different/root' WHERE id=1");
    return { ...artifact(operation), storageRef: operation.storage_ref };
  } });
  assert.equal(result.state, 'CONFLICT');
  assert.equal(result.error_code, 'PROJECT_SAVE_STORAGE_CONTEXT_CHANGED');
  assert.equal(f.project().config_revision, 0);
});
test('owner/admin grants never outlive removal of the current project association', async t => {
  for (const role of ['owner','admin','editor']) {
    for (const race of [false,true]) {
      const f = fixture(t);
      f.sqlite.prepare('UPDATE users SET role=? WHERE id=1').run(role);
      f.sqlite.exec("INSERT INTO user_permissions(user_id,permission,organization_id,project_id,active) VALUES(1,'project.save',1,1,1)");
      const operation = await stored(f);
      const revoke = db => db.exec('DELETE FROM user_projects WHERE user_id=1 AND project_id=1');
      if (race) f.beforeBatch(revoke); else revoke(f.sqlite);
      const result = await process(f, operation);
      assert.equal(result.state, 'FAILED_FINAL', `${role}, commit race ${race}`);
      assert.equal(result.error_code, 'PROJECT_SAVE_PERMISSION_REVOKED');
      assert.equal(f.project().config_revision, 0);
      assert.equal(count(f, 'project_config_revisions'), 0);
    }
  }
});
test('read-only legacy promotion retains the existing canonical thumbnail state', async t => {
  const f = fixture(t);
  f.sqlite.exec("UPDATE projects SET lifecycle_state=NULL,lifecycle_version=0,preview_status='UNKNOWN',preview_revision=0,preview_attempts=2,preview_capture_method='legacy-original' WHERE id=1");
  const operation = await stored(f, 'legacy-promotion-one', { kind: 'legacy-promotion' });
  const result = await process(f, operation);
  assert.equal(result.state, 'PUBLISHED');
  assert.equal(f.project().preview_status, 'UNKNOWN');
  assert.equal(f.project().preview_revision, 0);
  assert.equal(f.project().preview_attempts, 2);
  assert.equal(f.project().preview_capture_method, 'legacy-original');
});
test('accepted change apply ends its applying domain when a competing save wins', async t => {
  const f = fixture(t); changeRequest(f);
  const apply = await stored(f, 'change-loses-to-save', { kind: 'change-request', domain: { changeRequestId: 'change-1', changeRequestVersion: 3 } });
  assert.equal((await process(f, await stored(f, 'competing-editor-save'))).state, 'PUBLISHED');
  const result = await process(f, apply);
  assert.equal(result.state, 'CONFLICT');
  assert.equal(f.row("SELECT status FROM project_change_requests WHERE id='change-1'").status, 'conflict');
  assert.equal(f.row("SELECT COUNT(*) AS n FROM project_change_request_events WHERE change_request_id='change-1' AND to_status='conflict'").n, 1);
});
test('permission loss finalizes accepted change apply and its journal together', async t => {
  const f = fixture(t); changeRequest(f);
  const apply = await stored(f, 'change-revoked-actor', { kind: 'change-request', domain: { changeRequestId: 'change-1', changeRequestVersion: 3 } });
  f.sqlite.exec('DELETE FROM user_projects WHERE user_id=1 AND project_id=1');
  const result = await process(f, apply);
  assert.equal(result.state, 'FAILED_FINAL');
  assert.equal(f.row("SELECT status FROM project_change_requests WHERE id='change-1'").status, 'conflict');
  assert.equal(f.project().config_revision, 0);
  assert.equal(f.row("SELECT COUNT(*) AS n FROM project_change_request_events WHERE change_request_id='change-1' AND to_status='conflict'").n, 1);
});
test('ordinary updates atomically refresh linked organization file accounting without claiming Dropbox hashes are SHA-256', async t => {
  const f = fixture(t);
  f.sqlite.exec(`INSERT INTO organization_files(id,organization_id,project_id,name,file_name,dropbox_path,file_type,mime_type,size_bytes,sha256,status,uploaded_by,is_project,active)
    VALUES(1,1,1,'Map','config.kepler.json','/a/map/config.kepler.json','json','application/json',10,'old-sha','ACTIVE',1,1,1);
    UPDATE projects SET organization_file_id=1 WHERE id=1;`);
  const operation = await stored(f);
  f.failAt(6);
  const failed = await process(f, operation);
  assert.equal(failed.state, 'RETRY_WAIT');
  assert.equal(f.row('SELECT size_bytes FROM organization_files WHERE id=1').size_bytes, 10);
  assert.equal(f.project().config_revision, 0);
  f.sqlite.exec('UPDATE project_save_operations SET next_attempt_at=0');
  assert.equal((await process(f, failed)).state, 'PUBLISHED');
  assert.equal(f.row('SELECT size_bytes FROM organization_files WHERE id=1').size_bytes, 100);
  assert.equal(f.row('SELECT sha256 FROM organization_files WHERE id=1').sha256, null);
});
test('file import rechecks admin permission and atomically copies only current organization membership', async t => {
  const f = fixture(t), creationKey = 'creation-admin-import';
  f.sqlite.exec(`UPDATE users SET role='super_admin' WHERE id=1;
    UPDATE projects SET active=0,lifecycle_state='PREPARING_STORAGE' WHERE id=1;
    INSERT INTO organization_files(id,organization_id,project_id,name,file_name,dropbox_path,file_type,mime_type,size_bytes,status,idempotency_key,uploaded_by,is_project,active)
      VALUES(1,1,1,'Map','config.kepler.json','/a/map/config.kepler.json','json','application/json',0,'PROCESSING','${creationKey}',1,1,0),
        (2,1,NULL,'Source','source.json','/a/source.json','json','application/json',100,'ACTIVE',NULL,1,0,1);
    DELETE FROM user_projects WHERE project_id=1;`);
  const operation = await stored(f, creationKey, { kind:'create',domain:{creationKey,reservationId:1,importFileId:2,copyOrganizationAccess:true} });
  const result = await process(f, operation);
  assert.equal(result.state, 'PUBLISHED');
  assert.equal(f.row('SELECT access_level FROM user_projects WHERE user_id=1 AND project_id=1').access_level, 'owner');
  assert.equal(f.row('SELECT access_level FROM user_projects WHERE user_id=2 AND project_id=1').access_level, 'editor');
  assert.equal(f.row('SELECT access_level FROM user_projects WHERE user_id=3 AND project_id=1').access_level, 'viewer');
  assert.equal(f.row('SELECT project_id FROM organization_files WHERE id=2').project_id, null);
});
test('accepted file import cannot publish after admin permission is revoked', async t => {
  const f = fixture(t), creationKey = 'creation-admin-revoked';
  f.sqlite.exec(`UPDATE users SET role='super_admin' WHERE id=1;
    UPDATE projects SET active=0,lifecycle_state='PREPARING_STORAGE' WHERE id=1;
    INSERT INTO organization_files(id,organization_id,project_id,name,file_name,dropbox_path,file_type,mime_type,size_bytes,status,idempotency_key,uploaded_by,is_project,active)
      VALUES(1,1,1,'Map','config.kepler.json','/a/map/config.kepler.json','json','application/json',0,'PROCESSING','${creationKey}',1,1,0),
        (2,1,NULL,'Source','source.json','/a/source.json','json','application/json',100,'ACTIVE',NULL,1,0,1);`);
  const operation = await stored(f, creationKey, { kind:'create',domain:{creationKey,reservationId:1,importFileId:2} });
  f.beforeBatch(db => db.exec("UPDATE users SET role='owner' WHERE id=1"));
  const result = await process(f, operation);
  assert.equal(result.state, 'FAILED_FINAL');
  assert.equal(result.error_code, 'PROJECT_SAVE_PERMISSION_REVOKED');
  assert.equal(f.project().config_revision, 0);
});
test('deleting the accepted apply actor closes applying without adding a blocking actor FK', async t => {
  const f = fixture(t); changeRequest(f);
  const operation = await stored(f, 'change-delete-actor', { actor: { id: 2 }, kind:'change-request',domain:{changeRequestId:'change-1',changeRequestVersion:3} });
  f.sqlite.exec('DELETE FROM users WHERE id=2');
  assert.equal(f.row('SELECT state FROM project_save_operations WHERE id=?', operation.id).state, 'FAILED_FINAL');
  const domain = f.row("SELECT * FROM project_change_requests WHERE id='change-1'");
  assert.equal(domain.status, 'conflict');
  assert.equal(domain.transition_actor_user_id, null);
  assert.equal(f.row("SELECT actor_user_id FROM project_change_request_events WHERE change_request_id='change-1' AND to_status='conflict'").actor_user_id, null);
  assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
});
