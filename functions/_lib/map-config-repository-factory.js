import { DropboxMapConfigRepository } from "./dropbox-map-config-repository.js";
import { assertMapConfigRepository } from "./map-config-repository.js";

export function createMapConfigRepository(env) {
  return assertMapConfigRepository(new DropboxMapConfigRepository(env));
}

export function resolveMapConfigRepository(env, repository = null) {
  return repository
    ? assertMapConfigRepository(repository)
    : createMapConfigRepository(env);
}
