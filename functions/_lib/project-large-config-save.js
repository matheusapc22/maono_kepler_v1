import {
  ensureDropboxFolder,
  getDropboxMetadata,
} from "./dropbox.js";
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
import { PROJECT_LIFECYCLE_STATES } from "./project-lifecycle.js";
import {
  markProjectConfigRevisionFailed,
  markProjectConfigRevisionReady,
  publishProjectConfigRevision,
  reserveProjectConfigRevision,
} from "./project-config-revisions.js";

export const LARGE_CONFIG_REQUEST_HEADER = "X-Maono-Large-Config";
export const LARGE_CONFIG_THRESHOLD_BYTES = 8 * 1024 * 1024;
export const INLINE_CONFIG_HARD_LIMIT_BYTES = 12 * 1024 * 1024;
export const LARGE_CONFIG_CHECKSUM_ALGORITHM = "dropbox-content-hash";
export const LARGE_CONFIG_CONTENT_TYPE = "application/json; charset=utf-8";

function saveError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function integerHeader(request, name, { min = 0, required = true } = {}) {
  const raw = request.headers.get(name);
  if ((raw === null || raw === "") && !required) return null;
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

export function isLargeProjectConfigRequest(request) {
  return request?.headers?.get?.(LARGE_CONFIG_REQUEST_HEADER) === "1";
}

export function assertInlineProjectConfigRequestSize(request) {
  if (isLargeProjectConfigRequest(request)) return true;
  const contentLength = Number(request?.headers?.get?.("content-length") || 0);
  if (contentLength > INLINE_CONFIG_HARD_LIMIT_BYTES) {
    throw saveError(
      "Este MapConfig é grande demais para o modo de save JSON tradicional. Atualize a página e tente novamente.",
      413,
      "PROJECT_CONFIG_LARGE_SAVE_REQUIRED",
      {
        contentLength,
        inlineHardLimitBytes: INLINE_CONFIG_HARD_LIMIT_BYTES,
        largeThresholdBytes: LARGE_CONFIG_THRESHOLD_BYTES,
      },
    );
  }
  return true;
}

function validateLargeSaveHeaders(request) {
  if (!isLargeProjectConfigRequest(request)) {
    throw saveError(
      "Contrato de save grande não informado.",
      400,
      "PROJECT_CONFIG_LARGE_SAVE_HEADERS_INVALID",
    );
  }

  const expectedRevision = integerHeader(request, "X-Maono-Expected-Revision");
  const declaredSize = integerHeader(request, "X-Maono-Config-Size", { min: 1 });
  const datasetCount = integerHeader(request, "X-Maono-Dataset-Count");
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
    datasetCount,
    schemaName,
    schemaVersion,
    configVersion,
  };
}

class StreamingJsonObjectGuard {
  constructor() {
    this.stack = [];
    this.started = false;
    this.finished = false;
    this.inString = false;
    this.escape = false;
  }

  push(bytes) {
    for (let index = 0; index < bytes.byteLength; index += 1) {
      const byte = bytes[index];
      if (!this.started) {
        if ([0x20, 0x09, 0x0a, 0x0d].includes(byte)) continue;
        if (byte !== 0x7b) {
          throw saveError(
            "O MapConfig grande deve ser um objeto JSON.",
            400,
            "INVALID_KEPLER_CONFIG",
            { field: "root" },
          );
        }
        this.started = true;
        this.stack.push(0x7d);
        continue;
      }

      if (this.finished) {
        if (![0x20, 0x09, 0x0a, 0x0d].includes(byte)) {
          throw saveError(
            "Há conteúdo adicional após o MapConfig JSON.",
            400,
            "INVALID_KEPLER_CONFIG",
          );
        }
        continue;
      }

      if (this.inString) {
        if (this.escape) {
          this.escape = false;
          continue;
        }
        if (byte === 0x5c) {
          this.escape = true;
        } else if (byte === 0x22) {
          this.inString = false;
        } else if (byte < 0x20) {
          throw saveError(
            "String JSON inválida no MapConfig.",
            400,
            "INVALID_KEPLER_CONFIG",
          );
        }
        continue;
      }

      if (byte === 0x22) {
        this.inString = true;
      } else if (byte === 0x7b) {
        this.stack.push(0x7d);
      } else if (byte === 0x5b) {
        this.stack.push(0x5d);
      } else if (byte === 0x7d || byte === 0x5d) {
        const expected = this.stack.pop();
        if (expected !== byte) {
          throw saveError(
            "Estrutura JSON inválida no MapConfig.",
            400,
            "INVALID_KEPLER_CONFIG",
          );
        }
        if (this.stack.length === 0) this.finished = true;
      }
    }
  }

  finish() {
    if (
      !this.started ||
      !this.finished ||
      this.inString ||
      this.escape ||
      this.stack.length !== 0
    ) {
      throw saveError(
        "O MapConfig grande foi recebido de forma incompleta.",
        400,
        "INVALID_KEPLER_CONFIG",
      );
    }
  }
}

function hex(bytes) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function blockDigest(block) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", block));
}

async function finalDropboxHash(blockDigests) {
  const concatenated = new Uint8Array(blockDigests.length * 32);
  blockDigests.forEach((digest, index) => concatenated.set(digest, index * 32));
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", concatenated)));
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
    if (!retryable) throw firstError;

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
    if (!retryable) throw firstError;

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

async function updateLinkedOrganizationFile(env, project, artifact) {
  if (!project?.organization_file_id || !env?.DB?.prepare) return null;
  try {
    await env.DB.prepare(
      `UPDATE organization_files
          SET size_bytes = ?,
              sha256 = ?,
              is_project = 1,
              active = 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
      .bind(artifact.sizeBytes, artifact.checksum, project.organization_file_id)
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

export async function saveLargeProjectConfigStream(
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

  const manifest = validateLargeSaveHeaders(request);
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
  const guard = new StreamingJsonObjectGuard();
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
          blockDigests.push(await blockDigest(block));
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
      blockDigests.push(await blockDigest(finalBlock));
    }
    const contentHash = await finalDropboxHash(blockDigests);
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
      allowedLifecycleStates: [PROJECT_LIFECYCLE_STATES.ACTIVE],
    });

    if (reservation.alreadyPublished) {
      publicationCompleted = true;
      return {
        project: reservation.project,
        revision: nextRevision,
        revisionHead: revisionHead(reservation.project, artifact, nextRevision),
        artifact,
        ledger: reservation.revision,
        transitionId: saveTrace?.saveId ?? null,
        legacy: false,
        idempotent: true,
        auxiliaryWarnings: [],
        transport: "stream",
      };
    }

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
    const updatedProject = await publishProjectConfigRevision(env, {
      projectId: project.id,
      organizationId: project.organization_id,
      expectedCurrentRevision: manifest.expectedRevision,
      revision: nextRevision,
      actor: { id: user?.id ?? null, name: user?.name || "Usuário" },
      markPreviewPending: true,
      expectedLifecycleState: PROJECT_LIFECYCLE_STATES.ACTIVE,
    });
    publicationCompleted = true;

    const organizationFileWarning = await updateLinkedOrganizationFile(
      env,
      updatedProject,
      artifact,
    );

    return {
      project: updatedProject,
      revision: nextRevision,
      revisionHead: revisionHead(updatedProject, artifact, nextRevision),
      artifact,
      ledger: ready,
      transitionId: saveTrace?.saveId ?? null,
      legacy: false,
      idempotent: Boolean(reservation.idempotent),
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
