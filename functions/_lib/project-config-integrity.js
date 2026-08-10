export const PROJECT_CONFIG_CHECKSUM_ALGORITHM = "sha256";
export const PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER = "legacy-kepler";
export const PROJECT_CONFIG_SCHEMA_LEGACY_KEPLER_VERSION = 1;
export const PROJECT_CONFIG_CONTENT_TYPE = "application/json; charset=utf-8";

function integrityError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

export function serializeProjectConfigBytes(config) {
  const text = JSON.stringify(config, null, 2);
  const bytes = new TextEncoder().encode(text);
  return { text, bytes };
}

export async function sha256Hex(bytes) {
  const source = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
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
  const checksum = await sha256Hex(bytes);

  return {
    text,
    bytes,
    sizeBytes: bytes.byteLength,
    checksum,
    checksumAlgorithm: PROJECT_CONFIG_CHECKSUM_ALGORITHM,
    schemaName,
    schemaVersion,
    contentType,
  };
}

export async function verifyProjectConfigBytes(
  bytes,
  {
    expectedChecksum,
    expectedAlgorithm = PROJECT_CONFIG_CHECKSUM_ALGORITHM,
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

  const expected = String(expectedChecksum || "").trim().toLowerCase();
  const actual = await sha256Hex(bytes);

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

  return true;
}
