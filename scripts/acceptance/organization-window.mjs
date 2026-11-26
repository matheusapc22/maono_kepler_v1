import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { fail } from './production-acceptance-lib.mjs';

export const EXECUTORS = Object.freeze([
  'pages:maono-kepler-v1',
  'worker:maono-organization-deletion',
  'worker:maono-organization-storage-recovery',
]);
const MAX_BYTES = 32 * 1024;
const UI_CHECKS = Object.freeze([
  'stableForm', 'goldOverlay', 'confirmedTransition', 'cornerNotices',
  'noTechnicalBlocks', 'draftPreserved',
]);

function requireCondition(condition, code) {
  if (!condition) fail(code, code);
}

function exact(value, keys, code) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)), code);
}

function match(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function snapshot(value) {
  exact(value, EXECUTORS, 'EXECUTOR_INVENTORY');
  for (const executor of EXECUTORS) {
    exact(value[executor], ['deployment', 'configuration'], 'EXECUTOR_FIELDS');
    requireCondition(match(value[executor].deployment, /^[a-zA-Z0-9-]{1,80}$/) &&
      match(value[executor].configuration, /^[a-f0-9]{64}$/), 'EXECUTOR_SNAPSHOT');
  }
  return structuredClone(value);
}

function unchanged(left, right) {
  return left.deployment === right.deployment && left.configuration === right.configuration;
}

export function createOrganizationWindow(manifest, { now = Date.now } = {}) {
  const identityKeys = ['run', 'attempt', 'sha', 'origin', 'binding', 'organization', 'actor', 'caseId'];
  exact(manifest, ['version', 'kind', ...identityKeys, 'expiresAt', 'baseline'], 'MANIFEST_FIELDS');
  requireCondition(manifest.version === 1 && manifest.kind === 'synthetic' &&
    manifest.origin === 'https://maono.invalid' && manifest.binding === 'synthetic-maono-maps' &&
    match(manifest.sha, /^[a-f0-9]{40}$/) &&
    Number.isSafeInteger(manifest.run) && manifest.run > 0 &&
    Number.isSafeInteger(manifest.attempt) && manifest.attempt > 0 &&
    [manifest.organization, manifest.actor, manifest.caseId].every((id) =>
      match(id, /^synthetic-[a-z0-9-]{1,50}$/)) &&
    Number.isSafeInteger(manifest.expiresAt) && manifest.expiresAt > now() &&
    manifest.expiresAt - now() <= 60 * 60_000, 'MANIFEST_SCOPE');

  const approved = structuredClone(manifest);
  const baseline = snapshot(approved.baseline);
  const openedAt = now();
  const history = ['awaiting-evidence'];
  let disposition = 'pending';
  let evidenceDigest = null;
  let results = null;
  const state = () => history.at(-1);
  const transition = (next) => history.push(next);

  function interrupt(reason) {
    requireCondition(state() === 'awaiting-evidence' && ['cancelled', 'expired', 'access-revoked'].includes(reason),
      'INTERRUPTION_STATE');
    requireCondition(reason !== 'expired' || now() >= approved.expiresAt, 'WINDOW_STILL_ACTIVE');
    disposition = reason;
    transition(reason);
    transition('cleanup');
  }

  function ingest(raw) {
    if (state() === 'awaiting-evidence' && now() >= approved.expiresAt) interrupt('expired');
    requireCondition(state() === 'awaiting-evidence', 'EVIDENCE_STATE');
    requireCondition(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= MAX_BYTES, 'EVIDENCE_SIZE');
    const evidence = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    exact(evidence, ['version', 'kind', ...identityKeys, 'observedAt', 'operation', 'httpStatus', 'effect', 'ui'],
      'EVIDENCE_FIELDS');
    requireCondition(evidence.version === approved.version && evidence.kind === approved.kind &&
      identityKeys.every((key) => evidence[key] === approved[key]), 'EVIDENCE_SCOPE');
    requireCondition(Number.isSafeInteger(evidence.observedAt) &&
      evidence.observedAt >= openedAt && evidence.observedAt <= now() &&
      evidence.observedAt < approved.expiresAt, 'EVIDENCE_TIME');
    exact(evidence.ui, UI_CHECKS, 'UI_FIELDS');
    requireCondition(match(evidence.operation, /^synthetic-[a-z0-9-]{1,50}$/) &&
      evidence.httpStatus === 200 && evidence.effect === 'synthetic-effect-confirmed' &&
      UI_CHECKS.every((check) => evidence.ui[check] === true), 'CASE_INCOMPLETE');

    transition('verified');
    evidenceDigest = createHash('sha256').update(raw).digest('hex');
    disposition = 'synthetic-case-verified';
    transition('cleanup');
  }

  function verifyCleanup(observation) {
    requireCondition(state() === 'cleanup', 'CLEANUP_STATE');
    exact(observation, ['organization', 'remaining'], 'CLEANUP_FIELDS');
    requireCondition(observation.organization === approved.organization &&
      Array.isArray(observation.remaining) && observation.remaining.length === 0, 'CLEANUP_INCOMPLETE');
    transition('restoration');
  }

  function verifyRestoration(before, after) {
    requireCondition(state() === 'restoration', 'RESTORATION_STATE');
    const observedBefore = snapshot(before);
    const observedAfter = snapshot(after);
    results = Object.fromEntries(EXECUTORS.map((executor) => {
      if (!unchanged(baseline[executor], observedAfter[executor])) return [executor, 'mismatch'];
      return [executor, unchanged(baseline[executor], observedBefore[executor]) ? 'unchanged' : 'restored'];
    }));
    requireCondition(!Object.values(results).includes('mismatch'), 'RESTORATION_INCOMPLETE');
    transition('closed');
  }

  async function restore(adapter) {
    requireCondition(state() === 'restoration', 'RESTORATION_STATE');
    const readAll = async () => snapshot(Object.fromEntries(await Promise.all(
      EXECUTORS.map(async (executor) => [executor, await adapter.read(executor)]))));
    const before = await readAll();
    const attempts = await Promise.allSettled(EXECUTORS.map(async (executor) => {
      if (!unchanged(baseline[executor], before[executor])) {
        await adapter.restore(executor, structuredClone(baseline[executor]));
      }
    }));
    const after = await readAll();
    // Readback is decisive even when the adapter reports a lost response.
    try {
      verifyRestoration(before, after);
    } finally {
      restorationErrors = attempts.flatMap((attempt, index) =>
        attempt.status === 'rejected' ? [EXECUTORS[index]] : []);
    }
  }

  let restorationErrors = [];
  return {
    ingest, interrupt, verifyCleanup, verifyRestoration, restore,
    report: () => ({
      version: 1, kind: 'synthetic', state: state(), history: [...history], disposition,
      evidenceDigest, executors: results && { ...results }, restorationErrors: [...restorationErrors],
      protocolComplete: state() === 'closed' && disposition === 'synthetic-case-verified',
      acceptanceExecuted: false, complete: false,
    }),
  };
}

async function readBounded(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    requireCondition(stat.isFile() && stat.size <= MAX_BYTES, 'INPUT_SIZE');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    requireCondition(offset <= MAX_BYTES, 'INPUT_SIZE');
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}

export async function runOrganizationWindow(args) {
  requireCondition(args.length === 2, 'EXPECTED_MANIFEST_AND_EVIDENCE');
  const [manifestPath, evidencePath] = args;
  const scenario = JSON.parse(await readBounded(manifestPath));
  exact(scenario, ['clock', 'manifest', 'cleanup', 'beforeRestore'], 'SCENARIO_FIELDS');
  requireCondition(Number.isSafeInteger(scenario.clock) && scenario.clock > 0, 'SCENARIO_CLOCK');
  const window = createOrganizationWindow(scenario.manifest, { now: () => scenario.clock });
  window.ingest(await readBounded(evidencePath));
  window.verifyCleanup(scenario.cleanup);
  const syntheticState = snapshot(scenario.beforeRestore);
  await window.restore({
    read: async (executor) => syntheticState[executor],
    restore: async (executor, baseline) => { syntheticState[executor] = baseline; },
  });
  return window.report();
}
