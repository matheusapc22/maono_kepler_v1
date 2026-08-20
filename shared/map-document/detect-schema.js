import {
  MAP_DOCUMENT_KIND,
  MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER,
  MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER_VERSION,
  MAP_DOCUMENT_SCHEMA_MAONO,
  MAP_DOCUMENT_SCHEMA_MAONO_VERSION,
} from "./constants.js";

export function isPlainMapDocumentObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function looksLikeLegacyKepler(document) {
  return (
    isPlainMapDocumentObject(document) &&
    document.version !== undefined &&
    Array.isArray(document.datasets) &&
    isPlainMapDocumentObject(document.config)
  );
}

export function detectSchema(document) {
  if (!isPlainMapDocumentObject(document)) {
    return {
      kind: MAP_DOCUMENT_KIND.INVALID,
      schemaName: null,
      schemaVersion: null,
      supported: false,
      reasonCode: "MAP_DOCUMENT_INVALID_ROOT",
    };
  }

  if (document.schema === MAP_DOCUMENT_SCHEMA_MAONO) {
    const version = document.version;
    if (version === MAP_DOCUMENT_SCHEMA_MAONO_VERSION) {
      return {
        kind: MAP_DOCUMENT_KIND.MAONO_MAP_V1,
        schemaName: MAP_DOCUMENT_SCHEMA_MAONO,
        schemaVersion: MAP_DOCUMENT_SCHEMA_MAONO_VERSION,
        supported: true,
        reasonCode: null,
      };
    }
    if (Number.isInteger(version) && version > MAP_DOCUMENT_SCHEMA_MAONO_VERSION) {
      return {
        kind: MAP_DOCUMENT_KIND.FUTURE,
        schemaName: MAP_DOCUMENT_SCHEMA_MAONO,
        schemaVersion: version,
        supported: false,
        reasonCode: "MAP_DOCUMENT_FUTURE_VERSION",
      };
    }
    return {
      kind: MAP_DOCUMENT_KIND.INVALID,
      schemaName: MAP_DOCUMENT_SCHEMA_MAONO,
      schemaVersion: Number.isInteger(version) ? version : null,
      supported: false,
      reasonCode: "MAP_DOCUMENT_VERSION_INVALID",
    };
  }

  if (typeof document.schema === "string" && document.schema.trim()) {
    return {
      kind: MAP_DOCUMENT_KIND.FUTURE,
      schemaName: document.schema.trim(),
      schemaVersion: Number.isInteger(document.version)
        ? document.version
        : null,
      supported: false,
      reasonCode: "MAP_DOCUMENT_SCHEMA_UNKNOWN",
    };
  }

  if (looksLikeLegacyKepler(document)) {
    return {
      kind: MAP_DOCUMENT_KIND.LEGACY_KEPLER_V1,
      schemaName: MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER,
      schemaVersion: MAP_DOCUMENT_SCHEMA_LEGACY_KEPLER_VERSION,
      supported: true,
      reasonCode: null,
    };
  }

  return {
    kind: MAP_DOCUMENT_KIND.INVALID,
    schemaName: null,
    schemaVersion: null,
    supported: false,
    reasonCode: "MAP_DOCUMENT_SCHEMA_UNDETECTABLE",
  };
}
