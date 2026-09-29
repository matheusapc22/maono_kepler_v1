import * as cc04 from "./suites/cc04-selective-access.mjs";
import { fail, validateManifest } from "./production-acceptance-lib.mjs";

const suites = new Map([
  [cc04.manifest.id, cc04],
]);

export function listSuites() {
  return [...suites.values()].map((suite) => validateManifest(suite.manifest));
}

export function getSuite(id) {
  const suite = suites.get(String(id || ""));
  if (!suite) fail("SUITE_NOT_REGISTERED", "A suite solicitada não está registrada no operador.");
  validateManifest(suite.manifest);
  if (typeof suite.run !== "function") fail("SUITE_NOT_RUNNABLE", "A suite registrada não possui executor.");
  return suite;
}

export function publicManifest(id) {
  const manifest = getSuite(id).manifest;
  return {
    id: manifest.id,
    version: manifest.version,
    description: manifest.description,
    mutationMode: manifest.mutationMode,
    requiresBrowser: manifest.requiresBrowser === true,
    requiredProfiles: [...manifest.requiredProfiles],
    requiredPermissions: manifest.requiredPermissions || {},
    managedFlags: manifest.managedFlags,
    cases: [...manifest.cases],
  };
}
