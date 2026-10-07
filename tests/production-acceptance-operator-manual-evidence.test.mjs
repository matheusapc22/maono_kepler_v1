import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { validateBeforeEvidence, parseManualBundle, createManualAdministration, evidenceDigest, verifyManualCleanup, manualFunctionalCases, MANUAL_ORIGIN } from '../scripts/acceptance/manual-evidence.mjs';
const sha = 'a'.repeat(40), runId = '11111111-1111-4111-8111-111111111111';
const now = Date.now();
function before(suite = 'durable-project-save') {
  return { schemaVersion: 1, kind: 'qa-before-inventory', suite, expectedCommit: sha, runId, workflowRunId: '123456789', workflowRunAttempt: 1, administratorUserId: 12,
    origin: MANUAL_ORIGIN, organization: { id: 9, slug: 'maono-preview-qa', active: true },
    capturedAt: new Date(now - 120_000).toISOString(), inventory: { projects: [], files: [] } };
}
const options = { suite: 'durable-project-save', expectedCommit: sha, now, workflowRunId: '123456789', workflowRunAttempt: 1 };
function fixture(suite = 'durable-project-save') {
  const m = createManualAdministration(before(suite), 11);
  m.resources = (suite === 'durable-project-save' ? ['small', 'large'] : ['small']).map((kind, i) => ({ kind, name: `QA Durable ${runId} ${kind}`,
    projectId: i + 101, slug: `qa-durable-${runId}-${kind}`, organizationFileId: null, reservationStarted: true, reservationUncertain: false }));
  const flags = { PROJECT_DURABLE_SAVE_V1: false, PROJECT_DURABLE_SAVE_INLINE_ENABLED: true,
    ...(suite === 'durable-project-preview' ? { PROJECT_PREVIEW_OPERATIONS_V1: false, PROJECT_PREVIEW_PROCESSOR_ENABLED: false, VITE_PROJECT_PREVIEW_OPERATIONS_V1: false } : {}) };
  const observed = Object.fromEntries(Object.entries(flags).map(([name, value]) => [name, { state: 'observed', value }]));
  const report = { mode: 'run', suite, expectedCommit: sha, runId, workflowRunId: '123456789', workflowRunAttempt: 1, organizationId: 9, acceptanceExecuted: true, configurationRestored: true,
    cleanupComplete: false, complete: false, ok: false, operationalTestsPassed: true, acceptanceIncomplete: true, acceptanceStatus: 'PENDING_MANUAL_CLEANUP',
    finishedAt: new Date(now - 60_000).toISOString(), manualAdministration: m,
    error: { code: 'MANUAL_CLEANUP_REQUIRED' }, cleanupErrors: [{ code: 'MANUAL_CLEANUP_REQUIRED' }],
    cases: manualFunctionalCases(suite).map(id => ({ id, status: 'PASS' })),
    final: { databaseId: '5bc4dc32-f3bd-4c92-bbd1-cbda63e467db', baseUrl: MANUAL_ORIGIN, configuredFlags: observed,
      canonical: { commit: sha, commitDirty: false, status: 'success', flags: structuredClone(observed) } } };
  const binding = { schemaVersion: 1, suite, expectedCommit: sha, runId, organizationId: 9, creatorUserId: 11, administratorUserId: 12,
    origin: MANUAL_ORIGIN, reportDigest: evidenceDigest(report) };
  const inspection = { ...binding, kind: 'qa-cleanup-inspection', capturedAt: new Date(now - 45_000).toISOString(),
    resources: m.resources.map((r, i) => ({ kind: r.kind, name: r.name, projectId: r.projectId, slug: r.slug,
      organizationFileId: 201 + i, organizationId: 9, createdById: 11 })) };
  const files = inspection.resources.map(r => ({ id: r.organizationFileId, name: r.name, organizationId: 9, active: false, isProject: false, linkedProjectId: null }));
  const evidence = { ...binding, kind: 'qa-after-cleanup', capturedAt: new Date(now - 30_000).toISOString(), inspection,
    observations: inspection.resources.map((r, i) => ({ projectId: r.projectId, projectStatus: 404, file: { ...files[i] } })), inventory: { projects: [], files } };
  return { report, evidence };
}
function rebind(f) { f.evidence.reportDigest = f.evidence.inspection.reportDigest = evidenceDigest(f.report); return f; }

test('manual before evidence is fresh, scoped, normalized and credential-free', () => {
  const raw = before();
  const bundle = JSON.stringify({ creator: { email: 'qa@example.test', password: 'SECRET_SENTINEL' }, manualInventory: raw });
  assert.deepEqual(parseManualBundle(bundle, options), raw);
  assert.doesNotMatch(JSON.stringify(parseManualBundle(bundle, options)), /SECRET_SENTINEL|qa@example/);
  assert.throws(() => parseManualBundle(JSON.stringify({ creator: {}, administrator: {}, manualInventory: raw }), options));
  assert.throws(() => parseManualBundle('{SECRET_SENTINEL', options), error => !String(error).includes('SECRET_SENTINEL'));
  assert.throws(() => createManualAdministration(raw, 12), { code: 'QA_IDENTITIES_NOT_DISTINCT' });
});
for (const [label, change] of Object.entries({
  stale: b => { b.capturedAt = new Date(now - 16 * 60_000).toISOString(); },
  future: b => { b.capturedAt = new Date(now + 61_000).toISOString(); },
  sha: b => { b.expectedCommit = 'b'.repeat(40); },
  suite: b => { b.suite = 'durable-project-preview'; },
  org: b => { b.organization.id = 10; },
  inactive: b => { b.organization.active = false; },
  slug: b => { b.organization.slug = 'unrelated'; },
  origin: b => { b.origin = 'https://example.test'; },
  workflow: b => { b.workflowRunId = '987654321'; },
  repeat: b => { b.workflowRunAttempt = 2; },
  uuid: b => { b.runId = '../../project'; },
  admin: b => { b.administratorUserId = null; },
  inventory: b => { delete b.inventory.files; },
  live: b => { b.inventory.files.push({ id: 77, name: 'QA Durable old run', organizationId: 9, active: true, isProject: false, linkedProjectId: null }); },
  collision: b => { b.inventory.files.push({ id: 77, name: `QA Durable ${runId} small`, organizationId: 9, active: false, isProject: false, linkedProjectId: null }); },
})) test(`before inventory rejects ${label} before writes`, () => { const b = before(); change(b); assert.throws(() => validateBeforeEvidence(b, options)); });

test('legacy synthetic tombstones remain harmless while foreign or duplicate rows fail closed', () => {
  const b = before(); b.inventory.files.push({ id: 77, name: 'QA Durable previous run', organizationId: 9, active: false, isProject: false, linkedProjectId: null });
  assert.equal(validateBeforeEvidence(b, options).inventory.files.length, 1);
  b.inventory.files.push({ ...b.inventory.files[0] }); assert.throws(() => validateBeforeEvidence(b, options));
  b.inventory.files.pop(); b.inventory.files[0].organizationId = 10; assert.throws(() => validateBeforeEvidence(b, options));
});
for (const suite of ['durable-project-save', 'durable-project-preview']) test(`verified ${suite} cleanup yields separate certificate without changing original report`, () => {
  const { report, evidence } = fixture(suite), original = JSON.stringify(report);
  const certificate = verifyManualCleanup(report, evidence, { now });
  assert.equal(certificate.complete, true); assert.equal(certificate.cleanupComplete, true); assert.equal(certificate.operationalTestsPassed, true);
  assert.equal(certificate.reportDigest, evidenceDigest(report)); assert.equal(certificate.evidenceDigest, evidenceDigest(evidence));
  assert.equal(JSON.stringify(report), original); assert.equal(report.complete, false);
});
for (const [label, change] of Object.entries({
  checkbox: f => { f.evidence = { cleanupComplete: true }; },
  wrongWorkflow: f => { f.report.workflowRunId = '987654321'; rebind(f); },
  repeatedWorkflow: f => { f.report.workflowRunAttempt = 2; rebind(f); },
  reportDigest: f => { f.report.cases[0].duration = 99; },
  uncertainReservation: f => { f.report.manualAdministration.resources[0].reservationUncertain = true; rebind(f); },
  closureFailure: f => { f.report.cleanupErrors = [{ code: 'BROWSER_CLOSE_UNVERIFIED' }]; rebind(f); },
  noClosure: f => { f.report.cleanupErrors = []; rebind(f); },
  nonRestored: f => { f.report.configurationRestored = false; rebind(f); },
  unknownFlags: f => { f.report.final.configuredFlags.PROJECT_DURABLE_SAVE_V1.state = 'unknown'; rebind(f); },
  activeFlag: f => { f.report.final.canonical.flags.PROJECT_DURABLE_SAVE_V1.value = true; rebind(f); },
  wrongFinalSha: f => { f.report.final.canonical.commit = 'b'.repeat(40); rebind(f); },
  differentOrg: f => { f.evidence.organizationId = 10; },
  missingInspection: f => { delete f.evidence.inspection; },
  wrongCreator: f => { f.evidence.inspection.resources[0].createdById = 999; },
  wrongProject: f => { f.evidence.inspection.resources[0].projectId = 999; },
  wrongFile: f => { f.evidence.observations[0].file.id = 999; },
  duplicateFile: f => { f.evidence.inspection.resources[1].organizationFileId = 201; },
  wrongName: f => { f.evidence.observations[0].file.name = 'real project'; },
  liveProject: f => { f.evidence.observations[0].projectStatus = 200; },
  liveFile: f => { f.evidence.observations[0].file.active = true; },
  linkedFile: f => { f.evidence.observations[0].file.linkedProjectId = 101; },
  missingTargetInventory: f => { f.evidence.inventory.files.pop(); },
  hiddenActiveFile: f => { f.evidence.inventory.files.push({ id: 999, name: 'QA Durable previous run', organizationId: 9, active: true, isProject: false, linkedProjectId: null }); },
  beforeDigest: f => { f.report.manualAdministration.beforeInventory.administratorUserId = 999; rebind(f); },
  staleAfter: f => { f.evidence.capturedAt = new Date(now - 31 * 60_000).toISOString(); },
  inspectionBeforeRunEnds: f => { f.evidence.inspection.capturedAt = new Date(now - 90_000).toISOString(); },
  oversized: f => { f.evidence.untrusted = 'x'.repeat(24 * 1024); },
})) test(`cleanup certificate rejects ${label}`, () => { const f = fixture(); change(f); assert.throws(() => verifyManualCleanup(f.report, f.evidence, { now })); });

test('failed functional or uncertain remote operation state cannot produce a cleanup certificate', () => {
  for (const change of [f => { f.report.operationalTestsPassed = false; }, f => { f.report.cases[0].status = 'FAIL'; },
    f => { f.report.error.code = 'CALLBACK_FAILURE'; }, f => { f.report.budgetError = { code: 'TIMEOUT' }; }]) {
    const f = fixture(); change(f); rebind(f);
    assert.throws(() => verifyManualCleanup(f.report, f.evidence, { now }), { code: 'QA_REMOTE_OPERATIONS_UNVERIFIED' });
  }
});

test('offline CLI creates only a new certificate and cannot overwrite input or prior evidence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'manual-cleanup-proof-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture(), rp = join(dir, 'report.json'), ep = join(dir, 'after.json'), out = join(dir, 'certificate.json');
  await writeFile(rp, JSON.stringify(f.report)); await writeFile(ep, JSON.stringify(f.evidence));
  const args = ['scripts/acceptance/verify-manual-cleanup.mjs', '--report', rp, '--evidence', ep, '--output', out];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).complete, true);
  assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 1);
  args[args.length - 1] = rp; assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 1);
  assert.deepEqual(JSON.parse(await readFile(rp, 'utf8')), f.report);
});


test('workflow-bound bundle rejects missing context and reruns even while still fresh', () => {
  const raw = JSON.stringify({ creator: { email: 'qa@example.test', password: 'SECRET_SENTINEL' }, manualInventory: before() });
  for (const change of [{ workflowRunId: undefined }, { workflowRunAttempt: 2 }, { workflowRunId: '987654321' }]) {
    assert.throws(() => parseManualBundle(raw, { ...options, ...change }));
  }
});
