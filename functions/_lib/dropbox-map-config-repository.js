import { dropboxContentHashHex } from "./dropbox-content-hash.js";
import {
  downloadDropboxBinaryFile,
  ensureDropboxFolder,
  getDropboxMetadata,
  uploadDropboxBinaryFile,
} from "./dropbox.js";
import { isLocalStorageMode } from "./local-storage.js";
import { MAP_CONFIG_SAVE_MODES } from "./map-config-repository.js";
import {
  assertMapConfigStorageRef,
  createMapConfigStorageRef,
  getMapConfigRevisionFileName,
} from "./map-config-storage-ref.js";

const DEFAULT_CONTENT_TYPE = "application/json; charset=utf-8";

function mapConfigStorageError(error, operation) {
  if (String(error?.code || "").startsWith("MAP_CONFIG_")) return error;

  const status = Number(error?.status || 500);
  const message = String(error?.message || "");
  const providerCode = String(error?.code || "");
  const providerStatus = Number(
    error?.providerStatus ?? error?.dropboxStatus ?? error?.details?.providerStatus ?? 0,
  ) || null;
  const retryable =
    typeof error?.retryable === "boolean"
      ? error.retryable
      : typeof error?.details?.retryable === "boolean"
        ? error.details.retryable
        : status === 429 || status >= 500;
  let code = "MAP_CONFIG_STORAGE_FAILED";

  if (
    status === 404 ||
    providerCode === "DROPBOX_PATH_NOT_FOUND" ||
    /path\/not_found|not_found/i.test(message)
  ) {
    code = "MAP_CONFIG_NOT_FOUND";
  } else if (
    providerCode === "DROPBOX_AUTH_FAILED" ||
    status === 401 ||
    status === 403
  ) {
    code = "MAP_CONFIG_STORAGE_AUTH_FAILED";
  } else if (
    ["DROPBOX_TIMEOUT", "DROPBOX_RATE_LIMITED", "DROPBOX_UNAVAILABLE"].includes(providerCode) ||
    status === 429 ||
    status >= 500
  ) {
    code = "MAP_CONFIG_STORAGE_UNAVAILABLE";
  } else if (operation === "read") {
    code = "MAP_CONFIG_STORAGE_READ_FAILED";
  } else if (operation === "write") {
    code = "MAP_CONFIG_STORAGE_WRITE_FAILED";
  } else if (operation === "metadata") {
    code = "MAP_CONFIG_STORAGE_METADATA_FAILED";
  } else if (operation === "prepare") {
    code = "MAP_CONFIG_STORAGE_PREPARE_FAILED";
  }

  const wrapped = new Error(
    code === "MAP_CONFIG_NOT_FOUND"
      ? "A revisão de configuração não foi encontrada no storage."
      : code === "MAP_CONFIG_STORAGE_AUTH_FAILED"
        ? "A autenticação do storage da configuração do mapa falhou."
        : operation === "write"
          ? "Não foi possível persistir a configuração do mapa."
          : operation === "metadata"
            ? "Não foi possível consultar os metadados da configuração do mapa."
            : operation === "prepare"
              ? "Não foi possível preparar o storage da configuração do mapa."
              : "Não foi possível carregar a configuração do mapa.",
  );
  wrapped.status =
    code === "MAP_CONFIG_NOT_FOUND"
      ? 404
      : code === "MAP_CONFIG_STORAGE_AUTH_FAILED" ||
          code === "MAP_CONFIG_STORAGE_UNAVAILABLE"
        ? 503
        : status;
  wrapped.code = code;
  wrapped.retryable = retryable;
  wrapped.provider = "dropbox";
  wrapped.providerStatus = providerStatus;
  wrapped.details = {
    provider: "dropbox",
    operation,
    retryable,
    providerCode: providerCode || null,
    providerStatus,
    ...(Number.isInteger(Number(error?.details?.attempts))
      ? { attempts: Number(error.details.attempts) }
      : {}),
    ...(Number.isFinite(Number(error?.details?.providerElapsedMs))
      ? { providerElapsedMs: Number(error.details.providerElapsedMs) }
      : {}),
    ...(Number.isFinite(Number(error?.details?.retryAfterMs))
      ? { retryAfterMs: Number(error.details.retryAfterMs) }
      : {}),
  };
  wrapped.cause = error;
  return wrapped;
}

function isWriteConflict(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return (
    code === "DROPBOX_PATH_CONFLICT" ||
    code === "LOCAL_STORAGE_PATH_CONFLICT" ||
    (Number(error?.status || 0) === 409 && /path\/conflict|constraint/i.test(message))
  );
}

function assertProjectStorageContext(project) {
  if (!project?.id || !project?.dropbox_root_path) {
    const error = new Error("Projeto sem contexto interno de storage.");
    error.status = 500;
    error.code = "MAP_CONFIG_STORAGE_CONTEXT_INVALID";
    throw error;
  }
}

function normalizeBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  const error = new Error("Bytes de MapConfig inválidos.");
  error.status = 400;
  error.code = "MAP_CONFIG_BYTES_INVALID";
  throw error;
}

function bytesEqual(left, right) {
  const a = normalizeBytes(left);
  const b = normalizeBytes(right);
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function immutableViolation(project, revision, storageRef) {
  const error = new Error(
    "A revisão imutável já existe com conteúdo diferente.",
  );
  error.status = 409;
  error.code = "MAP_CONFIG_REVISION_IMMUTABILITY_VIOLATION";
  error.details = {
    projectId: project?.id ?? null,
    revision: Number(revision || 0),
    storageRef,
  };
  return error;
}

function providerIntegrityError(project, revision, storageRef) {
  const error = new Error(
    "O storage não confirmou a integridade da revisão persistida.",
  );
  error.status = 502;
  error.code = "MAP_CONFIG_STORAGE_INTEGRITY_MISMATCH";
  error.details = {
    provider: "dropbox",
    projectId: project?.id ?? null,
    revision: Number(revision || 0),
    storageRef,
    retryable: true,
  };
  return error;
}

function normalizeProviderMetadata(provider, metadata, fallbackSize = 0) {
  return {
    provider,
    providerVersion: metadata?.rev ?? null,
    providerHash: metadata?.content_hash ?? null,
    providerObjectId: metadata?.id ?? null,
    sizeBytes: Number(metadata?.size ?? fallbackSize ?? 0),
  };
}

export class DropboxMapConfigRepository {
  constructor(env) {
    this.env = env;
    this.provider = isLocalStorageMode(env) ? "local-d1" : "dropbox";
  }

  async prepare({ project }) {
    assertProjectStorageContext(project);
    try {
      await ensureDropboxFolder(this.env, project.dropbox_root_path);
      return { provider: this.provider };
    } catch (error) {
      throw mapConfigStorageError(error, "prepare");
    }
  }

  async load({ project }) {
    assertProjectStorageContext(project);
    const revision = Number(project.config_revision || 0);
    const storageRef = String(project.config_storage_ref || "").trim();
    if (revision > 0 && storageRef) {
      return this.getRevision({ project, revision, storageRef });
    }

    const fileName = project.default_config_file || "config.kepler.json";
    try {
      const response = await downloadDropboxBinaryFile(
        this.env,
        project.dropbox_root_path,
        fileName,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        bytes,
        contentType: response.headers.get("content-type") || DEFAULT_CONTENT_TYPE,
        sizeBytes: bytes.byteLength,
        provider: this.provider,
        storageRef: null,
        providerVersion: null,
        providerHash: null,
        providerObjectId: null,
        source: "legacy",
      };
    } catch (error) {
      throw mapConfigStorageError(error, "read");
    }
  }

  async findExistingRevision({ project, revision, storageRef }) {
    try {
      return await this.getRevision({ project, revision, storageRef });
    } catch (error) {
      if (error?.code === "MAP_CONFIG_NOT_FOUND") return null;
      throw error;
    }
  }

  async findExistingMetadata({ project, revision, storageRef }) {
    try {
      return await this.getMetadata({
        project,
        revision,
        storageRef,
        mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
      });
    } catch (error) {
      if (error?.code === "MAP_CONFIG_NOT_FOUND") return null;
      throw error;
    }
  }

  async existingRevisionResult({
    project,
    revision,
    storageRef,
    source,
    contentType,
    expectedProviderHash = null,
  }) {
    if (this.provider === "dropbox" && expectedProviderHash) {
      const metadata = await this.findExistingMetadata({
        project,
        revision,
        storageRef,
      });
      if (!metadata) return null;
      if (metadata.providerHash) {
        if (
          String(metadata.providerHash).toLowerCase() !==
          String(expectedProviderHash).toLowerCase()
        ) {
          throw immutableViolation(project, revision, storageRef);
        }
        return {
          ...metadata,
          storageRef,
          contentType,
          source: "revision",
          idempotent: true,
          createdNew: false,
          contentVerified: true,
          verificationMethod: "provider-content-hash",
        };
      }
    }

    const existing = await this.findExistingRevision({
      project,
      revision,
      storageRef,
    });
    if (!existing) return null;
    if (!bytesEqual(existing.bytes, source)) {
      throw immutableViolation(project, revision, storageRef);
    }
    const metadata = await this.getMetadata({
      project,
      revision,
      storageRef,
      mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
    });
    return {
      ...metadata,
      storageRef,
      contentType,
      source: "revision",
      idempotent: true,
      createdNew: false,
      contentVerified: true,
      verificationMethod: "byte-compare",
    };
  }

  async saveRevision({
    project,
    revision,
    storageRef = null,
    bytes,
    contentType = DEFAULT_CONTENT_TYPE,
    mode = MAP_CONFIG_SAVE_MODES.IMMUTABLE,
  }) {
    assertProjectStorageContext(project);
    const source = normalizeBytes(bytes);
    let fileName;
    let normalizedStorageRef = storageRef;
    let expectedProviderHash = null;

    if (mode === MAP_CONFIG_SAVE_MODES.LEGACY_OVERWRITE) {
      fileName = project.default_config_file || "config.kepler.json";
      normalizedStorageRef = null;
    } else if (mode === MAP_CONFIG_SAVE_MODES.IMMUTABLE) {
      normalizedStorageRef =
        storageRef || createMapConfigStorageRef(project.id, revision);
      assertMapConfigStorageRef(normalizedStorageRef, project.id, revision);
      fileName = getMapConfigRevisionFileName(
        project.default_config_file || "config.kepler.json",
        revision,
      );
      if (this.provider === "dropbox") {
        expectedProviderHash = await dropboxContentHashHex(source);
      }

      const existing = await this.existingRevisionResult({
        project,
        revision,
        storageRef: normalizedStorageRef,
        source,
        contentType,
        expectedProviderHash,
      });
      if (existing) return existing;
    } else {
      const error = new Error("Modo de persistência de MapConfig inválido.");
      error.status = 400;
      error.code = "MAP_CONFIG_SAVE_MODE_INVALID";
      throw error;
    }

    try {
      const rawMetadata = await uploadDropboxBinaryFile(
        this.env,
        project.dropbox_root_path,
        fileName,
        source,
        contentType,
        {
          writeMode:
            mode === MAP_CONFIG_SAVE_MODES.IMMUTABLE ? "create" : "overwrite",
        },
      );
      const metadata = normalizeProviderMetadata(
        this.provider,
        rawMetadata,
        source.byteLength,
      );
      let contentVerified = false;
      let verificationMethod = null;

      if (this.provider === "dropbox" && expectedProviderHash) {
        if (
          !metadata.providerHash ||
          String(metadata.providerHash).toLowerCase() !==
            String(expectedProviderHash).toLowerCase()
        ) {
          throw providerIntegrityError(project, revision, normalizedStorageRef);
        }
        contentVerified = true;
        verificationMethod = "provider-content-hash";
      }

      return {
        ...metadata,
        storageRef: normalizedStorageRef,
        contentType,
        source:
          mode === MAP_CONFIG_SAVE_MODES.LEGACY_OVERWRITE
            ? "legacy"
            : "revision",
        idempotent: false,
        createdNew: mode === MAP_CONFIG_SAVE_MODES.IMMUTABLE,
        contentVerified,
        verificationMethod,
      };
    } catch (error) {
      if (mode === MAP_CONFIG_SAVE_MODES.IMMUTABLE && isWriteConflict(error)) {
        const existing = await this.existingRevisionResult({
          project,
          revision,
          storageRef: normalizedStorageRef,
          source,
          contentType,
          expectedProviderHash,
        });
        if (existing) return existing;
      }
      throw mapConfigStorageError(error, "write");
    }
  }

  async getRevision({ project, revision, storageRef }) {
    assertProjectStorageContext(project);
    assertMapConfigStorageRef(storageRef, project.id, revision);
    const fileName = getMapConfigRevisionFileName(
      project.default_config_file || "config.kepler.json",
      revision,
    );
    try {
      const response = await downloadDropboxBinaryFile(
        this.env,
        project.dropbox_root_path,
        fileName,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        bytes,
        contentType: response.headers.get("content-type") || DEFAULT_CONTENT_TYPE,
        sizeBytes: bytes.byteLength,
        provider: this.provider,
        storageRef,
        source: "revision",
      };
    } catch (error) {
      throw mapConfigStorageError(error, "read");
    }
  }

  async getMetadata({
    project,
    revision = null,
    storageRef = null,
    mode = MAP_CONFIG_SAVE_MODES.IMMUTABLE,
  }) {
    assertProjectStorageContext(project);
    let fileName;
    if (mode === MAP_CONFIG_SAVE_MODES.LEGACY_OVERWRITE) {
      fileName = project.default_config_file || "config.kepler.json";
    } else {
      assertMapConfigStorageRef(storageRef, project.id, revision);
      fileName = getMapConfigRevisionFileName(
        project.default_config_file || "config.kepler.json",
        revision,
      );
    }
    try {
      const metadata = await getDropboxMetadata(
        this.env,
        project.dropbox_root_path,
        fileName,
      );
      return {
        ...normalizeProviderMetadata(this.provider, metadata),
        storageRef:
          mode === MAP_CONFIG_SAVE_MODES.LEGACY_OVERWRITE ? null : storageRef,
      };
    } catch (error) {
      throw mapConfigStorageError(error, "metadata");
    }
  }
}
