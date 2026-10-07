import { logPreviewServerMetric } from './project-preview-metrics.js';
import { downloadDropboxBinaryFile, getDropboxMetadata, uploadDropboxBinaryFile, joinDropboxPath } from './dropbox.js';
import { isLocalStorageMode } from './local-storage.js';
import { readBoundedPreview, validatePreviewPng, previewError } from './project-preview-png.js';
export function previewArtifactFileName(operation) {
  if (!/^[a-f0-9-]{36}$/.test(operation.id)) throw previewError('PROJECT_PREVIEW_ARTIFACT_INVALID');
  return `.maono-preview-${operation.organization_id}-${operation.project_id}-${operation.id}.png`;
}
export function previewArtifactRef(operation) { return joinDropboxPath(operation.storage_root, previewArtifactFileName(operation)); }
function checkContext(operation, project) {
  if (Number(project?.id) !== operation.project_id || Number(project?.organization_id) !== operation.organization_id ||
    project?.dropbox_root_path !== operation.storage_root || (project?.default_config_file || 'config.kepler.json') !== operation.config_file ||
    (project?.organization_file_id ?? null) !== operation.organization_file_id || previewArtifactRef(operation) !== operation.storage_ref) {
    throw previewError('PROJECT_PREVIEW_STORAGE_CONTEXT_CHANGED', 409);
  }
}
export function previewStorageNotFound(error) { return ['DROPBOX_PATH_NOT_FOUND','LOCAL_STORAGE_NOT_FOUND'].includes(error?.code) && [404,409].includes(Number(error?.status)); }
export async function verifyStoredPreview(env, { operation, project, missingAllowed = false }) {
  const startedAt = Date.now();
  checkContext(operation, project);
  const name = previewArtifactFileName(operation);
  let metadata;
  try { metadata = await getDropboxMetadata(env, operation.storage_root, name); }
  catch (error) { if (missingAllowed && previewStorageNotFound(error)) return null; throw error; }
  if (Number(metadata.size) !== operation.size_bytes) throw previewError('THUMBNAIL_SIZE_MISMATCH');
  const response = await downloadDropboxBinaryFile(env, operation.storage_root, name);
  const bytes = await readBoundedPreview(response.body, { expectedBytes:operation.size_bytes });
  const checked = await validatePreviewPng(bytes);
  if (checked.imageChecksum !== operation.image_checksum) throw previewError('THUMBNAIL_CHECKSUM_MISMATCH');
  logPreviewServerMetric('storage-verification', { durationMs:Date.now()-startedAt, bytes:bytes.length });
  return { contentVerified:true, storageRef:operation.storage_ref, storageProvider:isLocalStorageMode(env) ? 'local-d1' : 'dropbox',
    storageProviderVersion:metadata.rev ?? null, imageChecksum:checked.imageChecksum, sizeBytes:bytes.length };
}
export async function uploadPreviewPayload(env, { operation, project, body }) {
  checkContext(operation, project);
  const bytes = await readBoundedPreview(body, { expectedBytes:operation.size_bytes });
  const checked = await validatePreviewPng(bytes);
  if (checked.imageChecksum !== operation.image_checksum) throw previewError('THUMBNAIL_CHECKSUM_MISMATCH');
  const existing = await verifyStoredPreview(env, { operation, project, missingAllowed:true });
  if (existing) return existing;
  const startedAt = Date.now();
  try { await uploadDropboxBinaryFile(env, operation.storage_root, previewArtifactFileName(operation), bytes, 'image/png', { writeMode:'create' });
    logPreviewServerMetric('storage-upload', { durationMs:Date.now()-startedAt, bytes:bytes.length }); }

  catch (error) {
    logPreviewServerMetric('storage-upload', { durationMs:Date.now()-startedAt, bytes:bytes.length, result:'failed' });
    // An uncertain write or create conflict must reuse only identical bytes.
    const recovered = await verifyStoredPreview(env, { operation, project, missingAllowed:true });
    if (recovered) return recovered;
    throw error;
  }
  return verifyStoredPreview(env, { operation, project });
}

export async function readPreviewJsonBody(request, { maxBytes = 16 * 1024 } = {}) {
  const bytes = await readBoundedPreview(request.body, { maxBytes, timeoutMs: 10000 });
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw previewError('PROJECT_PREVIEW_MANIFEST_INVALID', 400); }
}
