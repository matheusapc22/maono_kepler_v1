import { digest } from '../../scripts/acceptance/organization-functional-evidence.mjs';

// Entirely synthetic observations. These objects are test fixtures, never
// evidence of a Production action, UI visit, migration or acceptance window.
export const FIXTURE_NOW = Date.parse('2026-11-25T12:00:00.000Z');
const id = suffix => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const stamp = value => new Date(value).toISOString();
const ORIGIN = 'https://maono-kepler-v1.pages.dev';

export function makeUiSamples({ kind = 'success', surface = 'organization', runId = id(1) } = {}) {
  const toastStart = 600, toastEnd = toastStart + (kind === 'error' ? 10_000 : 3000), duration = toastEnd + 400;
  const viewport = { width: 1280, height: 900 };
  const rect = surface === 'audit' ? { x: 680, y: 160, width: 550, height: 600 } : { x: 260, y: 100, width: 760, height: 700 };
  const samples = [];
  for (let t = 0; t <= duration; t += 100) {
    const busy = t >= 100 && t < 600;
    samples.push({ t, surface, dialogId: 1, formId: 2, busy, overlay: busy, loaderColors: busy ? [[229, 183, 77]] : [],
      rect: { ...rect }, draftDigest: digest(`${runId}:synthetic-draft`), scroll: 18, viewport: { ...viewport },
      documentVisible: true, focusInDialog: true, technicalReports: 0,
      toasts: t >= toastStart && t < toastEnd ? [{ id: 3, kind, rect: { x: 864, y: kind === 'error' ? 16 : 828, width: 400, height: 56 },
        hasCloseButton: kind === 'error', hasTechnicalReference: false }] : [],
    });
  }
  return samples;
}

function entry({ id: eventId = 'frame:10', at, actorId, organizationId, result = 'succeeded', action = 'organization.update' }) {
  return { id: eventId, createdAt: stamp(at), actorId, organizationId, action, result, legacy: false };
}
function detail(row, { operationId = id(20), source = 'organization_operation', version = 1 } = {}) {
  return { eventId: row.id, operationId, source, organizationId: row.organizationId, actorId: row.actorId, originalActorId: row.actorId,
    result: row.result, action: row.action, version };
}
function requests(capture) {
  const definitions = [['session', 200], ['detail', capture.detail.status], ['preview', capture.preview.status], ['audit-list', capture.audit.status],
    ...capture.audit.details.map(() => ['audit-detail', 200]), ...(capture.deletion ? [['deletion', 200]] : [])];
  capture.requests = definitions.map(([route, status], index) => ({ route, status, method: 'GET',
    at: stamp(Date.parse(capture.capturedAt) - (definitions.length - index) * 50), bytes: 100 }));
  return capture;
}

export function makeEvidenceFixture({ caseId = 'save_success', surface = 'organization', mode = 'functional', now = Date.now(), origin = ORIGIN } = {}) {
  const runId = id(1), organizationId = 900001, administratorUserId = 900002;
  const startedAt = now - 120_000, beforeAt = now - 90_000, runAt = now - 80_000;
  const org = { id: organizationId, nameDigest: digest(`${runId}:synthetic-name`), slugDigest: digest(`${runId}:synthetic-slug`),
    descriptionDigest: digest(`${runId}:before-description`), version: 1, active: true, storageStatus: 'READY',
    projectCount: 0, fileCount: 0, userCount: 1, syntheticMarkerMatches: true };
  const old = entry({ at: beforeAt - 2000, actorId: administratorUserId, organizationId });
  const before = requests({ id: id(2), capturedAt: stamp(beforeAt), administratorUserId, requests: [],
    detail: { status: 200, organization: org },
    preview: { status: 200, eligible: false, version: 1, blockers: [{ code: 'ORGANIZATION_ACTIVE', count: 1, action: { kind: 'pause', enabled: true } }], waitUntil: null },
    audit: { status: 200, truncated: false, entries: [old], details: [detail(old)] }, deletion: null });
  const evidence = { schemaVersion: 1, kind: 'organization-functional-evidence', contractVersion: 1, origin, mode, runId,
    organizationId, administratorUserId, expectedCommit: 'a'.repeat(40), expectedDeploymentId: id(40),
    startedAt: stamp(startedAt), capturedAt: stamp(beforeAt), requestedCases: [caseId], captures: [before], uiRuns: [] };
  if (caseId === 'snapshot') return evidence;
  const samples = makeUiSamples({ kind: caseId === 'save_error' ? 'error' : 'success', surface, runId });
  const endAt = runAt + samples.at(-1).t, afterAt = endAt + 1000;
  const after = structuredClone(before);
  after.id = id(3); after.capturedAt = stamp(afterAt);
  const fresh = entry({ id: 'frame:11', at: runAt + 600, actorId: administratorUserId, organizationId,
    result: caseId === 'save_error' ? 'failed' : caseId === 'recovery_query' ? 'unknown' : 'succeeded',
    action: caseId === 'deletion_observed' ? 'organization.permanent_delete' : 'organization.update' });
  const source = caseId === 'deletion_observed' ? 'organization_deletion_audit' : caseId === 'recovery_query' ? 'organization_operation_consultation' : 'organization_operation';
  const operationId = caseId === 'recovery_query' ? id(20) : id(21);
  after.audit.entries = [fresh, old]; after.audit.details = [detail(fresh, { operationId, source }), detail(old)];
  if (caseId === 'save_success') {
    after.detail.organization.version = 2;
    after.detail.organization.descriptionDigest = digest(`${runId}:after-description`);
    after.preview.version = 2;
  }
  if (caseId === 'deletion_observed') {
    after.detail = { status: 404, organization: null };
    after.preview = { status: 404, eligible: null, version: null, blockers: [], waitUntil: null };
    after.deletion = { id: operationId, organizationId, state: 'completed', hasError: false };
  } else evidence.uiRuns.push({ id: id(4), caseId, sampling: 'animation_frame', startedAt: stamp(runAt), endedAt: stamp(endAt),
    beforeCaptureId: before.id, afterCaptureId: after.id, samples, stopReason: 'finished' });
  evidence.captures.push(requests(after)); evidence.capturedAt = stamp(afterAt);
  return evidence;
}

export function makeEnvironmentFixture(evidence = makeEvidenceFixture()) {
  const finishedAt = Date.parse(evidence.startedAt) - 60_000;
  const report = { reportVersion: 1, suite: 'organization-management-readiness', mode: 'preflight', ok: true,
    expectedCommit: evidence.expectedCommit, organizationId: evidence.organizationId,
    workflowRunId: '123456789', workflowRunAttempt: 1, generatedAt: stamp(finishedAt - 1000), finishedAt: stamp(finishedAt),
    writesPerformed: false, acceptanceExecuted: false, complete: false, acceptanceIncomplete: true,
    preflight: { name: 'maono-kepler-v1', productionBranch: 'mano_kepler_v1', databaseId: '5bc4dc32-f3bd-4c92-bbd1-cbda63e467db', baseUrl: ORIGIN,
      pendingProductionDeployments: [], configuredFlags: {},
      canonical: { id: evidence.expectedDeploymentId, environment: 'production', stage: 'deploy', status: 'success',
        commit: evidence.expectedCommit, commitDirty: false, flags: {} } } };
  const bytes = JSON.stringify(report);
  return { bytes, sha256: digest(bytes), source: `https://github.com/matheusapc22/maono_kepler_v1/actions/runs/${report.workflowRunId}` };
}
