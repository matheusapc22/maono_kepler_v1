export const RUNTIME_ENVIRONMENTS = Object.freeze({
  PRODUCTION: "production",
  PREVIEW: "preview",
  LOCAL: "local",
  UNKNOWN: "unknown",
});

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

export function resolveRuntimeEnvironment(env = {}) {
  const value = String(env?.MAONO_RUNTIME_ENV || "")
    .trim()
    .toLowerCase();

  if (value === RUNTIME_ENVIRONMENTS.PRODUCTION) {
    return RUNTIME_ENVIRONMENTS.PRODUCTION;
  }
  if (value === RUNTIME_ENVIRONMENTS.PREVIEW) {
    return RUNTIME_ENVIRONMENTS.PREVIEW;
  }
  if (value === RUNTIME_ENVIRONMENTS.LOCAL) {
    return RUNTIME_ENVIRONMENTS.LOCAL;
  }
  return RUNTIME_ENVIRONMENTS.UNKNOWN;
}

export function isPreviewRuntime(env = {}) {
  return resolveRuntimeEnvironment(env) === RUNTIME_ENVIRONMENTS.PREVIEW;
}

export function arePreviewMutationsEnabled(env = {}) {
  return normalizeBoolean(env?.MAONO_PREVIEW_MUTATIONS_ENABLED, false);
}

export function previewQaOrganizationId(env = {}) {
  const value = String(env?.MAONO_PREVIEW_QA_ORG_ID || "").trim();
  return value || null;
}

export function publicRuntimeDiagnostics(env = {}) {
  const runtime = resolveRuntimeEnvironment(env);
  return {
    runtime,
    preview: runtime === RUNTIME_ENVIRONMENTS.PREVIEW,
    previewMutationsEnabled:
      runtime === RUNTIME_ENVIRONMENTS.PREVIEW
        ? arePreviewMutationsEnabled(env)
        : false,
    previewQaOrganizationConfigured: Boolean(previewQaOrganizationId(env)),
  };
}
