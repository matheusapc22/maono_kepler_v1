import assert from 'node:assert/strict';

// Exact inverse of the reviewed authorization receipt clarification. Historical
// domain hashes remain unchanged: authorization checks and every unrelated byte
// must still match. This helper never changes production authorization behavior.
const authorizationReceiptEdits = [
  ['        result: "denied",\n        metadata: {',
    '        result: "denied",\n        phase: "authorization",\n        metadata: {'],
  ['      result: "success",\n      metadata: {',
    '      // Permission is granted before the domain writes. It is not proof of a save.\n      result: "authorized",\n      phase: "authorization",\n      metadata: {'],
  ['  const details = JSON.stringify({\n    organizationId:',
    '  const details = JSON.stringify({\n    ...(event.phase === "authorization" ? { auditVersion: 2, phase: "authorization" } : {}),\n    organizationId:'],
];

export function restoreOperationAuditReceipts(path, source) {
  if (path !== 'functions/_lib/permissions.js') return source;
  for (const [before, after] of authorizationReceiptEdits) {
    assert.equal(source.split(after).length - 1, 1, 'Exact reviewed authorization receipt delta');
    source = source.replace(after, before);
  }
  return source;
}
