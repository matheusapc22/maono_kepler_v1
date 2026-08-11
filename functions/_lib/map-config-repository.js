export const MAP_CONFIG_SAVE_MODES = Object.freeze({
  IMMUTABLE: "immutable",
  LEGACY_OVERWRITE: "legacy-overwrite",
});

export const MAP_CONFIG_REPOSITORY_METHODS = Object.freeze([
  "load",
  "saveRevision",
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
 * Porta de persistência de MapConfig.
 *
 * Implementações devem expor:
 * - provider: identificador lógico do provider em uso;
 * - load(input): carrega a configuração lógica/publicada;
 * - saveRevision(input): persiste bytes de uma revisão;
 * - getRevision(input): carrega uma revisão exata;
 * - getMetadata(input): consulta metadata sem carregar o conteúdo completo.
 *
 * Contrato S05 para mode=immutable:
 * - (projectId, revision) identifica um conteúdo imutável;
 * - repetir os mesmos bytes é idempotente;
 * - conteúdo diferente para a mesma revisão deve falhar com
 *   MAP_CONFIG_REVISION_IMMUTABILITY_VIOLATION;
 * - persistir a revisão não a torna publicada: o HEAD é autoridade do D1.
 *
 * saveRevision() pode retornar `contentVerified: true` quando o provider
 * consegue atestar que o objeto remoto corresponde ao conteúdo enviado.
 * `verificationMethod` identifica o método da atestação. Quando essa garantia
 * não existir, a Application deve executar getRevision() e verificar os bytes.
 * A atestação do provider não substitui o contentHash SHA-256 lógico da Maõno.
 *
 * A camada de Application não deve conhecer APIs ou erros específicos do provider.
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
