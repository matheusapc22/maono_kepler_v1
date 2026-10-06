import { createHash } from 'node:crypto';

export const TARGET = Object.freeze({
  repository: 'matheusapc22/maono_kepler_v1', owner: 'matheusapc22',
  sourceSha: 'fff7e4c1efdf4f3665e829a79be8a22a69c622e9',
  accountId: '09d455fa1cf988b0d9db89987b73eaff',
  worker: 'maono-project-save-operations', databaseName: 'maono_maps',
  databaseId: '5bc4dc32-f3bd-4c92-bbd1-cbda63e467db',
  cron: '* * * * *', wranglerVersion: '4.139.0',
});
export function requireCondition(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export function digest(value) { return sha256(JSON.stringify(stable(value))); }
export function assertRef(expected, actual) {
  requireCondition(/^[a-f0-9]{40}$/.test(expected) && actual === expected, 'OPERATOR_REF_DRIFT');
}
export function validateDispatch(env) {
  requireCondition(env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'MANUAL_DISPATCH_REQUIRED');
  requireCondition(env.GITHUB_REPOSITORY === TARGET.repository, 'REPOSITORY_NOT_ALLOWED');
  requireCondition(env.GITHUB_REPOSITORY_OWNER === TARGET.owner && env.GITHUB_ACTOR === TARGET.owner
    && env.GITHUB_TRIGGERING_ACTOR === TARGET.owner, 'OWNER_REQUIRED');
  requireCondition(env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_WORKFLOW_REF === `${TARGET.repository}/.github/workflows/project-save-worker-operator.yml@refs/heads/main`, 'MAIN_REQUIRED');
  requireCondition(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ''), 'INVALID_OPERATOR_SHA');
  if (env.MODE === 'preflight') {
    requireCondition(env.CONFIRMATION === 'PREPARE_PROJECT_SAVE_WORKER' && !env.APPROVAL_HASH && !env.PREFLIGHT_RUN_ID, 'INVALID_PREFLIGHT_CONFIRMATION');
  } else {
    requireCondition(env.MODE === 'deploy_disabled', 'MODE_NOT_ALLOWED');
    requireCondition(env.CONFIRMATION === 'DEPLOY_DISABLED_PROJECT_SAVE_WORKER'
      && /^[a-f0-9]{64}$/.test(env.APPROVAL_HASH || '')
      && /^[1-9][0-9]*$/.test(env.PREFLIGHT_RUN_ID || '') && env.PREFLIGHT_RUN_ID !== env.GITHUB_RUN_ID, 'INVALID_DEPLOY_CONFIRMATION');
  }
  return env.MODE;
}
export function validateManifest(manifest) {
  requireCondition(manifest.schemaVersion === 1 && manifest.repository === TARGET.repository
    && manifest.sourceSha === TARGET.sourceSha && manifest.entryPoint === 'workers/project-save-operations.js', 'SOURCE_NOT_ALLOWED');
  const files = Object.entries(manifest.files || {});
  requireCondition(files.length === 22 && manifest.files[manifest.entryPoint], 'SOURCE_CLOSURE_INCOMPLETE');
  for (const [file, hash] of files) {
    requireCondition(/^(?:workers|functions\/_lib)\/[a-z0-9-]+\.js$/.test(file)
      && /^[a-f0-9]{64}$/.test(hash), 'SOURCE_PATH_NOT_ALLOWED');
  }
}
export function config({ bundled = false } = {}) {
  return {
    name: TARGET.worker, account_id: TARGET.accountId,
    main: bundled ? 'bundle/project-save-operations.js' : 'workers/project-save-operations.js',
    compatibility_date: '2026-09-01', workers_dev: false, preview_urls: false,
    ...(bundled ? { no_bundle: true } : {}),
    triggers: { crons: [TARGET.cron] },
    vars: {
      MAONO_RUNTIME_ENV: 'production', STORAGE_DRIVER: 'dropbox',
      PROJECT_DURABLE_SAVE_WORKER_ENABLED: 'false', PROJECT_PREVIEW_PROCESSOR_ENABLED: 'false',
      PROJECT_DURABLE_SAVE_V1: 'false', PROJECT_DURABLE_SAVE_BATCH_SIZE: '10', PROJECT_PREVIEW_BATCH_SIZE: '10',
    },
    d1_databases: [{ binding: 'DB', database_name: TARGET.databaseName, database_id: TARGET.databaseId }],
  };
}
export function artifactAudit({ operatorSha, manifest, lockHash, bundleHash }) {
  requireCondition(/^[a-f0-9]{40}$/.test(operatorSha), 'INVALID_OPERATOR_SHA');
  validateManifest(manifest);
  for (const hash of [lockHash, bundleHash]) requireCondition(/^[a-f0-9]{64}$/.test(hash), 'INVALID_ARTIFACT_HASH');
  const artifact = {
    schemaVersion: 1, purpose: 'initial-disabled-worker-only', operatorSha,
    deploymentPolicy: 'one-wrangler-invocation-internal-identical-upload-retries-possible',
    sourceSha: TARGET.sourceSha, manifestHash: digest(manifest), toolchainLockHash: lockHash,
    bundleHash, configHash: digest(config({ bundled: true })),
    target: TARGET, prerequisite: 'worker-absent-and-d1-identity-verified',
  };
  return { artifact, approvalHash: digest(artifact) };
}
export function verifyBootstrapTarget(database, scripts, resultInfo) {
  requireCondition(database?.uuid === TARGET.databaseId && database?.name === TARGET.databaseName, 'D1_IDENTITY_MISMATCH');
  requireCondition(Array.isArray(scripts) && scripts.every(script => typeof script.id === 'string'), 'INVALID_WORKER_LIST');
  requireCondition(!resultInfo?.cursor && !resultInfo?.cursors?.after
    && !(resultInfo?.total_count > scripts.length) && !(resultInfo?.total_pages > 1), 'INCOMPLETE_WORKER_LIST');
  requireCondition(!scripts.some(script => script.id === TARGET.worker), 'WORKER_ALREADY_EXISTS_STOP');
  return { databaseName: database.name, databaseId: database.uuid, workerExists: false };
}
export function verifyDeployedSettings(settings, schedules, deployments, subdomain) {
  const expected = config(), bindings = settings?.bindings;
  requireCondition(Array.isArray(bindings) && bindings.length === Object.keys(expected.vars).length + 1, 'UNEXPECTED_BINDINGS');
  for (const [name, text] of Object.entries(expected.vars)) {
    requireCondition(bindings.filter(b => b.name === name && b.type === 'plain_text' && b.text === text).length === 1, 'DISABLED_VARS_NOT_VERIFIED');
  }
  requireCondition(bindings.filter(b => b.name === 'DB' && b.type === 'd1'
    && (b.database_id ?? b.id) === TARGET.databaseId && (b.id === undefined || b.id === TARGET.databaseId)).length === 1, 'DEPLOYED_D1_MISMATCH');
  requireCondition(settings.compatibility_date === expected.compatibility_date, 'COMPATIBILITY_DATE_MISMATCH');
  requireCondition(Array.isArray(schedules?.schedules) && schedules.schedules.length === 1
    && schedules.schedules[0].cron === TARGET.cron, 'CRON_NOT_VERIFIED');
  requireCondition(subdomain?.enabled === false && subdomain?.previews_enabled === false, 'PUBLIC_ROUTES_NOT_DISABLED');
  const latest = deployments?.deployments?.[0];
  requireCondition(typeof latest?.id === 'string' && latest.versions?.length === 1
    && latest.versions[0].percentage === 100 && typeof latest.versions[0].version_id === 'string', 'DEPLOYMENT_NOT_VERIFIED');
  return { deploymentId: latest.id, versionId: latest.versions[0].version_id, processors: 'disabled', cron: TARGET.cron,
    databaseId: TARGET.databaseId, workersDev: false, previewUrls: false };
}
export function apiReader(token, fetchImpl = fetch) {
  requireCondition(typeof token === 'string' && token.length > 0, 'PROTECTED_TOKEN_MISSING');
  const paths = new Set([
    `/d1/database/${TARGET.databaseId}`, '/workers/scripts',
    ...['settings', 'schedules', 'deployments', 'subdomain'].map(suffix => `/workers/scripts/${TARGET.worker}/${suffix}`),
  ]);
  return async function read(path) {
    requireCondition(paths.has(path), 'API_PATH_NOT_ALLOWED');
    let response;
    try {
      response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${TARGET.accountId}${path}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000),
      });
    } catch { throw new Error('CLOUDFLARE_READ_FAILED'); }
    let body;
    try { body = await response.json(); } catch { throw new Error('INVALID_CLOUDFLARE_RESPONSE'); }
    requireCondition(response.ok && body?.success === true, 'CLOUDFLARE_READ_REJECTED');
    return body;
  };
}

export function verifyEnvironment(environment, branches) {
  requireCondition(environment?.name === 'production-project-save-worker', 'PROTECTED_ENVIRONMENT_MISSING');
  const reviewers = environment.protection_rules?.filter(rule => rule.type === 'required_reviewers');
  requireCondition(reviewers?.length === 1 && reviewers[0].reviewers?.length === 1
    && reviewers[0].reviewers[0].type === 'User' && reviewers[0].reviewers[0].reviewer?.login === TARGET.owner,
    'OWNER_REVIEW_GATE_REQUIRED');
  requireCondition(environment.deployment_branch_policy?.custom_branch_policies === true
    && environment.deployment_branch_policy?.protected_branches === false
    && branches?.total_count === 1 && branches.branch_policies?.length === 1
    && branches.branch_policies[0].name === 'main' && branches.branch_policies[0].type === 'branch', 'MAIN_ENVIRONMENT_POLICY_REQUIRED');
}
export async function checkEnvironment(token, fetchImpl = fetch) {
  requireCondition(typeof token === 'string' && token.length > 0, 'GITHUB_READ_TOKEN_MISSING');
  const base = `https://api.github.com/repos/${TARGET.repository}/environments/production-project-save-worker`;
  const results = [];
  for (const suffix of ['', '/deployment-branch-policies?per_page=100']) {
    let response;
    try { response = await fetchImpl(base + suffix, { method: 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000) }); } catch { throw new Error('GITHUB_ENVIRONMENT_READ_FAILED'); }
    requireCondition(response.ok, 'GITHUB_ENVIRONMENT_READ_REJECTED');
    results.push(await response.json());
  }
  verifyEnvironment(...results);
}

export function verifyPriorPreflight({ run, artifacts, report, runId, currentRunId, currentAudit }) {
  requireCondition(/^[1-9][0-9]*$/.test(runId || '') && runId !== currentRunId, 'PRIOR_PREFLIGHT_RUN_REQUIRED');
  requireCondition(String(run?.id) === runId && run.repository?.full_name === TARGET.repository
    && run.head_repository?.full_name === TARGET.repository
    && ['.github/workflows/project-save-worker-operator.yml',
      '.github/workflows/project-save-worker-operator.yml@main',
      '.github/workflows/project-save-worker-operator.yml@refs/heads/main'].includes(run.path)
    && run.event === 'workflow_dispatch' && run.head_branch === 'main'
    && run.head_sha === currentAudit.artifact.operatorSha
    && run.actor?.login === TARGET.owner && run.triggering_actor?.login === TARGET.owner
    && run.status === 'completed' && run.conclusion === 'success', 'PREFLIGHT_RUN_PROVENANCE_INVALID');
  requireCondition(Array.isArray(artifacts?.artifacts) && artifacts.total_count === artifacts.artifacts.length, 'INCOMPLETE_PREFLIGHT_ARTIFACT_LIST');
  const matches = artifacts.artifacts.filter(a => a.name === `project-save-worker-preflight-${runId}`);
  requireCondition(matches.length === 1 && matches[0].expired === false
    && String(matches[0].workflow_run?.id) === runId
    && matches[0].workflow_run?.head_sha === currentAudit.artifact.operatorSha, 'PREFLIGHT_ARTIFACT_INVALID');
  requireCondition(report?.mode === 'preflight' && report.complete === true && report.writeAttempted === false
    && report.deploymentVerified === false && report.runId === runId
    && report.runAttempt === String(run.run_attempt)
    && report.approvalHash === currentAudit.approvalHash
    && digest(report.artifact) === digest(currentAudit.artifact)
    && report.preflight?.databaseName === TARGET.databaseName && report.preflight?.databaseId === TARGET.databaseId
    && report.preflight?.workerExists === false && !report.error, 'PREFLIGHT_REPORT_INVALID');
  return { runId, runAttempt: report.runAttempt, artifactId: matches[0].id };
}
export async function readPreflightProvenance(token, runId, fetchImpl = fetch) {
  requireCondition(typeof token === 'string' && token.length > 0, 'GITHUB_READ_TOKEN_MISSING');
  requireCondition(/^[1-9][0-9]*$/.test(runId || ''), 'PRIOR_PREFLIGHT_RUN_REQUIRED');
  const base = `https://api.github.com/repos/${TARGET.repository}/actions/runs/${runId}`;
  const results = [];
  for (const suffix of ['', '/artifacts?per_page=100']) {
    let response;
    try { response = await fetchImpl(base + suffix, { method: 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000) }); } catch { throw new Error('PREFLIGHT_PROVENANCE_READ_FAILED'); }
    requireCondition(response.ok, 'PREFLIGHT_PROVENANCE_READ_REJECTED');
    results.push(await response.json());
  }
  return { run: results[0], artifacts: results[1] };
}
