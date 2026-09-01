import { ERROR_CATEGORIES } from "./error-categories.js";

const E = ERROR_CATEGORIES;

export const ERROR_DEFINITIONS = Object.freeze({
  AUTH_SESSION_REQUIRED: { category: E.AUTH, status: 401, retryable: false },
  AUTH_SESSION_EXPIRED: { category: E.AUTH, status: 401, retryable: false },
  AUTH_INVALID_CREDENTIALS: { category: E.AUTH, status: 401, retryable: false },
  INVALID_SESSION_USER: { category: E.AUTH, status: 400, retryable: false },

  FORBIDDEN: { category: E.PERMISSION, status: 403, retryable: false },
  PERMISSION_DENIED: { category: E.PERMISSION, status: 403, retryable: false },
  PERMISSION_PROJECT_SAVE_DENIED: { category: E.PERMISSION, status: 403, retryable: false },

  PROJECT_NOT_FOUND: { category: E.PROJECT, status: 404, retryable: false },
  PROJECT_SLUG_REQUIRED: { category: E.PROJECT, status: 400, retryable: false },
  PROJECT_LIFECYCLE_NOT_ACTIVE: { category: E.PROJECT, status: 409, retryable: false },

  INVALID_KEPLER_CONFIG: { category: E.MAP_CONFIG, status: 400, retryable: false },
  MISSING_CONFIG: { category: E.MAP_CONFIG, status: 400, retryable: false },
  INVALID_PROJECT_CONFIG: { category: E.MAP_CONFIG, status: 500, retryable: false },
  PROJECT_CONFIG_EXPECTED_REVISION_REQUIRED: { category: E.MAP_CONFIG, status: 400, retryable: false },
  PROJECT_CONFIG_REVISION_CONFLICT: { category: E.MAP_CONFIG, status: 409, retryable: false },
  PROJECT_CONFIG_SIZE_MISMATCH: { category: E.MAP_CONFIG, status: 409, retryable: false },
  PROJECT_CONFIG_CHECKSUM_MISMATCH: { category: E.MAP_CONFIG, status: 409, retryable: false },
  PROJECT_CONFIG_COMMIT_NOT_CONFIRMED: { category: E.MAP_CONFIG, status: 503, retryable: true },
  MAP_CONFIG_REVISION_IMMUTABILITY_VIOLATION: { category: E.MAP_CONFIG, status: 409, retryable: false },
  MAP_CONFIG_BYTES_INVALID: { category: E.MAP_CONFIG, status: 400, retryable: false },
  MAP_CONFIG_SAVE_MODE_INVALID: { category: E.MAP_CONFIG, status: 400, retryable: false },
  MAP_CONFIG_NOT_FOUND: { category: E.MAP_CONFIG, status: 404, retryable: false },

  MAP_CONFIG_STORAGE_CONTEXT_INVALID: { category: E.STORAGE, status: 500, retryable: false },
  MAP_CONFIG_STORAGE_AUTH_FAILED: { category: E.STORAGE, status: 503, retryable: false },
  MAP_CONFIG_STORAGE_UNAVAILABLE: { category: E.STORAGE, status: 503, retryable: true },
  MAP_CONFIG_STORAGE_READ_FAILED: { category: E.STORAGE, status: 502, retryable: true },
  MAP_CONFIG_STORAGE_WRITE_FAILED: { category: E.STORAGE, status: 502, retryable: true },
  MAP_CONFIG_STORAGE_METADATA_FAILED: { category: E.STORAGE, status: 502, retryable: true },
  MAP_CONFIG_STORAGE_PREPARE_FAILED: { category: E.STORAGE, status: 502, retryable: true },
  MAP_CONFIG_STORAGE_INTEGRITY_MISMATCH: { category: E.STORAGE, status: 502, retryable: true },
  DROPBOX_FILE_NAME_REQUIRED: { category: E.STORAGE, status: 400, retryable: false },
  DROPBOX_FILE_NAME_INVALID: { category: E.STORAGE, status: 400, retryable: false },
  DROPBOX_WRITE_MODE_INVALID: { category: E.STORAGE, status: 400, retryable: false },
  DROPBOX_PATH_NOT_FOUND: { category: E.STORAGE, status: 404, retryable: false },
  DROPBOX_PATH_CONFLICT: { category: E.STORAGE, status: 409, retryable: false },
  DROPBOX_UPLOAD_FAILED: { category: E.STORAGE, status: 502, retryable: true },
  DROPBOX_DOWNLOAD_FAILED: { category: E.STORAGE, status: 502, retryable: true },
  DROPBOX_METADATA_FAILED: { category: E.STORAGE, status: 502, retryable: true },
  DROPBOX_TOKEN_REFRESH_FAILED: { category: E.STORAGE, status: 503, retryable: true },
  DROPBOX_TIMEOUT: { category: E.STORAGE, status: 504, retryable: true },
  DROPBOX_RATE_LIMITED: { category: E.STORAGE, status: 429, retryable: true },
  DROPBOX_UNAVAILABLE: { category: E.STORAGE, status: 503, retryable: true },
  DROPBOX_AUTH_FAILED: { category: E.STORAGE, status: 503, retryable: false },
  DROPBOX_UPLOAD_SESSION_FAILED: { category: E.STORAGE, status: 502, retryable: true },

  PERFORMANCE_PAYLOAD_TOO_LARGE: { category: E.PERFORMANCE, status: 413, retryable: false },
  PERFORMANCE_OPERATION_TIMEOUT: { category: E.PERFORMANCE, status: 504, retryable: true },
  PERFORMANCE_COMPLEXITY_LIMIT_EXCEEDED: { category: E.PERFORMANCE, status: 422, retryable: false },

  SPATIAL_INVALID_GEOMETRY: { category: E.SPATIAL, status: 422, retryable: false },
  SPATIAL_CRS_UNSUPPORTED: { category: E.SPATIAL, status: 422, retryable: false },
  SPATIAL_OPERATION_FAILED: { category: E.SPATIAL, status: 500, retryable: false },

  ENGINE_PROCESSING_FAILED: { category: E.ENGINE, status: 500, retryable: false },
  ENGINE_RESULT_INVALID: { category: E.ENGINE, status: 500, retryable: false },
  ENGINE_UNAVAILABLE: { category: E.ENGINE, status: 503, retryable: true },

  SAVE_CLIENT_CONTRACT_UNSUPPORTED: { category: E.INFRASTRUCTURE, status: 412, retryable: false },
  SAVE_DB_SCHEMA_MISMATCH: { category: E.INFRASTRUCTURE, status: 503, retryable: true },
  DATABASE_NOT_CONFIGURED: { category: E.INFRASTRUCTURE, status: 500, retryable: false },
  INFRASTRUCTURE_ENV_NOT_CONFIGURED: { category: E.INFRASTRUCTURE, status: 500, retryable: false },
  INFRASTRUCTURE_D1_NOT_CONFIGURED: { category: E.INFRASTRUCTURE, status: 500, retryable: false },
  INFRASTRUCTURE_D1_QUERY_FAILED: { category: E.INFRASTRUCTURE, status: 503, retryable: true },
  INFRASTRUCTURE_POSTGIS_UNAVAILABLE: { category: E.INFRASTRUCTURE, status: 503, retryable: true },
  INFRASTRUCTURE_POSTGIS_QUERY_FAILED: { category: E.INFRASTRUCTURE, status: 503, retryable: true },
  INFRASTRUCTURE_NETWORK_FAILURE: { category: E.INFRASTRUCTURE, status: 503, retryable: true },
  INFRASTRUCTURE_UNEXPECTED_ERROR: { category: E.INFRASTRUCTURE, status: 500, retryable: false },
  PROJECT_CONFIG_ERROR: { category: E.INFRASTRUCTURE, status: 500, retryable: false },
  PROJECT_SAVE_ERROR: { category: E.INFRASTRUCTURE, status: 500, retryable: false },
  METHOD_NOT_ALLOWED: { category: E.INFRASTRUCTURE, status: 405, retryable: false },
  BAD_REQUEST: { category: E.INFRASTRUCTURE, status: 400, retryable: false },
});

function inferCategory(code, status) {
  const normalized = String(code || "").toUpperCase();
  if (/^(AUTH_|SESSION_|INVALID_SESSION)/.test(normalized) || status === 401) return E.AUTH;
  if (/^(PERMISSION_|FORBIDDEN|ACCESS_)/.test(normalized) || status === 403) return E.PERMISSION;
  if (/^(MAP_CONFIG_|PROJECT_CONFIG_|INVALID_KEPLER|MISSING_CONFIG)/.test(normalized)) return E.MAP_CONFIG;
  if (/^(DROPBOX_|STORAGE_|LOCAL_STORAGE_)/.test(normalized)) return E.STORAGE;
  if (/^PERFORMANCE_/.test(normalized)) return E.PERFORMANCE;
  if (/^(SPATIAL_|GEOJSON_|ISOCHRONE_)/.test(normalized)) return E.SPATIAL;
  if (/^(ENGINE_|KEPLER_)/.test(normalized)) return E.ENGINE;
  if (/^PROJECT_/.test(normalized)) return E.PROJECT;
  return E.INFRASTRUCTURE;
}

function inferRetryable(status) {
  return [408, 425, 429, 502, 503, 504].includes(Number(status));
}

export function getErrorDefinition(code, fallbackStatus = 500) {
  const normalizedCode = String(code || "INFRASTRUCTURE_UNEXPECTED_ERROR").trim() || "INFRASTRUCTURE_UNEXPECTED_ERROR";
  const exact = ERROR_DEFINITIONS[normalizedCode];
  if (exact) return { code: normalizedCode, ...exact };
  const status = Number(fallbackStatus || 500);
  return {
    code: normalizedCode,
    category: inferCategory(normalizedCode, status),
    status,
    retryable: inferRetryable(status),
  };
}
