import {
  MAP_DOCUMENT_ENGINE_KEPLER,
  MAP_DOCUMENT_KIND,
  MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER,
  MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER_VERSION,
  MAP_DOCUMENT_SCHEMA_MAONO,
  MAP_DOCUMENT_SCHEMA_MAONO_VERSION,
} from "./constants.js";
import { detectSchema, isPlainMapDocumentObject } from "./detect-schema.js";

export class MapDocumentValidationError extends Error {
  constructor(message, code, path = "$", details = null) {
    super(message);
    this.name = "MapDocumentValidationError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

function fail(message, code, path = "$", details = null) {
  throw new MapDocumentValidationError(message, code, path, details);
}

function requireRecord(value, path, code) {
  if (!isPlainMapDocumentObject(value)) {
    fail("Objeto obrigatório ausente ou inválido.", code, path);
  }
}

function requireArray(value, path, code) {
  if (!Array.isArray(value)) {
    fail("Lista obrigatória ausente ou inválida.", code, path);
  }
}

function requireNonEmptyString(value, path, code) {
  if (typeof value !== "string" || !value.trim()) {
    fail("Texto obrigatório ausente ou inválido.", code, path);
  }
}

function validateReferenceArray(entries, path, prefix) {
  requireArray(entries, path, `${prefix}_LIST_REQUIRED`);
  entries.forEach((entry, index) => {
    requireRecord(entry, `${path}[${index}]`, `${prefix}_ENTRY_INVALID`);
    requireNonEmptyString(
      entry.id,
      `${path}[${index}].id`,
      `${prefix}_ID_REQUIRED`,
    );
  });
}

export function validateLegacyKeplerV1(document) {
  requireRecord(document, "$", "MAP_DOCUMENT_INVALID_ROOT");
  if (document.version === undefined || document.version === null || document.version === "") {
    fail(
      "Documento Kepler legado sem version.",
      "LEGACY_KEPLER_VERSION_REQUIRED",
      "$.version",
    );
  }
  requireArray(
    document.datasets,
    "$.datasets",
    "LEGACY_KEPLER_DATASETS_REQUIRED",
  );
  requireRecord(document.config, "$.config", "LEGACY_KEPLER_CONFIG_REQUIRED");
  return {
    kind: MAP_DOCUMENT_KIND.LEGACY_KEPLER_V1,
    schemaName: MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER,
    schemaVersion: MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER_VERSION,
  };
}

export function validateMaonoMapV1(document) {
  requireRecord(document, "$", "MAP_DOCUMENT_INVALID_ROOT");
  if (document.schema !== MAP_DOCUMENT_SCHEMA_MAONO) {
    fail(
      "Schema Maõno inválido.",
      "MAONO_MAP_SCHEMA_REQUIRED",
      "$.schema",
    );
  }
  if (document.version !== MAP_DOCUMENT_SCHEMA_MAONO_VERSION) {
    fail(
      "Versão maono-map não suportada.",
      Number.isInteger(document.version) && document.version > MAP_DOCUMENT_SCHEMA_MAONO_VERSION
        ? "MAP_DOCUMENT_FUTURE_VERSION"
        : "MAONO_MAP_VERSION_UNSUPPORTED",
      "$.version",
      { version: document.version },
    );
  }

  requireRecord(document.map, "$.map", "MAONO_MAP_MAP_REQUIRED");
  validateReferenceArray(document.datasets, "$.datasets", "MAONO_MAP_DATASET");
  validateReferenceArray(document.layers, "$.layers", "MAONO_MAP_LAYER");
  validateReferenceArray(document.filters, "$.filters", "MAONO_MAP_FILTER");
  requireArray(document.analyses, "$.analyses", "MAONO_MAP_ANALYSES_REQUIRED");

  requireRecord(document.engine, "$.engine", "MAONO_MAP_ENGINE_REQUIRED");
  if (document.engine.type !== MAP_DOCUMENT_ENGINE_KEPLER) {
    fail(
      "Engine do documento maono-map não suportado nesta versão.",
      "MAONO_MAP_ENGINE_UNSUPPORTED",
      "$.engine.type",
      { engineType: document.engine.type ?? null },
    );
  }
  requireRecord(
    document.engine.payload,
    "$.engine.payload",
    "MAONO_MAP_ENGINE_PAYLOAD_REQUIRED",
  );
  validateLegacyKeplerV1(document.engine.payload);

  if (document.extensions !== undefined) {
    requireRecord(
      document.extensions,
      "$.extensions",
      "MAONO_MAP_EXTENSIONS_INVALID",
    );
  }

  return {
    kind: MAP_DOCUMENT_KIND.MAONO_MAP_V1,
    schemaName: MAP_DOCUMENT_SCHEMA_MAONO,
    schemaVersion: MAP_DOCUMENT_SCHEMA_MAONO_VERSION,
  };
}

export function validateDocument(
  document,
  { expectedSchemaName = null, expectedSchemaVersion = null } = {},
) {
  const detection = detectSchema(document);

  if (detection.kind === MAP_DOCUMENT_KIND.FUTURE) {
    fail(
      "Schema ou versão de documento ainda não suportado.",
      detection.reasonCode || "MAP_DOCUMENT_FUTURE_UNSUPPORTED",
      detection.reasonCode === "MAP_DOCUMENT_FUTURE_VERSION" ? "$.version" : "$.schema",
      {
        schemaName: detection.schemaName,
        schemaVersion: detection.schemaVersion,
      },
    );
  }

  if (detection.kind === MAP_DOCUMENT_KIND.INVALID) {
    fail(
      "Não foi possível reconhecer o schema do documento de mapa.",
      detection.reasonCode || "MAP_DOCUMENT_INVALID",
      detection.reasonCode === "MAP_DOCUMENT_VERSION_INVALID" ? "$.version" : "$",
      {
        schemaName: detection.schemaName,
        schemaVersion: detection.schemaVersion,
      },
    );
  }

  const validated = detection.kind === MAP_DOCUMENT_KIND.MAONO_MAP_V1
    ? validateMaonoMapV1(document)
    : validateLegacyKeplerV1(document);

  if (
    expectedSchemaName !== null &&
    String(expectedSchemaName) !== String(validated.schemaName)
  ) {
    fail(
      "O schema persistido não corresponde ao conteúdo da revisão.",
      "MAP_DOCUMENT_SCHEMA_METADATA_MISMATCH",
      "$.schema",
      {
        expectedSchemaName,
        actualSchemaName: validated.schemaName,
      },
    );
  }

  if (
    expectedSchemaVersion !== null &&
    Number(expectedSchemaVersion) !== Number(validated.schemaVersion)
  ) {
    fail(
      "A versão persistida não corresponde ao conteúdo da revisão.",
      "MAP_DOCUMENT_SCHEMA_METADATA_MISMATCH",
      "$.version",
      {
        expectedSchemaVersion: Number(expectedSchemaVersion),
        actualSchemaVersion: Number(validated.schemaVersion),
      },
    );
  }

  return validated;
}
