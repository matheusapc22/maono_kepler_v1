const STORAGE_REF_PATTERN = /^project-config:\/\/([1-9][0-9]*)\/revisions\/([1-9][0-9]*)$/;

function storageRefError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw storageRefError("Identificador de revisão inválido.", 400, code);
  }
  return number;
}

export function createMapConfigStorageRef(projectId, revision) {
  const normalizedProjectId = positiveInteger(
    projectId,
    "MAP_CONFIG_PROJECT_ID_INVALID",
  );
  const normalizedRevision = positiveInteger(
    revision,
    "MAP_CONFIG_REVISION_INVALID",
  );
  return `project-config://${normalizedProjectId}/revisions/${normalizedRevision}`;
}

export function parseMapConfigStorageRef(storageRef) {
  const value = String(storageRef || "").trim();
  const match = value.match(STORAGE_REF_PATTERN);
  if (!match) {
    throw storageRefError(
      "Referência interna da configuração inválida.",
      500,
      "MAP_CONFIG_STORAGE_REF_INVALID",
    );
  }
  return { projectId: Number(match[1]), revision: Number(match[2]) };
}

export function assertMapConfigStorageRef(storageRef, projectId, revision) {
  const parsed = parseMapConfigStorageRef(storageRef);
  const expectedProjectId = positiveInteger(
    projectId,
    "MAP_CONFIG_PROJECT_ID_INVALID",
  );
  const expectedRevision = positiveInteger(
    revision,
    "MAP_CONFIG_REVISION_INVALID",
  );
  if (
    parsed.projectId !== expectedProjectId ||
    parsed.revision !== expectedRevision
  ) {
    throw storageRefError(
      "Referência de storage não corresponde ao projeto/revisão.",
      409,
      "MAP_CONFIG_STORAGE_REF_MISMATCH",
    );
  }
  return parsed;
}

export function getMapConfigRevisionFileName(
  defaultConfigFile = "config.kepler.json",
  revision,
) {
  const normalizedRevision = positiveInteger(
    revision,
    "MAP_CONFIG_REVISION_INVALID",
  );
  const suffix = String(normalizedRevision).padStart(6, "0");
  const name = String(defaultConfigFile || "config.kepler.json").trim();
  if (/\.json$/i.test(name)) {
    return name.replace(/\.json$/i, `.r${suffix}.json`);
  }
  return `${name}.r${suffix}.json`;
}
