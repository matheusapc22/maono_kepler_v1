export const PROJECT_CONFIG_CHECKSUM_ALGORITHM = "sha256";
export const PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER = "legacy-kepler";
export const PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER_VERSION = 1;
export const PROJECT_CONFIG_CONTENT_TYPE = "application/json; charset=utf-8";

const MAONO_ANALYSIS_DATA_ID_PATTERN = /^maono_analysis_(?:buffer|isochrone)_/;

function integrityError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function datasetIdOf(dataset) {
  if (!isRecord(dataset)) return "";
  const candidates = [dataset?.info?.id, dataset?.data?.id, dataset?.id];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

function layerDataIds(layer) {
  if (!isRecord(layer)) return [];
  const dataId = layer?.config?.dataId ?? layer?.dataId;
  if (Array.isArray(dataId)) {
    return dataId.map((value) => String(value || "").trim()).filter(Boolean);
  }
  const value = String(dataId || "").trim();
  return value ? [value] : [];
}

export function findMissingMaonoAnalysisDatasetIds(config) {
  if (!isRecord(config)) return [];

  const available = new Set(
    (Array.isArray(config.datasets) ? config.datasets : [])
      .map(datasetIdOf)
      .filter(Boolean),
  );
  const layers = Array.isArray(config?.config?.visState?.layers)
    ? config.config.visState.layers
    : [];
  const missing = new Set();

  for (const layer of layers) {
    for (const dataId of layerDataIds(layer)) {
      if (
        MAONO_ANALYSIS_DATA_ID_PATTERN.test(dataId) &&
        !available.has(dataId)
      ) {
        missing.add(dataId);
      }
    }
  }

  return Array.from(missing);
}

export function assertMaonoAnalysisDatasetIntegrity(config) {
  const missing = findMissingMaonoAnalysisDatasetIds(config);
  if (!missing.length) return true;

  throw integrityError(
    "A configuração contém uma camada de análise Maõno sem o dataset correspondente.",
    400,
    "PROJECT_CONFIG_ANALYSIS_DATASET_MISSING",
    {
      missingDatasetIds: missing.slice(0, 4),
      missingDatasetCount: missing.length,
    },
  );
}

export function serializeProjectConfigBytes(config) {
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

  const bytes = new TextEncoder().encode(text);
  return { text, bytes };
}

export function validateProjectConfig(
  config,
  {
    bytes = null,
    schemaName = PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER,
    schemaVersion = PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER_VERSION,
  } = {},
) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw integrityError(
      "Envie uma configuração Kepler em formato JSON.",
      400,
      "INVALID_KEPLER_CONFIG",
      { field: "root" },
    );
  }
  if (!config.version) {
    throw integrityError(
      "O JSON não possui campo version.",
      400,
      "INVALID_KEPLER_CONFIG",
      { field: "version" },
    );
  }
  if (!config.config || typeof config.config !== "object" || Array.isArray(config.config)) {
    throw integrityError(
      "O JSON não possui o objeto config.",
      400,
      "INVALID_KEPLER_CONFIG",
      { field: "config" },
    );
  }
  if (!Array.isArray(config.datasets)) {
    throw integrityError(
      "O JSON não possui datasets em formato de lista.",
      400,
      "INVALID_KEPLER_CONFIG",
      { field: "datasets" },
    );
  }
  assertMaonoAnalysisDatasetIntegrity(config);
  if (String(schemaName || "") !== PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER) {
    throw integrityError(
      "Schema de configuração não suportado.",
      400,
      "PROJECT_CONFIG_SCHEMA_UNSUPPORTED",
      { schemaName },
    );
  }
  if (Number(schemaVersion) !== PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER_VERSION) {
    throw integrityError(
      "Versão de schema de configuração não suportada.",
      400,
      "PROJECT_CONFIG_SCHEMA_VERSION_UNSUPPORTED",
      { schemaName, schemaVersion },
    );
  }
  if (bytes && Number(bytes.byteLength || 0) <= 0) {
    throw integrityError(
      "A configuração serializada está vazia.",
      400,
      "PROJECT_CONFIG_EMPTY",
    );
  }
  return true;
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
  {
    schemaName = PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER,
    schemaVersion = PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER_VERSION,
    contentType = PROJECT_CONFIG_CONTENT_TYPE,
  } = {},
) {
  const { text, bytes } = serializeProjectConfigBytes(config);
  validateProjectConfig(config, { bytes, schemaName, schemaVersion });
  const artifact = await buildProjectConfigArtifactFromBytes(bytes, {
    schemaName,
    schemaVersion,
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
