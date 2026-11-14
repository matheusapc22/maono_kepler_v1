// LOCAL ADAPTER EXPERIMENT ONLY: no deployed namespace, HTTP endpoint or D1 binding.
import { DurableObject } from 'cloudflare:workers';
import { PRODUCTION_UUID } from './remote-protocol-model.mjs';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
function validateKey(key) {
  const prefix = 'synthetic-d1-once:';
  if (typeof key !== 'string' || !key.startsWith(prefix) ||
      !uuid.test(key.slice(prefix.length)) || key.slice(prefix.length) === PRODUCTION_UUID)
    throw Error('INVALID_REGISTRY_KEY');
}
// The namespace AND this object name must remain stable for the target lifetime.
// Changing either, deleting storage or restoring a pre-claim backup is NOT recovery.
export function createRegistryStore(namespace) {
  const stub = namespace.get(namespace.idFromName('synthetic-claim-registry-v1'));
  return {
    claimOnce: (key, record) => stub.claimOnce(key, record),
    finish: (key, attemptId, state) => stub.finish(key, attemptId, state),
  };
}
export class SyntheticClaimRegistry extends DurableObject {
  async claimOnce(key, record) {
    validateKey(key);
    if (!record || record.state !== 'claimed' || typeof record.attemptId !== 'string' || !uuid.test(record.attemptId) ||
        typeof record.payloadSha256 !== 'string' || !digest.test(record.payloadSha256) ||
        typeof record.auditSha256 !== 'string' || !digest.test(record.auditSha256))
      throw Error('INVALID_CLAIM');
    // Only allowlisted scalars; callback contains no external I/O or side effects.
    const clean = {state:'claimed', attemptId:record.attemptId,
      payloadSha256:record.payloadSha256, auditSha256:record.auditSha256};
    return this.ctx.storage.transaction(async txn => {
      if (await txn.get(key) !== undefined) return false;
      await txn.put(key, clean);
      return true;
    });
  }
  async finish(key, attemptId, state) {
    validateKey(key);
    if (typeof attemptId !== 'string' || !uuid.test(attemptId) || !['unknown', 'returned-unverified'].includes(state))
      throw Error('INVALID_TERMINAL_STATE');
    return this.ctx.storage.transaction(async txn => {
      const record = await txn.get(key);
      if (!record || record.state !== 'claimed' || record.attemptId !== attemptId)
        throw Error('CLAIM_TRANSITION_DENIED');
      await txn.put(key, {...record, state});
      return true;
    });
  }
}
// No alarm, TTL, delete, reset, unlock, retry, SQL or arbitrary storage interface.
