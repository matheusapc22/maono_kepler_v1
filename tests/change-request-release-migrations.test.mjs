import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(
  new URL('../scripts/operations/change-request-release-migrations.mjs', import.meta.url),
  'utf8',
);

test('migration operator isolates exactly 0021 -> 0023 and refuses ledger gaps', () => {
  assert.match(script, /0021_change_request_lifecycle\.sql/);
  assert.match(script, /0022_change_request_apply_artifacts\.sql/);
  assert.match(script, /0023_change_request_resubmissions\.sql/);
  assert.match(script, /setEqualsPrefix/);
  assert.match(script, /copyFileSync\(join\('migrations', name\), join\(migrationsDir, name\)\)/);
  assert.match(script, /'migrations',\s*'apply'/s);
  assert.doesNotMatch(script, /migrations apply[^\n]*--all/i);
});

test('migration operator requires fail-closed Preview and two real QA identities first', () => {
  assert.match(script, /MAONO_PREVIEW_MUTATIONS_ENABLED/);
  assert.match(script, /mutations !== 'false'/);
  assert.match(script, /MAONO_PREVIEW_VIEWER_SESSION_COOKIE/);
  assert.match(script, /MAONO_PREVIEW_REVIEWER_SESSION_COOKIE/);
  assert.match(script, /\/api\/session/);
  assert.match(script, /Viewer and Reviewer must be different authenticated identities/);
  assert.match(script, /Viewer QA identity must resolve to role viewer/);
  assert.match(script, /Reviewer QA identity must resolve to an Editor-capable project route/);
  assert.match(script, /qa-smoke-/);
});

test('migration operator fails closed on partial schema or in-flight Apply', () => {
  assert.match(script, /Partial unrecorded schema detected/);
  assert.match(script, /Migration ledger\/schema divergence detected/);
  assert.match(script, /WHERE status='applying'/);
  assert.match(script, /migration window is blocked/);
});

test('migration operator verifies post-apply ledger, lifecycle invariants and health', () => {
  assert.match(script, /Request\/Ticket divergence detected after migrations/);
  assert.match(script, /Lifecycle journal divergence detected after migrations/);
  assert.match(script, /changeRequestLifecycleReady/);
  assert.match(script, /changeRequestApplyArtifactReady/);
  assert.match(script, /changeRequestResubmissionReady/);
  assert.match(script, /previewMutationsEnabled !== false/);
});

test('migration operator suppresses raw remote command output and never logs cookies', () => {
  assert.match(script, /raw output suppressed/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(viewerCookie|reviewerCookie|token)/);
  assert.doesNotMatch(script, /record\([^\n]*(viewerCookie|reviewerCookie|token)/);
});
