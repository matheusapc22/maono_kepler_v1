import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { manifest, verifyPreflight, boundedBrowserOwner, withBrowserDeadline } from '../scripts/acceptance/suites/durable-project-preview.mjs';
import { allowedBrowserMutation, verifySaveReceipt, verifyPreviewReceipt, revocableBrowserScope } from '../scripts/acceptance/preview-browser.mjs';
import { makeManifest } from '../scripts/acceptance/suites/durable-project-save.mjs';
import { validateManifest, safeFlags, activeFlags, suiteContext } from '../scripts/acceptance/production-acceptance-lib.mjs';
import { publicManifest } from '../scripts/acceptance/registry.mjs';
import { createExecutionBudget, totalBudgetMs } from '../scripts/acceptance/execution-budget.mjs';

const prerequisiteNames = ['VITE_MAONO_MAP_SHELL_V1', 'VITE_MAONO_LAYER_MANAGER_V1', 'VITE_MAONO_MAP_OVERLAY_V1', 'VITE_ASYNC_PROJECT_THUMBNAIL'];
const prerequisites = () => Object.fromEntries(prerequisiteNames.map(name => [name, { type: 'plain_text', value: 'true' }]));
const projectConfig = (configured = prerequisites(), canonical = prerequisites()) => ({ raw: {
  deployment_configs: { production: { env_vars: configured } }, canonical_deployment: { env_vars: canonical },
} });

test('real PNG suite is browser-required, QA9-scoped and declares every temporary flag with safe OFF', () => {
  assert.doesNotThrow(() => validateManifest(manifest));
  assert.equal(publicManifest('durable-project-preview').requiresBrowser, true);
  assert.deepEqual(manifest.requiredOrganization, { id: 9, slug: 'maono-preview-qa' });
  assert.deepEqual(activeFlags(manifest), { PROJECT_DURABLE_SAVE_V1: true, PROJECT_DURABLE_SAVE_INLINE_ENABLED: false,
    PROJECT_PREVIEW_OPERATIONS_V1: true, PROJECT_PREVIEW_PROCESSOR_ENABLED: true, VITE_PROJECT_PREVIEW_OPERATIONS_V1: true });
  assert.deepEqual(safeFlags(manifest), { PROJECT_DURABLE_SAVE_V1: false, PROJECT_DURABLE_SAVE_INLINE_ENABLED: true,
    PROJECT_PREVIEW_OPERATIONS_V1: false, PROJECT_PREVIEW_PROCESSOR_ENABLED: false, VITE_PROJECT_PREVIEW_OPERATIONS_V1: false });
  assert.equal(totalBudgetMs(manifest), 190 * 60_000);
  for (const name of ['PROJECT_PREVIEW_WORKER_ENABLED', 'VITE_ASYNC_PROJECT_THUMBNAIL', 'PROJECT_QUOTA_RESERVATION_V1', 'VITE_ARBITRARY']) {
    assert.throws(() => validateManifest({ ...manifest, managedFlags: { [name]: { requiredBefore: false, activeValue: true, safeValue: false } } }), { code: 'MANIFEST_INVALID' });
  }
  assert.throws(() => validateManifest({ ...manifest, id: 'unregistered-preview' }), { code: 'MANIFEST_INVALID' });
});

test('preflight refuses missing frontend prerequisites, quota uncertainty and existing project input before flag writes', () => {
  const options = { organizationId: 9 };
  assert.doesNotThrow(() => verifyPreflight(projectConfig(), options));
  for (const name of prerequisiteNames) {
    for (const value of [undefined, { type: 'plain_text', value: 'false' }, { type: 'secret_text', value: 'true' }]) {
      const flags = { ...prerequisites(), [name]: value };
      assert.throws(() => verifyPreflight(projectConfig(flags), options), { code: 'PNG_PREREQUISITE_UNVERIFIED' });
      assert.throws(() => verifyPreflight(projectConfig(prerequisites(), flags), options), { code: 'PNG_PREREQUISITE_UNVERIFIED' });
    }
  }
  assert.throws(() => verifyPreflight(projectConfig(), { ...options, projectSlug: 'real-project' }), { code: 'QA_ORGANIZATION_MISMATCH' });
  assert.throws(() => verifyPreflight(projectConfig(), { organizationId: 8 }), { code: 'QA_ORGANIZATION_MISMATCH' });
  assert.throws(() => verifyPreflight(projectConfig({ ...prerequisites(), PROJECT_QUOTA_RESERVATION_V1: { type: 'plain_text', value: 'true' } }), options), { code: 'QUOTA_CLEANUP_UNSUPPORTED' });
});

test('browser mutation admission is restricted to its synthetic project and known numerical telemetry', () => {
  const base = 'https://maono.test', project = { slug: 'qa-durable-run-small' };
  for (const [method, path] of [['POST', '/save-operations'], ['PUT', '/save-operations/save_123/payload'], ['POST', '/thumbnail'], ['PUT', '/thumbnail?operationId=pv2:123'], ['PATCH', '/thumbnail']]) {
    assert.equal(allowedBrowserMutation(`${base}/api/projects/${project.slug}${path}`, method, base, project), true);
  }
  for (const url of [`${base}/api/projects`, `${base}/api/admin/projects/1`, `${base}/api/projects/real/thumbnail`, `${base}/api/projects/${project.slug}/thumbnail/extra`, 'https://external.invalid/api/projects/qa-durable-run-small/thumbnail']) {
    assert.equal(allowedBrowserMutation(url, 'POST', base, project), false);
  }
  assert.equal(allowedBrowserMutation(`${base}/api/projects/${project.slug}/thumbnail`, 'DELETE', base, project), false);
});

test('receipt evidence checks scope, revision, JSON bytes and every captured PNG manifest field', () => {
  const body = Buffer.from('{"version":"v1","config":{},"datasets":[]}');
  const input = makeManifest(body.toString(), 'save_123456789', 1, 'update');
  const project = { id: 101 }, saved = { operationId: input.operationId, organizationId: 9, projectId: 101, baseRevision: 1, publishedRevision: 2,
    checksum: input.contentHash, checksumAlgorithm: 'dropbox-content-hash', sizeBytes: body.length, committedAt: '2026-10-06T00:00:00Z' };
  assert.doesNotThrow(() => verifySaveReceipt(saved, input, project, 9, body));
  for (const bad of [{ ...saved, projectId: 102 }, { ...saved, checksum: 'f'.repeat(64) }, { ...saved, baseRevision: 0 }]) {
    assert.throws(() => verifySaveReceipt(bad, input, project, 9, body));
  }
  const png = { operationId: 'pv2:123456789', saveOperationId: saved.operationId, revision: 2, configChecksum: saved.checksum, organizationId: '9', projectId: '101',
    editorSessionId: 'editor-123456789', editGeneration: 0, rendererVersion: 'maono-png-v2', captureMethod: 'canvas-composite', imageChecksum: 'b'.repeat(64), sizeBytes: 100 };
  const receipt = { ...png, artifactId: 'artifact-id', committedAt: saved.committedAt };
  assert.doesNotThrow(() => verifyPreviewReceipt(receipt, png, saved, project, 9));
  for (const key of Object.keys(png)) assert.throws(() => verifyPreviewReceipt({ ...receipt, [key]: null }, png, saved, project, 9));
  assert.doesNotThrow(() => verifyPreviewReceipt({ ...receipt, captureMethod: 'html2canvas' }, { ...png, captureMethod: 'html2canvas' }, saved, project, 9));
  for (const captureMethod of ['generated-technical-preview', 'canvas', '', null]) {
    assert.throws(() => verifyPreviewReceipt({ ...receipt, captureMethod }, { ...png, captureMethod }, saved, project, 9));
  }
});

test('browser owner closes exactly once on success and failure and cannot consume closure reserve indefinitely', async () => {
  let closes = 0;
  const owner = boundedBrowserOwner({ close: async () => { closes++; } });
  assert.equal(await withBrowserDeadline(owner, 100, async () => 'done'), 'done');
  await owner.close();
  assert.equal(closes, 1); assert.equal(owner.closed, true);
  const failed = boundedBrowserOwner({ close: async () => { closes++; } });
  await assert.rejects(() => withBrowserDeadline(failed, 100, async () => { throw new Error('local failure'); }), /local failure/);
  assert.equal(failed.closed, true);
  const timeout = boundedBrowserOwner({ close: async () => {} });
  await assert.rejects(() => withBrowserDeadline(timeout, 1, () => new Promise(() => {})), { code: 'PNG_BROWSER_TIMEOUT' });
  assert.equal(timeout.closed, true);
  const stuck = boundedBrowserOwner({ close: () => new Promise(() => {}) }, 2);
  await assert.rejects(() => withBrowserDeadline(stuck, 1, () => new Promise(() => {})), { code: 'PNG_BROWSER_CLOSURE_UNVERIFIED' });
  assert.equal(stuck.closed, false, 'unknown browser closure must block synthetic cleanup, while operator can restore flags');
});

test('browser requests share the phase deadline and cannot begin mutations after it', () => {
  let now = 0;
  const budget = createExecutionBudget(manifest, { now: () => now }); budget.enter('preflight'); budget.enter('activation'); budget.enter('suite');
  const ctx = suiteContext({ baseUrl: 'https://maono.test', organizationId: 9, profiles: {}, deps: { budget } });
  assert.equal(ctx.requestTimeoutMs(60_000), 60_000);
  now = budget.phaseDeadline;
  assert.throws(() => ctx.assertAdmission(), { code: 'ACCEPTANCE_PHASE_TIMEOUT' });
  assert.throws(() => ctx.requestTimeoutMs(60_000), { code: 'ACCEPTANCE_PHASE_TIMEOUT' });
});

test('fixtures and CI contain no live credentials, dispatch, real service writes or public PNG uploads', async () => {
  const fixture = await readFile(new URL('../scripts/acceptance/fixtures/preview-points.kepler.json', import.meta.url), 'utf8');
  const map = JSON.parse(fixture);
  assert.equal(map.datasets.length, 1); assert.equal(map.datasets[0].data.allData.length, 3);
  assert.ok(Buffer.byteLength(fixture) < 64 * 1024);
  const { normalizeProjectSaveManifest } = await import('../functions/_lib/project-save-operations.js');
  const { validateProjectSavePayloadStream } = await import('../functions/_lib/project-save-operation-payload.js');
  const seedManifest = { ...makeManifest(fixture, 'qa-preview:fixture-proof', 0, 'create'), datasetCount: 1 };
  const verified = await validateProjectSavePayloadStream(new Blob([fixture]).stream(), normalizeProjectSaveManifest(seedManifest));
  assert.equal(verified.datasetCount, 1); assert.equal(verified.checksum, seedManifest.contentHash);
  assert.doesNotMatch(fixture, /https?:|accessToken|password|email/i);
  const workflow = await readFile(new URL('../.github/workflows/acceptance-preview-validation.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:|secrets\.|environment: production|--mode run/);
  const source = await readFile(new URL('../scripts/acceptance/suites/durable-project-preview.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.screenshot\(|recordVideo|\.tracing\.|writeFile|\.fulfill\(/);
  assert.match(source, /beforeCleanup:[\s\S]*?owner\.closed/);
});


test('revoking browser scope blocks helper writes after an in-flight request resumes', async () => {
  let resolve, calls = 0;
  const pending = new Promise(done => { resolve = done; });
  const { scope, stop, drain } = revocableBrowserScope({ api: async () => { calls++; return pending; }, assertAdmission() {}, requestTimeoutMs: ms => ms, pause: async () => {} });
  const request = scope.api('creator', '/synthetic', { method: 'POST' });
  const rejected = assert.rejects(request, { code: 'PNG_BROWSER_SCOPE_CLOSED' });
  stop();
  await assert.rejects(() => scope.api('creator', '/synthetic', { method: 'POST' }), { code: 'PNG_BROWSER_SCOPE_CLOSED' });
  assert.throws(() => scope.assertAdmission(), { code: 'PNG_BROWSER_SCOPE_CLOSED' });
  await assert.rejects(() => drain(1), { code: 'PNG_BROWSER_REQUESTS_UNVERIFIED' });
  resolve({ status: 201 });
  await rejected; await drain(1);
  assert.equal(calls, 1);
});


test('scenario cannot return PASS after its deadline while browser close is still settling', async () => {
  const owner = boundedBrowserOwner({ close: () => new Promise(resolve => setTimeout(resolve, 15)) });
  await assert.rejects(() => withBrowserDeadline(owner, 1, () => new Promise(resolve => setTimeout(() => resolve('too late'), 5))), { code: 'PNG_BROWSER_TIMEOUT' });
  assert.equal(owner.closed, true);
});
