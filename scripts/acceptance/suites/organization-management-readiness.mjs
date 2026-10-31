import {
  fail, ORGANIZATION_READINESS_SUITE, ORGANIZATION_OBSERVED_FLAGS, PRODUCTION_APP_ORIGIN,
} from "../production-acceptance-lib.mjs";

export const manifest = Object.freeze({
  id: ORGANIZATION_READINESS_SUITE,
  version: 1,
  description: "Organization Management control-plane readiness only; no functional acceptance or flag activation",
  mutationMode: "read_only",
  preflightOnly: true,
  requiresBrowser: false,
  requiredProfiles: [],
  managedFlags: {},
  observedFlags: ORGANIZATION_OBSERVED_FLAGS,
  prerequisites: [
    "0042 structure/ledger/integrity must be verified separately through the protected D1 postvalidate operator",
    "The organization input is a reserved synthetic scope, not proof of QA ownership or identity readiness",
    "A future functional suite and explicit window approval remain required",
  ],
  cleanup: { policy: "no-mutations", resources: "None; no login, application request, flag change or deployment retry" },
  cases: ["ORG-CONTROL-PLANE-READINESS"],
});

export function verifyPreflight(project) {
  if (project.baseUrl !== PRODUCTION_APP_ORIGIN) {
    fail("ORGANIZATION_READINESS_ORIGIN_MISMATCH", "Origem canônica de Organizações divergente.");
  }
  for (const name of ORGANIZATION_OBSERVED_FLAGS) {
    const configured = project.configuredFlags[name], deployed = project.canonical.flags[name];
    if (configured?.state !== "observed" || deployed?.state !== "observed" ||
        typeof configured.value !== "boolean" || typeof deployed.value !== "boolean") {
      fail("ORGANIZATION_READINESS_FLAG_UNOBSERVED", "Uma flag declarada de Organizações não possui valor boolean público confirmado.");
    }
    if (configured.value !== deployed.value) {
      fail("ORGANIZATION_READINESS_FLAG_DRIFT", "Configuração e deployment canônico divergem nas flags declaradas.");
    }
  }
  return {
    scope: "pages_control_plane_only",
    configuredAndCanonicalFlagsMatch: true,
    observedFlagNames: [...ORGANIZATION_OBSERVED_FLAGS],
    databaseSchemaVerified: false,
    applicationRuntimeVerified: false,
    compiledUiFlagVerified: false,
    qaIdentitiesVerified: false,
    functionalAcceptanceExecuted: false,
    rolloutAuthorized: false,
    pendingGates: ["D1_0042_STRUCTURE_REPORT", "RUNTIME_AND_COMPILED_UI_EVIDENCE",
      "REGISTERED_FUNCTIONAL_SUITE", "APPROVED_SYNTHETIC_SCOPE", "EXPLICIT_ACCEPTANCE_WINDOW"],
  };
}

// Registry keeps its runnable-contract check. This sentinel cannot execute a
// functional test even if another caller bypasses operator's preflight-only gate.
export async function run() {
  fail("SUITE_PREFLIGHT_ONLY", "Readiness não executa acceptance funcional.");
}
