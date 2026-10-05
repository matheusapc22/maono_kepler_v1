import { uploadProjectSaveOperationPayload, verifyStoredProjectSaveOperation, recoverStoredProjectSaveOperation } from "./project-save-operation-payload.js";
import { dropboxContentHashHex } from "./dropbox-content-hash.js";
import {
  downloadDropboxBinaryFile,
  ensureDropboxFolder,
  getDropboxMetadata,
} from "./dropbox.js";
import { isLocalStorageMode } from "./local-storage.js";
import {
  assertMapConfigStorageRef,
  resolveMapConfigStorageFileName,
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

function assertProjectStorageContext(project) {
  if (!project?.id || !project?.dropbox_root_path) {
    const error = new Error("Projeto sem contexto interno de storage.");
    error.status = 500;
    error.code = "MAP_CONFIG_STORAGE_CONTEXT_INVALID";
    throw error;
  }
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

  async uploadOperationPayload(args) {
    return uploadProjectSaveOperationPayload(this.env, args);
  }

  async verifyOperationPayload(args) {
    return verifyStoredProjectSaveOperation(this.env, args);
  }

  async recoverOperationPayload(args) {
    return recoverStoredProjectSaveOperation(this.env, args);
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

  async getRevision({ project, revision, storageRef }) {
    assertProjectStorageContext(project);
    assertMapConfigStorageRef(storageRef, project.id, revision, project.organization_id);
    const fileName = resolveMapConfigStorageFileName({ project, revision, storageRef });
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

  async getMetadata({ project, revision = null, storageRef = null }) {
    assertProjectStorageContext(project);
    const fileName = storageRef
      ? resolveMapConfigStorageFileName({ project, revision, storageRef })
      : project.default_config_file || "config.kepler.json";
    try {
      const metadata = await getDropboxMetadata(this.env, project.dropbox_root_path, fileName);
      return { ...normalizeProviderMetadata(this.provider, metadata), storageRef };
    } catch (error) {
      throw mapConfigStorageError(error, "metadata");
    }
  }

  // A legacy reader only: promotion writes through the durable operation API.
  // Dropbox content_hash binds the streamed source to the new manifest without
  // materializing large configurations in the application or D1.
  async loadLegacyStream({ project }) {
    assertProjectStorageContext(project);
    const fileName = project.default_config_file || "config.kepler.json";
    try {
      const metadata = await getDropboxMetadata(this.env, project.dropbox_root_path, fileName);
      const sizeBytes = Number(metadata?.size);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
        throw Object.assign(new Error("Tamanho da configuração legada inválido."), { status: 409, code: "MAP_CONFIG_STORAGE_INTEGRITY_MISMATCH" });
      }
      if (this.provider === "local-d1" && sizeBytes > 8 * 1024 * 1024) {
        throw Object.assign(new Error("O storage local de blobs não suporta mapas grandes."), { status: 413, code: "PROJECT_CONFIG_LOCAL_STREAM_UNSUPPORTED" });
      }
      const response = await downloadDropboxBinaryFile(this.env, project.dropbox_root_path, fileName);
      let body = response.body;
      let checksum = String(metadata?.content_hash || "").toLowerCase();
      if (this.provider === "local-d1") {
        const bytes = new Uint8Array(await response.arrayBuffer());
        checksum = await dropboxContentHashHex(bytes);
        body = new Response(bytes).body;
      }
      if (!/^[0-9a-f]{64}$/.test(checksum)) {
        try { await body?.cancel(); } catch { /* Preserve integrity error. */ }
        throw Object.assign(new Error("O storage não retornou o hash da configuração legada."), { status: 502, code: "MAP_CONFIG_STORAGE_INTEGRITY_MISMATCH" });
      }
      return {
        body, sizeBytes, checksum, checksumAlgorithm: "dropbox-content-hash",
        schemaName: "legacy-kepler", schemaVersion: 1, serializationVersion: 1,
        configVersion: null, datasetCount: null, contentType: DEFAULT_CONTENT_TYPE,
      };
    } catch (error) { throw mapConfigStorageError(error, "read"); }
  }
}
