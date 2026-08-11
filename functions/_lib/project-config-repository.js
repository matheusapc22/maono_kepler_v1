// Compatibilidade temporária da S03.
//
// Novos consumidores devem depender da porta `MapConfigRepository` e receber
// uma implementação via `map-config-repository-factory.js`. Este módulo não
// contém mais implementação de storage e não importa `dropbox.js`.
import { createMapConfigRepository } from "./map-config-repository-factory.js";
import { MAP_CONFIG_SAVE_MODES } from "./map-config-repository.js";
import {
  createMapConfigStorageRef,
  getMapConfigRevisionFileName,
  parseMapConfigStorageRef,
} from "./map-config-storage-ref.js";

export const createProjectConfigStorageRef = createMapConfigStorageRef;
export const parseProjectConfigStorageRef = parseMapConfigStorageRef;
export const getProjectConfigRevisionFileName = getMapConfigRevisionFileName;

export function getProjectConfigStorageProvider(env) {
  return createMapConfigRepository(env).provider;
}

export async function prepareProjectConfigStorage(env, project) {
  const repository = createMapConfigRepository(env);
  if (typeof repository.prepare === "function") {
    return repository.prepare({ project });
  }
  return { provider: repository.provider };
}

export async function putProjectConfigRevision(
  env,
  {
    project,
    revision,
    storageRef = createMapConfigStorageRef(project?.id, revision),
    bytes,
    contentType = "application/json; charset=utf-8",
  },
) {
  return createMapConfigRepository(env).saveRevision({
    project,
    revision,
    storageRef,
    bytes,
    contentType,
    mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
  });
}

export async function statProjectConfigRevision(
  env,
  { project, revision, storageRef },
) {
  return createMapConfigRepository(env).getMetadata({
    project,
    revision,
    storageRef,
    mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
  });
}

export async function readProjectConfigRevision(
  env,
  { project, revision, storageRef },
) {
  return createMapConfigRepository(env).getRevision({
    project,
    revision,
    storageRef,
  });
}
