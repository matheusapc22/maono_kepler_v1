import { createHash } from 'node:crypto';

// AU-AC01-A is an offline evidence contract, NOT a registered Production suite.
// In particular, it cannot activate flags, authenticate an administrator, or
// turn a human export into a cryptographic attestation of remote execution.
export const CONTRACT = Object.freeze({
  id: 'organization-functional-evidence', version: 1, phase: 'AU-AC01-A',
  registeredProductionSuite: false,
  cases: Object.freeze(['snapshot', 'save_success', 'save_error', 'recovery_query', 'deletion_observed']),
  maxEvidenceBytes: 2 * 1024 * 1024, maxResponseBytes: 256 * 1024,
  maxCaptures: 12, maxUiRuns: 4, maxSamples: 1300, maxRunMs: 30 * 60_000,
  maxUiRunMs: 120_000, maxEvidenceAgeMs: 24 * 60 * 60_000, maxEnvironmentAgeMs: 15 * 60_000,
  maxIncompleteUiOverrunMs: 1000,
});
const strictPattern = pattern => ({ test: value => typeof value === 'string' && pattern.exec(value)?.[0] === value });
const SHA = strictPattern(/^[0-9a-f]{64}$/);
const COMMIT = strictPattern(/^[0-9a-f]{40}$/);
const UUID = strictPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const EVENT = strictPattern(/^(?:frame|legacy):[1-9][0-9]{0,14}$/);
const CODE = strictPattern(/^[A-Z][A-Z0-9_]{0,100}$/);
const WORKFLOW_SOURCE = strictPattern(/^https:\/\/github\.com\/matheusapc22\/maono_kepler_v1\/actions\/runs\/[1-9][0-9]{0,19}(?:\/attempts\/[1-9][0-9]{0,5})?$/);
const WORKFLOW_ID = strictPattern(/^[1-9][0-9]{0,19}$/);
const RESULTS = new Set(['requested', 'authorized', 'denied', 'running', 'succeeded', 'failed', 'blocked', 'partial', 'unknown', 'noop', 'legacy_unproven']);
const ACTIONS = new Set(['organization.create', 'organization.created', 'organization.update', 'organization.updated',
  'organization.legacy_updated', 'organization.policy_updated', 'organization.configured', 'organization.pause', 'organization.paused',
  'organization.resume', 'organization.resumed', 'organization.review', 'organization.request_approved', 'organization.request_rejected',
  'organization.permanent_delete', 'organization.reconcile', 'organization.deletion_requested', 'organization.storage_recovery',
  'organization.storage_disable', 'organization.storage_observed', 'other']);
const AUDIT_SOURCES = new Set(['audit_logs', 'organization_operation', 'organization_management_events', 'organization_lifecycle',
  'organization_legacy_create', 'organization_storage_observation', 'organization_deletion', 'organization_deletion_audit',
  'organization_deletion_inspection', 'organization_deletion_worker', 'organization_operation_inspection',
  'organization_operation_consultation', 'organization_reconciliation', 'audit_recovery_request', 'other']);
const SOURCES = new Set(['session', 'detail', 'preview', 'audit-list', 'audit-detail', 'deletion']);
const ORIGIN = 'https://maono-kepler-v1.pages.dev';
const DATABASE = '5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';
const STORAGE = new Set(['UNKNOWN', 'READY', 'ACTIVE', 'CONFIGURED', 'DISABLED', 'PENDING', 'PREPARING', 'ERROR', 'FAILED', 'RECOVERING', 'DELETING']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => integer(value) && value > 0;
const bool = value => typeof value === 'boolean';
const nullable = (value, predicate) => value === null || predicate(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const time = value => Date.parse(value);
export class OrganizationEvidenceError extends Error {
  constructor(code) { super(code); this.name = 'OrganizationEvidenceError'; this.code = code; }
}
function check(value, code = 'ORG_EVIDENCE_INVALID') { if (!value) throw new OrganizationEvidenceError(code); }
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest('hex');

export function allowedEvidenceOrigin(value) {
  try {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password && (
      url.protocol === 'https:' && /^(?:[a-z0-9-]+\.)?maono-kepler-v1\.pages\.dev$/.test(url.hostname) ||
      url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
  } catch { return false; }
}
function rect(value) {
  return nullable(value, row => exact(row, ['x', 'y', 'width', 'height']) && ['x', 'y', 'width', 'height'].every(key =>
    Number.isFinite(row[key]) && Math.abs(row[key]) <= 100_000) && row.width >= 0 && row.height >= 0);
}
function validateEntry(row, scope) {
  check(exact(row, ['id', 'createdAt', 'actorId', 'organizationId', 'action', 'result', 'legacy']) && EVENT.test(row.id) &&
    nullable(row.createdAt, timestamp) && nullable(row.actorId, positive) && row.organizationId === scope.organizationId &&
    ACTIONS.has(row.action) && RESULTS.has(row.result) && bool(row.legacy) && row.id.startsWith(row.legacy ? 'legacy:' : 'frame:'));
}
function validateCapture(capture, scope) {
  check(exact(capture, ['id', 'capturedAt', 'administratorUserId', 'requests', 'detail', 'preview', 'audit', 'deletion']) && UUID.test(capture.id) &&
    timestamp(capture.capturedAt) && capture.administratorUserId === scope.administratorUserId);
  check(Array.isArray(capture.requests) && capture.requests.length >= 4 && capture.requests.length <= 9);
  for (const request of capture.requests) {
    check(exact(request, ['route', 'method', 'status', 'at', 'bytes']) && SOURCES.has(request.route) && request.method === 'GET' &&
      integer(request.status) && request.status >= 200 && request.status <= 599 && timestamp(request.at) && integer(request.bytes) && request.bytes <= CONTRACT.maxResponseBytes);
    check(time(request.at) >= time(scope.startedAt) && time(request.at) <= time(capture.capturedAt), 'ORG_REQUEST_TIME_INVALID');
  }
  for (const name of ['session', 'detail', 'preview', 'audit-list']) check(capture.requests.filter(row => row.route === name).length === 1);
  check(capture.requests[0].route === 'session' && capture.requests[0].status === 200);
  const d = capture.detail;
  check(exact(d, ['status', 'organization']) && [200, 404, 503].includes(d.status));
  if (d.status === 200) {
    const org = d.organization;
    check(exact(org, ['id', 'nameDigest', 'slugDigest', 'descriptionDigest', 'version', 'active', 'storageStatus', 'projectCount', 'fileCount', 'userCount', 'syntheticMarkerMatches']) &&
      org.id === scope.organizationId && [org.nameDigest, org.slugDigest, org.descriptionDigest].every(value => SHA.test(value)) && integer(org.version) && bool(org.active) &&
      STORAGE.has(org.storageStatus) && [org.projectCount, org.fileCount, org.userCount].every(integer) && bool(org.syntheticMarkerMatches));
    if (scope.mode === 'functional') check(org.syntheticMarkerMatches, 'ORG_SYNTHETIC_SCOPE_UNCONFIRMED');
  } else check(d.organization === null);
  const p = capture.preview;
  check(exact(p, ['status', 'eligible', 'version', 'blockers', 'waitUntil']) && [200, 404, 503].includes(p.status) && Array.isArray(p.blockers) && p.blockers.length <= 100);
  if (p.status === 200) {
    check(bool(p.eligible) && integer(p.version) && nullable(p.waitUntil, timestamp));
    for (const blocker of p.blockers) check(exact(blocker, ['code', 'count', 'action']) && CODE.test(blocker.code) && integer(blocker.count) &&
      nullable(blocker.action, action => exact(action, ['kind', 'enabled']) && ['pause', 'query', 'follow', 'review'].includes(action.kind) && bool(action.enabled)));
    check(!p.eligible || p.blockers.length === 0);
  } else check(p.eligible === null && p.version === null && p.waitUntil === null && p.blockers.length === 0);
  const audit = capture.audit;
  check(exact(audit, ['status', 'truncated', 'entries', 'details']) && [200, 404, 503].includes(audit.status) && bool(audit.truncated) &&
    Array.isArray(audit.entries) && audit.entries.length <= 25 && Array.isArray(audit.details) && audit.details.length <= 3);
  if (audit.status !== 200) check(audit.entries.length === 0 && audit.details.length === 0 && !audit.truncated);
  audit.entries.forEach(row => validateEntry(row, scope));
  check(new Set(audit.entries.map(row => row.id)).size === audit.entries.length);
  for (const row of audit.details) {
    check(exact(row, ['eventId', 'operationId', 'source', 'organizationId', 'actorId', 'originalActorId', 'result', 'action', 'version']) &&
      EVENT.test(row.eventId) && nullable(row.operationId, value => UUID.test(value)) && AUDIT_SOURCES.has(row.source) &&
      row.organizationId === scope.organizationId && nullable(row.actorId, positive) && nullable(row.originalActorId, positive) && RESULTS.has(row.result) &&
      ACTIONS.has(row.action) && nullable(row.version, integer));
    const entry = audit.entries.find(value => value.id === row.eventId);
    check(entry && entry.actorId === row.actorId && entry.action === row.action && entry.result === row.result);
  }
  check(new Set(audit.details.map(row => row.eventId)).size === audit.details.length);
  if (capture.deletion !== null) {
    const deletion = capture.deletion;
    check(exact(deletion, ['id', 'organizationId', 'state', 'hasError']) && UUID.test(deletion.id) && deletion.organizationId === scope.organizationId &&
      ['pending', 'storage_deleted', 'completed'].includes(deletion.state) && bool(deletion.hasError));
  }
  check(capture.requests.find(row => row.route === 'detail').status === d.status && capture.requests.find(row => row.route === 'preview').status === p.status &&
    capture.requests.find(row => row.route === 'audit-list').status === audit.status && capture.requests.filter(row => row.route === 'audit-detail').length === audit.details.length);
  check(capture.requests.filter(row => row.route === 'audit-detail').every(row => row.status === 200));
  const deletionRequests = capture.requests.filter(row => row.route === 'deletion');
  check(deletionRequests.length <= 1 && (capture.deletion === null
    ? deletionRequests.length === 0 || [404, 503].includes(deletionRequests[0].status)
    : deletionRequests.length === 1 && deletionRequests[0].status === 200), 'ORG_DELETION_REQUEST_UNCONFIRMED');
}
function validateSample(sample, maxUiMs) {
  check(exact(sample, ['t', 'surface', 'dialogId', 'formId', 'busy', 'overlay', 'loaderColors', 'rect', 'draftDigest', 'scroll', 'viewport', 'documentVisible', 'focusInDialog', 'technicalReports', 'toasts']) &&
    nullable(sample.surface, value => ['organization', 'audit'].includes(value)) &&
    Number.isFinite(sample.t) && sample.t >= 0 && sample.t <= maxUiMs && nullable(sample.dialogId, positive) && nullable(sample.formId, positive) &&
    bool(sample.busy) && bool(sample.overlay) && rect(sample.rect) && nullable(sample.draftDigest, value => SHA.test(value)) &&
    Number.isFinite(sample.scroll) && sample.scroll >= 0 && sample.scroll <= 100_000 && exact(sample.viewport, ['width', 'height']) &&
    positive(sample.viewport.width) && positive(sample.viewport.height) && sample.viewport.width <= 20_000 && sample.viewport.height <= 20_000 &&
    bool(sample.documentVisible) && bool(sample.focusInDialog) && integer(sample.technicalReports));
  check(Array.isArray(sample.loaderColors) && sample.loaderColors.length <= 12 && sample.loaderColors.every(color => Array.isArray(color) && color.length === 3 && color.every(v => integer(v) && v <= 255)));
  check(Array.isArray(sample.toasts) && sample.toasts.length <= 2);
  for (const toast of sample.toasts) check(exact(toast, ['id', 'kind', 'rect', 'hasCloseButton', 'hasTechnicalReference']) && positive(toast.id) &&
    ['success', 'error'].includes(toast.kind) && toast.rect !== null && rect(toast.rect) && bool(toast.hasCloseButton) && bool(toast.hasTechnicalReference));
}

export function validateOrganizationEvidence(value, { now = Date.now() } = {}) {
  check(object(value) && Buffer.byteLength(JSON.stringify(value)) <= CONTRACT.maxEvidenceBytes, 'ORG_EVIDENCE_SIZE_INVALID');
  check(exact(value, ['schemaVersion', 'kind', 'contractVersion', 'origin', 'mode', 'runId', 'organizationId', 'administratorUserId', 'expectedCommit', 'expectedDeploymentId', 'startedAt', 'capturedAt', 'requestedCases', 'captures', 'uiRuns']) &&
    value.schemaVersion === 1 && value.kind === 'organization-functional-evidence' && value.contractVersion === CONTRACT.version && allowedEvidenceOrigin(value.origin) &&
    ['diagnostic', 'functional'].includes(value.mode) && UUID.test(value.runId) && positive(value.organizationId) && positive(value.administratorUserId) &&
    COMMIT.test(value.expectedCommit) && UUID.test(value.expectedDeploymentId) && timestamp(value.startedAt) && timestamp(value.capturedAt));
  check(time(value.startedAt) <= time(value.capturedAt) && time(value.capturedAt) <= now + 60_000 && time(value.capturedAt) >= now - CONTRACT.maxEvidenceAgeMs &&
    time(value.capturedAt) - time(value.startedAt) <= CONTRACT.maxRunMs, 'ORG_EVIDENCE_TIME_INVALID');
  check(Array.isArray(value.requestedCases) && value.requestedCases.length > 0 && value.requestedCases.length <= CONTRACT.cases.length &&
    value.requestedCases.every(id => CONTRACT.cases.includes(id)) && new Set(value.requestedCases).size === value.requestedCases.length);
  if (value.mode === 'diagnostic') check(value.requestedCases.length === 1 && value.requestedCases[0] === 'snapshot', 'ORG_DIAGNOSTIC_MUTATION_CASE');
  check(Array.isArray(value.captures) && value.captures.length > 0 && value.captures.length <= CONTRACT.maxCaptures && Array.isArray(value.uiRuns) && value.uiRuns.length <= CONTRACT.maxUiRuns);
  for (const capture of value.captures) {
    validateCapture(capture, value);
    check(time(capture.capturedAt) >= time(value.startedAt) && time(capture.capturedAt) <= time(value.capturedAt));
  }
  check(new Set(value.captures.map(row => row.id)).size === value.captures.length);
  for (let i = 1; i < value.captures.length; i++) check(time(value.captures[i].capturedAt) > time(value.captures[i - 1].capturedAt), 'ORG_CAPTURE_ORDER_INVALID');
  for (const run of value.uiRuns) {
    check(object(run) && run.sampling === 'animation_frame', 'ORG_UI_SAMPLING_UNCONFIRMED');
    check(exact(run, ['id', 'caseId', 'sampling', 'startedAt', 'endedAt', 'beforeCaptureId', 'afterCaptureId', 'samples', 'stopReason']) && UUID.test(run.id) &&
      ['save_success', 'save_error', 'recovery_query'].includes(run.caseId) && value.requestedCases.includes(run.caseId) && timestamp(run.startedAt) && timestamp(run.endedAt) &&
      UUID.test(run.beforeCaptureId) && nullable(run.afterCaptureId, id => UUID.test(id)) && ['finished', 'timeout', 'stopped', 'session_changed'].includes(run.stopReason));
    const before = value.captures.find(row => row.id === run.beforeCaptureId), after = value.captures.find(row => row.id === run.afterCaptureId);
    const maxUiMs = CONTRACT.maxUiRunMs + (run.stopReason === 'finished' ? 0 : CONTRACT.maxIncompleteUiOverrunMs);
    check(before && time(before.capturedAt) <= time(run.startedAt) && time(run.startedAt) < time(run.endedAt) && time(run.endedAt) <= time(value.capturedAt) &&
      time(run.endedAt) - time(run.startedAt) <= maxUiMs);
    if (run.stopReason === 'finished') check(after && time(after.capturedAt) >= time(run.endedAt));
    check(Array.isArray(run.samples) && run.samples.length > 0 && run.samples.length <= CONTRACT.maxSamples);
    run.samples.forEach(sample => validateSample(sample, maxUiMs));
    for (let i = 1; i < run.samples.length; i++) check(run.samples[i].t > run.samples[i - 1].t, 'ORG_UI_SAMPLE_ORDER');
    check(run.samples.at(-1).t <= time(run.endedAt) - time(run.startedAt) + 100);
  }
  check(new Set(value.uiRuns.map(row => row.caseId)).size === value.uiRuns.length && new Set(value.uiRuns.map(row => row.id)).size === value.uiRuns.length);
  const runsByTime = [...value.uiRuns].sort((a, b) => time(a.startedAt) - time(b.startedAt));
  for (let i = 1; i < runsByTime.length; i++) check(time(runsByTime[i].startedAt) >= time(runsByTime[i - 1].endedAt), 'ORG_UI_RUN_OVERLAP');
  return structuredClone(value);
}

const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;
function sameRect(a, b) { return a && b && ['x', 'y', 'width', 'height'].every(key => near(a[key], b[key])); }
function visibleRect(rectangle, viewport) {
  return rectangle && rectangle.width > 0 && rectangle.height > 0 && rectangle.x >= -1 && rectangle.y >= -1 &&
    rectangle.x + rectangle.width <= viewport.width + 1 && rectangle.y + rectangle.height <= viewport.height + 1;
}
function centered(sample) {
  return visibleRect(sample.rect, sample.viewport) && near(sample.rect.x + sample.rect.width / 2, sample.viewport.width / 2, 4) &&
    near(sample.rect.y + sample.rect.height / 2, sample.viewport.height / 2, 4);
}
function uiChecks(run, kind) {
  if (!run || run.stopReason !== 'finished') return ['UI_RECORDING_INCOMPLETE'];
  const samples = run.samples, first = samples[0], last = samples.at(-1), busy = samples.filter(row => row.busy);
  const failures = [];
  if (samples.length < 5 || first.t > 100 || last.t < time(run.endedAt) - time(run.startedAt) - 250 ||
    !samples.every(row => row.documentVisible) || samples.some((row, i) => i && row.t - samples[i - 1].t > 500)) failures.push('UI_SAMPLING_INCOMPLETE');
  if (!first.dialogId || !first.formId || !first.draftDigest || first.busy || !busy.length || !samples.some(row => !row.busy && row.t > busy.at(-1).t)) failures.push('UI_LOADING_NOT_OBSERVED');
  if (!samples.every(row => row.dialogId === first.dialogId && row.surface !== null && row.surface === first.surface && visibleRect(row.rect, row.viewport) &&
    row.viewport.width === first.viewport.width && row.viewport.height === first.viewport.height)) failures.push('UI_DIALOG_CONTINUITY_FAILED');
  if ((run.caseId !== 'recovery_query' && first.surface !== 'organization') ||
    first.surface === 'organization' && !samples.every(centered)) failures.push('UI_DIALOG_PLACEMENT_FAILED');
  if (!busy.every(row => row.formId === first.formId && row.draftDigest === first.draftDigest && sameRect(row.rect, first.rect) && near(row.scroll, first.scroll) && row.overlay &&
    row.loaderColors.some(([r, g, b]) => r >= 160 && g >= 100 && g < r && b < g && b <= 170))) failures.push('UI_FORM_OR_GOLD_OVERLAY_FAILED');
  if (samples.some(row => row.technicalReports > 0 || row.toasts.some(toast => toast.hasTechnicalReference))) failures.push('UI_TECHNICAL_REPORT_VISIBLE');
  if (kind === 'error' && !samples.every(row => row.formId === first.formId && row.draftDigest === first.draftDigest)) failures.push('UI_ERROR_DRAFT_NOT_PRESERVED');
  const shown = samples.flatMap(sample => sample.toasts.filter(row => row.kind === kind).map(toast => ({ sample, toast })));
  if (!shown.length || new Set(shown.map(row => row.toast.id)).size !== 1) failures.push('UI_TOAST_NOT_OBSERVED');
  else {
    const beginning = shown[0], ending = samples.find(row => row.t > shown.at(-1).sample.t && !row.toasts.some(toast => toast.id === beginning.toast.id));
    const duration = ending ? ending.t - beginning.sample.t : null;
    const target = kind === 'success' ? 3000 : 10000;
    // A confirmed notice can coexist with the loader during the final React
    // commit. It must not predate the action or flicker; outcome timestamps are
    // correlated separately below. Raw MutationObserver microstates are not
    // accepted as animation-frame observations by this contract.
    if (first.toasts.length || !busy.length || beginning.sample.t <= busy[0].t ||
      samples.some(row => row.t >= beginning.sample.t && row.t <= shown.at(-1).sample.t && !row.toasts.some(toast => toast.id === beginning.toast.id))) failures.push('UI_TOAST_CHRONOLOGY_UNCONFIRMED');
    if (duration === null || duration < target - 500 || duration > target + 600) failures.push('UI_TOAST_DURATION_UNCONFIRMED');
    if (!shown.every(({ sample, toast }) => {
      const r = toast.rect, right = sample.viewport.width - r.x - r.width;
      const edge = kind === 'error' ? r.y : sample.viewport.height - r.y - r.height;
      return visibleRect(r, sample.viewport) && right >= 0 && right <= 40 && edge >= 0 && edge <= 40 && (kind !== 'error' || toast.hasCloseButton);
    })) failures.push('UI_TOAST_PLACEMENT_FAILED');
    if (!ending || last.t < ending.t + 400 || !last.dialogId) failures.push('UI_POST_TOAST_CONTINUITY_UNCONFIRMED');
  }
  return [...new Set(failures)];
}
function freshFrames(before, after, scope, startedAt) {
  if (!before || !after || before.audit.status !== 200 || after.audit.status !== 200 || before.audit.truncated || after.audit.truncated) return [];
  const prior = new Set(before.audit.entries.map(row => row.id));
  return after.audit.entries.filter(row => !prior.has(row.id) && !row.legacy && row.actorId === scope.administratorUserId && row.createdAt &&
    time(row.createdAt) >= time(startedAt) - 1000 && time(row.createdAt) >= time(before.capturedAt) - 1000 && time(row.createdAt) <= time(after.capturedAt) + 1000);
}
function freshDetails(before, after, scope, startedAt) {
  const fresh = new Set(freshFrames(before, after, scope, startedAt).map(row => row.id));
  return after?.audit.details.filter(row => fresh.has(row.eventId) && row.operationId !== null && row.originalActorId === scope.administratorUserId)
    .map(row => ({ ...row, createdAt: after.audit.entries.find(entry => entry.id === row.eventId).createdAt })) || [];
}
function caseResult(id, evidence) {
  let failures = [];
  if (id === 'snapshot') {
    const last = evidence.captures.at(-1);
    if (last.detail.status !== 200 || last.preview.status !== 200 || last.audit.status !== 200 || last.audit.truncated) failures.push('DOMAIN_SNAPSHOT_INCOMPLETE');
  } else if (id === 'deletion_observed') {
    const first = evidence.captures[0], last = evidence.captures.at(-1);
    const fresh = freshDetails(first, last, evidence, first.capturedAt);
    if (first.detail.status !== 200 || last.detail.status !== 404 || !last.deletion || last.deletion.state !== 'completed' || last.deletion.hasError ||
      !fresh.some(row => row.operationId === last.deletion.id && row.result === 'succeeded' && row.action === 'organization.permanent_delete' &&
        ['organization_deletion', 'organization_deletion_audit'].includes(row.source))) failures.push('DELETION_DOMAIN_EVIDENCE_INCOMPLETE');
  } else {
    const run = evidence.uiRuns.find(row => row.caseId === id), before = evidence.captures.find(row => row.id === run?.beforeCaptureId), after = evidence.captures.find(row => row.id === run?.afterCaptureId);
    failures = uiChecks(run, id === 'save_error' ? 'error' : 'success');
    const kind = id === 'save_error' ? 'error' : 'success';
    const firstNotice = run?.samples.find(row => row.toasts.some(toast => toast.kind === kind));
    // D1 event timestamps have second precision. This bounds correlation to
    // the first notice without pretending to have millisecond server evidence.
    const noticeDeadline = run && firstNotice ? time(run.startedAt) + firstNotice.t + 1000 : NaN;
    const details = freshDetails(before, after, evidence, run?.startedAt).filter(row => time(row.createdAt) <= noticeDeadline);
    if (id === 'save_success') {
      if (!before?.detail.organization || !after?.detail.organization || after.detail.organization.version !== before.detail.organization.version + 1 ||
        after.detail.organization.descriptionDigest === before.detail.organization.descriptionDigest ||
        !details.some(row => row.result === 'succeeded' && (row.action === 'organization.update' && row.source === 'organization_operation' && row.version === before.detail.organization.version ||
          row.action === 'organization.updated' && row.source === 'organization_management_events' && row.version === after.detail.organization.version))) failures.push('SAVE_EFFECT_NOT_CORRELATED');
    } else if (id === 'save_error') {
      if (!before?.detail.organization || !after?.detail.organization || before.detail.organization.version !== after.detail.organization.version ||
        before.detail.organization.descriptionDigest !== after.detail.organization.descriptionDigest ||
        !details.some(row => ['failed', 'blocked'].includes(row.result) && row.action === 'organization.update' && row.source === 'organization_operation' &&
          row.version === before.detail.organization.version)) failures.push('SAVE_FAILURE_NOT_CORRELATED');
    } else {
      const priorOperations = new Set(before?.audit.details.filter(row => row.operationId).map(row => row.operationId));
      if (!details.some(row => priorOperations.has(row.operationId) &&
        ['organization_operation_consultation', 'organization_reconciliation', 'organization_operation_inspection'].includes(row.source))) failures.push('RECOVERY_OBSERVATION_NOT_CORRELATED');
    }
  }
  return { id, status: failures.length ? 'INCOMPLETE' : 'OBSERVED', findings: [...new Set(failures)] };
}

// The caller pins bytes from an externally reviewed artifact. A matching digest
// proves byte identity, not the identity of the service/human who produced it.
function environmentBinding(evidence, external, now) {
  if (!external) return { matched: false, reason: 'EXTERNAL_ENVIRONMENT_REPORT_REQUIRED' };
  check(exact(external, ['bytes', 'sha256', 'source']) && (typeof external.bytes === 'string' || Buffer.isBuffer(external.bytes)) &&
    SHA.test(external.sha256) && WORKFLOW_SOURCE.test(external.source), 'ORG_EXTERNAL_PROVENANCE_INVALID');
  check(Buffer.byteLength(external.bytes) <= 1024 * 1024 && digest(external.bytes) === external.sha256, 'ORG_EXTERNAL_DIGEST_MISMATCH');
  let report; try { report = JSON.parse(String(external.bytes)); } catch { check(false, 'ORG_EXTERNAL_REPORT_INVALID'); }
  const snapshot = report?.mode === 'preflight' ? report.preflight : report?.final;
  check(report && report.reportVersion === 1 && ['preflight', 'run', 'closure'].includes(report.mode) && report.expectedCommit === evidence.expectedCommit &&
    report.organizationId === evidence.organizationId && timestamp(report.generatedAt) && timestamp(report.finishedAt) &&
    time(report.finishedAt) >= time(report.generatedAt) && time(report.finishedAt) <= now + 60_000 && time(report.finishedAt) <= time(evidence.startedAt) &&
    time(report.finishedAt) >= time(evidence.startedAt) - CONTRACT.maxEnvironmentAgeMs &&
    snapshot?.name === 'maono-kepler-v1' && snapshot.productionBranch === 'mano_kepler_v1' && snapshot.databaseId === DATABASE && snapshot.baseUrl === ORIGIN && evidence.origin === ORIGIN &&
    Array.isArray(snapshot.pendingProductionDeployments) && snapshot.pendingProductionDeployments.length === 0 &&
    snapshot.canonical?.id === evidence.expectedDeploymentId && snapshot.canonical.environment === 'production' && snapshot.canonical.stage === 'deploy' &&
    snapshot.canonical.status === 'success' && snapshot.canonical.commit === evidence.expectedCommit && snapshot.canonical.commitDirty === false, 'ORG_EXTERNAL_ENVIRONMENT_MISMATCH');
  if (report.mode === 'preflight') check(report.suite === 'organization-management-readiness' && report.ok === true &&
    report.writesPerformed === false && report.acceptanceExecuted === false, 'ORG_EXTERNAL_REPORT_INVALID');
  else check(report.configurationRestored === true, 'ORG_EXTERNAL_RESTORATION_UNCONFIRMED');
  // Earlier readiness reports did not record GitHub run identity. Do not fill
  // those fields from the caller's URL: that would fabricate provenance.
  if (report.workflowRunId === undefined || report.workflowRunAttempt === undefined) return {
    matched: false, reason: 'EXTERNAL_WORKFLOW_IDENTITY_UNRECORDED', artifactSha256: external.sha256, source: external.source,
  };
  const reference = /\/actions\/runs\/([1-9][0-9]*)(?:\/attempts\/([1-9][0-9]*))?$/.exec(external.source);
  check(WORKFLOW_ID.test(report.workflowRunId) &&
    report.workflowRunId === reference[1] && positive(report.workflowRunAttempt) && report.workflowRunAttempt === Number(reference[2] || 1), 'ORG_EXTERNAL_WORKFLOW_MISMATCH');
  if (report.runId !== undefined) check(report.runId === evidence.runId, 'ORG_EXTERNAL_RUN_MISMATCH');
  return { matched: true, artifactSha256: external.sha256, source: external.source, mode: report.mode,
    workflowRunId: report.workflowRunId, workflowRunAttempt: report.workflowRunAttempt,
    expectedCommit: report.expectedCommit, deploymentId: snapshot.canonical.id, databaseId: snapshot.databaseId,
    provenance: 'caller-pinned external artifact; offline consistency only', provesCurrentRuntime: false, provesMigration: false, provesAcceptanceWindow: false };
}

export function verifyOrganizationEvidence(input, { external = null, now = Date.now() } = {}) {
  const evidence = validateOrganizationEvidence(input, { now });
  const environment = environmentBinding(evidence, external, now);
  const cases = evidence.requestedCases.map(id => caseResult(id, evidence));
  const observationsComplete = cases.every(row => row.status === 'OBSERVED');
  return {
    schemaVersion: 1, kind: 'organization-functional-evidence-certificate', phase: CONTRACT.phase, contractVersion: CONTRACT.version,
    verifiedAt: new Date(now).toISOString(), evidenceDigest: digest(evidence), runId: evidence.runId, organizationId: evidence.organizationId,
    origin: evidence.origin, environment, cases, observationsComplete, ok: observationsComplete && environment.matched,
    verificationScope: 'offline_observation_consistency',
    uiObservations: evidence.uiRuns.map(run => ({ caseId: run.caseId, sampling: run.sampling,
      focusInsideInitially: run.samples[0].focusInDialog, focusOutsideDuringLoading: run.samples.some(row => row.busy && !row.focusInDialog),
      focusInsideAtEnd: run.samples.at(-1).focusInDialog, focusIsFunctionalGate: false })),
    complete: false, acceptanceIncomplete: true, registeredProductionSuite: false, operationalAcceptanceExecuted: false,
    cleanupVerified: false, restorationVerified: false, migrationVerified: false,
    pendingGates: ['AU_AC01_B_REGISTERED_WINDOW', 'AUTHORIZED_SYNTHETIC_SCOPE', 'BINDING_SCHEMA_POSTVALIDATION', 'COMPLETE_RESOURCE_CLEANUP', 'PAGES_AND_WORKERS_RESTORATION', 'AUTHENTICATED_T16_ACCEPTANCE'],
    trust: { source: 'human-session export', cryptographicAttestation: false, independentlyObservedHttp: false,
      statement: 'Validates structure, scope, chronology, animation-frame-scheduled DOM measurements and correlation within the supplied evidence. It does not capture or attest painted pixels. Focus is an observation, not a command-completion gate. Hashes do not authenticate a human export. A control-plane report does not prove the browser bundle, runtime, provider storage, migrations or an approved functional window.' },
  };
}
