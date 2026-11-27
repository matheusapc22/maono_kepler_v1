import { CF_ACCOUNT_ID, fail } from './production-acceptance-lib.mjs';
import { EXECUTORS } from './organization-window.mjs';

function requireCondition(condition, code) {
  if (!condition) fail(code, code);
}

function sameDeployment(left, right) {
  return left?.deployment === right.deployment && left?.configuration === right.configuration;
}

function validDeployment(value) {
  return typeof value?.deployment === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value.deployment) &&
    typeof value.configuration === 'string' && /^[a-f0-9]{64}$/.test(value.configuration);
}

// The transport is injected. This module has no Cloudflare client, credentials or production entry point.
export function createOrganizationTestRestoration(plan, transport) {
  const { account, targets } = structuredClone(plan);
  requireCondition(typeof account === 'string' && /^[a-f0-9]{32}$/.test(account) &&
    account !== CF_ACCOUNT_ID && targets && Object.keys(targets).length === EXECUTORS.length,
  'TEST_RESTORATION_SCOPE');

  const identifiers = new Set();
  for (const [index, executor] of EXECUTORS.entries()) {
    const target = targets[executor];
    const type = index === 0 ? 'pages' : 'worker';
    requireCondition(target?.type === type && typeof target.name === 'string' &&
      /^maono-ac01-test-[a-z0-9-]{1,40}$/.test(target.name) && !identifiers.has(target.name) &&
      validDeployment(target.baseline) && validDeployment(target.staged) &&
      target.baseline.deployment !== target.staged.deployment &&
      target.baseline.configuration === target.staged.configuration, 'TEST_RESTORATION_SCOPE');
    identifiers.add(target.name);
  }

  function targetFor(executor) {
    requireCondition(EXECUTORS.includes(executor), 'TEST_RESTORATION_EXECUTOR');
    const { type, name } = targets[executor];
    return { account, type, name };
  }

  async function read(executor) {
    const target = targetFor(executor);
    const result = await transport.read(target);
    requireCondition(result?.account === account && result.type === target.type &&
      result.name === target.name && result.terminal === true && validDeployment(result),
    'TEST_RESTORATION_READBACK');
    return { deployment: result.deployment, configuration: result.configuration };
  }

  async function restore(executor, requestedBaseline) {
    const target = targetFor(executor);
    const { baseline, staged } = targets[executor];
    requireCondition(sameDeployment(requestedBaseline, baseline), 'TEST_RESTORATION_BASELINE');
    const current = await read(executor);
    if (sameDeployment(current, baseline)) return;
    requireCondition(sameDeployment(current, staged), 'TEST_RESTORATION_DRIFT');
    // The transport must enforce the expected state or an exclusive sandbox lock at execution.
    await transport.restore({ ...target, from: structuredClone(staged), to: structuredClone(baseline) });
  }

  return { read, restore };
}
