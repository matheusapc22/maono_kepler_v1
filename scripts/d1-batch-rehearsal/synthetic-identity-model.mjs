// LOCAL comparison contract only. Inputs must come from a future trusted approval /
// read-only provider. Matching caller-supplied JSON does NOT authenticate a binding.
import {PRODUCTION_UUID} from './remote-protocol-model.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const fields=['accountId','databaseUuid','databaseName','workerName','deploymentId','gitSha','payloadSha256','fixtureSha256','registryNamespaceId','workerBundleSha256','registryClassName','registryObjectName'];
function valid(m) {
  return m && fields.every(k=>typeof m[k]==='string') && /^[a-f0-9]{32}$/.test(m.accountId) && uuid.test(m.databaseUuid) &&
    m.databaseUuid!==PRODUCTION_UUID && /^maono_synthetic_rehearsal_[a-z0-9_]+$/.test(m.databaseName) &&
    /^maono-synthetic-rehearsal-[a-z0-9-]+$/.test(m.workerName) && uuid.test(m.deploymentId) &&
    /^[a-f0-9]{40}$/.test(m.gitSha) && digest.test(m.payloadSha256) && digest.test(m.fixtureSha256) &&
    /^[a-f0-9]{32}$/.test(m.registryNamespaceId) && digest.test(m.workerBundleSha256) &&
    m.registryClassName==='SyntheticClaimRegistry' && m.registryObjectName==='synthetic-claim-registry-v1';
}
export function compareSyntheticIdentity(approved, observed, nowMs) {
  if (!valid(approved) || !valid(observed) || !Number.isSafeInteger(nowMs) ||
      !Number.isSafeInteger(approved.expiresAtMs) || !Number.isSafeInteger(observed.observedAtMs) ||
      approved.expiresAtMs<=nowMs || observed.observedAtMs>nowMs || nowMs-observed.observedAtMs>60000 ||
      fields.some(k=>approved[k]!==observed[k])) throw Error('SYNTHETIC_IDENTITY_DENIED');
  const bindings=observed.d1Bindings;
  if (!Array.isArray(bindings) || bindings.length!==1 || bindings[0]?.binding!=='TARGET' ||
      bindings[0]?.databaseUuid!==approved.databaseUuid) throw Error('SYNTHETIC_BINDING_DENIED');
  const registries=observed.durableObjectBindings;
  if (!Array.isArray(registries) || registries.length!==1 || registries[0]?.binding!=='REGISTRY' ||
      registries[0]?.namespaceId!==approved.registryNamespaceId || registries[0]?.className!==approved.registryClassName)
    throw Error('SYNTHETIC_REGISTRY_DENIED');
  return Object.freeze({correspondence:true,remoteIdentityAuthenticated:false,operationalAuthorization:false});
}
