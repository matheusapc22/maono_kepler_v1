import {
  downloadDropboxBinaryFile,
  ensureDropboxFolder,
  getDropboxMetadata,
  uploadDropboxBinaryFile,
} from "./dropbox.js";
import { isLocalStorageMode } from "./local-storage.js";

const STORAGE_REF_PATTERN = /^project-config:\/\/([1-9][0-9]*)\/revisions\/([1-9][0-9]*)$/;

function repositoryError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw repositoryError("Identificador de revisão inválido.", 400, code);
  }
  return number;
}

export function getProjectConfigStorageProvider(env) {
  return isLocalStorageMode(env) ? "local-d1" : "dropbox";
}

export function createProjectConfigStorageRef(projectId, revision) {
  const normalizedProjectId = positiveInteger(projectId, "PROJECT_CONFIG_PROJECT_ID_INVALID");
  const normalizedRevision = positiveInteger(revision, "PROJECT_CONFIG_REVISION_INVALID");
  return `project-config://${normalizedProjectId}/revisions/${normalizedRevision}`;
}

export function parseProjectConfigStorageRef(storageRef) {
  const value = String(storageRef || "").trim();
  const match = value.match(STORAGE_REF_PATTERN);

  if (!match) {
    throw repositoryError(
      "Referência interna da configuração inválida.",
      500,
      "PROJECT_CONFIG_STORAGE_REF_INVALID",
    );
  }

  return {
    projectId: Number(match[1]),
    revision: Number(match[2]),
  };
}

export function getProjectConfigRevisionFileName(
  defaultConfigFile = "config.kepler.json",
  revision,
) {
  const normalizedRevision = positiveInteger(revision, "PROJECT_CONFIG_REVISION_INVALID");
  const suffix = String(normalizedRevision).padStart(6, "0");
  const name = String(defaultConfigFile || "config.kepler.json").trim();

  if (/\.json$/i.test(name)) {
    return name.replace(/\.json$/i, `.r${suffix}.json`);
  }

  return `${name}.r${suffix}.json`;
}

function assertProjectStorageContext(project) {
  if (!project?.id || !project?.dropbox_root_path) {
    throw repositoryError(
      "Projeto sem contexto interno de storage.",
      500,
      "PROJECT_CONFIG_STORAGE_CONTEXT_INVALID",
    );
  }
}

function assertStorageRefMatchesProject(storageRef, project, revision) {
  const parsed = parseProjectConfigStorageRef(storageRef);
  if (
    Number(parsed.projectId) !== Number(project.id) ||
    Number(parsed.revision) !== Number(revision)
  ) {
    throw repositoryError(
      "Referência de storage não corresponde ao projeto/revisão.",
      409,
      "PROJECT_CONFIG_STORAGE_REF_MISMATCH",
    );
  }
}

export async function prepareProjectConfigStorage(env, project) {
  assertProjectStorageContext(project);
  await ensureDropboxFolder(env, project.dropbox_root_path);
  return {
    provider: getProjectConfigStorageProvider(env),
  };
}

export async function putProjectConfigRevision(
  env,
  {
    project,
    revision,
    storageRef = createProjectConfigStorageRef(project?.id, revision),
    bytes,
    contentType = "application/json; charset=utf-8",
  },
) {
  assertProjectStorageContext(project);
  const normalizedRevision = positiveInteger(revision, "PROJECT_CONFIG_REVISION_INVALID");
  assertStorageRefMatchesProject(storageRef, project, normalizedRevision);

  const fileName = getProjectConfigRevisionFileName(
    project.default_config_file || "config.kepler.json",
    normalizedRevision,
  );
  const metadata = await uploadDropboxBinaryFile(
    env,
    project.dropbox_root_path,
    fileName,
    bytes,
    contentType,
  );

  return {
    provider: getProjectConfigStorageProvider(env),
    storageRef,
    providerVersion: metadata?.rev ?? null,
    providerHash: metadata?.content_hash ?? null,
    providerObjectId: metadata?.id ?? null,
    sizeBytes: Number(metadata?.size ?? bytes?.byteLength ?? 0),
  };
}

export async function statProjectConfigRevision(
  env,
  { project, revision, storageRef },
) {
  assertProjectStorageContext(project);
  const normalizedRevision = positiveInteger(revision, "PROJECT_CONFIG_REVISION_INVALID");
  assertStorageRefMatchesProject(storageRef, project, normalizedRevision);
  const fileName = getProjectConfigRevisionFileName(
    project.default_config_file || "config.kepler.json",
    normalizedRevision,
  );
  const metadata = await getDropboxMetadata(
    env,
    project.dropbox_root_path,
    fileName,
  );

  return {
    provider: getProjectConfigStorageProvider(env),
    storageRef,
    providerVersion: metadata?.rev ?? null,
    providerHash: metadata?.content_hash ?? null,
    providerObjectId: metadata?.id ?? null,
    sizeBytes: Number(metadata?.size ?? 0),
  };
}

export async function readProjectConfigRevision(
  env,
  { project, revision, storageRef },
) {
  assertProjectStorageContext(project);
  const normalizedRevision = positiveInteger(revision, "PROJECT_CONFIG_REVISION_INVALID");
  assertStorageRefMatchesProject(storageRef, project, normalizedRevision);
  const fileName = getProjectConfigRevisionFileName(
    project.default_config_file || "config.kepler.json",
    normalizedRevision,
  );
  const response = await downloadDropboxBinaryFile(
    env,
    project.dropbox_root_path,
    fileName,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());

  return {
    bytes,
    contentType: response.headers.get("content-type") || "application/json; charset=utf-8",
  };
}
