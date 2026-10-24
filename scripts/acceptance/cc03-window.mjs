import { createHash } from 'node:crypto';
import { fail, PRODUCTION_D1_ID } from './production-acceptance-lib.mjs';

// Sanitized aggregate evidence, not credentials and not executable SQL. This is
// an explicitly human-supplied snapshot, NOT an independent live D1 attestation.
// The dedicated Pages token cannot prove D1 readiness. Review its source before
// approving the Environment; automatic structural checks do not replace that gate.
export const MAX_EVIDENCE_AGE_MS = 10 * 60_000;
const reject = () => fail('CC03_WINDOW_INVALID', 'Janela global/evidência CC03 ausente, inválida, obsoleta ou fora do escopo.');
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== allowed.length || allowed.some(key => !Object.hasOwn(value, key))) reject();
}
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) reject();
  return Date.parse(value);
}
export function validateCc03Window(raw, { expectedCommit, organizationId, qaUserIds, now = Date.now(), actor, workflowAttempt } = {}) {
  let window;
  try { if (typeof raw !== 'string' || Buffer.byteLength(raw) > 20_000) reject(); window = JSON.parse(raw); } catch { reject(); }
  keys(window, ['version', 'expectedCommit', 'databaseId', 'observedAt', 'startsAt', 'endsAt', 'globalCommandsApproved',
    'writersPaused', 'restorationOwner', 'evidenceSha256', 'schemaCompatible', 'allActiveOrganizations', 'activeOrganizationCount', 'organizations']);
  if (window.version !== 1 || organizationId !== 9 || window.expectedCommit !== expectedCommit || !/^[a-f0-9]{40}$/.test(expectedCommit || '') ||
    window.databaseId !== PRODUCTION_D1_ID || window.globalCommandsApproved !== true || window.writersPaused !== true ||
    window.schemaCompatible !== true || window.allActiveOrganizations !== true || !/^[a-f0-9]{64}$/.test(window.evidenceSha256) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(actor || '') || window.restorationOwner !== actor || workflowAttempt !== '1' ||
    qaUserIds?.manager !== 5 || qaUserIds?.allowed !== 11 || qaUserIds?.restricted !== 7) reject();
  const observedAt = time(window.observedAt), startsAt = time(window.startsAt), endsAt = time(window.endsAt);
  if (observedAt > now || now - observedAt > MAX_EVIDENCE_AGE_MS || startsAt > now || endsAt <= now || startsAt >= endsAt) reject();
  if (!Array.isArray(window.organizations) || !Number.isSafeInteger(window.activeOrganizationCount) || window.activeOrganizationCount < 1 ||
    window.organizations.length !== window.activeOrganizationCount || window.organizations.length > 100) reject();
  const ids = new Set();
  for (const row of window.organizations) {
    keys(row, ['id', 'status', 'schemaVersion', 'pendingCount', 'skippedCount', 'completedAt', 'actualPendingCount', 'unclassifiedAdoptedCount']);
    if (!Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id) || row.status !== 'ready' || row.schemaVersion !== 1 ||
      row.pendingCount !== 0 || row.skippedCount !== 0 || row.actualPendingCount !== 0 || row.unclassifiedAdoptedCount !== 0 ||
      time(row.completedAt) > observedAt) reject();
    ids.add(row.id);
  }
  if (!ids.has(9)) reject();
  return { ...window, inputSha256: createHash('sha256').update(raw).digest('hex'),
    evidenceVerification: 'HUMAN_SUPPLIED_AGGREGATES_NOT_LIVE_D1', deadline: endsAt };
}
