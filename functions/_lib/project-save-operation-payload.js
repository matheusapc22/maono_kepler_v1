import { downloadDropboxBinaryFile, ensureDropboxFolder, getDropboxMetadata, uploadDropboxBinaryFile } from "./dropbox.js";
import { dropboxContentHashBlockDigest, dropboxContentHashFromBlockDigestsHex } from "./dropbox-content-hash.js";
import { DROPBOX_STREAM_BLOCK_BYTES, appendLargeDropboxUploadSession, finishLargeDropboxUploadSession, startLargeDropboxUploadSession } from "./dropbox-large-upload.js";
import { createMapConfigOperationStorageRef, resolveMapConfigStorageFileName } from "./map-config-storage-ref.js";
import { isLocalStorageMode } from "./local-storage.js";
import { StreamingMapConfigValidator } from "./project-config-stream-validator.js";

export const LARGE_CONFIG_REQUEST_HEADER = "X-Maono-Large-Config";
export const LARGE_CONFIG_THRESHOLD_BYTES = 8 * 1024 * 1024;
export const INLINE_CONFIG_HARD_LIMIT_BYTES = 12 * 1024 * 1024;
export const LARGE_CONFIG_CHECKSUM_ALGORITHM = "dropbox-content-hash";
export const LARGE_CONFIG_CONTENT_TYPE = "application/json; charset=utf-8";
export const MAX_OPERATION_PAYLOAD_BYTES = 100 * 1024 * 1024;

function saveError(message, status, code, details = null) {
  return Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
}
export function isLargeProjectConfigRequest(request) { return request?.headers?.get?.(LARGE_CONFIG_REQUEST_HEADER) === "1"; }
export function assertInlineProjectConfigRequestSize(request) {
  if (!isLargeProjectConfigRequest(request) && Number(request?.headers?.get?.("content-length") || 0) > INLINE_CONFIG_HARD_LIMIT_BYTES) {
    throw saveError("Use o protocolo durável de envio do MapConfig.", 413, "PROJECT_CONFIG_LARGE_SAVE_REQUIRED");
  }
  return true;
}

export function createProjectSaveOperationStorageRef({ project, operation }) {
  if (!project?.dropbox_root_path || Number(project.id) !== Number(operation?.project_id) || Number(project.organization_id) !== Number(operation?.organization_id)) {
    throw saveError("Contexto de storage da operação inválido.", 409, "MAP_CONFIG_STORAGE_REF_MISMATCH");
  }
  return createMapConfigOperationStorageRef({
    organizationId: operation.organization_id, projectId: operation.project_id,
    operationId: operation.id, uploadEpoch: operation.upload_epoch,
  });
}

function manifestOf(operation) {
  const manifest = {
    sizeBytes: Number(operation?.size_bytes ?? operation?.sizeBytes),
    checksum: String(operation?.checksum || "").toLowerCase(),
    checksumAlgorithm: operation?.checksum_algorithm ?? operation?.checksumAlgorithm,
    serializationVersion: Number(operation?.serialization_version ?? operation?.serializationVersion),
    schemaName: operation?.schema_name ?? operation?.schemaName ?? "legacy-kepler",
    schemaVersion: Number(operation?.schema_version ?? operation?.schemaVersion ?? 1),
    configVersion: operation?.config_version ?? operation?.configVersion ?? null,
    datasetCount: operation?.dataset_count ?? operation?.datasetCount ?? null,
  };
  if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes <= 0 || manifest.sizeBytes > MAX_OPERATION_PAYLOAD_BYTES || !/^[0-9a-f]{64}$/.test(manifest.checksum) || manifest.checksumAlgorithm !== LARGE_CONFIG_CHECKSUM_ALGORITHM || manifest.serializationVersion !== 1 || manifest.schemaName !== "legacy-kepler" || manifest.schemaVersion !== 1) {
    throw saveError("Manifesto de payload inválido.", 400, "PROJECT_SAVE_MANIFEST_INVALID");
  }
  return manifest;
}
function payloadStream(body) {
  if (body?.getReader) return body;
  const source = body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) : null;
  if (!source) throw saveError("Stream do MapConfig não está disponível.", 400, "PROJECT_CONFIG_PAYLOAD_STREAM_REQUIRED");
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset >= source.byteLength) { controller.close(); return; }
    const end = Math.min(offset + 65536, source.byteLength);
    controller.enqueue(source.subarray(offset, end)); offset = end;
  } });
}

// One 4 MiB accumulation block. Digests are 32 bytes each, capped by the 100 MiB
// admission limit. No JSON document, dataset or incoming chunk is copied whole.
export async function validateProjectSavePayloadStream(body, manifest, onBlock = null) {
  const reader = payloadStream(body).getReader();
  const guard = new StreamingMapConfigValidator(manifest);
  const digests = [];
  const pending = new Uint8Array(DROPBOX_STREAM_BLOCK_BYTES);
  let used = 0, sizeBytes = 0, offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw saveError("Bloco de upload inválido.", 400, "MAP_CONFIG_BYTES_INVALID");
      sizeBytes += value.byteLength;
      if (sizeBytes > manifest.sizeBytes) throw saveError("Tamanho do MapConfig divergente.", 400, "PROJECT_CONFIG_SIZE_MISMATCH");
      guard.push(value);
      for (let cursor = 0; cursor < value.byteLength;) {
        const length = Math.min(pending.byteLength - used, value.byteLength - cursor);
        pending.set(value.subarray(cursor, cursor + length), used); used += length; cursor += length;
        if (used === pending.byteLength) {
          digests.push(await dropboxContentHashBlockDigest(pending));
          await onBlock?.(pending, offset); offset += used; used = 0;
        }
      }
    }
    const parsed = guard.finish();
    if (sizeBytes !== manifest.sizeBytes) throw saveError("Tamanho do MapConfig divergente.", 400, "PROJECT_CONFIG_SIZE_MISMATCH");
    const finalBlock = pending.subarray(0, used);
    if (used) digests.push(await dropboxContentHashBlockDigest(finalBlock));
    const checksum = await dropboxContentHashFromBlockDigestsHex(digests);
    if (checksum !== manifest.checksum) throw saveError("Checksum do MapConfig divergente.", 409, "PROJECT_CONFIG_INTEGRITY_MISMATCH");
    return { finalBlock, offset, sizeBytes, checksum, ...parsed };
  } catch (error) {
    try { await reader.cancel(error); } catch { /* Preserve the original error. */ }
    throw error;
  } finally { reader.releaseLock(); }
}

function notFound(error) { return error?.code === "DROPBOX_PATH_NOT_FOUND" || error?.code === "MAP_CONFIG_NOT_FOUND" || Number(error?.status) === 404; }
function metadataIntegrity(metadata, manifest, local = false) {
  if (!metadata || Number(metadata.size) !== manifest.sizeBytes || (!local && String(metadata.content_hash || "").toLowerCase() !== manifest.checksum)) {
    throw saveError("O storage não confirmou a integridade do MapConfig.", 502, "MAP_CONFIG_STORAGE_INTEGRITY_MISMATCH");
  }
}
function artifactOf(env, manifest, storageRef, metadata, extra = {}) {
  const provider = isLocalStorageMode(env) ? "local-d1" : "dropbox";
  return {
    storageRef, storageProvider: provider, provider,
    storageProviderVersion: metadata.rev ?? null, providerVersion: metadata.rev ?? null,
    storageProviderHash: metadata.content_hash ?? manifest.checksum, providerHash: metadata.content_hash ?? manifest.checksum,
    providerObjectId: metadata.id ?? null,
    checksum: manifest.checksum, contentHash: manifest.checksum, checksumAlgorithm: manifest.checksumAlgorithm,
    sizeBytes: manifest.sizeBytes, schemaName: manifest.schemaName, schemaVersion: manifest.schemaVersion,
    contentType: LARGE_CONFIG_CONTENT_TYPE, contentVerified: true, ...extra,
  };
}
async function readVerified(env, { project, operation }, missingAllowed) {
  const manifest = manifestOf(operation);
  const expectedRef = createProjectSaveOperationStorageRef({ project, operation });
  if (operation.storage_ref && operation.storage_ref !== expectedRef) throw saveError("Referência de payload divergente.", 409, "MAP_CONFIG_STORAGE_REF_MISMATCH");
  const fileName = resolveMapConfigStorageFileName({ project, storageRef: expectedRef });
  let metadata;
  try { metadata = await getDropboxMetadata(env, project.dropbox_root_path, fileName); }
  catch (error) { if (missingAllowed && notFound(error)) return null; throw error; }
  metadataIntegrity(metadata, manifest, isLocalStorageMode(env));
  const response = await downloadDropboxBinaryFile(env, project.dropbox_root_path, fileName);
  await validateProjectSavePayloadStream(response.body, manifest);
  return artifactOf(env, manifest, expectedRef, metadata, { idempotent: true });
}
export async function verifyStoredProjectSaveOperation(env, args) { return readVerified(env, args, false); }
export async function recoverStoredProjectSaveOperation(env, args) { return readVerified(env, args, true); }

function retryable(error) {
  return error?.retryable === true || ["DROPBOX_TIMEOUT", "DROPBOX_UNAVAILABLE", "DROPBOX_UPLOAD_SESSION_FAILED"].includes(error?.code);
}
async function waitForRetry(error) {
  const delay = Number(error?.details?.retryAfterMs ?? 250);
  if (!Number.isFinite(delay) || delay < 0 || delay > 5000) return false;
  await new Promise(resolve => setTimeout(resolve, delay)); return true;
}
async function appendBlock(env, sessionId, offset, block) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { await appendLargeDropboxUploadSession(env, sessionId, offset, block); return; }
    catch (error) {
      if (error?.code === "DROPBOX_UPLOAD_SESSION_OFFSET_CONFLICT" && Number(error?.details?.correctOffset) === offset + block.byteLength) return;
      if (attempt || !retryable(error) || !await waitForRetry(error)) throw error;
    }
  }
}
async function reconcileFinishMetadata(env, project, fileName, manifest) {
  try {
    const metadata = await getDropboxMetadata(env, project.dropbox_root_path, fileName);
    metadataIntegrity(metadata, manifest); return metadata;
  } catch (error) { if (notFound(error)) return null; throw error; }
}
async function finishSession(env, { project, sessionId, fileName, finalBlock, offset, manifest }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const metadata = await finishLargeDropboxUploadSession(env, sessionId, offset, project.dropbox_root_path, fileName, finalBlock, { writeMode: "create" });
      metadataIntegrity(metadata, manifest); return metadata;
    } catch (error) {
      // An uncertain finish or create conflict may already be the desired file.
      // Never overwrite, delete, or blindly retry an immutable operation object.
      const committed = await reconcileFinishMetadata(env, project, fileName, manifest);
      if (committed) return committed;
      if (attempt || !retryable(error) || !await waitForRetry(error)) throw error;
    }
  }
}

export async function uploadProjectSaveOperationPayload(env, { project, operation, body }) {
  const manifest = manifestOf(operation);
  const storageRef = createProjectSaveOperationStorageRef({ project, operation });
  const fileName = resolveMapConfigStorageFileName({ project, storageRef });
  const existing = await recoverStoredProjectSaveOperation(env, { project, operation });
  if (existing) {
    try { await body?.cancel?.(); } catch { /* A receipt does not depend on downstream cancellation. */ }
    return existing;
  }
  await ensureDropboxFolder(env, project.dropbox_root_path);
  if (isLocalStorageMode(env)) {
    // The development D1 blob adapter has no upload sessions. Keep its small-map
    // support bounded; large integration tests exercise the real Dropbox session
    // transport against the local HTTP fixture instead of changing providers.
    if (manifest.sizeBytes > LARGE_CONFIG_THRESHOLD_BYTES) throw saveError("O storage local de blobs não suporta mapas grandes; use o adaptador Dropbox.", 413, "PROJECT_CONFIG_LOCAL_STREAM_UNSUPPORTED");
    const bytes = new Uint8Array(manifest.sizeBytes);
    const result = await validateProjectSavePayloadStream(body, manifest, (block, offset) => { bytes.set(block, offset); });
    bytes.set(result.finalBlock, result.offset);
    try { await uploadDropboxBinaryFile(env, project.dropbox_root_path, fileName, bytes, LARGE_CONFIG_CONTENT_TYPE, { writeMode: "create" }); }
    catch (error) { if (error?.code !== "LOCAL_STORAGE_PATH_CONFLICT") throw error; }
    return verifyStoredProjectSaveOperation(env, { project, operation });
  }
  const started = await startLargeDropboxUploadSession(env);
  const sessionId = String(started?.session_id || "");
  if (!sessionId) throw saveError("Sessão Dropbox inválida.", 502, "DROPBOX_UPLOAD_SESSION_FAILED");
  const result = await validateProjectSavePayloadStream(body, manifest, (block, offset) => appendBlock(env, sessionId, offset, block));
  const metadata = await finishSession(env, { project, sessionId, fileName, manifest, ...result });
  return artifactOf(env, manifest, storageRef, metadata, { idempotent: false });
}
