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
  let code = "MAP_CONFIG_STORAGE_FAILED";
  if (status === 401 || status === 403) code = "MAP_CONFIG_STORAGE_AUTH_FAILED";
  else if (status === 404) code = "MAP_CONFIG_NOT_FOUND";
  else if (status === 429 || status >= 500) code = "MAP_CONFIG_STORAGE_UNAVAILABLE";
  else if (operation === "read") code = "MAP_CONFIG_STORAGE_READ_FAILED";
  else if (operation === "write") code = "MAP_CONFIG_STORAGE_WRITE_FAILED";
  else if (operation === "metadata") code = "MAP_CONFIG_STORAGE_METADATA_FAILED";
  else if (operation === "prepare") code = "MAP_CONFIG_STORAGE_PREPARE_FAILED";

  const wrapped = new Error(
    operation === "write"
      ? "Não foi possível persistir a configuração do mapa."
      : operation === "metadata"
        ? "Não foi possível consultar os metadados da configuração do mapa."
        : operation === "prepare"
          ? "Não foi possível preparar o storage da configuração do mapa."
          : "Não foi possível carregar a configuração do mapa.",
  );
  wrapped.status = status;
  wrapped.code = code;
  wrapped.details = {
    provider: "dropbox",
    operation,
    retryable: status === 429 || status >= 500,
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

function normalizeBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  const error = new Error("Bytes de MapConfig inválidos.");
  error.status = 400;
  error.code = "MAP_CONFIG_BYTES_INVALID";
  throw error;
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

  // Compatibilidade de infraestrutura para fluxos antigos que preparavam a
  // pasta explicitamente. Não faz parte da porta MapConfigRepository S04.
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
        contentType:
          response.headers.get("content-type") || DEFAULT_CONTENT_TYPE,
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
    } else {
      const error = new Error("Modo de persistência de MapConfig inválido.");
      error.status = 400;
      error.code = "MAP_CONFIG_SAVE_MODE_INVALID";
      throw error;
    }

    try {
      const metadata = await uploadDropboxBinaryFile(
        this.env,
        project.dropbox_root_path,
        fileName,
        source,
        contentType,
      );
      return {
        ...normalizeProviderMetadata(this.provider, metadata, source.byteLength),
        storageRef: normalizedStorageRef,
        contentType,
        source:
          mode === MAP_CONFIG_SAVE_MODES.LEGACY_OVERWRITE
            ? "legacy"
            : "revision",
      };
    } catch (error) {
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
        contentType:
          response.headers.get("content-type") || DEFAULT_CONTENT_TYPE,
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
