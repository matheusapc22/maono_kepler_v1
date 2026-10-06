import { logPreviewServerMetric } from './project-preview-metrics.js';
import { normalizeRole } from './auth.js';
import { can } from './permissions.js';
import { resolveEffectiveProjectMapRoute } from './project-map-route-policy.js';
import { previewError, MAX_PREVIEW_BYTES } from './project-preview-png.js';
import { previewArtifactRef, verifyStoredPreview } from './project-preview-payload.js';

export const PREVIEW_TERMINAL = new Set(['READY','FAILED_FINAL','SUPERSEDED']);
const NOW = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const LEASE_MS = 5 * 60 * 1000, MAX_ATTEMPTS = 8, RETENTION_MS = 24 * 60 * 60 * 1000;
const enabled = value => String(value || 'false').toLowerCase() === 'true';
export const previewProcessorEnabled = env => enabled(env.PROJECT_PREVIEW_PROCESSOR_ENABLED);
export function previewDatabase(env) { const db = env.DB; if (!db?.batch) throw previewError('PROJECT_PREVIEW_SCHEMA_REQUIRED', 503); return db.withSession ? db.withSession('first-primary') : db; }
async function requirePreviewSchema(db) {
  const schema = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_preview_operation_schema'").first();
  if (!schema) throw previewError('PROJECT_PREVIEW_SCHEMA_REQUIRED',503);
}
const guard = db => db.prepare('INSERT INTO project_preview_transaction_guard(value) VALUES(CASE WHEN changes()=1 THEN 1 ELSE 0 END)');
const reload = (db, op) => db.prepare('SELECT * FROM project_preview_operations WHERE id=?').bind(op.id).first();
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code || '') ? error.code : 'PROJECT_PREVIEW_TEMPORARY_FAILURE';
const number = (value, name, min = 0) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < min) throw previewError(name,400); return n; };
const id = (value, name) => { const s = String(value || ''); if (!/^[A-Za-z0-9:_-]{12,128}$/.test(s)) throw previewError(name,400); return s; };
const hash = value => { if (!/^[a-f0-9]{64}$/.test(String(value || ''))) throw previewError('PROJECT_PREVIEW_CHECKSUM_INVALID',400); return value; };
export function normalizePreviewManifest(input) {
  const sizeBytes = number(input?.sizeBytes,'THUMBNAIL_SIZE_INVALID',1);
  if (sizeBytes > MAX_PREVIEW_BYTES) throw previewError('THUMBNAIL_TOO_LARGE',413);
  const rendererVersion = String(input?.rendererVersion || ''), captureMethod = String(input?.captureMethod || '');
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(rendererVersion) || !/^[A-Za-z0-9+._:-]{1,120}$/.test(captureMethod)) throw previewError('PROJECT_PREVIEW_MANIFEST_INVALID',400);
  return { operationId:id(input?.operationId,'PROJECT_PREVIEW_OPERATION_ID_INVALID'), saveOperationId:id(input?.saveOperationId,'PROJECT_PREVIEW_SAVE_ID_INVALID'),
    organizationId:String(number(input?.organizationId,'PROJECT_ORGANIZATION_INVALID',1)), projectId:String(number(input?.projectId,'PROJECT_ID_INVALID',1)),
    revision:number(input?.revision,'THUMBNAIL_REVISION_INVALID',1), configChecksum:hash(input?.configChecksum),
    editorSessionId:id(input?.editorSessionId,'PROJECT_PREVIEW_EDITOR_SESSION_INVALID'), editGeneration:number(input?.editGeneration,'PROJECT_PREVIEW_GENERATION_INVALID'),
    rendererVersion,imageChecksum:hash(input?.imageChecksum),sizeBytes,captureMethod };
}
export async function getPreviewOperation(env, { organizationId,projectId,actorUserId,operationId }) {
  const db = previewDatabase(env); await requirePreviewSchema(db);
  return db.prepare('SELECT * FROM project_preview_operations WHERE organization_id=? AND project_id=? AND actor_user_id=? AND operation_id=?')
    .bind(organizationId,projectId,actorUserId,operationId).first();
}
export function publicPreviewOperation(op) {
  if (!op) return null;
  return { ...JSON.parse(op.manifest_json),state:op.state,artifactId:op.id,payloadStored:Boolean(op.payload_stored_at),
    receipt:op.receipt_json ? JSON.parse(op.receipt_json) : null,errorCode:op.error_code,nextAttemptAt:(op.state === 'RECEIVING' ? Math.max(Number(op.next_attempt_at || 0), Number(op.lease_until || 0)) : op.next_attempt_at) || null,
    terminal:PREVIEW_TERMINAL.has(op.state) };
}
async function receiptFor(db, op) {
  // The immutable revision link disambiguates save IDs scoped to different
  // actors. An authorized editor may recapture another editor's saved snapshot.
  const save = await db.prepare(`SELECT s.* FROM project_save_operations s WHERE ${op.save_operation_id ? 's.id=?' : 's.operation_id=?'}
    AND s.organization_id=? AND s.project_id=? AND s.state='PUBLISHED'
    AND EXISTS(SELECT 1 FROM project_config_revisions r WHERE r.save_operation_id=s.id
      AND r.project_id=s.project_id AND r.revision=? AND r.status='READY' AND r.checksum=?)`)
    .bind(op.save_operation_id || op.save_operation_key,op.organization_id,op.project_id,op.revision,op.config_checksum).first();
  const receipt = save?.receipt_json ? JSON.parse(save.receipt_json) : null;
  if (!save || !receipt || receipt.operationId !== op.save_operation_key || Number(receipt.organizationId) !== op.organization_id ||
    Number(receipt.projectId) !== op.project_id || Number(receipt.publishedRevision) !== op.revision || receipt.checksum !== op.config_checksum ||
    save.checksum !== op.config_checksum || save.expected_config_revision + 1 !== op.revision) throw previewError('PROJECT_PREVIEW_SAVE_RECEIPT_MISMATCH',409);
  return save;
}
// Shared authorization-generation fence from 0039, with independent preview
// journal/leases. No save journal row or save receipt is ever mutated here.
async function authorize(db,env,op) {
  const generation = await db.prepare('SELECT version FROM project_save_authorization_generation WHERE id=1').first();
  if (!generation) throw previewError('PROJECT_PREVIEW_SCHEMA_REQUIRED',503);
  const actor = await db.prepare('SELECT id,name,role,active FROM users WHERE id=?').bind(op.actor_user_id).first();
  const org = await db.prepare('SELECT active FROM organizations WHERE id=?').bind(op.organization_id).first();
  if (!actor?.active || !org?.active) throw previewError('PROJECT_PREVIEW_PERMISSION_REVOKED',403);
  actor.role = normalizeRole(actor.role); actor.activeOrganizationId = op.organization_id;
  const member = await db.prepare('SELECT access_level FROM organization_users WHERE user_id=? AND organization_id=?').bind(actor.id,op.organization_id).first();
  if (!member && actor.role !== 'super_admin') throw previewError('PROJECT_PREVIEW_PERMISSION_REVOKED',403);
  const project = await db.prepare(`SELECT p.*,up.access_level FROM projects p LEFT JOIN user_projects up ON up.project_id=p.id AND up.user_id=?
    WHERE p.id=? AND p.organization_id=?`).bind(actor.id,op.project_id,op.organization_id).first();
  const denials = await db.prepare('SELECT permission FROM user_permission_denials WHERE user_id=? AND organization_id=?').bind(actor.id,op.organization_id).all();
  if (actor.role !== 'super_admin' && (denials.results || []).some(r => r.permission === 'project.save')) throw previewError('PROJECT_PREVIEW_PERMISSION_REVOKED',403);
  if (!project || !project.active || (project.lifecycle_state != null && project.lifecycle_state !== 'ACTIVE')) throw previewError('PROJECT_PREVIEW_PROJECT_UNAVAILABLE',409);
  if (resolveEffectiveProjectMapRoute(actor,project).mode !== 'editor' || !(await can({...env,DB:db},actor,'project.save',{project,projectId:project.id,organizationId:op.organization_id})).allowed) throw previewError('PROJECT_PREVIEW_PERMISSION_REVOKED',403);
  const grants = await db.prepare("SELECT expires_at FROM user_permissions WHERE user_id=? AND active=1 AND permission IN ('project.save','project.map.edit') AND expires_at IS NOT NULL").bind(actor.id).all();
  const deadlines = (grants.results || []).map(r => Date.parse(r.expires_at)).filter(t => Number.isFinite(t) && t > Date.now());
  return { actor,project,generation:Number(generation.version),validUntil:deadlines.length ? Math.min(...deadlines) : Number.MAX_SAFE_INTEGER };
}
function assertCurrent(op,project) {
  if (Number(project.config_revision) !== op.revision || project.config_checksum !== op.config_checksum) throw previewError('PROJECT_PREVIEW_SUPERSEDED',409);
  if (project.dropbox_root_path !== op.storage_root || (project.default_config_file || 'config.kepler.json') !== op.config_file ||
    (project.organization_file_id ?? null) !== op.organization_file_id) throw previewError('PROJECT_PREVIEW_STORAGE_CONTEXT_CHANGED',409);
  if (project.preview_operation_id !== op.id || project.preview_operation_epoch !== op.project_epoch || (project.preview_artifact_id ?? null) !== op.expected_artifact_id) throw previewError('PROJECT_PREVIEW_SUPERSEDED',409);
}
export async function registerPreviewOperation(env,{ actor,project,manifest:input }) {
  const manifest = normalizePreviewManifest(input), db = previewDatabase(env);
  await requirePreviewSchema(db);
  if (String(project.id) !== manifest.projectId || String(project.organization_id) !== manifest.organizationId) throw previewError('PROJECT_PREVIEW_SCOPE_MISMATCH',409);
  const candidate = { organization_id:Number(manifest.organizationId),project_id:Number(manifest.projectId),actor_user_id:number(actor.id,'PROJECT_PREVIEW_ACTOR_INVALID',1),
    save_operation_key:manifest.saveOperationId,revision:manifest.revision,config_checksum:manifest.configChecksum };
  const auth = await authorize(db,env,candidate);
  const save = await receiptFor(db,candidate);
  const existing = await getPreviewOperation(env,{ organizationId:candidate.organization_id,projectId:candidate.project_id,actorUserId:candidate.actor_user_id,operationId:manifest.operationId });
  const serialized = JSON.stringify(manifest);
  if (existing) { if (existing.manifest_json !== serialized) throw previewError('PROJECT_PREVIEW_PAYLOAD_MISMATCH',409); return existing; }
  if (!enabled(env.PROJECT_PREVIEW_OPERATIONS_V1)) throw previewError('PROJECT_PREVIEW_ADMISSION_PAUSED',503);
  project = auth.project;
  if (project.config_revision !== manifest.revision || project.config_checksum !== manifest.configChecksum) throw previewError('PROJECT_PREVIEW_SUPERSEDED',409);
  const internalId = crypto.randomUUID(), epoch = Number(project.preview_operation_epoch || 0)+1;
  const op = { ...candidate,id:internalId,storage_root:project.dropbox_root_path,config_file:project.default_config_file || 'config.kepler.json' };
  const storageRef = previewArtifactRef(op);
  try {
    await db.batch([
      db.prepare(`UPDATE projects SET preview_operation_id=?,preview_operation_epoch=?,preview_attempts=preview_attempts+1,
        preview_status=CASE WHEN preview_status='READY' AND preview_revision=config_revision THEN 'READY' ELSE 'PENDING' END,
        preview_last_error=NULL,preview_capture_method=?
        WHERE id=? AND organization_id=? AND config_revision=? AND config_checksum=? AND active=1
          AND lifecycle_state IS ? AND lifecycle_version=? AND dropbox_root_path IS ? AND default_config_file IS ? AND organization_file_id IS ?
          AND preview_operation_id IS ? AND preview_operation_epoch=? AND preview_artifact_id IS ?
          AND EXISTS(SELECT 1 FROM project_save_authorization_generation WHERE id=1 AND version=?) AND ${NOW} < ?`)
        .bind(internalId,epoch,manifest.captureMethod,project.id,project.organization_id,manifest.revision,manifest.configChecksum,
          project.lifecycle_state,project.lifecycle_version,project.dropbox_root_path,project.default_config_file,project.organization_file_id,
          project.preview_operation_id,project.preview_operation_epoch,project.preview_artifact_id,auth.generation,auth.validUntil),guard(db),
      db.prepare(`INSERT INTO project_preview_operations(id,organization_id,project_id,actor_user_id,operation_id,save_operation_id,save_operation_key,
        revision,config_checksum,editor_session_id,edit_generation,renderer_version,image_checksum,size_bytes,capture_method,manifest_json,
        storage_root,config_file,organization_file_id,expected_artifact_id,project_epoch,storage_ref)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(internalId,candidate.organization_id,candidate.project_id,candidate.actor_user_id,manifest.operationId,save.id,save.operation_id,
          manifest.revision,manifest.configChecksum,manifest.editorSessionId,manifest.editGeneration,manifest.rendererVersion,manifest.imageChecksum,
          manifest.sizeBytes,manifest.captureMethod,serialized,op.storage_root,op.config_file,project.organization_file_id,project.preview_artifact_id,epoch,storageRef),
    ]);
  } catch (error) {
    const raced = await getPreviewOperation(env,{organizationId:candidate.organization_id,projectId:candidate.project_id,actorUserId:candidate.actor_user_id,operationId:manifest.operationId});
    if (raced) { if (raced.manifest_json !== serialized) throw previewError('PROJECT_PREVIEW_PAYLOAD_MISMATCH',409); return raced; }
    throw error;
  }
  return reload(db,op);
}
function verified(op,artifact) {
  if (!artifact?.contentVerified || artifact.storageRef !== op.storage_ref || artifact.imageChecksum !== op.image_checksum || artifact.sizeBytes !== op.size_bytes) throw previewError('PROJECT_PREVIEW_PAYLOAD_INTEGRITY_FAILED');
}
export async function markPreviewPayloadStored(env,{operation,artifact}) {
  const db = previewDatabase(env); verified(operation,artifact);
  const current = await reload(db,operation);
  if (current.payload_stored_at || PREVIEW_TERMINAL.has(current.state)) return current;
  await db.batch([
    db.prepare(`UPDATE project_preview_operations SET state='PAYLOAD_STORED',payload_stored_at=CURRENT_TIMESTAMP,
      storage_provider=?,storage_provider_version=?,lease_owner=NULL,lease_until=NULL,error_code=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND state='RECEIVING' AND lease_epoch=? AND lease_owner=? AND lease_until > ${NOW}`)
      .bind(artifact.storageProvider,artifact.storageProviderVersion ?? null,operation.id,operation.lease_epoch,operation.lease_owner),guard(db),
    db.prepare('INSERT INTO project_preview_outbox(operation_id) VALUES(?) ON CONFLICT(operation_id) DO NOTHING').bind(operation.id),
  ]);
  return reload(db,operation);
}
async function finish(db,op,state,code) {
  const current = await reload(db,op);
  if (!current || PREVIEW_TERMINAL.has(current.state) || current.lease_epoch !== op.lease_epoch || current.lease_owner !== op.lease_owner) return current;
  await db.batch([
    db.prepare(`UPDATE project_preview_operations SET state=?,error_code=?,lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND state=? AND lease_epoch=? AND lease_owner IS ?`).bind(state,code,op.id,op.state,op.lease_epoch,op.lease_owner),guard(db),
    db.prepare(`UPDATE projects SET preview_status=CASE WHEN preview_status='READY' AND preview_revision=config_revision THEN 'READY' ELSE 'FAILED' END,
      preview_last_error=?,preview_updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND organization_id=? AND config_revision=? AND config_checksum=? AND preview_operation_id=? AND preview_operation_epoch=?
        AND EXISTS(SELECT 1 FROM project_preview_operations WHERE id=? AND state=? AND lease_epoch=?)`)
      .bind(code,op.project_id,op.organization_id,op.revision,op.config_checksum,op.id,op.project_epoch,op.id,state,op.lease_epoch),
    db.prepare("UPDATE project_preview_outbox SET state='DONE',updated_at=CURRENT_TIMESTAMP WHERE operation_id=?").bind(op.id),
  ]);
  return reload(db,op);
}
function expired(op) { return Date.now()-Date.parse(op.created_at.replace(' ','T')+(op.created_at.endsWith('Z')?'':'Z')) > RETENTION_MS; }
function retryDelay(attempt) { return Math.round(Math.min(3600000,1000*2**Math.min(attempt,12))*(0.8+Math.random()*0.4)); }
async function failed(db,env,op,error,{upload=false}={}) {
  let current = await reload(db,op);
  if (!current || PREVIEW_TERMINAL.has(current.state) || current.lease_epoch !== op.lease_epoch || current.lease_owner !== op.lease_owner) return current;
  let reason = error;
  try { const auth = await authorize(db,env,op); await receiptFor(db,op); assertCurrent(op,auth.project); } catch (e) { reason=e; }
  const code = codeOf(reason);
  if (['PROJECT_PREVIEW_SUPERSEDED','PROJECT_PREVIEW_STORAGE_CONTEXT_CHANGED','PROJECT_PREVIEW_PROJECT_UNAVAILABLE'].includes(code)) return finish(db,op,'SUPERSEDED',code);
  if ([400,403,404,413,422].includes(Number(reason.status)) || code === 'PROJECT_PREVIEW_SAVE_RECEIPT_MISMATCH') return finish(db,op,'FAILED_FINAL',code);
  if ((upload ? op.upload_attempts : op.attempts) >= MAX_ATTEMPTS || expired(op)) return finish(db,op,'FAILED_FINAL','PROJECT_PREVIEW_RETRY_EXHAUSTED');
  const next = Date.now()+retryDelay(upload ? op.upload_attempts : op.attempts);
  if (upload) {
    // Keep RECEIVING: a failed response does not prove storage was never written.
    await db.prepare(`UPDATE project_preview_operations SET lease_until=?,next_attempt_at=?,error_code=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND state='RECEIVING' AND lease_epoch=? AND lease_owner=?`).bind(next,next,code,op.id,op.lease_epoch,op.lease_owner).run();
  } else await db.batch([
    db.prepare(`UPDATE project_preview_operations SET state='RETRY_WAIT',next_attempt_at=?,error_code=?,lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND state='PROCESSING' AND lease_epoch=? AND lease_owner=?`).bind(next,code,op.id,op.lease_epoch,op.lease_owner),guard(db),
    db.prepare('UPDATE project_preview_outbox SET available_at=?,updated_at=CURRENT_TIMESTAMP WHERE operation_id=?').bind(next,op.id),
  ]);
  return reload(db,op);
}
export async function failPreviewUpload(env,{operation,error}) { return failed(previewDatabase(env),env,operation,error,{upload:true}); }
export async function acquirePreviewUpload(env,{operation,owner=crypto.randomUUID()}) {
  const db = previewDatabase(env); let op = await reload(db,operation);
  if (!op) throw previewError('PROJECT_PREVIEW_OPERATION_NOT_FOUND',404);
  if (op.payload_stored_at || PREVIEW_TERMINAL.has(op.state)) return op;
  const auth = await authorize(db,env,op); await receiptFor(db,op);
  try { assertCurrent(op,auth.project); } catch (e) { return finish(db,op,'SUPERSEDED',codeOf(e)); }
  if (op.state==='RECEIVING' && Number(op.lease_until)<=Date.now()) op=await recoverPreviewUpload(env,{operation:op});
  if (op.payload_stored_at || PREVIEW_TERMINAL.has(op.state)) return op;
  if (op.upload_attempts>=MAX_ATTEMPTS || expired(op)) return finish(db,op,'FAILED_FINAL','PROJECT_PREVIEW_RETRY_EXHAUSTED');
  const claimed = await db.prepare(`UPDATE project_preview_operations SET state='RECEIVING',lease_epoch=lease_epoch+1,
    lease_owner=?,lease_until=?,upload_attempts=upload_attempts+1,error_code=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND state='WAITING_CAPTURE' AND next_attempt_at<=${NOW} RETURNING *`).bind(owner,Date.now()+LEASE_MS,op.id).first();
  if (!claimed) throw previewError('PROJECT_PREVIEW_UPLOAD_BUSY',409);
  return claimed;
}
export async function recoverPreviewUpload(env,{operation,owner=crypto.randomUUID(),verifyPayload=verifyStoredPreview}) {
  const db=previewDatabase(env);
  const op=await db.prepare(`UPDATE project_preview_operations SET lease_epoch=lease_epoch+1,lease_owner=?,lease_until=?,
    upload_attempts=upload_attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='RECEIVING' AND lease_until<=${NOW} RETURNING *`)
    .bind(owner,Date.now()+LEASE_MS,operation.id).first();
  if (!op) return reload(db,operation);
  try {
    const auth=await authorize(db,env,op); await receiptFor(db,op); assertCurrent(op,auth.project);
    const artifact=await verifyPayload(env,{operation:op,project:auth.project,missingAllowed:true});
    if (artifact) return markPreviewPayloadStored(env,{operation:op,artifact});
    if (op.upload_attempts>=MAX_ATTEMPTS || expired(op)) return finish(db,op,'FAILED_FINAL','PROJECT_PREVIEW_RETRY_EXHAUSTED');
    await db.prepare(`UPDATE project_preview_operations SET state='WAITING_CAPTURE',lease_owner=NULL,lease_until=NULL,
      next_attempt_at=0,error_code='PROJECT_PREVIEW_UPLOAD_INCOMPLETE',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND state='RECEIVING' AND lease_epoch=? AND lease_owner=?`).bind(op.id,op.lease_epoch,op.lease_owner).run();
    return reload(db,op);
  } catch(error) { return failed(db,env,op,error,{upload:true}); }
}
export async function failWaitingPreview(env,{operation,errorCode='CLIENT_CAPTURE_FAILED'}) {
  const db=previewDatabase(env), op=await reload(db,operation);
  if (!op || op.state!=='WAITING_CAPTURE') return op;
  return finish(db,op,'FAILED_FINAL',codeOf({code:errorCode}));
}
async function publish(db,op,auth) {
  const startedAt=Date.now();
  const p=auth.project; assertCurrent(op,p); await receiptFor(db,op);
  const receipt={...JSON.parse(op.manifest_json),artifactId:op.id,committedAt:new Date().toISOString()};
  await db.batch([
    db.prepare(`UPDATE projects SET preview_status='READY',preview_revision=?,preview_artifact_id=?,preview_updated_at=CURRENT_TIMESTAMP,
      preview_last_error=NULL,preview_capture_method=?
      WHERE id=? AND organization_id=? AND config_revision=? AND config_checksum=? AND active=? AND active=1
        AND lifecycle_state IS ? AND lifecycle_version=? AND dropbox_root_path IS ? AND default_config_file IS ? AND organization_file_id IS ?
        AND preview_operation_id=? AND preview_operation_epoch=? AND preview_artifact_id IS ? AND preview_status IS ? AND preview_revision IS ?
        AND EXISTS(SELECT 1 FROM project_preview_operations WHERE id=? AND state='PROCESSING' AND lease_epoch=? AND lease_owner=? AND lease_until>${NOW})
        AND EXISTS(SELECT 1 FROM project_save_authorization_generation WHERE id=1 AND version=?) AND ${NOW}<?`)
      .bind(op.revision,op.id,op.capture_method,p.id,p.organization_id,op.revision,op.config_checksum,p.active,p.lifecycle_state,p.lifecycle_version,
        p.dropbox_root_path,p.default_config_file,p.organization_file_id,op.id,op.project_epoch,op.expected_artifact_id,p.preview_status,p.preview_revision,
        op.id,op.lease_epoch,op.lease_owner,auth.generation,auth.validUntil),guard(db),
    db.prepare(`UPDATE project_preview_operations SET state='READY',receipt_json=?,lease_owner=NULL,lease_until=NULL,error_code=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND state='PROCESSING' AND lease_epoch=? AND lease_owner=?`).bind(JSON.stringify(receipt),op.id,op.lease_epoch,op.lease_owner),guard(db),
    db.prepare("UPDATE project_preview_outbox SET state='DONE',updated_at=CURRENT_TIMESTAMP WHERE operation_id=?").bind(op.id),
  ]);
  logPreviewServerMetric('publication', { durationMs:Date.now()-startedAt, bytes:op.size_bytes, attempts:op.attempts });
  return reload(db,op);
}
export async function processPreviewOperation(env,{operation,verifyPayload=verifyStoredPreview,owner=crypto.randomUUID()}) {
  const db=previewDatabase(env), current=await reload(db,operation);
  if (!current || PREVIEW_TERMINAL.has(current.state) || !previewProcessorEnabled(env)) return current;
  const op=await db.prepare(`UPDATE project_preview_operations SET state='PROCESSING',lease_epoch=lease_epoch+1,lease_owner=?,lease_until=?,
    attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND payload_stored_at IS NOT NULL
    AND ((state IN ('PAYLOAD_STORED','RETRY_WAIT') AND next_attempt_at<=${NOW}) OR (state='PROCESSING' AND lease_until<=${NOW}))
    AND EXISTS(SELECT 1 FROM project_preview_outbox WHERE operation_id=project_preview_operations.id AND state='PENDING') RETURNING *`)
    .bind(owner,Date.now()+LEASE_MS,current.id).first();
  if (!op) return reload(db,current);
  try {
    if (op.attempts>MAX_ATTEMPTS || expired(op)) return finish(db,op,'FAILED_FINAL','PROJECT_PREVIEW_RETRY_EXHAUSTED');
    const auth=await authorize(db,env,op); await receiptFor(db,op); assertCurrent(op,auth.project);
    verified(op,await verifyPayload(env,{operation:op,project:auth.project}));
    // Slow provider reads cannot extend old permission or project snapshots.
    return await publish(db,op,await authorize(db,env,op));
  } catch(error) { return failed(db,env,op,error); }
}
export async function reconcilePreviewOperations(env,{limit=10}={}) {
  if (!previewProcessorEnabled(env)) return {disabled:true};
  const db=previewDatabase(env);
  const rows=await db.prepare(`SELECT * FROM project_preview_operations WHERE
    (state='RECEIVING' AND lease_until<=${NOW}) OR (state IN ('PAYLOAD_STORED','RETRY_WAIT') AND next_attempt_at<=${NOW})
    OR (state='PROCESSING' AND lease_until<=${NOW}) OR (state='WAITING_CAPTURE' AND created_at<datetime('now','-1 day'))
    ORDER BY created_at,id LIMIT ?`).bind(Math.max(1,Math.min(25,limit))).all();
  const summary={inspected:0,ready:0,failed:0,oldestAgeMs:0};
  const recoveryStarted=Date.now();
  for (let op of rows.results || []) {
    summary.inspected++;
    const created=Date.parse(String(op.created_at).replace(' ','T')+'Z');
    if(Number.isFinite(created)) summary.oldestAgeMs=Math.max(summary.oldestAgeMs,Date.now()-created);
    try {
      if (op.state==='WAITING_CAPTURE') op=await finish(db,op,'FAILED_FINAL','PROJECT_PREVIEW_CAPTURE_EXPIRED');
      if (op.state==='RECEIVING') op=await recoverPreviewUpload(env,{operation:op});
      if (op.payload_stored_at && !PREVIEW_TERMINAL.has(op.state)) op=await processPreviewOperation(env,{operation:op});
      if (op.state==='READY') summary.ready++; if (op.state==='FAILED_FINAL') summary.failed++;
    } catch { summary.failed++; }
  }
  logPreviewServerMetric('recovery', { ...summary, durationMs:Date.now()-recoveryStarted });
  return summary;
}

// Replaying a successful PUT is a new authenticated read. Historical receipts
// remain immutable, but cannot substitute for a current object/permission check.
export async function verifyReadyPreviewReceipt(env, { operation }) {
  const db = previewDatabase(env), current = await reload(db, operation);
  if (current?.state !== 'READY') throw previewError('PROJECT_PREVIEW_NOT_READY', 409);
  const auth = await authorize(db, env, current); await receiptFor(db, current);
  await verifyStoredPreview(env, { operation: current, project: auth.project });
  const finalAuth = await authorize(db, env, current); await receiptFor(db, current);
  if (finalAuth.project.dropbox_root_path !== current.storage_root ||
    (finalAuth.project.default_config_file || 'config.kepler.json') !== current.config_file ||
    (finalAuth.project.organization_file_id ?? null) !== current.organization_file_id) throw previewError('PROJECT_PREVIEW_STORAGE_CONTEXT_CHANGED', 409);
  return current;
}
