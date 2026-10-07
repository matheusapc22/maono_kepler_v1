export const MAP_CONFIG_REPOSITORY_METHODS = Object.freeze([
  "load",
  "loadLegacyStream",
  "uploadOperationPayload",
  "verifyOperationPayload",
  "recoverOperationPayload",
  "getRevision",
  "getMetadata",
]);

function repositoryContractError(message, details = null) {
  const error = new Error(message);
  error.status = 500;
  error.code = "MAP_CONFIG_REPOSITORY_INVALID";
  if (details) error.details = details;
  return error;
}

/**
 * Config readers preserve legacy/revision formats. The only writer accepts a
 * server-owned operation and immutable upload epoch; it never publishes D1.
 * uploadOperationPayload verifies exact bytes, complete JSON and provider
 * metadata. verify/recover are read-only and support the storage-to-D1 gap.
 */
export function assertMapConfigRepository(repository) {
  if (!repository || (typeof repository !== "object" && typeof repository !== "function")) {
    throw repositoryContractError("MapConfigRepository não informado.");
  }

  const missing = MAP_CONFIG_REPOSITORY_METHODS.filter(
    (method) => typeof repository[method] !== "function",
  );
  if (missing.length) {
    throw repositoryContractError(
      "MapConfigRepository não satisfaz o contrato obrigatório.",
      { missing },
    );
  }

  if (!String(repository.provider || "").trim()) {
    throw repositoryContractError(
      "MapConfigRepository deve informar o provider lógico.",
      { missing: ["provider"] },
    );
  }

  return repository;
}
