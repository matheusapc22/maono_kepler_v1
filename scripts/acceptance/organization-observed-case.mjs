import { digest, verifyOrganizationEvidence } from './organization-functional-evidence.mjs';

function requireProof(ok, code) {
  if (!ok) throw new Error(code);
}
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const exact = (obj, fields) => obj && typeof obj === 'object' && !Array.isArray(obj) &&
  Object.keys(obj).length === fields.length && fields.every(key => Object.hasOwn(obj, key));

export function verifyObservedCase(bundle, expected) {
  requireProof(exact(bundle, ['version','kind','caseId','run','attempt','workflowSha','sha','productBranch','scenarios']) &&
    bundle.version === 3 && bundle.kind === 'organization-observed-loopback' && bundle.productBranch === 'mano_kepler_v1' &&
    expected && ['synthetic-organization-update','synthetic-organization-pause'].includes(expected.caseId) &&
    ['caseId','run','attempt','workflowSha','sha'].every(key => bundle[key] === expected[key]) &&
    Number.isSafeInteger(bundle.run) && bundle.run > 0 && Number.isSafeInteger(bundle.attempt) && bundle.attempt > 0 &&
    [bundle.workflowSha,bundle.sha].every(s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s)), 'OBSERVED_SCOPE');
  const edit = bundle.caseId === 'synthetic-organization-update';
  requireProof(exact(bundle.scenarios, ['success','conflict']), 'OBSERVED_SCENARIOS');
  const sessions = new Set(), operations = new Set();
  for (const key of ['success','conflict']) {
    const success = key === 'success', scenario = bundle.scenarios[key];
    const caseId = edit ? (success ? 'save_success' : 'edit_conflict') : (success ? 'pause_success' : 'pause_conflict');
    requireProof(exact(scenario, ['capture','http','controlBefore','controlAfter','linksBefore','linksAfter']), 'OBSERVED_FIELDS');
    const {capture, http} = scenario;
    requireProof(exact(http, ['run','attempt','workflowSha','caseId','sessionId','actor','target','operation','terminalOperation','kind','requestedVersion','expectedDescription','createStatus','stepStatus','itemState','terminal','releaseAt','sessionReads']) &&
      http.run === bundle.run && http.attempt === bundle.attempt && http.workflowSha === bundle.workflowSha && http.caseId === caseId &&
      uuid(http.sessionId) && uuid(http.operation) && http.operation === http.terminalOperation &&
      http.sessionId === capture.runId && http.sessionReads >= 3 && Number.isSafeInteger(http.sessionReads) &&
      http.actor === capture.administratorUserId && http.target === capture.organizationId && http.target === (edit ? 1 : 2) &&
      http.kind === (edit ? 'change' : 'pause') && http.terminal === true &&
      http.createStatus >= 200 && http.createStatus < 300 && Number.isInteger(http.createStatus) && http.stepStatus === 200 &&
      http.itemState === (success ? 'succeeded' : 'failed') && Number.isInteger(http.requestedVersion) &&
      (edit ? hash(http.expectedDescription) : http.expectedDescription === null), 'OBSERVED_HTTP');
    requireProof(capture.expectedCommit === bundle.sha && /^http:\/\/127\.0\.0\.1:\d+$/.test(capture.origin) &&
      capture.requestedCases.length === 1 && capture.requestedCases[0] === caseId && capture.uiRuns.length === 1, 'OBSERVED_CAPTURE_SCOPE');
    // Authenticity and freshness of the archived run are checked against GitHub separately.
    const result = verifyOrganizationEvidence(capture, {now:Date.parse(capture.capturedAt)});
    requireProof(result.cases[0].status === 'OBSERVED', 'OBSERVED_UI_DOMAIN_' + result.cases[0].findings.join('_'));
    const ui = capture.uiRuns[0];
    const before = capture.captures.find(c => c.id === ui.beforeCaptureId);
    const after = capture.captures.find(c => c.id === ui.afterCaptureId);
    const a = before.detail.organization, b = after.detail.organization;
    const firstToast = ui.samples.find(s => s.toasts.length);
    requireProof(Number.isSafeInteger(http.releaseAt) && ui.samples.some(s => s.busy && s.overlay &&
      Date.parse(ui.startedAt) + s.t < http.releaseAt) && firstToast &&
      Date.parse(ui.startedAt) + firstToast.t >= http.releaseAt && !ui.samples.some(s =>
        s.toasts.some(t => t.kind !== (success ? 'success' : 'error'))), 'OBSERVED_RESPONSE_ORDER');
    const terminalEvents = after.audit.details.filter(row => row.operationId === http.operation && row.source === 'organization_operation' &&
      row.version === http.requestedVersion && row.organizationId === http.target && row.originalActorId === http.actor && row.actorId === http.actor &&
      row.action === (edit ? 'organization.update' : 'organization.pause') &&
      ['succeeded','failed','blocked','partial','denied','unknown','noop'].includes(row.result) &&
      !before.audit.entries.some(prior => prior.id === row.eventId));
    requireProof(terminalEvents.length === 1, 'OBSERVED_TERMINAL_EVENT');
    const [audit] = terminalEvents;
    requireProof(success ? audit.result === 'succeeded' : ['failed','blocked'].includes(audit.result), 'OBSERVED_RESULT');
    const eventAt = Date.parse(after.audit.entries.find(entry => entry.id === audit.eventId)?.createdAt);
    requireProof(Number.isFinite(eventAt) && eventAt >= Math.max(Date.parse(before.capturedAt), Date.parse(ui.startedAt)) - 1000 &&
      eventAt <= Date.parse(ui.startedAt) + firstToast.t + 1000, 'OBSERVED_EVENT_TIME');
    requireProof(!before.audit.truncated && !after.audit.truncated && a.active &&
      http.requestedVersion === a.version - Number(!success) && b.version === a.version + Number(success) &&
      b.active === (edit || !success) && b.descriptionDigest === (edit && success ? http.expectedDescription : a.descriptionDigest) &&
      (!edit || http.expectedDescription !== a.descriptionDigest), 'OBSERVED_EFFECT');
    requireProof(hash(scenario.controlBefore) && scenario.controlBefore === scenario.controlAfter &&
      hash(scenario.linksBefore) && scenario.linksBefore === scenario.linksAfter, 'OBSERVED_ISOLATION');
    sessions.add(http.sessionId); operations.add(http.operation);
  }
  requireProof(sessions.size === 2 && operations.size === 2, 'OBSERVED_REPLAY');
  return digest(bundle.scenarios);
}
