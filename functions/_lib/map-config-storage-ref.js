const STORAGE_REF_PATTERN = /^project-config:\/\/([1-9][0-9]*)\/revisions\/([1-9][0-9]*)$/;
const OPERATION_REF_PATTERN = /^project-config:\/\/organizations\/([1-9][0-9]*)\/projects\/([1-9][0-9]*)\/operations\/([a-zA-Z0-9_-]{1,128})\/uploads\/([1-9][0-9]*)$/;

function storageRefError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw storageRefError("Identificador de revisão inválido.", 400, code);
  }
  return number;
}

export function createMapConfigStorageRef(projectId, revision) {
  return `project-config://${positiveInteger(projectId, "MAP_CONFIG_PROJECT_ID_INVALID")}/revisions/${positiveInteger(revision, "MAP_CONFIG_REVISION_INVALID")}`;
}

export function createMapConfigOperationStorageRef({ organizationId, projectId, operationId, uploadEpoch }) {
  const organization = positiveInteger(organizationId, "MAP_CONFIG_ORGANIZATION_ID_INVALID");
  const project = positiveInteger(projectId, "MAP_CONFIG_PROJECT_ID_INVALID");
  const epoch = positiveInteger(uploadEpoch, "MAP_CONFIG_UPLOAD_EPOCH_INVALID");
  // This identifier is the server operation row identity, never a client path.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(String(operationId || ""))) {
    throw storageRefError("Identificador de operação inválido.", 400, "MAP_CONFIG_OPERATION_ID_INVALID");
  }
  return `project-config://organizations/${organization}/projects/${project}/operations/${operationId}/uploads/${epoch}`;
}

export function parseMapConfigStorageRef(storageRef) {
  const value = String(storageRef || "").trim();
  const legacy = value.match(STORAGE_REF_PATTERN);
  if (legacy) {
    return {
      projectId: positiveInteger(legacy[1], "MAP_CONFIG_STORAGE_REF_INVALID"),
      revision: positiveInteger(legacy[2], "MAP_CONFIG_STORAGE_REF_INVALID"),
    };
  }
  const operation = value.match(OPERATION_REF_PATTERN);
  if (operation) {
    return {
      kind: "operation",
      organizationId: positiveInteger(operation[1], "MAP_CONFIG_STORAGE_REF_INVALID"),
      projectId: positiveInteger(operation[2], "MAP_CONFIG_STORAGE_REF_INVALID"),
      operationId: operation[3],
      uploadEpoch: positiveInteger(operation[4], "MAP_CONFIG_STORAGE_REF_INVALID"),
    };
  }
  throw storageRefError("Referência interna da configuração inválida.", 500, "MAP_CONFIG_STORAGE_REF_INVALID");
}

export function assertMapConfigStorageRef(storageRef, projectId, revision, organizationId = null) {
  const parsed = parseMapConfigStorageRef(storageRef);
  const project = positiveInteger(projectId, "MAP_CONFIG_PROJECT_ID_INVALID");
  const expectedRevision = revision == null ? null : positiveInteger(revision, "MAP_CONFIG_REVISION_INVALID");
  if (parsed.projectId !== project ||
      (parsed.kind !== "operation" && parsed.revision !== expectedRevision) ||
      (parsed.kind === "operation" && organizationId != null && parsed.organizationId !== Number(organizationId))) {
    throw storageRefError("Referência de storage não corresponde ao projeto/revisão.", 409, "MAP_CONFIG_STORAGE_REF_MISMATCH");
  }
  return parsed;
}

export function getMapConfigRevisionFileName(defaultConfigFile = "config.kepler.json", revision) {
  const suffix = String(positiveInteger(revision, "MAP_CONFIG_REVISION_INVALID")).padStart(6, "0");
  const name = String(defaultConfigFile || "config.kepler.json").trim();
  return /\.json$/i.test(name) ? name.replace(/\.json$/i, `.r${suffix}.json`) : `${name}.r${suffix}.json`;
}

// Every reader resolves the explicit reference; new objects have no revision-derived name.
export function resolveMapConfigStorageFileName({ project, revision = null, storageRef }) {
  const parsed = assertMapConfigStorageRef(storageRef, project?.id, revision, project?.organization_id ?? project?.organizationId);
  if (parsed.kind === "operation") {
    if (Number(project?.organization_id ?? project?.organizationId) !== parsed.organizationId) {
      throw storageRefError("Referência de storage fora da organização.", 409, "MAP_CONFIG_STORAGE_REF_MISMATCH");
    }
    return `config.o${parsed.organizationId}.p${parsed.projectId}.op-${parsed.operationId}.u${parsed.uploadEpoch}.json`;
  }
  return getMapConfigRevisionFileName(project?.default_config_file, parsed.revision);
}
