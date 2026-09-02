import {
  ensureDropboxFolder,
  getDropboxMetadata,
} from "./dropbox.js";
import {
  dropboxContentHashBlockDigest,
  dropboxContentHashFromBlockDigestsHex,
} from "./dropbox-content-hash.js";
import {
  DROPBOX_STREAM_BLOCK_BYTES,
  appendLargeDropboxUploadSession,
  finishLargeDropboxUploadSession,
  startLargeDropboxUploadSession,
} from "./dropbox-large-upload.js";
import {
  createMapConfigStorageRef,
  getMapConfigRevisionFileName,
} from "./map-config-storage-ref.js";
import {
  markProjectConfigRevisionFailed,
  markProjectConfigRevisionReady,
  reserveProjectConfigRevision,
} from "./project-config-revisions.js";

const LARGE_CONFIG_THRESHOLD_BYTES = 8 * 1024 * 1024;
const LARGE_CONFIG_CHECKSUM_ALGORITHM = "dropbox-content-hash";
const LARGE_CONFIG_CONTENT_TYPE = "application/json; charset=utf-8";
const JSON_WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);
const SESSION_RECONCILE_MAX_WAIT_MS = 5_000;

function saveError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function integerHeader(request, name, { min = 0 } = {}) {
  const raw = request.headers.get(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw saveError(
      `Header ${name} inválido para save grande.`,
      400,
      "PROJECT_CONFIG_LARGE_SAVE_HEADERS_INVALID",
      { header: name },
    );
  }
  return value;
}

function safeHeader(request, name, maxLength = 160) {
  return String(request.headers.get(name) || "").trim().slice(0, maxLength);
}

function validateManifest(request) {
  const expectedRevision = integerHeader(request, "X-Maono-Expected-Revision");
  const declaredSize = integerHeader(request, "X-Maono-Config-Size", { min: 1 });
  const schemaName = safeHeader(request, "X-Maono-Config-Schema", 80);
  const schemaVersion = integerHeader(request, "X-Maono-Config-Schema-Version", { min: 1 });
  const configVersion = safeHeader(request, "X-Maono-Config-Version", 80);
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  const contentLength = Number(request.headers.get("content-length") || 0);

  if (!contentType.startsWith("application/vnd.maono.map-config+json")) {
    throw saveError(
      "Content-Type inválido para save grande.",
      415,
      "PROJECT_CONFIG_LARGE_SAVE_CONTENT_TYPE_INVALID",
    );
  }
  if (schemaName !== "legacy-kepler" || schemaVersion !== 1) {
    throw saveError(
      "Schema do MapConfig grande não suportado.",
      400,
      "PROJECT_CONFIG_SCHEMA_UNSUPPORTED",
      { schemaName, schemaVersion },
    );
  }
  if (!configVersion) {
    throw saveError(
      "Versão do MapConfig grande não informada.",
      400,
      "INVALID_KEPLER_CONFIG",
      { field: "version" },
    );
  }
  if (declaredSize <= LARGE_CONFIG_THRESHOLD_BYTES) {
    throw saveError(
      "Payload não requer o modo de save grande.",
      400,
      "PROJECT_CONFIG_LARGE_SAVE_NOT_REQUIRED",
      { declaredSize, largeThresholdBytes: LARGE_CONFIG_THRESHOLD_BYTES },
    );
  }
  if (contentLength > 0 && contentLength !== declaredSize) {
    throw saveError(
      "O tamanho declarado do MapConfig não corresponde ao request.",
      400,
      "PROJECT_CONFIG_SIZE_MISMATCH",
      { expectedSizeBytes: declaredSize, actualSizeBytes: contentLength },
    );
  }

  return {
    expectedRevision,
    declaredSize,
    schemaName,
    schemaVersion,
    configVersion,
  };
}

class StreamingJsonBoundaryGuard {
  constructor() {
    this.firstNonWhitespace = null;
    this.lastNonWhitespace = null;
  }

  push(bytes) {
    if (this.firstNonWhitespace === null) {
      for (let index = 0; index < bytes.byteLength; index += 1) {
        const byte = bytes[index];
        if (!JSON_WHITESPACE.has(byte)) {
          this.firstNonWhitespace = byte;
          break;
        }
      }
    }

    for (let index = bytes.byteLength - 1; index >= 0; index -= 1) {
      const byte = bytes[index];
      if (!JSON_WHITESPACE.has(byte)) {
        this.lastNonWhitespace = byte;
        break;
      }
    }
  }

  finish() {
    if (this.firstNonWhitespace !== 0x7b || this.lastNonWhitespace !== 0x7d) {
      throw saveError(
        "O MapConfig grande não possui fronteiras de objeto JSON válidas.",
        400,
        "INVALID_KEPLER_CONFIG",
        { field: "root" },
      );
    }
  }
}

function normalizeProviderMetadata(metadata, fallbackSize = 0) {
  return {
    providerVersion: metadata?.rev ?? null,
    providerHash: metadata?.content_hash ?? null,
    providerObjectId: metadata?.id ?? null,
    sizeBytes: Number(metadata?.size ?? fallbackSize ?? 0),
  };
}

function isSessionOffsetAcknowledgement(error, expectedEnd) {
  return (
    error?.code === "DROPBOX_UPLOAD_SESSION_OFFSET_CONFLICT" &&
    Number(error?.details?.correctOffset) === Number(expectedEnd)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function waitBeforeReconciledRetry(error) {
  const retryAfter = Number(error?.details?.retryAfterMs);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    if (retryAfter > SESSION_RECONCILE_MAX_WAIT_MS) return false;
    await sleep(retryAfter);
    return true;
  }
  await sleep(Math.round(250 + Math.random() * 250));
  return true;
}

async function appendBlock(env, sessionId, offset, block) {
  const expectedEnd = offset + block.byteLength;
  try {
    await appendLargeDropboxUploadSession(env, sessionId, offset, block);
    return expectedEnd;
  } catch (firstError) {
    if (isSessionOffsetAcknowledgement(firstError, expectedEnd)) return expectedEnd;
    const retryable =
      firstError?.retryable === true ||
      ["DROPBOX_TIMEOUT", "DROPBOX_UNAVAILABLE", "DROPBOX_UPLOAD_SESSION_FAILED"].includes(
        String(firstError?.code || ""),
      );
    if (!retryable || !(await waitBeforeReconciledRetry(firstError))) {
      throw firstError;
    }

    try {
      await appendLargeDropboxUploadSession(env, sessionId, offset, block);
      return expectedEnd;
    } catch (secondError) {
      if (isSessionOffsetAcknowledgement(secondError, expectedEnd)) return expectedEnd;
      throw secondError;
    }
  }
}

async function findCommittedMetadata(env, project, fileName, expectedSize, expectedHash) {
  try {
    const raw = await getDropboxMetadata(env, project.dropbox_root_path, fileName);
    const metadata = normalizeProviderMetadata(raw, expectedSize);
    if (
      metadata.sizeBytes === expectedSize &&
      String(metadata.providerHash || "").toLowerCase() === String(expectedHash).toLowerCase()
    ) {
      return metadata;
    }
    return null;
  } catch (error) {
    if (error?.code === "DROPBOX_PATH_NOT_FOUND" || Number(error?.status) === 404) {
      return null;
    }
    throw error;
  }
}

async function finishSessionWithReconciliation(
  env,
  { sessionId, offset, project, fileName, finalBlock, expectedSize, expectedHash },
) {
  try {
    const raw = await finishLargeDropboxUploadSession(
      env,
      sessionId,
      offset,
      project.dropbox_root_path,
      fileName,
      finalBlock,
      { writeMode: "create" },
    );
    return normalizeProviderMetadata(raw, expectedSize);
  } catch (firstError) {
    const committed = await findCommittedMetadata(
      env,
      project,
      fileName,
      expectedSize,
      expectedHash,
    );
    if (committed) return committed;

    const retryable =
      firstError?.retryable === true ||
      ["DROPBOX_TIMEOUT", "DROPBOX_UNAVAILABLE", "DROPBOX_UPLOAD_SESSION_FAILED"].includes(
        String(firstError?.code || ""),
      );
    if (!retryable || !(await waitBeforeReconciledRetry(firstError))) {
      throw firstError;
    }

    try {
      const raw = await finishLargeDropboxUploadSession(
        env,
        sessionId,
        offset,
        project.dropbox_root_path,
        fileName,
        finalBlock,
        { writeMode: "create" },
      );
      return normalizeProviderMetadata(raw, expectedSize);
    } catch (secondError) {
      const afterRetry = await findCommittedMetadata(
        env,
        project,
        fileName,
        expectedSize,
        expectedHash,
      );
      if (afterRetry) return afterRetry;
      throw secondError;
    }
  }
}

async function publishLegacyPromotion(
  env,
  { project, expectedRevision, revision, ledger, actor, transitionId },
) {
  const updated = await env.DB.prepare(
    `UPDATE projects
        SET config_revision = ?,
            config_checksum = ?,
            config_checksum_algorithm = ?,
            config_storage_provider = ?,
            config_storage_ref = ?,
            config_storage_provider_version = ?,
            config_storage_provider_hash = ?,
            config_schema = ?,
            config_schema_version = ?,
            config_size_bytes = ?,
            config_content_type = ?,
            lifecycle_state = 'ACTIVE',
            lifecycle_version = CASE
              WHEN lifecycle_version < 1 THEN 1
              ELSE lifecycle_version + 1
            END,
            lifecycle_updated_at = CURRENT_TIMESTAMP,
            lifecycle_transition_id = ?,
            lifecycle_failure_stage = NULL,
            lifecycle_failure_code = NULL,
            lifecycle_failure_at = NULL,
            lifecycle_retryable = NULL,
            active = 1,
            updated_by = ?,
            updated_by_name_snapshot = ?,
            updated_at = CURRENT_TIMESTAMP,
            preview_status = 'PENDING',
            preview_attempts = 0,
            preview_last_error = NULL,
            preview_capture_method = NULL
      WHERE id = ?
        AND organization_id = ?
        AND config_revision = ?
        AND lifecycle_state IS NULL
        AND active = 1
      RETURNING *`,
  )
    .bind(
      revision,
      ledger.checksum,
      ledger.checksum_algorithm,
      ledger.storage_provider,
      ledger.storage_ref,
      ledger.storage_provider_version,
      ledger.storage_provider_hash,
      ledger.schema_name,
      ledger.schema_version,
      ledger.size_bytes,
      ledger.content_type,
      transitionId,
      actor?.id ?? null,
      actor?.name || "Usuário",
      project.id,
      project.organization_id,
      expectedRevision,
    )
    .first();

  if (!updated) {
    const current = await env.DB.prepare(
      `SELECT * FROM projects WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
      .bind(project.id, project.organization_id)
      .first();

    if (
      current?.lifecycle_state === "ACTIVE" &&
      Number(current?.config_revision || 0) === Number(revision) &&
      String(current?.config_checksum || "").toLowerCase() ===
        String(ledger.checksum || "").toLowerCase()
    ) {
      return { project: current, idempotent: true };
    }

    throw saveError(
      "O projeto foi alterado em outro lugar durante a promoção do lifecycle.",
      409,
      current?.lifecycle_state !== null && current?.lifecycle_state !== undefined
        ? "PROJECT_CONFIG_LIFECYCLE_CONFLICT"
        : "PROJECT_CONFIG_REVISION_CONFLICT",
      {
        expectedConfigRevision: expectedRevision,
        currentConfigRevision: Number(current?.config_revision || 0),
        expectedLifecycleState: null,
        currentLifecycleState: current?.lifecycle_state ?? null,
        stage: "PUBLISH",
      },
    );
  }

  try {
    await env.DB.prepare(
      `UPDATE project_config_revisions
          SET published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
      .bind(ledger.id)
      .run();
  } catch (error) {
    console.warn("[Maono large save] Promoção publicada sem carimbo published_at", {
      projectId: project.id,
      revision,
      code: error?.code || null,
    });
  }

  return { project: updated, idempotent: false };
}

async function updateLinkedOrganizationFile(env, project, artifact) {
  if (!project?.organization_file_id || !env?.DB?.prepare) return null;
  try {
    await env.DB.prepare(
      `UPDATE organization_files
          SET size_bytes = ?,
              sha256 = NULL,
              is_project = 1,
              active = 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
      .bind(artifact.sizeBytes, project.organization_file_id)
      .run();
    return null;
  } catch (error) {
    console.warn("[Maono large save] Falha auxiliar ao sincronizar organization_file", {
      projectId: project?.id ?? null,
      organizationFileId: project?.organization_file_id ?? null,
      code: error?.code || "PROJECT_ORGANIZATION_FILE_SYNC_FAILED",
    });
    return {
      stage: "organization_file_sync",
      code: error?.code || "PROJECT_ORGANIZATION_FILE_SYNC_FAILED",
      retryable: true,
    };
  }
}

function revisionHead(project, artifact, revision) {
  return {
    previousRevision: Math.max(0, Number(revision || 0) - 1),
    currentRevision: Number(revision || 0),
    contentHash: artifact.checksum,
    checksumAlgorithm: artifact.checksumAlgorithm,
    sizeBytes: artifact.sizeBytes,
    schema: {
      name: artifact.schemaName,
      version: artifact.schemaVersion,
    },
  };
}

export async function saveLargeLegacyProjectConfigStream(
  env,
  { request, project, user, saveTrace = null },
) {
  if (!request?.body || typeof request.body.getReader !== "function") {
    throw saveError(
      "Stream do MapConfig não está disponível.",
      400,
      "PROJECT_CONFIG_LARGE_SAVE_STREAM_REQUIRED",
    );
  }
  if (!project?.id || !project?.organization_id || !project?.dropbox_root_path) {
    throw saveError(
      "Projeto sem contexto de storage para save grande.",
      500,
      "MAP_CONFIG_STORAGE_CONTEXT_INVALID",
    );
  }
  if (project.lifecycle_state !== null && project.lifecycle_state !== undefined) {
    throw saveError(
      "O projeto não é legado e não pode usar a promoção automática de lifecycle.",
      409,
      "PROJECT_CONFIG_LIFECYCLE_CONFLICT",
      { currentLifecycleState: project.lifecycle_state },
    );
  }

  const manifest = validateManifest(request);
  const currentRevision = Math.max(0, Number(project.config_revision || 0));
  if (currentRevision !== manifest.expectedRevision) {
    throw saveError(
      "O projeto foi alterado em outro lugar. Recarregue o mapa antes de salvar novamente.",
      409,
      "PROJECT_CONFIG_REVISION_CONFLICT",
      {
        expectedConfigRevision: manifest.expectedRevision,
        currentConfigRevision: currentRevision,
        stage: "RESERVE",
      },
    );
  }

  const nextRevision = manifest.expectedRevision + 1;
  const storageRef = createMapConfigStorageRef(project.id, nextRevision);
  const fileName = getMapConfigRevisionFileName(
    project.default_config_file || "config.kepler.json",
    nextRevision,
  );

  saveTrace?.updateContext({
    projectId: project.id,
    organizationId: project.organization_id,
    expectedRevision: manifest.expectedRevision,
    candidateRevision: nextRevision,
    payloadBytes: manifest.declaredSize,
    provider: "dropbox",
  });

  await ensureDropboxFolder(env, project.dropbox_root_path);
  const started = await startLargeDropboxUploadSession(env);
  const sessionId = String(started?.session_id || "").trim();
  if (!sessionId) {
    throw saveError(
      "O Dropbox não retornou uma sessão de upload válida.",
      502,
      "DROPBOX_UPLOAD_SESSION_FAILED",
    );
  }

  const reader = request.body.getReader();
  const guard = new StreamingJsonBoundaryGuard();
  const blockDigests = [];
  let pending = new Uint8Array(DROPBOX_STREAM_BLOCK_BYTES);
  let pendingLength = 0;
  let offset = 0;
  let totalBytes = 0;
  let reservation = null;
  let publicationCompleted = false;
  let currentStage = "WRITE";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const incoming = value instanceof Uint8Array ? value : new Uint8Array(value);
      if (!incoming.byteLength) continue;

      totalBytes += incoming.byteLength;
      if (totalBytes > manifest.declaredSize) {
        throw saveError(
          "O MapConfig recebido ultrapassou o tamanho declarado.",
          400,
          "PROJECT_CONFIG_SIZE_MISMATCH",
          {
            expectedSizeBytes: manifest.declaredSize,
            actualSizeBytes: totalBytes,
          },
        );
      }
      guard.push(incoming);

      let sourceOffset = 0;
      while (sourceOffset < incoming.byteLength) {
        const writable = Math.min(
          pending.byteLength - pendingLength,
          incoming.byteLength - sourceOffset,
        );
        pending.set(
          incoming.subarray(sourceOffset, sourceOffset + writable),
          pendingLength,
        );
        pendingLength += writable;
        sourceOffset += writable;

        if (pendingLength === pending.byteLength) {
          const block = pending;
          blockDigests.push(await dropboxContentHashBlockDigest(block));
          offset = await appendBlock(env, sessionId, offset, block);
          pending = new Uint8Array(DROPBOX_STREAM_BLOCK_BYTES);
          pendingLength = 0;
        }
      }
    }

    guard.finish();
    if (totalBytes !== manifest.declaredSize) {
      throw saveError(
        "O tamanho recebido do MapConfig não corresponde ao tamanho declarado.",
        400,
        "PROJECT_CONFIG_SIZE_MISMATCH",
        {
          expectedSizeBytes: manifest.declaredSize,
          actualSizeBytes: totalBytes,
        },
      );
    }

    const finalBlock = pending.subarray(0, pendingLength);
    if (finalBlock.byteLength > 0) {
      blockDigests.push(await dropboxContentHashBlockDigest(finalBlock));
    }
    const contentHash = await dropboxContentHashFromBlockDigestsHex(blockDigests);
    const artifact = {
      checksum: contentHash,
      contentHash,
      checksumAlgorithm: LARGE_CONFIG_CHECKSUM_ALGORITHM,
      sizeBytes: totalBytes,
      schemaName: manifest.schemaName,
      schemaVersion: manifest.schemaVersion,
      contentType: LARGE_CONFIG_CONTENT_TYPE,
    };

    currentStage = "RESERVE";
    reservation = await reserveProjectConfigRevision(env, {
      projectId: project.id,
      organizationId: project.organization_id,
      expectedCurrentRevision: manifest.expectedRevision,
      checksumAlgorithm: artifact.checksumAlgorithm,
      checksum: artifact.checksum,
      storageProvider: "dropbox",
      storageRef,
      schemaName: artifact.schemaName,
      schemaVersion: artifact.schemaVersion,
      sizeBytes: artifact.sizeBytes,
      contentType: artifact.contentType,
      actorUserId: user?.id ?? null,
      transitionId: saveTrace?.saveId ?? null,
      allowedLifecycleStates: [],
    });

    currentStage = "WRITE";
    const metadata = await finishSessionWithReconciliation(env, {
      sessionId,
      offset,
      project,
      fileName,
      finalBlock,
      expectedSize: totalBytes,
      expectedHash: contentHash,
    });

    if (
      metadata.sizeBytes !== totalBytes ||
      String(metadata.providerHash || "").toLowerCase() !== contentHash.toLowerCase()
    ) {
      throw saveError(
        "O Dropbox não confirmou a integridade do MapConfig grande.",
        502,
        "MAP_CONFIG_STORAGE_INTEGRITY_MISMATCH",
        {
          provider: "dropbox",
          expectedSizeBytes: totalBytes,
          actualSizeBytes: metadata.sizeBytes,
        },
      );
    }

    currentStage = "READY";
    const ready = await markProjectConfigRevisionReady(env, {
      projectId: project.id,
      revision: nextRevision,
      checksum: contentHash,
      storageProviderVersion: metadata.providerVersion,
      storageProviderHash: metadata.providerHash,
    });

    currentStage = "PUBLISH";
    const promoted = await publishLegacyPromotion(env, {
      project,
      expectedRevision: manifest.expectedRevision,
      revision: nextRevision,
      ledger: ready,
      actor: { id: user?.id ?? null, name: user?.name || "Usuário" },
      transitionId: saveTrace?.saveId ?? null,
    });
    publicationCompleted = true;

    const organizationFileWarning = await updateLinkedOrganizationFile(
      env,
      promoted.project,
      artifact,
    );

    return {
      project: promoted.project,
      revision: nextRevision,
      revisionHead: revisionHead(promoted.project, artifact, nextRevision),
      artifact,
      ledger: ready,
      transitionId: saveTrace?.saveId ?? null,
      legacy: false,
      promotedFromLegacy: true,
      idempotent: Boolean(promoted.idempotent || reservation.idempotent),
      auxiliaryWarnings: organizationFileWarning ? [organizationFileWarning] : [],
      transport: "stream",
    };
  } catch (error) {
    if (reservation && !publicationCompleted) {
      try {
        await markProjectConfigRevisionFailed(env, {
          projectId: project.id,
          revision: nextRevision,
          errorCode: error?.code || "PROJECT_CONFIG_LARGE_SAVE_FAILED",
          errorStage: currentStage,
        });
      } catch {
        // O erro original continua sendo a autoridade da tentativa.
      }
    }
    if (error && typeof error === "object") {
      error.details = {
        ...(error.details || {}),
        stage: error?.details?.stage || currentStage,
        transport: "stream",
        bytesReceived: totalBytes,
        legacyPromotion: true,
      };
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // noop
    }
  }
}
