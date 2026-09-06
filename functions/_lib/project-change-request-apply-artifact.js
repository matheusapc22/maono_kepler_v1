import { getDb, tableExists } from './organizations.js';

export async function isChangeRequestApplyArtifactSchemaReady(env) {
  if (!(await tableExists(env, 'project_change_request_apply_artifacts'))) return false;
  const db = getDb(env);
  const columns = await db.prepare(`SELECT COUNT(*) AS count
    FROM pragma_table_info('project_change_request_apply_artifacts')
    WHERE name IN ('change_request_id','checksum','size_bytes','base_revision','created_at')`).first();
  if (Number(columns?.count) !== 5) return false;
  const trigger = await db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type='trigger' AND name='trg_change_request_apply_artifact_immutable'`).first();
  return Number(trigger?.count) === 1;
}

export function readChangeRequestApplyArtifact(request, row) {
  const checksum = String(request.headers.get('X-Maono-Config-Checksum') || '').toLowerCase();
  const sizeBytes = Number(request.headers.get('X-Maono-Config-Size'));
  const baseRevision = Number(request.headers.get('X-Maono-Expected-Revision'));
  const version = Number(request.headers.get('X-Maono-Change-Request-Version'));
  const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
  if (!/^[a-f0-9]{64}$/.test(checksum) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 100 * 1024 * 1024) fail('CHANGE_REQUEST_APPLY_ARTIFACT_INVALID', 400);
  if (!request.headers.has('X-Maono-Expected-Revision') || baseRevision !== Number(row.base_revision)) fail('CHANGE_REQUEST_REVIEW_CONFLICT');
  if (!request.headers.has('X-Maono-Change-Request-Version') || !Number.isSafeInteger(version) || version !== Number(row.lifecycle_version)) fail('CHANGE_REQUEST_REVIEW_STATE_CONFLICT');
  return { checksum, sizeBytes, baseRevision };
}
export async function claimChangeRequestApplyArtifact(env, db, row, artifact) {
  if (!(await isChangeRequestApplyArtifactSchemaReady(env))) throw Object.assign(new Error('Migration 0022 required'), {code:'CHANGE_REQUEST_APPLY_SCHEMA_OUTDATED',status:503});
  await db.prepare(`INSERT INTO project_change_request_apply_artifacts(change_request_id,checksum,size_bytes,base_revision)
    VALUES(?,?,?,?) ON CONFLICT(change_request_id) DO NOTHING`).bind(row.id,artifact.checksum,artifact.sizeBytes,artifact.baseRevision).run();
  const claimed = await db.prepare('SELECT * FROM project_change_request_apply_artifacts WHERE change_request_id=?').bind(row.id).first();
  if (claimed?.checksum !== artifact.checksum || Number(claimed?.size_bytes) !== artifact.sizeBytes || Number(claimed?.base_revision) !== artifact.baseRevision) throw Object.assign(new Error('Retry artifact differs from original apply'), {code:'CHANGE_REQUEST_APPLY_ARTIFACT_CONFLICT',status:409});
  return claimed;
}
