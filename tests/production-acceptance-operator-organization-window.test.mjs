import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFile, chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOrganizationWindow, EXECUTORS } from '../scripts/acceptance/organization-window.mjs';

function fixture() {
  const clock = 1_800_000_000_000;
  const baseline = Object.fromEntries(EXECUTORS.map((id) =>
    [id, { deployment: 'synthetic-base', configuration: 'a'.repeat(64) }]));
  const identity = {
    version: 1, kind: 'synthetic', run: 42, attempt: 1, sha: 'b'.repeat(40),
    origin: 'https://maono.invalid', binding: 'synthetic-maono-maps',
    organization: 'synthetic-org', actor: 'synthetic-actor', caseId: 'synthetic-update',
  };
  const manifest = { ...identity, baseline, expiresAt: clock + 60_000 };
  const evidence = {
    ...identity, observedAt: clock, operation: 'synthetic-operation', httpStatus: 200,
    effect: 'synthetic-effect-confirmed',
    ui: { stableForm: true, goldOverlay: true, confirmedTransition: true, cornerNotices: true,
      noTechnicalBlocks: true, draftPreserved: true },
  };
  const cleanup = { organization: manifest.organization, remaining: [] };
  return { clock, baseline, manifest, evidence, cleanup };
}

const encode = (data) => Buffer.from(JSON.stringify(data));

test('the operator imports evidence and keeps closure classified as synthetic', async (t) => {
  const { clock, baseline, manifest, evidence, cleanup } = fixture();
  const beforeRestore = structuredClone(baseline);
  beforeRestore[EXECUTORS[0]].deployment = 'synthetic-window';
  beforeRestore[EXECUTORS[1]].configuration = 'c'.repeat(64);
  const dir = await mkdtemp(join(tmpdir(), 'organization-window-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const scenarioPath = join(dir, 'scenario.json');
  const evidencePath = join(dir, 'evidence.json');
  const original = encode(evidence);
  await writeFile(scenarioPath, encode({ clock, manifest, cleanup, beforeRestore }));
  await writeFile(evidencePath, original);
  const result = spawnSync(process.execPath, [
    'scripts/acceptance/operator.mjs', 'organization-window-synthetic', scenarioPath, evidencePath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.complete, false);
  assert.equal(report.acceptanceExecuted, false);
  assert.equal(report.protocolComplete, true);
  assert.deepEqual(Object.values(report.executors), ['restored', 'restored', 'unchanged']);
  assert.deepEqual(report.history, ['awaiting-evidence', 'verified', 'cleanup', 'restoration', 'closed']);
  assert.match(report.evidenceDigest, /^[a-f0-9]{64}$/);
  await writeFile(evidencePath, Buffer.alloc(32 * 1024 + 1));
  const rejected = spawnSync(process.execPath, [
    'scripts/acceptance/operator.mjs', 'organization-window-synthetic', scenarioPath, evidencePath,
  ], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /INPUT_SIZE/);
});

test('scope, input fields, observation time and every UI criterion are required', () => {
  const { clock, manifest, evidence } = fixture();
  const window = createOrganizationWindow(manifest, { now: () => clock });
  for (const [field, value] of Object.entries({
    organization: 'synthetic-other', actor: 'synthetic-other', caseId: 'synthetic-other',
    binding: 'maono_maps', sha: 'c'.repeat(40), run: 43, attempt: 2, origin: 'https://example.com',
  })) {
    assert.throws(() => window.ingest(encode({ ...evidence, [field]: value })), /EVIDENCE_SCOPE/);
  }
  for (const key of ['command', 'sql', 'url', 'method', 'target']) {
    assert.throws(() => createOrganizationWindow({ ...manifest, [key]: 'external' },
      { now: () => clock }), /MANIFEST_FIELDS/);
  }
  assert.throws(() => window.ingest(encode({ ...evidence, observedAt: clock - 1 })), /EVIDENCE_TIME/);
  for (const key of Object.keys(evidence.ui)) {
    assert.throws(() => window.ingest(encode({ ...evidence, ui: { ...evidence.ui, [key]: false } })),
      /CASE_INCOMPLETE/);
  }
  assert.equal(window.report().state, 'awaiting-evidence');
  assert.equal(window.report().protocolComplete, false);
  window.ingest(encode(evidence));
  assert.throws(() => window.ingest(encode(evidence)), /EVIDENCE_STATE/);
});

for (const interruption of ['cancelled', 'expired', 'access-revoked']) {
  test(interruption + ' permits closure only after cleanup and restoration', () => {
    const { clock, baseline, manifest, evidence, cleanup } = fixture();
    let time = clock;
    const window = createOrganizationWindow(manifest, { now: () => time });
    if (interruption === 'expired') {
      time = manifest.expiresAt;
      assert.throws(() => window.ingest(encode(evidence)), /EVIDENCE_STATE/);
    } else {
      window.interrupt(interruption);
    }
    assert.equal(window.report().disposition, interruption);
    assert.throws(() => window.verifyCleanup({ ...cleanup, remaining: ['synthetic-org'] }),
      /CLEANUP_INCOMPLETE/);
    window.verifyCleanup(cleanup);
    for (const executor of EXECUTORS) {
      const incomplete = structuredClone(baseline);
      incomplete[executor].deployment = 'synthetic-other';
      assert.throws(() => window.verifyRestoration(incomplete, incomplete), /RESTORATION_INCOMPLETE/);
      assert.equal(window.report().executors[executor], 'mismatch');
    }
    window.verifyRestoration(baseline, baseline);
    assert.equal(window.report().state, 'closed');
    assert.equal(window.report().protocolComplete, false);
  });
}

test('restores remaining executors when one adapter fails and requires matching readback', async () => {
  const { clock, baseline, manifest, evidence, cleanup } = fixture();
  const window = createOrganizationWindow(manifest, { now: () => clock });
  const current = structuredClone(baseline);
  for (const executor of EXECUTORS) current[executor].deployment = 'synthetic-window';
  window.ingest(encode(evidence));
  window.verifyCleanup(cleanup);
  const failed = EXECUTORS[1];
  const read = async (executor) => current[executor];
  await assert.rejects(window.restore({
    read,
    restore: async (executor, value) => {
      if (executor === failed) throw new Error('fixture failure');
      current[executor] = value;
    },
  }), /RESTORATION_INCOMPLETE/);
  assert.deepEqual(window.report().restorationErrors, [failed]);
  assert.deepEqual(Object.values(window.report().executors), ['restored', 'mismatch', 'restored']);
  assert.equal(window.report().state, 'restoration');
  await window.restore({ read, restore: async (executor, value) => { current[executor] = value; } });
  assert.deepEqual(current, baseline);
  assert.equal(window.report().protocolComplete, true);
});

async function checkpointFixture(t, alterScenario = () => {}) {
  const { clock, baseline, manifest, evidence, cleanup } = fixture();
  const dir = await mkdtemp(join(tmpdir(), 'organization-checkpoint-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const checkpoint = join(dir, 'journal');
  await mkdir(checkpoint, { mode: 0o700 });
  const scenarioPath = join(dir, 'scenario.json');
  const evidencePath = join(dir, 'evidence.json');
  const alternateEvidence = join(dir, 'alternate-evidence.json');
  const scenario = { clock, manifest, cleanup, beforeRestore: structuredClone(baseline) };
  scenario.beforeRestore[EXECUTORS[2]].deployment = 'synthetic-window';
  alterScenario(scenario);
  await writeFile(scenarioPath, encode(scenario));
  await writeFile(evidencePath, encode(evidence));
  await writeFile(alternateEvidence, encode({ ...evidence, operation: 'synthetic-other-operation' }));
  const args = (phase, input = evidencePath) =>
    ['scripts/acceptance/operator.mjs', 'organization-window-synthetic', scenarioPath, input, checkpoint, phase];
  const run = (...params) => spawnSync(process.execPath, args(...params), { encoding: 'utf8' });
  return { run, args, scenarioPath, checkpoint, alternateEvidence };
}

const posix = { skip: process.platform === 'win32' };

test('synthetic checkpoint resumes and deduplicates between CLI processes', posix, async (t) => {
  const { run, checkpoint, scenarioPath, alternateEvidence } = await checkpointFixture(t);
  const premature = run('finish');
  assert.equal(premature.status, 1);
  assert.match(premature.stderr, /CHECKPOINT_NOT_ACCEPTED/);
  // An interrupted writer may leave an unpublished temporary file.
  await writeFile(join(checkpoint, '.pending-stale'), 'incomplete', { mode: 0o600 });
  const accepted = run('accept');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).state, 'cleanup');
  assert.deepEqual(run('accept').stdout, accepted.stdout);
  const different = run('finish', alternateEvidence);
  assert.equal(different.status, 1);
  assert.match(different.stderr, /CHECKPOINT_CONFLICT/);
  const finished = run('finish');
  assert.equal(finished.status, 0, finished.stderr);
  const report = JSON.parse(finished.stdout);
  assert.equal(report.state, 'closed');
  assert.equal(report.executors[EXECUTORS[2]], 'restored');
  assert.equal(report.complete, false);
  assert.equal(report.acceptanceExecuted, false);
  assert.equal(run('finish').stdout, finished.stdout);
  await appendFile(scenarioPath, '\n');
  const changedScenario = run('finish');
  assert.equal(changedScenario.status, 1);
  assert.match(changedScenario.stderr, /CHECKPOINT_CONFLICT/);
  assert.equal((await readdir(checkpoint)).filter((name) => name.endsWith('.json')).length, 2);
});

function runAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('concurrent CLI writers cannot replace accepted evidence', posix, async (t) => {
  const { run, args, checkpoint, alternateEvidence } = await checkpointFixture(t);
  const inputs = [undefined, alternateEvidence];
  const accepted = await Promise.all(inputs.map((input) => runAsync(args('accept', input))));
  assert.deepEqual(accepted.map((result) => result.status).sort(), [0, 1]);
  assert.match(accepted.find((result) => result.status === 1).stderr, /CHECKPOINT_CONFLICT/);
  const winner = inputs[accepted.findIndex((result) => result.status === 0)];
  const finished = await Promise.all([runAsync(args('finish', winner)), runAsync(args('finish', winner))]);
  for (const result of finished) assert.equal(result.status, 0, result.stderr);
  assert.equal(finished[0].stdout, finished[1].stdout);
  assert.equal(run('finish', winner).stdout, finished[0].stdout);
  assert.equal((await readdir(checkpoint)).length, 2);
});

test('invalid or corrupt storage fails closed without replacing the journal', posix, async (t) => {
  const { run, checkpoint } = await checkpointFixture(t);
  await chmod(checkpoint, 0o755);
  const exposed = run('accept');
  assert.equal(exposed.status, 1);
  assert.match(exposed.stderr, /CHECKPOINT_DIRECTORY/);
  assert.deepEqual(await readdir(checkpoint), []);
  await chmod(checkpoint, 0o700);
  const accepted = run('accept');
  assert.equal(accepted.status, 0, accepted.stderr);
  const [record] = await readdir(checkpoint);
  await writeFile(join(checkpoint, record), 'corrupt');
  const corrupt = run('finish');
  assert.equal(corrupt.status, 1);
  assert.match(corrupt.stderr, /CHECKPOINT_RECORD/);
  assert.deepEqual(await readdir(checkpoint), [record]);
});

test('an incomplete synthetic cleanup preserves the acceptance record but cannot close', posix, async (t) => {
  const { run, checkpoint } = await checkpointFixture(t, (scenario) => {
    scenario.cleanup.remaining.push('synthetic-org');
  });
  const accepted = run('accept');
  assert.equal(accepted.status, 0, accepted.stderr);
  const incomplete = run('finish');
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /CLEANUP_INCOMPLETE/);
  assert.equal(run('accept').stdout, accepted.stdout);
  const records = await readdir(checkpoint);
  assert.equal(records.length, 1);
  assert.match(records[0], /\.accepted\.json$/);
});

test('an unverified executor before restoration prevents all writes', async () => {
  const { clock, baseline, manifest, evidence, cleanup } = fixture();
  const window = createOrganizationWindow(manifest, { now: () => clock });
  window.ingest(encode(evidence));
  window.verifyCleanup(cleanup);
  const reads = [];
  let writes = 0;
  const [pages, deletion, recovery] = EXECUTORS;
  await assert.rejects(window.restore({
    read: async (executor) => {
      reads.push(executor);
      if (executor === recovery) return null;
      if (executor === deletion) return { ...baseline[executor], configuration: 'c'.repeat(64) };
      return baseline[executor];
    },
    restore: async () => { writes++; },
  }), /RESTORATION_BASELINE_UNVERIFIED/);
  assert.deepEqual(reads, EXECUTORS);
  assert.equal(writes, 0);
  assert.deepEqual(window.report().executors, { [pages]: 'unchanged', [deletion]: 'pending', [recovery]: 'unverified' });
  assert.deepEqual(window.report().restorationReadErrors, { before: [recovery], after: [] });
  assert.equal(window.report().state, 'restoration');
});

test('a missing readback blocks closure until fresh observations match without repeating a write', async () => {
  const { clock, baseline, manifest, evidence, cleanup } = fixture();
  const window = createOrganizationWindow(manifest, { now: () => clock });
  window.ingest(encode(evidence));
  window.verifyCleanup(cleanup);
  const [pages, deletion, recovery] = EXECUTORS;
  const current = structuredClone(baseline);
  current[recovery].configuration = 'c'.repeat(64);
  let failAfter = true;
  let writes = 0;
  const adapter = {
    read: async (executor) => {
      if (executor === recovery && failAfter && writes > 0) throw new Error('fixture unavailable');
      return current[executor];
    },
    restore: async (executor, value) => {
      assert.equal(executor, recovery);
      current[executor] = value;
      writes++;
    },
  };
  await assert.rejects(window.restore(adapter), /RESTORATION_INCOMPLETE/);
  assert.deepEqual(window.report().restorationReadErrors, { before: [], after: [recovery] });
  assert.deepEqual(window.report().executors, { [pages]: 'unchanged', [deletion]: 'unchanged', [recovery]: 'unverified' });
  assert.equal(window.report().protocolComplete, false);
  failAfter = false;
  await window.restore(adapter);
  assert.equal(writes, 1);
  assert.equal(window.report().protocolComplete, true);
  assert.equal(window.report().acceptanceExecuted, false);
});
