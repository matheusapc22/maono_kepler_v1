import {
  MAP_DOCUMENT_KIND,
  MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER,
  MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER_VERSION,
  MAP_DOCUMENT_SCHEMA_MAONO,
  MAP_DOCUMENT_SCHEMA_MAONO_VERSION,
  MapDocumentValidationError,
  canonicalSerializeBytes,
  detectSchema,
  validateDocument,
} from "../../shared/map-document/index.js";

export const PROJECT_CONFIG_CHECKSUM_ALGORITHM = "sha256";
export const PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER = MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER;
export const PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER_VERSION = MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER_VERSION;
export const PROJECT_CONFIG_SCHEMA_MAONO_MAP = MAP_DOCUMENT_SCHEMA_MAONO;
export const PROJECT_CONFIG_SCHEMA_MAONO_MAP_VERSION = MAP_DOCUMENT_SCHEMA_MAONO_VERSION;
export const PROJECT_CONFIG_CONTENT_TYPE = "application/json; charset=utf-8";

function integrityError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function coreValidationToIntegrityError(error) {
  if (!(error instanceof MapDocumentValidationError)) return error;

  const validationCode = error.code || "MAP_DOCUMENT_INVALID";
  const path = error.path || "$";
  const details = {
    validationCode,
    path,
    field: path.startsWith("$.") ? path.slice(2) : path,
    ...(error.details && typeof error.details === "object" ? error.details : {}),
  };

  if (
    validationCode === "MAP_DOCUMENT_FUTURE_VERSION" ||
    validationCode === "MAONO_MAP_VERSION_UNSUPPORTED"
  ) {
    return integrityError(
      "Versão de schema de configuração não suportada.",
      400,
      "PROJECT_CONFIG_SCHEMA_VERSION_UNSUPPORTED",
      details,
    );
  }

  if (validationCode === "MAP_DOCUMENT_SCHEMA_UNKNOWN") {
    return integrityError(
      "Schema de configuração não suportado.",
      400,
      "PROJECT_CONFIG_SCHEMA_UNSUPPORTED",
      details,
    );
  }

  if (validationCode === "MAP_DOCUMENT_SCHEMA_METADATA_MISMATCH") {
    return integrityError(
      "O schema registrado não corresponde ao conteúdo da revisão.",
      409,
      "PROJECT_CONFIG_SCHEMA_METADATA_MISMATCH",
      details,
    );
  }

  const detectionFamily = String(validationCode).startsWith("LEGACY_KEPLER_") ||
    validationCode === "MAP_DOCUMENT_INVALID_ROOT" ||
    validationCode === "MAP_DOCUMENT_SCHEMA_UNDETECTABLE";

  return integrityError(
    detectionFamily
      ? "Envie uma configuração Kepler em formato JSON."
      : "Documento maono-map inválido.",
    400,
    detectionFamily ? "INVALID_KEPLER_CONFIG" : "INVALID_MAONO_MAP_CONFIG",
    details,
  );
}

export function resolveProjectConfigSchema(config) {
  try {
    return validateDocument(config);
  } catch (error) {
    throw coreValidationToIntegrityError(error);
  }
}

export function serializeProjectConfigBytes(config) {
  const detection = detectSchema(config);

  if (detection.kind === MAP_DOCUMENT_KIND.MAONO_MAP_V1) {
    try {
      validateDocument(config);
      return canonicalSerializeBytes(config);
    } catch (error) {
      throw coreValidationToIntegrityError(error);
    }
  }

  let text;
  try {
    text = JSON.stringify(config, null, 2);
  } catch (error) {
    throw integrityError(
      "Não foi possível serializar a configuração do projeto.",
      400,
      "PROJECT_CONFIG_SERIALIZATION_FAILED",
      { cause: error?.name || "SERIALIZATION_ERROR" },
    );
  }

  if (typeof text !== "string" || !text.length) {
    throw integrityError(
      "A configuração serializada está vazia.",
      400,
      "PROJECT_CONFIG_EMPTY",
    );
  }

  return { text, bytes: new TextEncoder().encode(text) };
}

export function validateProjectConfig(
  config,
  { bytes = null, schemaName = null, schemaVersion = null } = {},
) {
  let schema;
  try {
    schema = validateDocument(config, {
      expectedSchemaName: schemaName,
      expectedSchemaVersion: schemaVersion,
    });
  } catch (error) {
    throw coreValidationToIntegrityError(error);
  }

  if (bytes && Number(bytes.byteLength || 0) <= 0) {
    throw integrityError(
      "A configuração serializada está vazia.",
      400,
      "PROJECT_CONFIG_EMPTY",
    );
  }

  return schema;
}

export async function sha256Hex(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildProjectConfigArtifactFromBytes(
  input,
  {
    schemaName = PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER,
    schemaVersion = PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER_VERSION,
    contentType = PROJECT_CONFIG_CONTENT_TYPE,
  } = {},
) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength <= 0) {
    throw integrityError(
      "A configuração armazenada está vazia.",
      409,
      "PROJECT_CONFIG_EMPTY",
    );
  }

  const checksum = await sha256Hex(bytes);

  return {
    bytes,
    sizeBytes: bytes.byteLength,
    checksum,
    contentHash: checksum,
    checksumAlgorithm: PROJECT_CONFIG_CHECKSUM_ALGORITHM,
    schemaName,
    schemaVersion,
    contentType,
  };
}

export async function buildProjectConfigArtifact(
  config,
  { schemaName = null, schemaVersion = null, contentType = PROJECT_CONFIG_CONTENT_TYPE } = {},
) {
  const schema = validateProjectConfig(config, { schemaName, schemaVersion });
  const { text, bytes } = serializeProjectConfigBytes(config);
  const artifact = await buildProjectConfigArtifactFromBytes(bytes, {
    schemaName: schemaName ?? schema.schemaName,
    schemaVersion: schemaVersion ?? schema.schemaVersion,
    contentType,
  });
  return { text, ...artifact };
}

export async function verifyProjectConfigBytes(
  bytes,
  {
    expectedChecksum,
    expectedAlgorithm = PROJECT_CONFIG_CHECKSUM_ALGORITHM,
    expectedSizeBytes = null,
  },
) {
  const algorithm = String(expectedAlgorithm || "").trim().toLowerCase();

  if (algorithm !== PROJECT_CONFIG_CHECKSUM_ALGORITHM) {
    throw integrityError(
      "Algoritmo de integridade de configuração não suportado.",
      500,
      "PROJECT_CONFIG_CHECKSUM_ALGORITHM_UNSUPPORTED",
      { algorithm },
    );
  }

  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (
    expectedSizeBytes !== null &&
    Number(expectedSizeBytes) !== source.byteLength
  ) {
    throw integrityError(
      "O tamanho da revisão persistida não corresponde ao conteúdo preparado.",
      409,
      "PROJECT_CONFIG_SIZE_MISMATCH",
      {
        expectedSizeBytes: Number(expectedSizeBytes),
        actualSizeBytes: source.byteLength,
      },
    );
  }

  const expected = String(expectedChecksum || "").trim().toLowerCase();
  const actual = await sha256Hex(source);

  if (!expected || actual !== expected) {
    throw integrityError(
      "A configuração armazenada não corresponde à revisão publicada.",
      409,
      "PROJECT_CONFIG_INTEGRITY_MISMATCH",
      {
        algorithm,
        expectedPresent: Boolean(expected),
        actualPresent: Boolean(actual),
      },
    );
  }

  return {
    checksum: actual,
    contentHash: actual,
    checksumAlgorithm: algorithm,
    sizeBytes: source.byteLength,
  };
}
