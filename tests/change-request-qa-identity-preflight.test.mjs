import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../scripts/preview/change-request-qa-identity-preflight.mjs', import.meta.url),
  'utf8',
);

test('QA identity preflight validates two distinct authenticated users', () => {
  assert.match(source, /MAONO_PREVIEW_VIEWER_SESSION_COOKIE/);
  assert.match(source, /MAONO_PREVIEW_REVIEWER_SESSION_COOKIE/);
  assert.match(source, /\/api\/session/);
  assert.match(source, /Viewer and Reviewer must be different authenticated users/);
});

test('QA identity preflight pins Viewer and Reviewer to their intended routes', () => {
  assert.match(source, /viewerRole !== 'viewer'/);
  assert.match(source, /viewerAccess !== 'viewer'/);
  assert.match(source, /Reviewer QA identity must resolve to an Editor-capable project route/);
  assert.match(source, /\['editor', 'write', 'owner'\]/);
  assert.match(source, /maono-preview-qa/);
  assert.match(source, /qa-smoke-/);
});

test('QA identity preflight never prints credentials or user identifiers', () => {
  assert.doesNotMatch(source, /console\.log\([^\n]*(viewerCookie|reviewerCookie|user\.id|email)/);
  assert.doesNotMatch(source, /record\([^\n]*(viewerCookie|reviewerCookie|user\.id|email)/);
});
