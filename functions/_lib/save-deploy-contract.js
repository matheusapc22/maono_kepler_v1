import { createMaonoError } from "./maono-error.js";

export const SAVE_CLIENT_CONTRACT_VERSION = 1;
export const SAVE_API_CONTRACT_VERSION = 1;
export const SAVE_EXPECTED_DB_SCHEMA_VERSION = 19;

const CLIENT_CONTRACT_HEADER = "X-Maono-Client-Contract";
const CLIENT_BUILD_HEADER = "X-Maono-Client-Build";

function cleanBuildId(value, fallback = "unknown") {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, 120) : fallback;
}

export function getSaveDeploymentMetadata(env = {}) {
  return {
    apiContract: SAVE_API_CONTRACT_VERSION,
    apiBuild: cleanBuildId(
      env.MAONO_API_BUILD_ID ||
        env.CF_PAGES_COMMIT_SHA ||
        env.CF_PAGES_DEPLOYMENT_ID,
    ),
    expectedDbSchema: SAVE_EXPECTED_DB_SCHEMA_VERSION,
  };
}

export function getSaveClientMetadata(request) {
  const rawContract = request?.headers?.get?.(CLIENT_CONTRACT_HEADER) || "";
  const parsedContract = rawContract ? Number(rawContract) : null;
  return {
    clientContract:
      Number.isInteger(parsedContract) && parsedContract > 0 ? parsedContract : null,
    clientBuild: cleanBuildId(
      request?.headers?.get?.(CLIENT_BUILD_HEADER),
      rawContract ? "unknown" : "legacy",
    ),
    legacy: !rawContract,
  };
}

export async function readDbSchemaVersion(env) {
  if (!env?.DB) {
    throw createMaonoError("INFRASTRUCTURE_D1_NOT_CONFIGURED", {
      message: "Banco D1 não configurado para validar o contrato de save.",
    });
  }

  try {
    const row = await env.DB.prepare(
      "SELECT schema_version FROM app_schema_metadata WHERE id = 1 LIMIT 1",
    ).first();
    const version = Number(row?.schema_version);
    return Number.isInteger(version) ? version : null;
  } catch (error) {
    throw createMaonoError("SAVE_DB_SCHEMA_MISMATCH", {
      message: "Não foi possível validar a versão do banco de dados.",
      status: 503,
      retryable: true,
      details: { expectedDbSchema: SAVE_EXPECTED_DB_SCHEMA_VERSION, actualDbSchema: null },
      cause: error,
    });
  }
}

export async function assertSaveDeployCompatibility(env, request, options = {}) {
  const client = getSaveClientMetadata(request);
  const deployment = getSaveDeploymentMetadata(env);

  // Rollout seguro: abas antigas sem o header continuam aceitas. Apenas clientes
  // versionados e explicitamente incompatíveis são bloqueados.
  if (
    !client.legacy &&
    client.clientContract !== SAVE_CLIENT_CONTRACT_VERSION
  ) {
    throw createMaonoError("SAVE_CLIENT_CONTRACT_UNSUPPORTED", {
      message: "A versão aberta da Maõno não é compatível com o serviço de salvamento.",
      status: 409,
      retryable: false,
      details: {
        clientContract: client.clientContract,
        apiContract: deployment.apiContract,
      },
    });
  }

  const actualDbSchema = await readDbSchemaVersion(env);
  if (actualDbSchema !== deployment.expectedDbSchema) {
    throw createMaonoError("SAVE_DB_SCHEMA_MISMATCH", {
      message: "A versão do banco de dados não é compatível com o serviço de salvamento.",
      status: 503,
      retryable: true,
      details: {
        expectedDbSchema: deployment.expectedDbSchema,
        actualDbSchema,
      },
    });
  }

  const metadata = {
    ...client,
    ...deployment,
    actualDbSchema,
  };

  if (typeof options.onCompatible === "function") options.onCompatible(metadata);
  return metadata;
}

export function saveDeployResponseHeaders(metadata = {}) {
  return {
    "X-Maono-Api-Contract": String(metadata.apiContract || SAVE_API_CONTRACT_VERSION),
    "X-Maono-Api-Build": cleanBuildId(metadata.apiBuild),
    "X-Maono-Db-Schema": String(
      metadata.actualDbSchema ??
        metadata.expectedDbSchema ??
        SAVE_EXPECTED_DB_SCHEMA_VERSION,
    ),
  };
}
