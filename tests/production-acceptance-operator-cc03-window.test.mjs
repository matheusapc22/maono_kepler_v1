import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateCc03Window, MAX_EVIDENCE_AGE_MS } from '../scripts/acceptance/cc03-window.mjs';
import { PRODUCTION_D1_ID, activeFlags, safeFlags } from '../scripts/acceptance/production-acceptance-lib.mjs';
import { manifest } from '../scripts/acceptance/suites/cc03-command-lifecycle.mjs';
import { publicManifest } from '../scripts/acceptance/registry.mjs';
import { createExecutionBudget, PHASE_BUDGET_MS } from '../scripts/acceptance/execution-budget.mjs';
import { main } from '../scripts/acceptance/operator.mjs';

export const now = Date.parse('2026-10-24T01:00:00.000Z'), sha = 'a'.repeat(40);
export const input = () => ({ version: 1, expectedCommit: sha, databaseId: PRODUCTION_D1_ID,
  observedAt: new Date(now).toISOString(), startsAt: new Date(now).toISOString(), endsAt: new Date(now + 190 * 60_000).toISOString(),
  globalCommandsApproved: true, writersPaused: true, restorationOwner: 'synthetic-owner', evidenceSha256: 'b'.repeat(64),
  schemaCompatible: true, allActiveOrganizations: true, activeOrganizationCount: 1, organizations: [{ id: 9, status: 'ready', schemaVersion: 1,
    pendingCount: 0, skippedCount: 0, completedAt: new Date(now).toISOString(), actualPendingCount: 0, unclassifiedAdoptedCount: 0 }] });
const options = () => ({ expectedCommit: sha, organizationId: 9, qaUserIds: { manager: 5, allowed: 11, restricted: 7 },
  now, actor: 'synthetic-owner', workflowAttempt: '1' });

test('CC03 registered manifest preserves TRIAGE/SELECTIVE, restores COMMANDS and declares human global evidence', () => {
  assert.equal(publicManifest(manifest.id).requiresGlobalWindow, true);
  assert.equal(publicManifest(manifest.id).requiresBrowser, false);
  assert.deepEqual(activeFlags(manifest), { MAONO_TICKET_COMMANDS_ENABLED: true, MAONO_TICKET_TRIAGE_ENABLED: true, MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: true });
  assert.deepEqual(safeFlags(manifest), { MAONO_TICKET_COMMANDS_ENABLED: false, MAONO_TICKET_TRIAGE_ENABLED: true, MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: true });
  const result = validateCc03Window(JSON.stringify(input()), options());
  assert.equal(result.evidenceVerification, 'HUMAN_SUPPLIED_AGGREGATES_NOT_LIVE_D1');
  assert.match(result.inputSha256, /^[a-f0-9]{64}$/);
});

const mutations = [
  ['global approval absent', w => { w.globalCommandsApproved = false; }],
  ['writers not paused', w => { w.writersPaused = false; }],
  ['incomplete scope', w => { w.allActiveOrganizations = false; }],
  ['schema not confirmed', w => { w.schemaCompatible = false; }],
  ['scope count differs', w => { w.activeOrganizationCount = 2; }],
  ['duplicate organization', w => { w.organizations.push({ ...w.organizations[0] }); w.activeOrganizationCount = 2; }],
  ['missing QA9', w => { w.organizations[0].id = 8; }],
  ['source additions', w => { w.organizations[0].actualPendingCount = 1; }],
  ['marker pending', w => { w.organizations[0].pendingCount = 1; }],
  ['skipped rows', w => { w.organizations[0].skippedCount = 1; }],
  ['adopted unclassified rows', w => { w.organizations[0].unclassifiedAdoptedCount = 1; }],
  ['marker not ready', w => { w.organizations[0].status = 'failed'; }],
  ['missing completion', w => { w.organizations[0].completedAt = null; }],
  ['future completion', w => { w.organizations[0].completedAt = new Date(now + 1).toISOString(); }],
  ['wrong schema', w => { w.organizations[0].schemaVersion = 2; }],
  ['wrong D1', w => { w.databaseId = 'other'; }],
  ['wrong SHA', w => { w.expectedCommit = 'c'.repeat(40); }],
  ['stale evidence', w => { w.observedAt = new Date(now - MAX_EVIDENCE_AGE_MS - 1).toISOString(); }],
  ['future evidence', w => { w.observedAt = new Date(now + 1).toISOString(); }],
  ['outside window', w => { w.endsAt = new Date(now).toISOString(); }],
  ['window not started', w => { w.startsAt = new Date(now + 1).toISOString(); }],
  ['unknown input', w => { w.sql = 'SECRET_NOT_FOR_LOGS'; }],
  ['unknown row input', w => { w.organizations[0].email = 'SECRET_NOT_FOR_LOGS'; }],
  ['unassigned restoration', w => { w.restorationOwner = 'someone-else'; }],
];
for (const [name, mutate] of mutations) test(`CC03 window rejects ${name} without reflecting supplied data`, () => {
  const value = input(); mutate(value);
  assert.throws(() => validateCc03Window(JSON.stringify(value), options()), error => {
    assert.equal(error.code, 'CC03_WINDOW_INVALID'); assert.doesNotMatch(error.message, /SECRET_NOT_FOR_LOGS/); return true;
  });
});
test('CC03 window rejects reruns, missing scope, non-JSON and other QA IDs', () => {
  for (const override of [{ workflowAttempt: '2' }, { actor: undefined }, { organizationId: 1 }, { qaUserIds: { manager: 4, allowed: 11, restricted: 7 } }]) {
    assert.throws(() => validateCc03Window(JSON.stringify(input()), { ...options(), ...override }), { code: 'CC03_WINDOW_INVALID' });
  }
  for (const raw of [undefined, '', '{}', 'null', '[]', 'not-json', 'x'.repeat(20_001)]) assert.throws(() => validateCc03Window(raw, options()));
});

test('approved deadline can only shorten the budget; activation admission preserves full cleanup/restoration reserves', () => {
  const budget = createExecutionBudget(manifest, { now: () => now });
  budget.enter('preflight');
  const original = budget.endAt;
  budget.constrainDeadline(now + 300 * 60_000); assert.equal(budget.endAt, original);
  budget.constrainDeadline(now + 30 * 60_000);
  assert.throws(() => budget.enter('activation'), { code: 'ACCEPTANCE_CLOSURE_BUDGET_REQUIRED' });
  assert.equal(budget.closureReserveMs, PHASE_BUDGET_MS.cleanup + PHASE_BUDGET_MS.restoration + PHASE_BUDGET_MS.report);
  const limited = createExecutionBudget(manifest, { now: () => now }); limited.enter('preflight');
  limited.constrainDeadline(now + 180 * 60_000); limited.enter('activation');
  assert.throws(() => limited.constrainDeadline(original), { code: 'ACCEPTANCE_BUDGET_INVALID' });
});

test('missing/invalid CC03 window fails in the real operator before QA login, secrets parsing or any mutation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cc03-window-')); t.after(() => rm(dir, { recursive: true, force: true }));
  t.mock.method(process.stdout, 'write', () => true);
  const vars = Object.fromEntries(Object.entries(manifest.managedFlags).map(([name, flag]) => [name, { type: 'plain_text', value: String(flag.requiredBefore) }]));
  const deployment = { id: 'baseline', environment: 'production', url: 'https://maono-kepler-v1.pages.dev',
    latest_stage: { name: 'deploy', status: 'success' }, deployment_trigger: { metadata: { commit_hash: sha, commit_dirty: false } }, env_vars: vars };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init.method); assert.equal(init.method, 'GET'); assert.equal(new URL(url).hostname, 'api.cloudflare.com');
    return Response.json({ success: true, result: new URL(url).pathname.endsWith('/deployments') ? [deployment] :
      { name: 'maono-kepler-v1', production_branch: 'mano_kepler_v1', subdomain: 'maono-kepler-v1.pages.dev', canonical_deployment: deployment,
        deployment_configs: { production: { env_vars: vars, d1_databases: { DB: { id: PRODUCTION_D1_ID } } } } } });
  };
  const reportPath = join(dir, 'report.json');
  const result = await main(['--mode', 'run', '--suite', manifest.id, '--organization-id', '9', '--qa-user-ids', '5,11,7',
    '--expected-commit', sha, '--report', reportPath], { MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN: 'synthetic',
    MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON: 'invalid-secret-must-not-be-parsed' }, { fetchImpl, now: () => now });
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(result, 1); assert.equal(report.error.code, 'CC03_WINDOW_INVALID');
  assert.equal(report.acceptanceExecuted, false); assert.equal(report.writesPerformed, false); assert.ok(calls.length > 0);
  assert.doesNotMatch(JSON.stringify(report), /invalid-secret-must-not-be-parsed/);
});
