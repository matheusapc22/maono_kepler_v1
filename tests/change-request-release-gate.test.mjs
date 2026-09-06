import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

const [
  workflow,
  observability,
  acceptance,
  health,
  applyArtifact,
  stackReadiness,
  resubmission,
] = await Promise.all([
  source('.github/workflows/change-request-production-acceptance.yml'),
  source('scripts/operations/change-request-release-observability.mjs'),
  source('scripts/preview/change-request-production-acceptance.mjs'),
  source('functions/api/health.js'),
  source('functions/_lib/project-change-request-apply-artifact.js'),
  source('functions/_lib/project-change-request-stack-readiness.js'),
  source('functions/_lib/project-change-request-resubmission.js'),
]);

test('remote acceptance cannot run from push or an arbitrary branch', () => {
  assert.doesNotMatch(workflow, /^\s*push\s*:/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/ops\/change-request-release-acceptance'/);
  assert.match(workflow, /inputs\.confirmation == 'RUN_QA_CHANGE_REQUEST_ACCEPTANCE'/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test('remote acceptance requires distinct Viewer and Reviewer session secrets', () => {
  assert.match(workflow, /secrets\.MAONO_PREVIEW_VIEWER_SESSION_COOKIE/);
  assert.match(workflow, /secrets\.MAONO_PREVIEW_REVIEWER_SESSION_COOKIE/);
  assert.match(acceptance, /viewerCookie === reviewerCookie/);
  assert.match(acceptance, /\^maono_session=/);
  assert.doesNotMatch(acceptance, /console\.log\([^\n]*(viewerCookie|reviewerCookie)/);
});

test('acceptance is confined to disposable QA project and covers lifecycle, feedback, lineage and replay', () => {
  assert.match(acceptance, /\^qa-smoke-/);
  assert.match(acceptance, /action: 'reject'/);
  assert.match(acceptance, /feedback !== feedback/);
  assert.match(acceptance, /\/tracking\?limit=50/);
  assert.match(acceptance, /\/resubmit/);
  assert.match(acceptance, /replayed !== true/);
  assert.match(acceptance, /resubmittedToRequestId/);
  assert.match(acceptance, /resubmittedFromRequestId/);
  assert.match(acceptance, /action: 'start'/);
  assert.match(acceptance, /action: 'approve'/);
});

test('acceptance exercises the shared streaming Apply pipeline with a verified content hash', () => {
  assert.match(acceptance, /buildProjectChangeProposal/);
  assert.match(acceptance, /dropboxContentHashHex/);
  assert.match(acceptance, /'X-Maono-Large-Config': '1'/);
  assert.match(acceptance, /'X-Maono-Config-Checksum': checksum/);
  assert.match(acceptance, /'X-Maono-Change-Request-Version': String\(lifecycleVersion\)/);
  assert.match(acceptance, /application\/vnd\.maono\.map-config\+json/);
  assert.match(acceptance, /appliedRevision !== baseRevision \+ 1/);
  assert.match(acceptance, /idempotent !== true/);
});

test('observability is read-only and requires all rollout migrations and schema objects', () => {
  assert.match(observability, /0021_change_request_lifecycle\.sql/);
  assert.match(observability, /0022_change_request_apply_artifacts\.sql/);
  assert.match(observability, /0023_change_request_resubmissions\.sql/);
  assert.match(observability, /Release observability accepts read-only SQL only/);
  assert.match(observability, /\(INSERT\|UPDATE\|DELETE\|REPLACE\|CREATE\|ALTER\|DROP\|VACUUM\|ATTACH\|DETACH\)/);
  assert.match(observability, /uq_project_change_request_resubmission_source/);
  assert.match(observability, /trg_change_request_apply_artifact_immutable/);
  assert.match(observability, /Request\/Ticket lifecycle divergence/);
  assert.match(observability, /Lifecycle journal divergence/);
  assert.match(observability, /Stale applying requests/);
});

test('post-acceptance evidence proves the canonical parent, child, artifact and Ticket state', () => {
  assert.match(observability, /MAONO_ACCEPTANCE_SOURCE_REQUEST_ID/);
  assert.match(observability, /MAONO_ACCEPTANCE_RESUBMISSION_ID/);
  assert.match(observability, /MAONO_ACCEPTANCE_ARTIFACT_CHECKSUM/);
  assert.match(observability, /source_status !== 'rejected'/);
  assert.match(observability, /child_status !== 'applied'/);
  assert.match(observability, /ticket_status !== 'closed'/);
});

test('health exposes readiness for lifecycle, Apply artifact and resubmission contracts', () => {
  assert.match(health, /changeRequestLifecycleReady/);
  assert.match(health, /changeRequestApplyArtifactReady/);
  assert.match(health, /changeRequestResubmissionReady/);
  assert.match(observability, /changeRequestApplyArtifactReady/);
  assert.match(observability, /changeRequestResubmissionReady/);
});

test('partial 0022/0023 schemas fail closed instead of passing on table or column presence alone', () => {
  assert.match(applyArtifact, /isChangeRequestApplyArtifactSchemaReady/);
  assert.match(applyArtifact, /trg_change_request_apply_artifact_immutable/);
  assert.match(applyArtifact, /CHANGE_REQUEST_APPLY_SCHEMA_OUTDATED/);
  assert.match(stackReadiness, /uq_project_change_request_resubmission_source/);
  assert.match(stackReadiness, /trg_project_change_request_resubmission_immutable/);
  assert.match(stackReadiness, /trg_project_change_request_resubmission_guard/);
  assert.match(resubmission, /isChangeRequestResubmissionSchemaReady/);
  assert.match(resubmission, /CHANGE_REQUEST_RESUBMISSION_SCHEMA_OUTDATED/);
});
