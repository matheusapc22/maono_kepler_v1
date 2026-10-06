import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TARGET, requireCondition, sha256, digest, assertRef, validateDispatch, validateManifest, config,
  artifactAudit, verifyBootstrapTarget, verifyDeployedSettings, apiReader, checkEnvironment, verifyPriorPreflight, readPreflightProvenance } from './operator-lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(root, '.tmp/project-save-worker');
const sourceRoot = path.join(root, '.tmp/project-save-worker-source');
const toolsRoot = path.join(root, 'scripts/project-save-worker');
const manifest = JSON.parse(fs.readFileSync(path.join(toolsRoot, 'source-manifest.json'), 'utf8'));
const wrangler = path.join(toolsRoot, 'node_modules/wrangler/bin/wrangler.js');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function assertCleanOperator() {
  requireCondition(git(['status', '--porcelain', '--untracked-files=no']) === '', 'OPERATOR_WORKTREE_DIRTY');
  assertRef(process.env.GITHUB_SHA, git(['rev-parse', 'HEAD']));
}
function audit() {
  requireCondition(digest(JSON.parse(fs.readFileSync(path.join(work, 'wrangler.deploy.json'), 'utf8'))) === digest(config({ bundled: true })), 'DEPLOY_CONFIG_CHANGED');
  return artifactAudit({ operatorSha: process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']), manifest,
    lockHash: sha256(fs.readFileSync(path.join(toolsRoot, 'package-lock.json'))),
    bundleHash: sha256(fs.readFileSync(path.join(work, 'bundle/project-save-operations.js'))) });
}
function safeWranglerEnv(token) {
  // Do not inherit .env values, arbitrary CF destinations, proxy settings, or other secrets.
  return Object.fromEntries(Object.entries({ PATH: process.env.PATH, HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR, CI: 'true', WRANGLER_SEND_METRICS: 'false',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_ACCOUNT_ID: TARGET.accountId,
    CLOUDFLARE_API_TOKEN: token }).filter(([, value]) => value !== undefined));
}
async function prepare() {
  validateManifest(manifest);
  assertRef(TARGET.sourceSha, git(['rev-parse', 'HEAD'], sourceRoot));
  // Read immutable Git objects, not a working tree or package scripts from the product branch.
  fs.rmSync(work, { recursive: true, force: true });
  for (const [file, hash] of Object.entries(manifest.files)) {
    const bytes = execFileSync('git', ['show', `${TARGET.sourceSha}:${file}`], { cwd: sourceRoot });
    requireCondition(sha256(bytes) === hash, 'SOURCE_HASH_MISMATCH');
    const destination = path.join(work, 'source', file);
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes);
  }
  writeJSON(path.join(work, 'source/package.json'), { private: true, type: 'module' });
  writeJSON(path.join(work, 'source/wrangler.json'), config());
  writeJSON(path.join(work, 'wrangler.deploy.json'), config({ bundled: true }));
}
async function bundle() {
  const result = spawnSync(process.execPath, [wrangler, 'deploy', '--dry-run', '--config', 'source/wrangler.json', '--outdir', '../bundle'], {
    cwd: work, env: safeWranglerEnv(), encoding: 'utf8', timeout: 120000,
  });
  requireCondition(result.status === 0, 'WRANGLER_DRY_RUN_FAILED');
  const uploadCheck = spawnSync(process.execPath, [wrangler, 'deploy', '--dry-run', '--config', 'wrangler.deploy.json', '--no-bundle', '--outdir', 'upload-check'], {
    cwd: work, env: safeWranglerEnv(), encoding: 'utf8', timeout: 120000,
  });
  requireCondition(uploadCheck.status === 0, 'WRANGLER_NO_BUNDLE_DRY_RUN_FAILED');
  // Ensure dynamic local imports were bundled, and test the real artifact with denied DB/network access.
  const artifact = await import(pathToFileURL(path.join(work, 'bundle/project-save-operations.js')).href);
  const beforeFetch = globalThis.fetch; let networkCalls = 0; let dbCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('UNEXPECTED_NETWORK_ACCESS'); };
  const env = { ...config().vars, DB: new Proxy({}, { get() { dbCalls++; throw new Error('UNEXPECTED_DB_ACCESS'); } }) };
  try {
    let completion;
    await artifact.default.scheduled({}, env, { waitUntil(promise) { completion = promise; } });
    const results = await completion;
    requireCondition(results?.length === 2 && results.every(r => r.status === 'fulfilled' && r.value.disabled === true)
      && networkCalls === 0 && dbCalls === 0, 'SAFE_OFF_RUNTIME_FAILED');
    requireCondition((await artifact.default.fetch()).status === 404, 'HTTP_HANDLER_NOT_CLOSED');
  } finally { globalThis.fetch = beforeFetch; }
  writeJSON(path.join(work, 'artifact-audit.json'), audit());
  console.log('Pinned Worker bundled; both disabled processors made zero DB/network calls.');
}
async function priorPreflight(currentAudit = audit()) {
  const provenance = await readPreflightProvenance(process.env.GITHUB_READ_TOKEN, process.env.PREFLIGHT_RUN_ID);
  const report = JSON.parse(fs.readFileSync(path.join(root, '.tmp/prior-project-save-worker/report.json'), 'utf8'));
  return verifyPriorPreflight({ ...provenance, report, runId: process.env.PREFLIGHT_RUN_ID,
    currentRunId: process.env.GITHUB_RUN_ID, currentAudit });
}
async function protectedOperation() {
  const mode = validateDispatch(process.env);
  assertCleanOperator();
  await checkEnvironment(process.env.GITHUB_READ_TOKEN);
  assertRef(process.env.GITHUB_SHA, git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0]);
  const current = audit();
  requireCondition(current.approvalHash === process.env.VALIDATED_ARTIFACT_HASH, 'VALIDATED_ARTIFACT_DRIFT');
  if (mode === 'deploy_disabled') requireCondition(current.approvalHash === process.env.APPROVAL_HASH, 'APPROVAL_HASH_MISMATCH');
  const prior = mode === 'deploy_disabled' ? await priorPreflight(current) : null;
  const read = apiReader(process.env.CLOUDFLARE_API_TOKEN);
  const report = { mode, ...current, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, priorPreflight: prior, writeAttempted: false, deploymentVerified: false, complete: false };
  const persist = () => writeJSON(path.join(work, 'report.json'), report);
  try {
    const database = await read(`/d1/database/${TARGET.databaseId}`);
    const scripts = await read('/workers/scripts');
    report.preflight = verifyBootstrapTarget(database.result, scripts.result, scripts.result_info);
    if (mode === 'preflight') {
      report.complete = true; persist();
      console.log(`Preflight passed without writes. Approval hash: ${current.approvalHash}`);
      return;
    }
    // Recheck immediately before the one CLI invocation. Pinned Wrangler may retry internally;
    // the operator never re-invokes it after an uncertain result.
    assertRef(process.env.GITHUB_SHA, git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0]);
    requireCondition(audit().approvalHash === current.approvalHash, 'ARTIFACT_CHANGED_BEFORE_WRITE');
    report.writeAttempted = true; persist();
    const result = spawnSync(process.execPath, [wrangler, 'deploy', '--config', 'wrangler.deploy.json', '--no-bundle'], {
      cwd: work, env: safeWranglerEnv(process.env.CLOUDFLARE_API_TOKEN), encoding: 'utf8', timeout: 180000,
    });
    // Never persist raw CLI output or API bodies. A failure may be a partial write: stop and inspect read-only.
    requireCondition(result.status === 0, 'DEPLOY_OUTCOME_UNCERTAIN_STOP');
    const prefix = `/workers/scripts/${TARGET.worker}`;
    const settings = await read(`${prefix}/settings`);
    const schedules = await read(`${prefix}/schedules`);
    const deployments = await read(`${prefix}/deployments`);
    const subdomain = await read(`${prefix}/subdomain`);
    report.deployment = verifyDeployedSettings(settings.result, schedules.result, deployments.result, subdomain.result);
    report.deploymentVerified = true; report.complete = true; persist();
    console.log(`Disabled Worker deployed and verified. Version: ${report.deployment.versionId}`);
  } catch (error) {
    report.error = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'OPERATOR_FAILED'; persist();
    throw new Error(report.error);
  }
}
const commands = { prepare, bundle, protected: protectedOperation, 'validate-dispatch': () => validateDispatch(process.env),
  'check-environment': () => checkEnvironment(process.env.GITHUB_READ_TOKEN),
  'verify-prior-preflight': () => priorPreflight(),
  'artifact-hash': () => console.log(audit().approvalHash) };
try {
  requireCondition(process.argv.length === 3 && Object.hasOwn(commands, process.argv[2]), 'COMMAND_NOT_ALLOWED');
  await commands[process.argv[2]]();
} catch (error) {
  console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'OPERATOR_FAILED'); process.exitCode = 1;
}
