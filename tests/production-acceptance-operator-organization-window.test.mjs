import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
