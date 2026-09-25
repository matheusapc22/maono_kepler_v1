function booleanValue(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function organizationFileRolloutConfig(env) {
  return {
    permanentPurgeEnabled: booleanValue(
      env?.MAONO_DOCUMENT_PURGE_MANUAL_ENABLED,
      false,
    ),
  };
}

export function publicOrganizationFileCapabilities(env) {
  const config = organizationFileRolloutConfig(env);
  return {
    permanentPurgeEnabled: config.permanentPurgeEnabled,
  };
}

export function requirePermanentDocumentPurgeEnabled(env) {
  const config = organizationFileRolloutConfig(env);
  if (config.permanentPurgeEnabled) return config;

  const error = new Error("Recurso não disponível.");
  error.status = 404;
  error.code = "DOCUMENT_PURGE_FEATURE_DISABLED";
  error.stage = "document.purge.rollout";
  error.publicMessage = error.message;
  throw error;
}

export const __organizationFileRolloutTesting = Object.freeze({
  booleanValue,
});
