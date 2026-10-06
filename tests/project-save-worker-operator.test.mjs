import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TARGET, config, digest, assertRef, validateDispatch, validateManifest, artifactAudit,
  verifyBootstrapTarget, verifyDeployedSettings, apiReader, verifyEnvironment, checkEnvironment, verifyPriorPreflight, readPreflightProvenance } from '../scripts/project-save-worker/operator-lib.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('../scripts/project-save-worker/source-manifest.json', import.meta.url)));
const workflow = fs.readFileSync(new URL('../.github/workflows/project-save-worker-operator.yml', import.meta.url), 'utf8');
const cli = fs.readFileSync(new URL('../scripts/project-save-worker/operator.mjs', import.meta.url), 'utf8');
const base = {
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: TARGET.repository, GITHUB_REPOSITORY_OWNER: TARGET.owner,
  GITHUB_ACTOR: TARGET.owner, GITHUB_TRIGGERING_ACTOR: TARGET.owner, GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: `${TARGET.repository}/.github/workflows/project-save-worker-operator.yml@refs/heads/main`,
  GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '456', PREFLIGHT_RUN_ID: '', MODE: 'preflight', CONFIRMATION: 'PREPARE_PROJECT_SAVE_WORKER', APPROVAL_HASH: '',
};
const db = { uuid: TARGET.databaseId, name: TARGET.databaseName };
const live = () => ({
  settings: { compatibility_date: '2026-09-01', bindings: [
    ...Object.entries(config().vars).map(([name, text]) => ({ name, text, type: 'plain_text' })),
    { name: 'DB', type: 'd1', id: TARGET.databaseId },
  ] },
  schedules: { schedules: [{ cron: TARGET.cron }] },
  deployments: { deployments: [{ id: 'deployment', versions: [{ version_id: 'version', percentage: 100 }] }] },
  subdomain: { enabled: false, previews_enabled: false },
});
const checkLive = value => verifyDeployedSettings(value.settings, value.schedules, value.deployments, value.subdomain);

test('only reviewed immutable 22-file source closure is accepted', () => {
  validateManifest(manifest);
  assert.equal(manifest.files['workers/project-save-operations.js'].length, 64);
  for (const changed of [
    { ...manifest, sourceSha: 'main' }, { ...manifest, repository: 'other/repo' },
    { ...manifest, files: { ...manifest.files, '../evil.js': 'a'.repeat(64) } },
    { ...manifest, files: { [manifest.entryPoint]: 'a'.repeat(64) } },
  ]) assert.throws(() => validateManifest(changed));
});
test('renderer fixes target, least bindings, cron and both disabled processors', () => {
  const c = config();
  assert.equal(c.account_id, TARGET.accountId); assert.equal(c.name, TARGET.worker);
  assert.deepEqual(c.triggers.crons, ['* * * * *']);
  assert.deepEqual(c.d1_databases, [{ binding: 'DB', database_name: TARGET.databaseName, database_id: TARGET.databaseId }]);
  for (const key of ['PROJECT_DURABLE_SAVE_WORKER_ENABLED', 'PROJECT_PREVIEW_PROCESSOR_ENABLED', 'PROJECT_DURABLE_SAVE_V1']) assert.equal(c.vars[key], 'false');
  assert.equal(c.vars.PROJECT_PREVIEW_BATCH_SIZE, '10'); assert.equal(c.workers_dev, false); assert.equal(c.preview_urls, false);
  assert.deepEqual(Object.keys(c).sort(), ['account_id','compatibility_date','d1_databases','main','name','preview_urls','triggers','vars','workers_dev'].sort());
  assert.equal(config({ bundled: true }).no_bundle, true);
  assert.doesNotMatch(JSON.stringify(c), /secret|DROPBOX_|queue|route|build/);
});
test('manual owner main invocation allowed with exact confirmation', () => {
  assert.equal(validateDispatch(base), 'preflight');
  assert.equal(validateDispatch({ ...base, MODE: 'deploy_disabled', CONFIRMATION: 'DEPLOY_DISABLED_PROJECT_SAVE_WORKER', PREFLIGHT_RUN_ID: '123', APPROVAL_HASH: 'b'.repeat(64) }), 'deploy_disabled');
});
for (const [key, value] of Object.entries({ GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'evil/fork', GITHUB_ACTOR: 'other',
  GITHUB_TRIGGERING_ACTOR: 'other', GITHUB_REPOSITORY_OWNER: 'other', GITHUB_REF: 'refs/heads/mano_kepler_v1',
  GITHUB_WORKFLOW_REF: 'evil', GITHUB_SHA: 'main', MODE: 'activate', CONFIRMATION: 'continue', APPROVAL_HASH: 'unexpected' })) {
  test(`dispatch rejects changed ${key}`, () => assert.throws(() => validateDispatch({ ...base, [key]: value })));
}
test('deployment requires exact confirmation plus prior audit hash', () => {
  for (const patch of [{ CONFIRMATION: '' }, { APPROVAL_HASH: '' }, { APPROVAL_HASH: 'x'.repeat(64) }, { PREFLIGHT_RUN_ID: '' }, { PREFLIGHT_RUN_ID: '456' }, { PREFLIGHT_RUN_ID: '../evil' }]) {
    assert.throws(() => validateDispatch({ ...base, MODE: 'deploy_disabled', CONFIRMATION: 'DEPLOY_DISABLED_PROJECT_SAVE_WORKER', PREFLIGHT_RUN_ID: '123', APPROVAL_HASH: 'b'.repeat(64), ...patch }));
  }
});
test('main ref drift or invalid SHA fails closed', () => {
  assertRef(base.GITHUB_SHA, base.GITHUB_SHA);
  assert.throws(() => assertRef(base.GITHUB_SHA, 'b'.repeat(40)));
  assert.throws(() => assertRef('main', 'main'));
});
test('approval digest binds operator source, source closure, bundle and locked toolchain', () => {
  const input = { operatorSha: base.GITHUB_SHA, manifest, lockHash: 'c'.repeat(64), bundleHash: 'd'.repeat(64) };
  const first = artifactAudit(input);
  assert.equal(first.approvalHash, artifactAudit(input).approvalHash);
  for (const patch of [{ operatorSha: 'b'.repeat(40) }, { lockHash: 'f'.repeat(64) }, { bundleHash: 'f'.repeat(64) },
    { manifest: { ...manifest, files: { ...manifest.files, [manifest.entryPoint]: 'e'.repeat(64) } } }]) {
    assert.notEqual(first.approvalHash, artifactAudit({ ...input, ...patch }).approvalHash);
  }
  assert.equal(first.artifact.configHash, digest(config({ bundled: true })));
});
test('bootstrap refuses existing Worker, wrong database, incomplete list and malformed data', () => {
  assert.deepEqual(verifyBootstrapTarget(db, []), { databaseName: TARGET.databaseName, databaseId: TARGET.databaseId, workerExists: false });
  assert.throws(() => verifyBootstrapTarget(db, [{ id: TARGET.worker }]));
  assert.throws(() => verifyBootstrapTarget({ ...db, name: 'other' }, []));
  assert.throws(() => verifyBootstrapTarget({ ...db, uuid: 'other' }, []));
  assert.throws(() => verifyBootstrapTarget(db, [], { total_count: 1 }));
  assert.throws(() => verifyBootstrapTarget(db, [], { cursor: 'next' }));
  assert.throws(() => verifyBootstrapTarget(db, [{ name: 'missing-id' }]));
});
test('post-validation proves both OFF, sole D1, cron and disabled HTTP routes', () => {
  assert.equal(checkLive(live()).processors, 'disabled');
  const mutations = [
    x => x.settings.bindings[2].text = 'true', x => x.settings.bindings[3].text = 'true',
    x => x.settings.bindings.push({ name: 'EXTRA', type: 'secret_text' }),
    x => x.settings.bindings.at(-1).id = 'other', x => x.settings.compatibility_date = '2000-01-01',
    x => x.schedules.schedules.push({ cron: '0 * * * *' }), x => x.schedules.schedules[0].cron = '0 * * * *',
    x => x.deployments.deployments[0].versions[0].percentage = 50,
    x => x.subdomain.enabled = true, x => x.subdomain.previews_enabled = true,
  ];
  for (const mutate of mutations) { const x = live(); mutate(x); assert.throws(() => checkLive(x)); }
});
test('remote reads only fixed Cloudflare account endpoints and rejects redirects/errors', async () => {
  const calls = [];
  const read = apiReader('synthetic-token', async (url, opts) => {
    calls.push({ url, opts }); return { ok: true, json: async () => ({ success: true, result: db }) };
  });
  await read(`/d1/database/${TARGET.databaseId}`);
  assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${TARGET.accountId}/d1/database/${TARGET.databaseId}`);
  assert.equal(calls[0].opts.method, 'GET'); assert.equal(calls[0].opts.redirect, 'error');
  await assert.rejects(() => read('https://evil.test')); await assert.rejects(() => read('/d1/database/other'));
  await assert.rejects(() => apiReader('token', async () => ({ ok: false, json: async () => ({ success: false, secret: 'do-not-log' }) }))('/workers/scripts'), /CLOUDFLARE_READ_REJECTED/);
  assert.throws(() => apiReader(''));
});
test('workflow has no automatic production path, arbitrary target input or secret configuration', () => {
  assert.match(workflow, /workflow_dispatch:/); assert.doesNotMatch(workflow, /^\s+(push|schedule|pull_request_target):/m);
  assert.match(workflow, /environment: production-project-save-worker/);
  assert.match(workflow, /if: github.event_name == 'workflow_dispatch'\n    needs: validate/);
  assert.deepEqual([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(x => x[1]), ['MAONO_PROJECT_SAVE_WORKER_DEPLOY_API_TOKEN']);
  assert.doesNotMatch(workflow, /MAONO_D1_MIGRATION|DROPBOX_|secret put|inputs\.(?:ref|source|worker|account|database|command|secret|flag)/);
  assert.equal((workflow.match(new RegExp(`ref: ${TARGET.sourceSha}`, 'g')) || []).length, 2);
  assert.match(workflow, /needs.validate.outputs.artifact_hash/); assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  for (const action of workflow.matchAll(/uses: ([^\n]+)/g)) assert.match(action[1], /@[a-f0-9]{40}(?: |$)/);
  assert.match(workflow, /--ignore-scripts/); assert.match(workflow, /include-hidden-files: true/);
});
test('protected executor hashes the exact no-bundle deployment and stops on uncertain writes', () => {
  assert.match(cli, /'ls-remote', 'origin', 'refs\/heads\/main'/);
  assert.match(cli, /'deploy', '--config', 'wrangler.deploy.json', '--no-bundle'/);
  assert.match(cli, /DEPLOY_OUTCOME_UNCERTAIN_STOP/); assert.match(cli, /ARTIFACT_CHANGED_BEFORE_WRITE/);
  assert.doesNotMatch(cli, /secret put|secret bulk|d1 migrations|pages deploy|--keep-vars/);
  assert.ok(cli.indexOf('verifyBootstrapTarget(database.result') < cli.indexOf('report.writeAttempted = true'));
});
test('toolchain is version pinned with integrity locked registry packages', () => {
  const lock = JSON.parse(fs.readFileSync(new URL('../scripts/project-save-worker/package-lock.json', import.meta.url)));
  assert.equal(lock.packages['node_modules/wrangler'].version, TARGET.wranglerVersion);
  for (const [name, pkg] of Object.entries(lock.packages)) if (name) {
    assert.match(pkg.resolved, /^https:\/\/registry\.npmjs\.org\//); assert.match(pkg.integrity, /^sha512-/);
  }
});

test('environment must exist with owner approval and main-only branch policy', async () => {
  const environment = { name: 'production-project-save-worker', protection_rules: [{ type: 'required_reviewers',
    reviewers: [{ type: 'User', reviewer: { login: TARGET.owner } }] }],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
  const branches = { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };
  verifyEnvironment(environment, branches);
  assert.throws(() => verifyEnvironment(undefined, branches));
  assert.throws(() => verifyEnvironment({ ...environment, protection_rules: [] }, branches));
  assert.throws(() => verifyEnvironment({ ...environment, deployment_branch_policy: null }, branches));
  assert.throws(() => verifyEnvironment(environment, { ...branches, total_count: 2 }));
  assert.throws(() => verifyEnvironment(environment, { ...branches, branch_policies: [{ name: 'main', type: 'tag' }] }));
  assert.throws(() => verifyEnvironment(environment, { ...branches, branch_policies: [{ name: '*', type: 'branch' }] }));
  const calls = [];
  await checkEnvironment('synthetic-github-token', async (url, opts) => {
    calls.push({ url, opts }); return { ok: true, json: async () => calls.length === 1 ? environment : branches };
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.opts.method === 'GET' && call.opts.redirect === 'error'
    && call.url.startsWith(`https://api.github.com/repos/${TARGET.repository}/environments/production-project-save-worker`)));
  await assert.rejects(() => checkEnvironment('token', async () => ({ ok: false })), /GITHUB_ENVIRONMENT_READ_REJECTED/);
});

test('D1 post-validation supports current database_id and rejects conflicting legacy id', () => {
  const x = live();
  delete x.settings.bindings.at(-1).id;
  x.settings.bindings.at(-1).database_id = TARGET.databaseId;
  assert.equal(checkLive(x).databaseId, TARGET.databaseId);
  x.settings.bindings.at(-1).id = 'other';
  assert.throws(() => checkLive(x), /DEPLOYED_D1_MISMATCH/);
});

test('prior preflight provenance is required and bound to its successful owner/main run and report', async () => {
  const currentAudit = artifactAudit({ operatorSha: base.GITHUB_SHA, manifest, lockHash: 'c'.repeat(64), bundleHash: 'd'.repeat(64) });
  const fixture = () => ({ runId: '123', currentRunId: '456', currentAudit,
    run: { id: 123, repository: { full_name: TARGET.repository }, head_repository: { full_name: TARGET.repository },
      path: '.github/workflows/project-save-worker-operator.yml', event: 'workflow_dispatch', head_branch: 'main',
      head_sha: base.GITHUB_SHA, actor: { login: TARGET.owner }, triggering_actor: { login: TARGET.owner },
      status: 'completed', conclusion: 'success', run_attempt: 1 },
    artifacts: { total_count: 1, artifacts: [{ id: 99, name: 'project-save-worker-preflight-123', expired: false,
      workflow_run: { id: 123, head_sha: base.GITHUB_SHA } }] },
    report: { mode: 'preflight', ...currentAudit, runId: '123', runAttempt: '1', complete: true, writeAttempted: false,
      deploymentVerified: false, preflight: { databaseName: TARGET.databaseName, databaseId: TARGET.databaseId, workerExists: false } },
  });
  assert.deepEqual(verifyPriorPreflight(fixture()), { runId: '123', runAttempt: '1', artifactId: 99 });
  for (const suffix of ['@main', '@refs/heads/main']) {
    const x = fixture(); x.run.path += suffix; assert.equal(verifyPriorPreflight(x).runId, '123');
  }
  const wrongRef = fixture(); wrongRef.run.path += '@other';
  assert.throws(() => verifyPriorPreflight(wrongRef));
  const mutations = [x => x.runId = '456', x => x.run.repository.full_name = 'evil/fork', x => x.run.head_repository.full_name = 'evil/fork',
    x => x.run.path = 'other.yml', x => x.run.event = 'push', x => x.run.head_branch = 'other', x => x.run.head_sha = 'b'.repeat(40),
    x => x.run.actor.login = 'other', x => x.run.triggering_actor.login = 'other', x => x.run.status = 'in_progress',
    x => x.run.conclusion = 'failure', x => x.run.run_attempt = 2, x => x.artifacts.total_count = 2,
    x => x.artifacts.artifacts[0].expired = true, x => x.artifacts.artifacts[0].name = 'other',
    x => { x.artifacts.artifacts.push(x.artifacts.artifacts[0]); x.artifacts.total_count = 2; },
    x => x.report.mode = 'deploy_disabled', x => x.report.complete = false, x => x.report.writeAttempted = true,
    x => x.report.deploymentVerified = true, x => x.report.runId = '999', x => x.report.approvalHash = 'f'.repeat(64),
    x => x.report.artifact = { ...x.report.artifact, purpose: 'other' }, x => x.report.preflight.workerExists = true,
    x => x.report.preflight.databaseId = 'other', x => x.report.error = 'ERROR',
  ];
  for (const mutate of mutations) { const x = fixture(); mutate(x); assert.throws(() => verifyPriorPreflight(x)); }
  const calls = [];
  await readPreflightProvenance('synthetic-token', '123', async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({}) };
  });
  assert.equal(calls.length, 2); assert.ok(calls.every(x => x.options.method === 'GET' && x.options.redirect === 'error'));
  await assert.rejects(() => readPreflightProvenance('token', '../evil'), /PRIOR_PREFLIGHT_RUN_REQUIRED/);
});
