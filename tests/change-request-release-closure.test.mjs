import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

const [workflow, closure] = await Promise.all([
  source('.github/workflows/change-request-production-closure.yml'),
  source('scripts/operations/change-request-release-closure.mjs'),
]);

test('closure verification cannot run from push or an arbitrary branch', () => {
  assert.doesNotMatch(workflow, /^\s*push\s*:/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/ops\/change-request-release-acceptance'/);
  assert.match(workflow, /inputs\.confirmation == 'VERIFY_QA_CHANGE_REQUEST_CLOSED'/);
});

test('closure gate is read-only and does not depend on QA session cookies', () => {
  assert.doesNotMatch(workflow, /MAONO_PREVIEW_(VIEWER|REVIEWER)_SESSION_COOKIE/);
  assert.doesNotMatch(closure, /method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]/i);
  assert.doesNotMatch(closure, /wrangler\b/i);
  assert.doesNotMatch(closure, /d1\s+execute/i);
});

test('closure requires the Preview kill switch to be explicitly false in Pages and health', () => {
  assert.match(closure, /configuredMutations !== 'false'/);
  assert.match(closure, /MAONO_PREVIEW_MUTATIONS_ENABLED=false/);
  assert.match(closure, /previewMutationsEnabled !== false/);
  assert.match(closure, /requirePreviewClosed: true/);
});

test('closure preserves the audited DB binding and all Change Request readiness gates', () => {
  assert.match(closure, /productionBinding !== database\.uuid \|\| previewBinding !== database\.uuid/);
  assert.match(closure, /changeRequestLifecycleReady/);
  assert.match(closure, /changeRequestApplyArtifactReady/);
  assert.match(closure, /changeRequestResubmissionReady/);
  assert.match(closure, /databaseReachable/);
});

test('closure validates both Preview and Production health endpoints', () => {
  assert.match(closure, /checkHealth\(previewBaseUrl, 'preview'/);
  assert.match(closure, /checkHealth\(productionBaseUrl, 'production'/);
  assert.match(closure, /HTTPS origin without embedded credentials/);
});
