import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrganizationTestRestoration } from '../scripts/acceptance/organization-test-restoration.mjs';
import { createOrganizationWindow, EXECUTORS } from '../scripts/acceptance/organization-window.mjs';
import { CF_ACCOUNT_ID } from '../scripts/acceptance/production-acceptance-lib.mjs';

function fixture() {
  const account = '1'.repeat(32);
  const clock = 1_800_000_000_000;
  const targets = Object.fromEntries(EXECUTORS.map((key, index) => [key, {
    type: index === 0 ? 'pages' : 'worker',
    name: 'maono-ac01-test-' + index,
    baseline: { deployment: 'baseline-' + index, configuration: 'a'.repeat(64) },
    staged: { deployment: 'staged-' + index, configuration: 'a'.repeat(64) },
  }]));
  const current = Object.fromEntries(Object.values(targets).map((target) => [target.name, target.staged]));
  const writes = [];
  const reads = [];
  const plan = { account, targets };
  const transport = {
    async read(target) {
      reads.push(target.name);
      return { ...target, ...current[target.name], terminal: true };
    },
    async restore({ account: requestedAccount, name, from, to }) {
      assert.equal(requestedAccount, account);
      assert.deepEqual(current[name], from);
      writes.push(name);
      current[name] = to;
    },
  };
  const window = createOrganizationWindow({
    version: 1, kind: 'synthetic', run: 42, attempt: 1, sha: 'b'.repeat(40),
    origin: 'https://maono.invalid', binding: 'synthetic-maono-maps',
    organization: 'synthetic-org', actor: 'synthetic-actor', caseId: 'synthetic-update',
    expiresAt: clock + 1000,
    baseline: Object.fromEntries(EXECUTORS.map((key) => [key, targets[key].baseline])),
  }, { now: () => clock });
  window.interrupt('cancelled');
  window.verifyCleanup({ organization: 'synthetic-org', remaining: [] });
  return { window, plan, current, writes, reads, transport };
}

test('test adapter restores only the three allowlisted deployments and verifies each readback', async () => {
  const { window, plan, writes, reads, transport } = fixture();
  await window.restore(createOrganizationTestRestoration(plan, transport));
  const names = Object.values(plan.targets).map(({ name }) => name);
  assert.deepEqual(writes, names);
  assert.deepEqual(reads, [...names, ...names, ...names]);
  assert.deepEqual(Object.values(window.report().executors), ['restored', 'restored', 'restored']);
  assert.equal(window.report().acceptanceExecuted, false);
});

test('test adapter refuses production account, named production assets and configuration changes', () => {
  const { plan, transport } = fixture();
  assert.throws(() => createOrganizationTestRestoration({ ...plan, account: CF_ACCOUNT_ID }, transport),
    /TEST_RESTORATION_SCOPE/);
  const [pages] = EXECUTORS;
  const bad = structuredClone(plan);
  bad.targets[pages].name = 'maono-kepler-v1';
  assert.throws(() => createOrganizationTestRestoration(bad, transport), /TEST_RESTORATION_SCOPE/);
  bad.targets[pages].name = plan.targets[pages].name;
  bad.targets[pages].staged.configuration = 'b'.repeat(64);
  assert.throws(() => createOrganizationTestRestoration(bad, transport), /TEST_RESTORATION_SCOPE/);
});

test('test adapter refuses unverified identity before any restoration', async () => {
  const { plan, window, transport, writes } = fixture();
  const read = transport.read;
  transport.read = async (target) => ({ ...await read(target), account: CF_ACCOUNT_ID });
  await assert.rejects(window.restore(createOrganizationTestRestoration(plan, transport)),
    /RESTORATION_BASELINE_UNVERIFIED/);
  assert.deepEqual(writes, []);
});

test('test adapter leaves drifted deployments alone while reporting partial restoration', async () => {
  const { plan, window, current, transport, writes } = fixture();
  const drift = plan.targets[EXECUTORS[1]];
  current[drift.name] = { ...drift.staged, deployment: 'changed-after-staging' };
  await assert.rejects(window.restore(createOrganizationTestRestoration(plan, transport)),
    /RESTORATION_INCOMPLETE/);
  assert.equal(writes.includes(drift.name), false);
  assert.equal(window.report().state, 'restoration');
  assert.deepEqual(window.report().restorationErrors, [EXECUTORS[1]]);
});
