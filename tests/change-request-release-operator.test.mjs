import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../.github/workflows/change-request-release-operator.yml', import.meta.url),
  'utf8',
);

test('release operator is manual-only and serialized across rollout phases', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*push\s*:/m);
  assert.doesNotMatch(workflow, /^\s*schedule\s*:/m);
  assert.match(workflow, /group: change-request-d1-rollout/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('release operator exposes only migrate, acceptance and closure confirmations', () => {
  assert.match(workflow, /- migrate/);
  assert.match(workflow, /- acceptance/);
  assert.match(workflow, /- closure/);
  assert.match(workflow, /APPLY_CHANGE_REQUEST_0021_0023/);
  assert.match(workflow, /RUN_QA_CHANGE_REQUEST_ACCEPTANCE/);
  assert.match(workflow, /VERIFY_QA_CHANGE_REQUEST_CLOSED/);
});

test('operator pins a release SHA and refuses branch drift before every remote phase', () => {
  assert.match(workflow, /RELEASE_REF: ops\/change-request-release-acceptance/);
  assert.match(workflow, /release_sha: \$\{\{ steps\.pin\.outputs\.sha \}\}/);
  assert.match(workflow, /ref: \$\{\{ needs\.validate\.outputs\.release_sha \}\}/);
  const driftChecks = workflow.match(/git ls-remote origin/g) || [];
  assert.equal(driftChecks.length, 3);
  const validatedShaUses = workflow.match(/VALIDATED_RELEASE_SHA/g) || [];
  assert.ok(validatedShaUses.length >= 6);
});

test('migrate and acceptance receive QA sessions but closure does not', () => {
  const migrateStart = workflow.indexOf('\n  migrate:');
  const acceptanceStart = workflow.indexOf('\n  acceptance:');
  const closureStart = workflow.indexOf('\n  closure:');
  assert.ok(migrateStart > 0 && acceptanceStart > migrateStart && closureStart > acceptanceStart);
  const migrate = workflow.slice(migrateStart, acceptanceStart);
  const acceptance = workflow.slice(acceptanceStart, closureStart);
  const closure = workflow.slice(closureStart);
  for (const block of [migrate, acceptance]) {
    assert.match(block, /MAONO_PREVIEW_VIEWER_SESSION_COOKIE/);
    assert.match(block, /MAONO_PREVIEW_REVIEWER_SESSION_COOKIE/);
  }
  assert.doesNotMatch(closure, /MAONO_PREVIEW_(VIEWER|REVIEWER)_SESSION_COOKIE/);
  assert.match(closure, /change-request-release-closure\.mjs/);
});

test('operator validates release contracts before any remote phase', () => {
  assert.match(workflow, /tests\/change-request-release-migrations\.test\.mjs/);
  assert.match(workflow, /tests\/change-request-qa-identity-preflight\.test\.mjs/);
  assert.match(workflow, /tests\/viewer-request-tracking-runtime\.test\.mjs/);
  assert.match(workflow, /scripts\/preview\/assert-preview-safety\.mjs/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /node --check scripts\/operations\/change-request-release-migrations\.mjs/);
});
