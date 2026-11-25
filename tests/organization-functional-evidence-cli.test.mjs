import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT } from '../scripts/acceptance/organization-functional-evidence.mjs';
import { makeEvidenceFixture, makeEnvironmentFixture } from './helpers/organization-functional-evidence-fixture.mjs';

const cli = fileURLToPath(new URL('../scripts/acceptance/verify-organization-functional-evidence.mjs', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'maono-org-evidence-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const evidence = makeEvidenceFixture();
  const external = makeEnvironmentFixture(evidence);
  const evidencePath = join(directory, 'synthetic-evidence.json');
  const environmentPath = join(directory, 'synthetic-control-plane.json');
  const outputPath = join(directory, 'derived-certificate.json');
  const originalEvidence = JSON.stringify(evidence);
  await writeFile(evidencePath, originalEvidence);
  await writeFile(environmentPath, external.bytes);
  const base = ['--evidence', evidencePath];
  const environment = ['--environment-report', environmentPath, '--environment-sha256', external.sha256, '--environment-source', external.source];
  return { directory, evidencePath, environmentPath, outputPath, originalEvidence, external, base, environment };
}
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}
function failure(result, code) {
  assert.equal(result.status, 1);
  const lines = result.stderr.trim().split('\n');
  const body = JSON.parse(lines.at(-1));
  assert.equal(body.error.code, code);
  assert.equal(body.complete, false);
  assert.equal(body.acceptanceIncomplete, true);
  assert.doesNotMatch(result.stderr + result.stdout, /PRIVATE_SENTINEL/);
}

test('CLI verifies synthetic observations and source linkage without declaring operational acceptance', async t => {
  const f = await fixture(t);
  const result = run([...f.base, ...f.environment, '--output', f.outputPath]);
  assert.equal(result.status, 0);
  const certificate = JSON.parse(result.stdout);
  assert.equal(certificate.observationsComplete, true);
  assert.equal(certificate.environment.matched, true);
  assert.equal(certificate.complete, false);
  assert.equal(certificate.operationalAcceptanceExecuted, false);
  assert.equal(certificate.migrationVerified, false);
  assert.equal(certificate.cleanupVerified, false);
  assert.equal(certificate.restorationVerified, false);
  assert.equal(certificate.trust.cryptographicAttestation, false);
  assert.equal(await readFile(f.evidencePath, 'utf8'), f.originalEvidence);
  assert.equal(await readFile(f.environmentPath, 'utf8'), f.external.bytes);
  assert.deepEqual(JSON.parse(await readFile(f.outputPath, 'utf8')), certificate);
  assert.equal((await stat(f.outputPath)).mode & 0o777, 0o600);
});

test('CLI reports missing external evidence with exit 2 and preserves incomplete status', async t => {
  const f = await fixture(t);
  const result = run(f.base);
  assert.equal(result.status, 2);
  const certificate = JSON.parse(result.stdout);
  assert.equal(certificate.observationsComplete, true);
  assert.equal(certificate.environment.matched, false);
  assert.equal(certificate.environment.reason, 'EXTERNAL_ENVIRONMENT_REPORT_REQUIRED');
  assert.equal(certificate.complete, false);
  assert.equal(certificate.acceptanceIncomplete, true);
});

test('CLI rejects malformed evidence without echoing its private contents', async t => {
  const f = await fixture(t);
  await writeFile(f.evidencePath, 'PRIVATE_SENTINEL{');
  failure(run([...f.base, '--output', f.outputPath]), 'ORG_EVIDENCE_JSON_INVALID');
  assert.equal(await readFile(f.evidencePath, 'utf8'), 'PRIVATE_SENTINEL{');
  await assert.rejects(stat(f.outputPath), { code: 'ENOENT' });
});

test('CLI rejects a changed external artifact before creating a certificate', async t => {
  const f = await fixture(t);
  const changed = f.external.bytes + ' ';
  await writeFile(f.environmentPath, changed);
  failure(run([...f.base, ...f.environment, '--output', f.outputPath]), 'ORG_EXTERNAL_DIGEST_MISMATCH');
  assert.equal(await readFile(f.environmentPath, 'utf8'), changed);
  await assert.rejects(stat(f.outputPath), { code: 'ENOENT' });
});

test('CLI never overwrites either original or an existing certificate', async t => {
  const f = await fixture(t);
  for (const path of [f.evidencePath, f.environmentPath]) {
    failure(run([...f.base, ...f.environment, '--output', path]), 'ORG_CLI_ORIGINAL_IMMUTABLE');
  }
  await writeFile(f.outputPath, 'existing certificate');
  failure(run([...f.base, ...f.environment, '--output', f.outputPath]), 'ORG_CERTIFICATE_ALREADY_EXISTS');
  assert.equal(await readFile(f.evidencePath, 'utf8'), f.originalEvidence);
  assert.equal(await readFile(f.environmentPath, 'utf8'), f.external.bytes);
  assert.equal(await readFile(f.outputPath, 'utf8'), 'existing certificate');
});

test('CLI rejects partial source metadata and duplicate options', async t => {
  const f = await fixture(t);
  failure(run([...f.base, '--environment-report', f.environmentPath]), 'ORG_CLI_ENVIRONMENT_INCOMPLETE');
  failure(run([...f.base, '--evidence', f.evidencePath]), 'ORG_CLI_ARGUMENTS_INVALID');
});

test('CLI bounds input bytes before parsing and keeps the oversized original unchanged', async t => {
  const f = await fixture(t);
  const oversized = Buffer.alloc(CONTRACT.maxEvidenceBytes + 1, 0x20);
  await writeFile(f.evidencePath, oversized);
  failure(run([...f.base, '--output', f.outputPath]), 'ORG_EVIDENCE_FILE_TOO_LARGE');
  assert.equal((await stat(f.evidencePath)).size, oversized.byteLength);
  await assert.rejects(stat(f.outputPath), { code: 'ENOENT' });
});
