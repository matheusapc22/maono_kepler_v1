// LOCAL PROTOCOL MODEL ONLY. No remote adapter, credential, deployment or D1 access.
// Store.claimOnce MUST be linearizable and durable in any future implementation.
export const PRODUCTION_UUID = '5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
export function operationKey(spec) {
  if (!spec || !uuid.test(spec.databaseUuid) || spec.databaseUuid === PRODUCTION_UUID ||
      !/^maono_synthetic_rehearsal_[a-z0-9_]+$/.test(spec.databaseName) ||
      !digest.test(spec.payloadSha256) || !digest.test(spec.auditSha256) ||
      !uuid.test(spec.attemptId)) throw Error('INVALID_SYNTHETIC_OPERATION');
  // A new audit/payload/attempt must not reopen the same target after uncertainty.
  return 'synthetic-d1-once:' + spec.databaseUuid;
}
export async function modelInvocation({store, spec, executeFixedBatch}) {
  const key = operationKey(spec);
  const claimed = await store.claimOnce(key, {
    state: 'claimed', attemptId: spec.attemptId,
    payloadSha256: spec.payloadSha256, auditSha256: spec.auditSha256,
  });
  if (!claimed) return {outcome: 'denied-replay', retryAllowed: false};
  // No timeout here: caller disconnect/timeout does not cancel an underlying write.
  try {
    await executeFixedBatch();
  } catch {
    await store.finish(key, spec.attemptId, 'unknown');
    return {outcome: 'unknown', retryAllowed: false};
  }
  await store.finish(key, spec.attemptId, 'returned-unverified');
  return {outcome: 'returned-unverified', retryAllowed: false};
}
// No "reset", "unlock", "retry", or caller-selectable SQL API exists in this model.
// Reconciliation cannot reopen the claim, even if it observes a matching prestate.
