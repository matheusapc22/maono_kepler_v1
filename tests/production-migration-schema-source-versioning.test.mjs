import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256Text } from '../scripts/migrations/production-migration-lib.mjs';
import { historicalDeletionReference } from '../scripts/migrations/deletion-historical-prestate.mjs';
import { ORGANIZATION_SCHEMA_SNAPSHOT } from '../scripts/migrations/organization-schema-snapshot.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const v1Path = 'scripts/migrations/references/deletion-historical-safety-v1.json';
const v2Path = 'scripts/migrations/references/deletion-historical-safety-v2.json';

test('the original historical contract, manifest, and M44 candidates remain byte-identical', () => {
  const originalPins = {
    [v1Path]: '47f143173c8a0610bcbb17de19f3ff4d67104ab3ddf0e03a09610912de1e0b72',
    'tests/fixtures/deletion-historical-safety/manifest.json': 'eba41d065824c0bf24c8a446906f570f9f94d2de551b760b80d86488fa290d6a',
    'migrations/0044_organization_permanent_deletion.sql': 'cde2cbad6ded662faf004eac176309b3003641ec2f0714eda06b890127fb3aba',
    'scripts/migrations/candidates/0044_organization_permanent_deletion_historical.sql': 'b04a164e85fe09d292dd8e81ac744ce4deec8927290d38cff326c77e030354fa',
  };
  for (const [path, hash] of Object.entries(originalPins)) assert.equal(sha256Text(read(path)), hash, path);
});

test('the immutable schema snapshot has its original hash and is an exact prefix of the M45 bootstrap', () => {
  const historical = read(ORGANIZATION_SCHEMA_SNAPSHOT.path), current = read('schema.sql');
  assert.equal(sha256Text(historical), '7016dbc64d6502af557bc9fd5cab9cc2be71770a1d56ff74d5c88219d61026fc');
  assert.equal(current.slice(0, historical.length), historical);
  assert.equal(current.slice(historical.length).trim(), ('-- Operation audit journal (migration 0045).\n' + read('migrations/0045_operation_audit_frames.sql')).trim());
  for (const [marker, hash] of [
    ['-- Organization management (migration 0042)', '870ca4640ca9e5d21b9515ddc7a60a67b0e56b178988c0428317f86d56e7841a'],
    ['-- Organization permanent deletion (migration 0044)', '4e7cddb23a4666624120d22dbff0fe81912710b9cc740d6773c490dc49c875c9'],
  ]) {
    assert.equal(sha256Text(historical.split(marker)[0]), hash);
    assert.equal(current.split(marker)[0], historical.split(marker)[0]);
  }
});

test('V2 distinguishes historical schema provenance from pinned current runtime and grants no apply authority', () => {
  const ref = historicalDeletionReference(path => {
    assert.notEqual(path, 'schema.sql', 'The historical source must use its explicit physical snapshot');
    return read(path);
  });
  assert.equal(ref.contract.profileId, 'deletion-safety-historical-v2');
  assert.equal(ref.contract.version, 2); assert.equal(ref.contract.operationalApproval, false);
  assert.deepEqual(ref.contract.sourceLocations['schema.sql'], {
    path: ORGANIZATION_SCHEMA_SNAPSHOT.path, revision: ORGANIZATION_SCHEMA_SNAPSHOT.revision,
    sha256: ORGANIZATION_SCHEMA_SNAPSHOT.sha256,
    scope: 'Immutable structural baseline from schema.sql before 0045; this is not the current bootstrap or runtime.',
  });
  assert.equal(ref.contract.supersedes.sha256, sha256Text(read(v1Path)));
  assert.equal(ref.contract.supersedes.previousEvidenceAndApprovalReusable, false);
  assert.equal(ref.contract.sourcePins['schema.sql'], undefined);
  assert.equal(ref.manifest.objects.length, 530); assert.equal(ref.planned.length, 147);
  for (const path of ref.contract.runtimeSources) assert.equal(ref.contract.sourcePins[path], sha256Text(read(path)), path);
  for (const path of ['functions/_lib/operation-audit.js', 'functions/_lib/organization-audit-recovery.js', 'functions/_lib/organization-storage.js', 'functions/_lib/organization-audited-mutation.js']) assert.ok(ref.contract.runtimeSources.includes(path));
  assert.notEqual(ref.contract.sourcePins['functions/_lib/organization-permanent-deletion.js'], JSON.parse(read(v1Path)).sourcePins['functions/_lib/organization-permanent-deletion.js']);
  assert.ok(ref.contract.nonClaims.includes('already-applied-0044-reexecution'));
  assert.ok(ref.contract.nonClaims.includes('0045-installed'));
  assert.equal(JSON.parse(read(v2Path)).operationalApproval, false);
});

for (const path of [ORGANIZATION_SCHEMA_SNAPSHOT.path, 'functions/_lib/operation-audit.js', 'functions/_lib/organization-audit-recovery.js', 'functions/_lib/organization-audited-mutation.js', 'functions/_lib/organization-storage.js']) {
  test('V2 blocks drift in the reviewed source: ' + path, () => {
    assert.throws(() => historicalDeletionReference(value => read(value) + (value === path ? '\n/* unreviewed change */' : '')), { code: 'HISTORICAL_SOURCE_DRIFT' });
  });
}
