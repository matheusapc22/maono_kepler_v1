import { normalizeRole } from './auth.js';
import { isLocalStorageMode } from './local-storage.js';
import { can } from './permissions.js';
import { resolveEffectiveProjectMapRoute } from './project-map-route-policy.js';

export const PROJECT_SAVE_OPERATION_CAPABILITY = 1;
export const PROJECT_SAVE_TERMINAL_STATES = new Set(['PUBLISHED', 'CONFLICT', 'FAILED_FINAL']);
const MAX_ATTEMPTS = 8;
const UPLOAD_LEASE_MS = 10 * 60 * 1000;
const PROCESS_LEASE_MS = 5 * 60 * 1000;
const UPLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PROCESS_RETENTION_MS = 24 * 60 * 60 * 1000;
const NOW_SQL = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

function failure(code, status = 409, message = 'Não foi possível concluir esta operação de salvamento.') {
  return Object.assign(new Error(message), { code, status });
}
function database(env) {
  const raw = env?.DB || env?.D1 || env?.MAONO_DB;
  if (!raw?.prepare || !raw?.batch) throw failure('DATABASE_NOT_CONFIGURED', 503);
  // Missing results on a lagging replica must never be interpreted as safe ID reuse.
  return typeof raw.withSession === 'function' ? raw.withSession('first-primary') : raw;
}
function integer(value, code, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw failure(code, 400);
  return result;
}
function safeCode(error) {
  const code = String(error?.code || 'PROJECT_SAVE_TEMPORARY_FAILURE');
  return /^[A-Z0-9_]{1,120}$/.test(code) ? code : 'PROJECT_SAVE_TEMPORARY_FAILURE';
}
function domainOf(operation) { return JSON.parse(operation.domain_json || '{}'); }
function scopeOf(operation) {
  return { organizationId: operation.organization_id, actorUserId: operation.actor_user_id, operationId: operation.operation_id };
}
function guard(db) {
  return db.prepare('INSERT INTO project_save_transaction_guard(value) VALUES (CASE WHEN changes() = 1 THEN 1 ELSE 0 END)');
}
function scopedSelect(db, { organizationId, actorUserId, operationId, projectId }) {
  let sql = 'SELECT * FROM project_save_operations WHERE organization_id = ? AND actor_user_id = ? AND operation_id = ?';
  const values = [organizationId, actorUserId, operationId];
  if (projectId != null) { sql += ' AND project_id = ?'; values.push(projectId); }
  return db.prepare(sql).bind(...values);
}
export async function getProjectSaveOperation(env, scope) {
  return scopedSelect(database(env), scope).first();
}
async function reload(db, operation) {
  return scopedSelect(db, scopeOf(operation)).first();
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
async function fingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(stable(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function normalizeProjectSaveManifest(input) {
  const algorithm = String(input?.checksumAlgorithm || '').toLowerCase();
  const checksum = String(input?.checksum ?? input?.contentHash ?? '').toLowerCase();
  const sizeBytes = integer(input?.sizeBytes ?? input?.payloadBytes, 'PROJECT_SAVE_SIZE_INVALID', 1);
  if (algorithm !== 'dropbox-content-hash' || !/^[a-f0-9]{64}$/.test(checksum)) throw failure('PROJECT_SAVE_CHECKSUM_INVALID', 400);
  if (sizeBytes > 104857600) throw failure('PROJECT_CONFIG_TOO_LARGE', 413);
  const serializationVersion = integer(input?.serializationVersion, 'PROJECT_SAVE_SERIALIZATION_INVALID', 1);
  if (serializationVersion !== 1) throw failure('PROJECT_SAVE_SERIALIZATION_UNSUPPORTED', 400);
  const schemaName = input?.schemaName || 'legacy-kepler';
  const schemaVersion = integer(input?.schemaVersion ?? 1, 'PROJECT_CONFIG_SCHEMA_INVALID', 1);
  if (schemaName !== 'legacy-kepler' || schemaVersion !== 1) throw failure('PROJECT_CONFIG_SCHEMA_INVALID', 400);
  return { checksumAlgorithm: algorithm, checksum, sizeBytes, serializationVersion, schemaName, schemaVersion,
    contentType: 'application/json; charset=utf-8',
    configVersion: input?.configVersion == null ? null : String(input.configVersion).slice(0, 64),
    datasetCount: input?.datasetCount == null ? null : integer(input.datasetCount, 'PROJECT_SAVE_DATASET_COUNT_INVALID') };
}

// The existing policy is evaluated on fresh records. Its generation is captured
// first, then fenced in the publication transaction. Grant expiry is also fenced
// by database time, because clocks passing an expires_at do not fire SQL triggers.
async function authorization(db, env, operation) {
  const generation = await db.prepare('SELECT version FROM project_save_authorization_generation WHERE id = 1').first();
  if (!generation) throw failure('PROJECT_SAVE_SCHEMA_OUTDATED', 503);
  const actor = await db.prepare('SELECT id, name, role, active FROM users WHERE id = ?').bind(operation.actor_user_id).first();
  const organization = await db.prepare('SELECT id, active FROM organizations WHERE id = ?').bind(operation.organization_id).first();
  if (!actor?.active || !organization?.active) throw failure('PROJECT_SAVE_PERMISSION_REVOKED', 403);
  actor.role = normalizeRole(actor.role);
  actor.activeOrganizationId = operation.organization_id;
  const membership = await db.prepare('SELECT access_level FROM organization_users WHERE user_id = ? AND organization_id = ?')
    .bind(actor.id, operation.organization_id).first();
  if (!membership && actor.role !== 'super_admin') throw failure('PROJECT_SAVE_PERMISSION_REVOKED', 403);
  let project = null;
  if (operation.project_id != null) {
    project = await db.prepare(`SELECT p.*, up.access_level FROM projects p LEFT JOIN user_projects up
      ON up.project_id = p.id AND up.user_id = ? WHERE p.id = ? AND p.organization_id = ?`)
      .bind(actor.id, operation.project_id, operation.organization_id).first();
    if (!project) throw failure('PROJECT_NOT_FOUND', 404);
  }
  const context = { project, projectId: project?.id, organizationId: operation.organization_id };
  const permission = operation.kind === 'create' ? 'project.create' : 'project.save';
  // can() preserves optional-table compatibility for old readers. Here denial
  // reads must fail closed: a transient read error cannot erase a revocation.
  const denials = await db.prepare('SELECT permission FROM user_permission_denials WHERE user_id = ? AND organization_id = ?')
    .bind(actor.id, operation.organization_id).all();
  if (actor.role !== 'super_admin' && (denials.results || []).some(row => row.permission === permission ||
      (operation.kind === 'change-request' && row.permission === 'project.map.edit'))) throw failure('PROJECT_SAVE_PERMISSION_REVOKED', 403);
  if (!(await can({ ...env, DB: db }, actor, permission, context)).allowed) throw failure('PROJECT_SAVE_PERMISSION_REVOKED', 403);
  if (operation.kind !== 'create') {
    if (resolveEffectiveProjectMapRoute(actor, project).mode !== 'editor') throw failure('PROJECT_SAVE_PERMISSION_REVOKED', 403);
    if (!project?.active) throw failure('PROJECT_CONFIG_LIFECYCLE_BLOCKED');
  }
  const domain = operation.domain_json ? domainOf(operation) : operation.domain || {};
  if (domain.importFileId != null) {
    if (!(await can({ ...env, DB: db }, actor, 'admin.panel.access', context)).allowed) throw failure('PROJECT_SAVE_PERMISSION_REVOKED', 403);
    const source = await db.prepare('SELECT id FROM organization_files WHERE id = ? AND organization_id = ? AND active = 1')
      .bind(domain.importFileId, operation.organization_id).first();
    if (!source) throw failure('PROJECT_CREATION_IMPORT_SOURCE_UNAVAILABLE', 409);
  }
  if (operation.kind === 'change-request') {
    if (resolveEffectiveProjectMapRoute(actor, project).mode !== 'editor' || !(await can({ ...env, DB: db }, actor, 'project.map.edit', context)).allowed) {
      throw failure('CHANGE_REQUEST_APPLY_FORBIDDEN', 403);
    }
  }
  const grants = await db.prepare(`SELECT expires_at FROM user_permissions WHERE user_id = ? AND active = 1
    AND permission IN ('project.save','project.map.edit','project.create') AND expires_at IS NOT NULL`)
    .bind(actor.id).all();
  const expirations = (grants.results || []).map(row => Date.parse(row.expires_at)).filter(value => Number.isFinite(value) && value > Date.now());
  return { generation: Number(generation.version), actor, project, validUntil: expirations.length ? Math.min(...expirations) : Number.MAX_SAFE_INTEGER };
}

export async function registerProjectSaveOperation(env, options) {
  const db = database(env);
  const manifest = normalizeProjectSaveManifest(options.manifest || options);
  const operationId = String(options.operationId || options.manifest?.operationId || '');
  if (!/^[A-Za-z0-9:_-]{12,128}$/.test(operationId)) throw failure('PROJECT_SAVE_OPERATION_ID_INVALID', 400);
  const organizationId = integer(options.organizationId ?? options.project?.organization_id, 'PROJECT_ORGANIZATION_INVALID', 1);
  const actorId = integer(options.actor?.id ?? options.actorUserId, 'PROJECT_SAVE_ACTOR_INVALID', 1);
  const requestedKind = options.kind || options.operation || options.manifest?.operation || 'update';
  const kind = requestedKind === 'change_request' ? 'change-request' : requestedKind;
  if (!['update','legacy-promotion','create','change-request'].includes(kind)) throw failure('PROJECT_SAVE_KIND_INVALID', 400);
  const expected = integer(options.expectedConfigRevision ?? options.manifest?.expectedConfigRevision, 'PROJECT_CONFIG_EXPECTED_REVISION_INVALID');
  const projectId = options.project?.id ?? options.projectId ?? null;
  if (!projectId && kind !== 'create') throw failure('PROJECT_ID_INVALID', 400);
  const domain = { ...(options.domain || {}) };
  if (domain.expectedChangeRequestVersion != null) { domain.changeRequestVersion = domain.expectedChangeRequestVersion; delete domain.expectedChangeRequestVersion; }
  if (kind === 'change-request' && (!domain.changeRequestId || domain.changeRequestVersion == null)) throw failure('CHANGE_REQUEST_VERSION_REQUIRED', 400);
  if (kind === 'create') {
    if (expected !== 0) throw failure('PROJECT_CREATION_REVISION_INVALID', 400);
    domain.creationKey = domain.creationKey || options.manifest?.creationKey || options.creationKey || operationId;
  }
  const target = kind === 'create' ? `creation:${domain.creationKey}` : `project:${integer(projectId, 'PROJECT_ID_INVALID', 1)}`;
  const immutableDomain = { ...domain };
  delete immutableDomain.reservationId;
  delete immutableDomain.quotaReservationId;
  const digest = await fingerprint({ organizationId, actorId, operationId, target, kind, expected, manifest, domain: immutableDomain });
  const scope = { organizationId, actorUserId: actorId, operationId };
  const existing = await scopedSelect(db, scope).first();
  if (existing) {
    if (existing.manifest_fingerprint !== digest || (projectId != null && existing.project_id != null && Number(existing.project_id) !== Number(projectId))) throw failure('OPERATION_PAYLOAD_MISMATCH');
    return existing;
  }
  if (String(env?.PROJECT_DURABLE_SAVE_V1).toLowerCase() !== 'true') throw failure('PROJECT_DURABLE_SAVE_PAUSED', 503);
  const candidate = { actor_user_id: actorId, organization_id: organizationId, project_id: projectId, kind, domain: immutableDomain };
  const auth = await authorization(db, env, candidate);
  const id = crypto.randomUUID();
  try {
    const inserted = await db.prepare(`INSERT INTO project_save_operations (
      id, organization_id, actor_user_id, operation_id, project_id, target_key, kind, expected_config_revision,
      manifest_fingerprint, checksum_algorithm, checksum, size_bytes, serialization_version, schema_name,
      schema_version, content_type, config_version, dataset_count, domain_json, reservation_id, quota_reservation_id)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE EXISTS (SELECT 1 FROM project_save_authorization_generation WHERE id = 1 AND version = ?)
        AND ${NOW_SQL} < ? RETURNING *`).bind(id, organizationId, actorId, operationId, projectId, target, kind, expected,
      digest, manifest.checksumAlgorithm, manifest.checksum, manifest.sizeBytes, manifest.serializationVersion,
      manifest.schemaName, manifest.schemaVersion, manifest.contentType, manifest.configVersion, manifest.datasetCount,
      JSON.stringify(stable(immutableDomain)), domain.reservationId ?? null, domain.quotaReservationId ?? null,
      auth.generation, auth.validUntil).first();
    if (!inserted) throw failure('PROJECT_SAVE_AUTHORIZATION_CHANGED');
    return inserted;
  } catch (error) {
    const raced = await scopedSelect(db, scope).first();
    if (raced) {
      if (raced.manifest_fingerprint !== digest) throw failure('OPERATION_PAYLOAD_MISMATCH');
      return raced;
    }
    throw error;
  }
}

export async function bindProjectSaveOperationProject(env, { operation, project, reservationId, quotaReservationId = null }) {
  const db = database(env);
  const bound = await db.prepare(`UPDATE project_save_operations SET project_id = ?, reservation_id = ?, quota_reservation_id = ?,
    version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND kind = 'create' AND state = 'AWAITING_UPLOAD' AND project_id IS NULL
      AND EXISTS (SELECT 1 FROM projects p JOIN organization_files f ON f.id = ?
        WHERE p.id = ? AND p.organization_id = project_save_operations.organization_id
          AND p.created_by = project_save_operations.actor_user_id AND f.project_id = p.id
          AND f.organization_id = p.organization_id AND f.uploaded_by = project_save_operations.actor_user_id
          AND f.idempotency_key = json_extract(project_save_operations.domain_json, '$.creationKey')) RETURNING *`)
    .bind(project.id, reservationId, quotaReservationId, operation.id, reservationId, project.id).first();
  if (bound) return bound;
  const current = await reload(db, operation);
  if (current?.project_id === project.id && current?.reservation_id === reservationId) return current;
  throw failure('OPERATION_PAYLOAD_MISMATCH');
}

export function publicProjectSaveOperation(operation, project = null) {
  if (!operation) return null;
  const receipt = operation.receipt_json ? JSON.parse(operation.receipt_json) : null;
  const terminal = PROJECT_SAVE_TERMINAL_STATES.has(operation.state);
  return { operationId: operation.operation_id, organizationId: operation.organization_id, projectId: operation.project_id,
    state: operation.state, stage: operation.stage,
    nextAction: operation.state === 'AWAITING_UPLOAD' ? 'UPLOAD' : terminal ? (receipt ? 'NONE' : 'REVIEW') : 'POLL',
    receipt, currentRevision: project?.config_revision == null ? null : Number(project.config_revision),
    expectedConfigRevision: operation.expected_config_revision, createdAt: operation.created_at, updatedAt: operation.updated_at,
    errorCode: operation.error_code || null, retryAt: operation.next_attempt_at || null,
    payloadStored: Boolean(operation.payload_stored_at), terminal };
}

async function storageFunctions() { return import('./project-save-operation-payload.js'); }
async function recoverStorage(env, args, recoverPayload) {
  return recoverPayload ? recoverPayload(env, args) : (await storageFunctions()).recoverStoredProjectSaveOperation(env, args);
}
async function verifyStorage(env, args, verifyPayload) {
  return verifyPayload ? verifyPayload(env, args) : (await storageFunctions()).verifyStoredProjectSaveOperation(env, args);
}
export async function acquireProjectSaveUpload(env, { operation, owner = crypto.randomUUID(), recoverPayload = null }) {
  const db = database(env);
  let current = await reload(db, operation);
  if (!current) throw failure('PROJECT_SAVE_OPERATION_NOT_FOUND', 404);
  if (current.payload_stored_at || PROJECT_SAVE_TERMINAL_STATES.has(current.state)) return current;
  await authorization(db, env, current);
  if (current.state === 'RECEIVING' && Number(current.lease_until) <= Date.now()) {
    current = await recoverProjectSaveUpload(env, { operation: current, recoverPayload });
    if (current.payload_stored_at || PROJECT_SAVE_TERMINAL_STATES.has(current.state)) return current;
  }
  if (current.upload_attempts >= MAX_ATTEMPTS) return finalizeWithoutPublication(db, current, 'FAILED_FINAL', 'PROJECT_SAVE_UPLOAD_RETRY_EXHAUSTED');
  const claimed = await db.prepare(`UPDATE project_save_operations SET state = 'RECEIVING', stage = 'UPLOAD',
    upload_epoch = upload_epoch + 1, lease_epoch = lease_epoch + 1, upload_attempts = upload_attempts + 1,
    lease_owner = ?, lease_until = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP, error_code = NULL
    WHERE id = ? AND project_id IS NOT NULL AND state = 'AWAITING_UPLOAD' RETURNING *`)
    .bind(owner, Date.now() + UPLOAD_LEASE_MS, current.id).first();
  if (!claimed) throw failure('PROJECT_SAVE_UPLOAD_BUSY');
  return claimed;
}
function verifiedArtifact(env, operation, artifact) {
  if (artifact?.contentVerified !== true || String(artifact.checksum).toLowerCase() !== operation.checksum ||
      artifact.checksumAlgorithm !== operation.checksum_algorithm || Number(artifact.sizeBytes) !== Number(operation.size_bytes) ||
      !artifact.storageRef || (artifact.storageProvider || artifact.provider) !== (isLocalStorageMode(env) ? 'local-d1' : 'dropbox')) throw failure('PROJECT_SAVE_PAYLOAD_INTEGRITY_FAILED', 422);
  // Ref ownership is checked again by the storage verifier before publication.
  return artifact;
}
export async function markProjectSavePayloadStored(env, { operation, uploadEpoch = operation.upload_epoch, artifact }) {
  const db = database(env);
  verifiedArtifact(env, operation, artifact);
  const current = await reload(db, operation);
  if (current?.payload_stored_at || PROJECT_SAVE_TERMINAL_STATES.has(current?.state)) return current;
  await db.batch([
    db.prepare(`UPDATE project_save_operations SET state = 'PAYLOAD_STORED', stage = 'STORED', storage_provider = ?,
      storage_ref = ?, storage_provider_version = ?, storage_provider_hash = ?, payload_stored_at = CURRENT_TIMESTAMP,
      lease_owner = NULL, lease_until = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP, error_code = NULL
      WHERE id = ? AND state = 'RECEIVING' AND upload_epoch = ? AND lease_epoch = ? AND lease_owner = ? AND lease_until > ${NOW_SQL}`)
      .bind(artifact.storageProvider || artifact.provider, artifact.storageRef, artifact.storageProviderVersion ?? artifact.providerVersion ?? null,
        artifact.storageProviderHash ?? artifact.providerHash ?? null, operation.id, uploadEpoch, operation.lease_epoch, operation.lease_owner),
    guard(db),
    db.prepare("INSERT INTO project_save_outbox(operation_id,effect) VALUES (?,'PROCESS') ON CONFLICT(operation_id,effect) DO NOTHING").bind(operation.id),
  ]);
  return reload(db, operation);
}

export function manifestFromProjectSaveOperation(operation) {
  return { checksumAlgorithm: operation.checksum_algorithm, checksum: operation.checksum, contentHash: operation.checksum,
    sizeBytes: operation.size_bytes, payloadBytes: operation.size_bytes, serializationVersion: operation.serialization_version,
    schemaName: operation.schema_name, schemaVersion: operation.schema_version, contentType: operation.content_type,
    configVersion: operation.config_version, datasetCount: operation.dataset_count };
}
async function finalizeWithoutPublication(db, operation, state, code, expectedState = null) {
  const statements = [db.prepare(`UPDATE project_save_operations SET state = ?, stage = 'TERMINAL', error_code = ?, lease_owner = NULL,
    lease_until = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_epoch = ?
    AND state NOT IN ('PUBLISHED','CONFLICT','FAILED_FINAL') AND (? IS NULL OR state = ?)`)
    .bind(state, code, operation.id, operation.lease_epoch, expectedState, expectedState)];
  // The migration's operation-terminal trigger closes an exact applying CR
  // and appends its journal, including deletion-triggered terminal failures.
  statements.push(db.prepare(`UPDATE project_save_outbox SET state = 'DONE', updated_at = CURRENT_TIMESTAMP WHERE operation_id = ?
    AND effect = 'PROCESS' AND EXISTS (SELECT 1 FROM project_save_operations WHERE id = ? AND state IN ('PUBLISHED','CONFLICT','FAILED_FINAL'))`)
    .bind(operation.id, operation.id));
  await db.batch(statements);
  return reload(db, operation);
}

function permanent(error) {
  return safeCode(error) === 'PROJECT_SAVE_LEGACY_CANDIDATE_RECONCILIATION_REQUIRED' ||
    [400, 403, 404, 413, 422].includes(Number(error?.status)) ||
    /INTEGRITY|CHECKSUM|SCHEMA_INVALID|SERIALIZATION|JSON_INVALID|PAYLOAD_MISMATCH/.test(safeCode(error));
}
export async function failProjectSaveUpload(env, { operation, uploadEpoch = operation.upload_epoch, error }) {
  const db = database(env);
  if (Number(uploadEpoch) !== Number(operation.upload_epoch)) throw failure('PROJECT_SAVE_UPLOAD_FENCED');
  if (permanent(error)) return finalizeWithoutPublication(db, operation, 'FAILED_FINAL', safeCode(error), 'RECEIVING');
  // A failed response does not mean Dropbox failed. Keep the object/epoch and let
  // a new fenced owner inspect it before allowing a different upload attempt.
  await db.prepare(`UPDATE project_save_operations SET lease_until = 0, error_code = ?, updated_at = CURRENT_TIMESTAMP,
    version = version + 1 WHERE id = ? AND state = 'RECEIVING' AND upload_epoch = ? AND lease_epoch = ? AND lease_owner = ?`)
    .bind(safeCode(error), operation.id, uploadEpoch, operation.lease_epoch, operation.lease_owner).run();
  return reload(db, operation);
}
export async function recoverProjectSaveUpload(env, { operation, recoverPayload = null }) {
  const db = database(env);
  const owner = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE project_save_operations SET lease_epoch = lease_epoch + 1,
    lease_owner = ?, lease_until = ?, attempts = attempts + 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND state = 'RECEIVING' AND lease_until <= ${NOW_SQL} RETURNING *`)
    .bind(owner, Date.now() + PROCESS_LEASE_MS, operation.id).first();
  if (!claimed) return reload(db, operation);
  try {
    const { project } = await authorization(db, env, claimed);
    const artifact = await recoverStorage(env, { operation: claimed, project }, recoverPayload);
    if (artifact) return await markProjectSavePayloadStored(env, { operation: claimed, artifact });
    if (claimed.upload_attempts >= MAX_ATTEMPTS || Date.now() - Date.parse(claimed.created_at + (claimed.created_at.endsWith('Z') ? '' : 'Z')) > UPLOAD_RETENTION_MS) {
      return finalizeWithoutPublication(db, claimed, 'FAILED_FINAL', 'PROJECT_SAVE_UPLOAD_RETRY_EXHAUSTED');
    }
    await db.prepare(`UPDATE project_save_operations SET state = 'AWAITING_UPLOAD', stage = 'UPLOAD_REQUIRED',
      lease_owner = NULL, lease_until = NULL, error_code = 'PROJECT_SAVE_UPLOAD_INCOMPLETE', version = version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'RECEIVING' AND lease_epoch = ? AND lease_owner = ?`)
      .bind(claimed.id, claimed.lease_epoch, owner).run();
    return reload(db, claimed);
  } catch (error) {
    if (permanent(error) || claimed.attempts >= MAX_ATTEMPTS) return finalizeWithoutPublication(db, claimed, 'FAILED_FINAL', permanent(error) ? safeCode(error) : 'PROJECT_SAVE_RECOVERY_EXHAUSTED');
    await db.prepare(`UPDATE project_save_operations SET lease_until = ?, error_code = ?, version = version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'RECEIVING' AND lease_epoch = ? AND lease_owner = ?`)
      .bind(Date.now() + retryDelay(claimed.attempts), safeCode(error), claimed.id, claimed.lease_epoch, owner).run();
    return reload(db, claimed);
  }
}
function retryDelay(attempts) { return Math.min(60 * 60 * 1000, 5000 * 2 ** Math.min(attempts, 10)); }
function lifecycleCompatible(operation, project) {
  if (operation.kind === 'create') return Number(project.config_revision) === 0 && ['DRAFT','PREPARING_STORAGE','CONFIG_READY','FAILED'].includes(project.lifecycle_state);
  return Boolean(project.active) && (project.lifecycle_state == null || project.lifecycle_state === 'ACTIVE');
}

async function publish(db, env, operation, auth) {
  const project = auth.project;
  if (!project || !lifecycleCompatible(operation, project)) throw failure('PROJECT_CONFIG_LIFECYCLE_BLOCKED');
  if (Number(project.config_revision) !== Number(operation.expected_config_revision)) throw failure('PROJECT_CONFIG_REVISION_CONFLICT');
  const nextRevision = Number(operation.expected_config_revision) + 1;
  const priorCandidate = await db.prepare('SELECT status, save_operation_id, published_at FROM project_config_revisions WHERE project_id = ? AND revision = ?')
    .bind(project.id, nextRevision).first();
  if (priorCandidate && priorCandidate.save_operation_id == null && priorCandidate.published_at == null && priorCandidate.status !== 'FAILED') {
    throw failure('PROJECT_SAVE_LEGACY_CANDIDATE_RECONCILIATION_REQUIRED');
  }
  const domain = domainOf(operation);
  const activate = operation.kind === 'create' || project.lifecycle_state == null;
  const committedAt = new Date().toISOString();
  const receipt = { operationId: operation.operation_id, organizationId: operation.organization_id, projectId: operation.project_id,
    baseRevision: operation.expected_config_revision, publishedRevision: nextRevision, configRevision: nextRevision,
    checksum: operation.checksum, checksumAlgorithm: operation.checksum_algorithm, sizeBytes: operation.size_bytes, committedAt };
  const statements = [
    db.prepare(`UPDATE projects SET config_revision = ?, config_checksum = ?, config_checksum_algorithm = ?,
      config_storage_provider = ?, config_storage_ref = ?, config_storage_provider_version = ?, config_storage_provider_hash = ?,
      config_schema = ?, config_schema_version = ?, config_size_bytes = ?, config_content_type = ?,
      updated_by = ?, updated_by_name_snapshot = ?, updated_at = CURRENT_TIMESTAMP,
      preview_status = CASE WHEN ? = 1 THEN preview_status ELSE 'PENDING' END,
      preview_attempts = CASE WHEN ? = 1 THEN preview_attempts ELSE 0 END,
      preview_last_error = CASE WHEN ? = 1 THEN preview_last_error ELSE NULL END,
      preview_capture_method = CASE WHEN ? = 1 THEN preview_capture_method ELSE NULL END,
      active = 1, lifecycle_state = 'ACTIVE', lifecycle_version = lifecycle_version + ?,
      lifecycle_updated_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE lifecycle_updated_at END,
      lifecycle_transition_id = CASE WHEN ? = 1 THEN ? ELSE lifecycle_transition_id END,
      lifecycle_failure_stage = NULL, lifecycle_failure_code = NULL, lifecycle_failure_at = NULL, lifecycle_retryable = NULL
      WHERE id = ? AND organization_id = ? AND config_revision = ? AND lifecycle_state IS ? AND lifecycle_version = ? AND active = ?
        AND dropbox_root_path IS ? AND default_config_file IS ? AND organization_file_id IS ?
        AND EXISTS (SELECT 1 FROM project_save_operations o WHERE o.id = ? AND o.state = 'PROCESSING'
          AND o.lease_epoch = ? AND o.lease_owner = ? AND o.lease_until > ${NOW_SQL} AND o.storage_ref = ?)
        AND EXISTS (SELECT 1 FROM project_save_authorization_generation WHERE id = 1 AND version = ?)
        AND ${NOW_SQL} < ?
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.active = 1)
        AND EXISTS (SELECT 1 FROM organizations g WHERE g.id = ? AND g.active = 1)`)
      .bind(nextRevision, operation.checksum, operation.checksum_algorithm, operation.storage_provider, operation.storage_ref,
        operation.storage_provider_version, operation.storage_provider_hash, operation.schema_name, operation.schema_version,
        operation.size_bytes, operation.content_type, auth.actor.id, auth.actor.name || 'Usuário',
        ...Array(4).fill(operation.kind === 'legacy-promotion' ? 1 : 0), activate ? 1 : 0,
        activate ? 1 : 0, activate ? 1 : 0, operation.id, project.id, operation.organization_id, operation.expected_config_revision,
        project.lifecycle_state, project.lifecycle_version, project.active, project.dropbox_root_path, project.default_config_file, project.organization_file_id, operation.id, operation.lease_epoch, operation.lease_owner,
        operation.storage_ref, auth.generation, auth.validUntil, auth.actor.id, operation.organization_id),
    guard(db),
    db.prepare(`INSERT INTO project_config_revisions (project_id, revision, status, checksum_algorithm, checksum,
      storage_provider, storage_ref, storage_provider_version, storage_provider_hash, schema_name, schema_version, size_bytes,
      content_type, created_by, transition_id, ready_at, published_at, save_operation_id)
      VALUES (?,?,'READY',?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,?)
      ON CONFLICT(project_id,revision) DO UPDATE SET status = 'READY', checksum_algorithm = excluded.checksum_algorithm,
        checksum = excluded.checksum, storage_provider = excluded.storage_provider, storage_ref = excluded.storage_ref,
        storage_provider_version = excluded.storage_provider_version, storage_provider_hash = excluded.storage_provider_hash,
        schema_name = excluded.schema_name, schema_version = excluded.schema_version, size_bytes = excluded.size_bytes,
        content_type = excluded.content_type, created_by = excluded.created_by, transition_id = excluded.transition_id,
        ready_at = excluded.ready_at, published_at = excluded.published_at, save_operation_id = excluded.save_operation_id,
        updated_at = CURRENT_TIMESTAMP, error_code = NULL, error_stage = NULL
      WHERE project_config_revisions.status = 'FAILED' AND project_config_revisions.published_at IS NULL
        AND project_config_revisions.save_operation_id IS NULL`)
      .bind(project.id, nextRevision, operation.checksum_algorithm, operation.checksum, operation.storage_provider,
        operation.storage_ref, operation.storage_provider_version, operation.storage_provider_hash, operation.schema_name,
        operation.schema_version, operation.size_bytes, operation.content_type, auth.actor.id,
        domain.changeRequestId ? `cc08:${domain.changeRequestId}` : null, committedAt, operation.id),
    guard(db),
  ];
  if (operation.kind === 'create') {
    if (!operation.reservation_id) throw failure('PROJECT_CREATION_RESERVATION_INVALID');
    statements.push(db.prepare(`UPDATE organization_files SET project_id = ?, name = ?, original_name = ?, file_name = ?,
      file_type = 'json', mime_type = 'application/json', size_bytes = ?, sha256 = ?, status = 'ACTIVE', error_message = NULL,
      uploaded_by = ?, is_project = 1, active = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ? AND project_id = ? AND uploaded_by = ? AND idempotency_key = ?
        AND status IN ('PENDING','PROCESSING','ERROR','ACTIVE')`)
      .bind(project.id, project.name, project.default_config_file, project.default_config_file, operation.size_bytes,
        operation.checksum_algorithm === 'sha256' ? operation.checksum : null, auth.actor.id, operation.reservation_id,
        operation.organization_id, project.id, auth.actor.id, domain.creationKey), guard(db));
    if (operation.quota_reservation_id != null) statements.push(
      db.prepare(`UPDATE organization_resource_reservations SET project_id = ?, status = 'COMMITTED', error_code = NULL,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND actor_user_id = ? AND resource_type = 'project'
          AND (project_id IS NULL OR project_id = ?) AND idempotency_key = ? AND status IN ('RESERVED','PROCESSING','COMMITTED')`)
        .bind(project.id, operation.quota_reservation_id, operation.organization_id, auth.actor.id, project.id, domain.creationKey), guard(db));
    statements.push(db.prepare(`INSERT INTO user_projects(user_id,project_id,access_level) VALUES (?,?,'owner')
      ON CONFLICT(user_id,project_id) DO UPDATE SET access_level = 'owner'`).bind(auth.actor.id, project.id));
    if (domain.importFileId != null) {
      statements.push(db.prepare(`INSERT INTO project_save_transaction_guard(value)
        SELECT CASE WHEN EXISTS(SELECT 1 FROM organization_files WHERE id = ? AND organization_id = ? AND active = 1) THEN 1 ELSE 0 END`)
        .bind(domain.importFileId, operation.organization_id));
    }
    if (domain.copyOrganizationAccess === true) {
      statements.push(db.prepare(`INSERT INTO user_projects(user_id,project_id,access_level)
        SELECT user_id,?,CASE WHEN user_id = ? THEN 'owner' ELSE access_level END FROM organization_users
        WHERE organization_id = ?
        ON CONFLICT(user_id,project_id) DO UPDATE SET access_level = excluded.access_level`)
        .bind(project.id, auth.actor.id, operation.organization_id));
    }

  }
  if (operation.kind !== 'create' && project.organization_file_id != null) {
    // File accounting is part of publication, including old map promotion. A
    // Dropbox content hash must never be mislabeled as a SHA-256 value.
    statements.push(db.prepare(`UPDATE organization_files SET size_bytes = ?, sha256 = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ? AND (project_id IS NULL OR project_id = ?)`)
      .bind(operation.size_bytes, operation.checksum_algorithm === 'sha256' ? operation.checksum : null,
        project.organization_file_id, operation.organization_id, project.id), guard(db));
  }
  if (operation.kind === 'change-request') {
    // CC08's trigger appends the lifecycle event in this same D1 transaction.
    // Approval is not synthesized here; the review adapter must already have
    // transitioned the request to applying under the user's review permission.
    statements.push(db.prepare(`UPDATE project_change_requests SET status = 'applied', applied_revision = ?,
      lifecycle_version = lifecycle_version + 1, transition_actor_user_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ? AND project_id = ? AND base_revision = ?
        AND status = 'applying' AND decision = 'approved' AND lifecycle_version = ?
        AND EXISTS (SELECT 1 FROM project_change_request_apply_artifacts a WHERE a.change_request_id = project_change_requests.id
          AND a.checksum = ? AND a.size_bytes = ? AND a.base_revision = project_change_requests.base_revision)`)
      .bind(nextRevision, auth.actor.id, domain.changeRequestId, operation.organization_id, project.id,
        operation.expected_config_revision, domain.changeRequestVersion, operation.checksum, operation.size_bytes), guard(db));
  }
  statements.push(
    db.prepare(`UPDATE project_save_operations SET state = 'PUBLISHED', stage = 'COMMITTED', receipt_json = ?, committed_at = ?,
      lease_owner = NULL, lease_until = NULL, error_code = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND state = 'PROCESSING' AND lease_epoch = ? AND lease_owner = ?`)
      .bind(JSON.stringify(receipt), committedAt, operation.id, operation.lease_epoch, operation.lease_owner),
    guard(db),
    db.prepare("UPDATE project_save_outbox SET state = 'DONE', updated_at = CURRENT_TIMESTAMP WHERE operation_id = ? AND effect = 'PROCESS'").bind(operation.id),
    db.prepare("INSERT INTO project_save_outbox(operation_id,effect) VALUES (?,'AUDIT') ON CONFLICT(operation_id,effect) DO NOTHING").bind(operation.id),
  );
  await db.batch(statements);
  return reload(db, operation);
}

async function retryOrFinish(db, env, operation, error) {
  const current = await reload(db, operation);
  if (!current || PROJECT_SAVE_TERMINAL_STATES.has(current.state) || current.lease_epoch !== operation.lease_epoch || current.lease_owner !== operation.lease_owner) return current;
  let finalError = error;
  // A CHECK failure might be a zero-row CAS after an ACL/project/domain race.
  // Re-read current facts before assigning a stable terminal reason.
  try {
    const auth = await authorization(db, env, current);
    if (!lifecycleCompatible(current, auth.project)) finalError = failure('PROJECT_CONFIG_LIFECYCLE_BLOCKED');
    else if (Number(auth.project.config_revision) !== Number(current.expected_config_revision)) finalError = failure('PROJECT_CONFIG_REVISION_CONFLICT');
    else if (current.kind === 'change-request') {
      const domain = domainOf(current);
      const change = await db.prepare('SELECT * FROM project_change_requests WHERE id = ? AND project_id = ? AND organization_id = ?')
        .bind(domain.changeRequestId, current.project_id, current.organization_id).first();
      if (!change || change.status !== 'applying' || change.lifecycle_version !== domain.changeRequestVersion) finalError = failure('CHANGE_REQUEST_LIFECYCLE_CONFLICT');
    }
  } catch (authError) { finalError = authError; }
  const code = safeCode(finalError);
  if (['PROJECT_CONFIG_REVISION_CONFLICT','PROJECT_CONFIG_LIFECYCLE_BLOCKED','CHANGE_REQUEST_LIFECYCLE_CONFLICT','PROJECT_SAVE_STORAGE_CONTEXT_CHANGED'].includes(code)) {
    return finalizeWithoutPublication(db, operation, 'CONFLICT', code);
  }
  if (permanent(finalError)) return finalizeWithoutPublication(db, operation, 'FAILED_FINAL', code);
  const storedAt = Date.parse(String(operation.payload_stored_at).replace(' ', 'T') + (String(operation.payload_stored_at).endsWith('Z') ? '' : 'Z'));
  if (operation.attempts >= MAX_ATTEMPTS || Date.now() - storedAt > PROCESS_RETENTION_MS) return finalizeWithoutPublication(db, operation, 'FAILED_FINAL', 'PROJECT_SAVE_RETRY_EXHAUSTED');
  const nextAttempt = Date.now() + retryDelay(operation.attempts);
  await db.batch([
    db.prepare(`UPDATE project_save_operations SET state = 'RETRY_WAIT', stage = 'RETRY', error_code = ?, next_attempt_at = ?,
      lease_owner = NULL, lease_until = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND state = 'PROCESSING' AND lease_epoch = ? AND lease_owner = ?`)
      .bind(code, nextAttempt, operation.id, operation.lease_epoch, operation.lease_owner),
    db.prepare(`UPDATE project_save_outbox SET available_at = ?, attempts = attempts + 1, error_code = ?, updated_at = CURRENT_TIMESTAMP
      WHERE operation_id = ? AND effect = 'PROCESS' AND state = 'PENDING'
        AND EXISTS (SELECT 1 FROM project_save_operations o WHERE o.id = project_save_outbox.operation_id
          AND o.state = 'RETRY_WAIT' AND o.lease_epoch = ?)`)
      .bind(nextAttempt, code, operation.id, operation.lease_epoch),
  ]);
  return reload(db, operation);
}
export async function processProjectSaveOperation(env, { operation, verifyPayload = null, owner = crypto.randomUUID() }) {
  const db = database(env);
  const current = await reload(db, operation);
  if (!current || PROJECT_SAVE_TERMINAL_STATES.has(current.state)) return current;
  const claimed = await db.prepare(`UPDATE project_save_operations SET state = 'PROCESSING', stage = 'VERIFY',
    lease_epoch = lease_epoch + 1, lease_owner = ?, lease_until = ?, attempts = attempts + 1,
    version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payload_stored_at IS NOT NULL
      AND ((state IN ('PAYLOAD_STORED','RETRY_WAIT') AND next_attempt_at <= ${NOW_SQL})
        OR (state = 'PROCESSING' AND lease_until <= ${NOW_SQL}))
      AND EXISTS (SELECT 1 FROM project_save_outbox x WHERE x.operation_id = project_save_operations.id AND effect = 'PROCESS' AND state = 'PENDING')
      RETURNING *`).bind(owner, Date.now() + PROCESS_LEASE_MS, current.id).first();
  if (!claimed) return reload(db, current);
  try {
    const auth = await authorization(db, env, claimed);
    const artifact = await verifyStorage(env, { operation: claimed, project: auth.project }, verifyPayload);
    verifiedArtifact(env, claimed, artifact);
    if (artifact.storageRef !== claimed.storage_ref) throw failure('PROJECT_SAVE_STORAGE_REF_MISMATCH', 422);
    // Authorization is read again after slow storage verification. The generation
    // and grant deadline are checked atomically by publish, not trusted forever.
    const finalAuth = await authorization(db, env, claimed);
    if (finalAuth.project?.dropbox_root_path !== auth.project?.dropbox_root_path ||
        finalAuth.project?.default_config_file !== auth.project?.default_config_file) {
      throw failure('PROJECT_SAVE_STORAGE_CONTEXT_CHANGED');
    }
    return await publish(db, env, claimed, finalAuth);
  } catch (error) {
    return retryOrFinish(db, env, claimed, error);
  }
}

async function drainAudit(db, limit) {
  const rows = await db.prepare(`SELECT x.id AS outbox_id, o.* FROM project_save_outbox x JOIN project_save_operations o ON o.id = x.operation_id
    WHERE x.effect = 'AUDIT' AND x.state = 'PENDING' AND x.available_at <= ${NOW_SQL} ORDER BY x.id LIMIT ?`).bind(limit).all();
  let done = 0;
  for (const operation of rows.results || []) {
    try {
      await db.batch([
        db.prepare(`INSERT INTO audit_logs(user_id,project_id,action,details,created_at)
          SELECT ?,?,'project.save.durable',?,CURRENT_TIMESTAMP WHERE EXISTS
            (SELECT 1 FROM project_save_outbox WHERE id = ? AND state = 'PENDING')`)
          .bind(operation.actor_user_id, operation.project_id, JSON.stringify({ organizationId: operation.organization_id,
            result: 'success', metadata: { operationId: operation.operation_id, revision: JSON.parse(operation.receipt_json).publishedRevision } }), operation.outbox_id),
        db.prepare("UPDATE project_save_outbox SET state = 'DONE', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'PENDING'").bind(operation.outbox_id),
      ]);
      done += 1;
    } catch (error) {
      await db.prepare(`UPDATE project_save_outbox SET attempts = attempts + 1, error_code = ?, available_at = ?,
        state = CASE WHEN attempts + 1 >= ? THEN 'FAILED_FINAL' ELSE 'PENDING' END, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND state = 'PENDING'`).bind(safeCode(error), Date.now() + 60000, MAX_ATTEMPTS, operation.outbox_id).run();
    }
  }
  return done;
}
export async function reconcileProjectSaveOperations(env, { limit = 20, verifyPayload = null, recoverPayload = null, budgetMs = 45000 } = {}) {
  const db = database(env);
  const boundedLimit = Math.max(1, Math.min(100, integer(limit, 'PROJECT_SAVE_BATCH_LIMIT_INVALID', 1)));
  const startedAt = Date.now();
  const rows = await db.prepare(`SELECT * FROM project_save_operations WHERE
    (state IN ('PAYLOAD_STORED','RETRY_WAIT') AND next_attempt_at <= ${NOW_SQL})
    OR (state IN ('RECEIVING','PROCESSING') AND lease_until <= ${NOW_SQL})
    OR (state = 'AWAITING_UPLOAD' AND created_at <= datetime('now','-7 days'))
    ORDER BY next_attempt_at, created_at, id LIMIT ?`).bind(boundedLimit).all();
  const result = { inspected: 0, published: 0, terminal: 0, pending: 0, failed: 0, audit: 0 };
  for (const operation of rows.results || []) {
    if (Date.now() - startedAt >= budgetMs) break;
    result.inspected += 1;
    const operationStartedAt=Date.now();
    try {
      let current = operation;
      if (current.state === 'AWAITING_UPLOAD') current = await finalizeWithoutPublication(db, current, 'FAILED_FINAL', 'PROJECT_SAVE_UPLOAD_EXPIRED');
      else if (current.state === 'RECEIVING') current = await recoverProjectSaveUpload(env, { operation: current, recoverPayload });
      if (['PAYLOAD_STORED','RETRY_WAIT','PROCESSING'].includes(current.state)) current = await processProjectSaveOperation(env, { operation: current, verifyPayload });
      if (current.state === 'PUBLISHED') result.published += 1;
      else if (PROJECT_SAVE_TERMINAL_STATES.has(current.state)) result.terminal += 1;
      else result.pending += 1;
      console.info('[Maono durable save] recovery operation', {operationId:current.operation_id,stage:current.stage,state:current.state,durationMs:Date.now()-operationStartedAt,errorCode:current.error_code || null});
    } catch(error) {
      result.failed += 1;
      console.warn('[Maono durable save] recovery operation', {operationId:operation.operation_id,stage:operation.stage,state:operation.state,durationMs:Date.now()-operationStartedAt,errorCode:safeCode(error)});
    }
  }
  if (Date.now() - startedAt < budgetMs) result.audit = await drainAudit(db, boundedLimit);
  return result;
}
