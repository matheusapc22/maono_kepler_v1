import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTRACT, digest, validateOrganizationEvidence, verifyOrganizationEvidence, OrganizationEvidenceError } from '../scripts/acceptance/organization-functional-evidence.mjs';
import { FIXTURE_NOW, makeEvidenceFixture, makeEnvironmentFixture } from './helpers/organization-functional-evidence-fixture.mjs';

const fixture = (caseId = 'save_success', options = {}) => makeEvidenceFixture({ caseId, now: FIXTURE_NOW, ...options });
const verify = (evidence, external = makeEnvironmentFixture(evidence)) => verifyOrganizationEvidence(evidence, { external, now: FIXTURE_NOW });
function changedReport(evidence, mutate) {
  const external = makeEnvironmentFixture(evidence), report = JSON.parse(external.bytes);
  mutate(report, external);
  external.bytes = JSON.stringify(report); external.sha256 = digest(external.bytes);
  return external;
}
function assertIncomplete(evidence, finding) {
  const certificate = verify(evidence);
  assert.equal(certificate.ok, false);
  assert.equal(certificate.complete, false);
  assert.equal(certificate.observationsComplete, false);
  assert.ok(certificate.cases.some(row => row.findings.includes(finding)), JSON.stringify(certificate.cases));
}
function rejects(evidence, code, external) {
  assert.throws(() => external === undefined ? verify(evidence) : verify(evidence, external),
    error => error instanceof OrganizationEvidenceError && (!code || error.code === code));
}
function fresh(evidence, mutate) {
  const after = evidence.captures.at(-1), entry = after.audit.entries.find(row => row.id === 'frame:11'), detail = after.audit.details.find(row => row.eventId === 'frame:11');
  mutate(entry, detail, after);
}

for (const caseId of CONTRACT.cases) test(`offline ${caseId} observations do not certify operational acceptance`, () => {
  const evidence = fixture(caseId), original = structuredClone(evidence), certificate = verify(evidence);
  assert.deepEqual(certificate.cases, [{ id: caseId, status: 'OBSERVED', findings: [] }]);
  assert.equal(certificate.ok, true);
  assert.equal(certificate.environment.workflowRunId, '123456789');
  assert.equal(certificate.complete, false);
  assert.equal(certificate.acceptanceIncomplete, true);
  for (const field of ['registeredProductionSuite', 'operationalAcceptanceExecuted', 'cleanupVerified', 'restorationVerified', 'migrationVerified']) assert.equal(certificate[field], false, field);
  assert.equal(certificate.trust.cryptographicAttestation, false);
  assert.equal(certificate.trust.independentlyObservedHttp, false);
  assert.equal(certificate.environment.provesCurrentRuntime, false);
  assert.ok(certificate.pendingGates.includes('COMPLETE_RESOURCE_CLEANUP'));
  assert.ok(certificate.pendingGates.includes('PAGES_AND_WORKERS_RESTORATION'));
  assert.deepEqual(evidence, original, 'verification must never rewrite supplied evidence');
});

for (const caseId of CONTRACT.sandboxCases) test(`reject sandbox case ${caseId} on the product origin`, () => {
  rejects(fixture(caseId), 'ORG_SANDBOX_ONLY');
});

test('GET snapshots and caller-supplied commit/deployment do not substitute for an external artifact', () => {
  const certificate = verify(fixture('snapshot'), null);
  assert.equal(certificate.observationsComplete, true);
  assert.equal(certificate.ok, false);
  assert.equal(certificate.environment.reason, 'EXTERNAL_ENVIRONMENT_REPORT_REQUIRED');
});
test('a saved effect with only GET evidence cannot prove loading, form continuity or notices', () => {
  const evidence = fixture(); evidence.uiRuns = [];
  assertIncomplete(evidence, 'UI_RECORDING_INCOMPLETE');
});
test('anchored Audit recovery is valid but organization saves cannot relabel an uncentered dialog', () => {
  assert.equal(verify(fixture('recovery_query', { surface: 'audit' })).ok, true);
  assertIncomplete(fixture('save_success', { surface: 'audit' }), 'UI_DIALOG_PLACEMENT_FAILED');
});
test('successful completion may display the next form after loading ends', () => {
  const evidence = fixture();
  for (const sample of evidence.uiRuns[0].samples.filter(row => row.t >= 600)) { sample.formId = 9; sample.draftDigest = digest('synthetic-next-form'); }
  assert.equal(verify(evidence).ok, true);
});
test('recovery inspection proves observation, not a successful retry', () => {
  const evidence = fixture('recovery_query');
  fresh(evidence, (entry, detail) => { entry.result = 'unknown'; detail.result = 'unknown'; detail.source = 'organization_operation_inspection'; });
  assert.equal(verify(evidence).cases[0].status, 'OBSERVED');
  assert.equal(verify(evidence).operationalAcceptanceExecuted, false);
});

for (const [name, mutate, finding] of [
  ['late first sample', e => { e.uiRuns[0].samples.splice(0, 3); }, 'UI_SAMPLING_INCOMPLETE'],
  ['missing end of recording', e => {
    const run = e.uiRuns[0]; run.endedAt = new Date(Date.parse(run.endedAt) + 10_000).toISOString();
    e.captures[1].capturedAt = new Date(Date.parse(e.captures[1].capturedAt) + 10_000).toISOString(); e.capturedAt = e.captures[1].capturedAt;
  }, 'UI_SAMPLING_INCOMPLETE'],
  ['unobserved sampling gap', e => { e.uiRuns[0].samples = e.uiRuns[0].samples.filter(row => row.t < 800 || row.t >= 1600); }, 'UI_SAMPLING_INCOMPLETE'],
  ['hidden document', e => { e.uiRuns[0].samples[5].documentVisible = false; }, 'UI_SAMPLING_INCOMPLETE'],
  ['stable upper-left dialog', e => { e.uiRuns[0].samples.forEach(row => { row.rect.x = 0; row.rect.y = 0; }); }, 'UI_DIALOG_PLACEMENT_FAILED'],
  ['dialog outside viewport', e => { e.uiRuns[0].samples[7].rect.x = -40; }, 'UI_DIALOG_CONTINUITY_FAILED'],
  ['zero-area dialog', e => { e.uiRuns[0].samples.forEach(row => { row.rect.width = 0; }); }, 'UI_DIALOG_CONTINUITY_FAILED'],
  ['dialog closed after toast and reopened before final sample', e => { e.uiRuns[0].samples.at(-2).dialogId = null; }, 'UI_DIALOG_CONTINUITY_FAILED'],
  ['surface changed during request', e => { e.uiRuns[0].samples[3].surface = 'audit'; }, 'UI_DIALOG_CONTINUITY_FAILED'],
  ['form remounted during loading', e => { e.uiRuns[0].samples[3].formId = 22; }, 'UI_FORM_OR_GOLD_OVERLAY_FAILED'],
  ['draft changed during loading', e => { e.uiRuns[0].samples[3].draftDigest = digest('changed'); }, 'UI_FORM_OR_GOLD_OVERLAY_FAILED'],
  ['loading moved the form', e => { e.uiRuns[0].samples[3].rect.x += 30; }, 'UI_FORM_OR_GOLD_OVERLAY_FAILED'],
  ['loading lost scroll', e => { e.uiRuns[0].samples[3].scroll += 30; }, 'UI_FORM_OR_GOLD_OVERLAY_FAILED'],
  ['loading replaced overlay', e => { e.uiRuns[0].samples[3].overlay = false; }, 'UI_FORM_OR_GOLD_OVERLAY_FAILED'],
  ['spinner is not gold', e => { e.uiRuns[0].samples[3].loaderColors = [[255, 255, 255]]; }, 'UI_FORM_OR_GOLD_OVERLAY_FAILED'],
  ['technical report visible', e => { e.uiRuns[0].samples[7].technicalReports = 1; }, 'UI_TECHNICAL_REPORT_VISIBLE'],
  ['toast exposes technical reference', e => { e.uiRuns[0].samples[7].toasts[0].hasTechnicalReference = true; }, 'UI_TECHNICAL_REPORT_VISIBLE'],
  ['toast outside permitted corner', e => { e.uiRuns[0].samples[7].toasts[0].rect.x = 40; }, 'UI_TOAST_PLACEMENT_FAILED'],
  ['toast disappears early', e => { e.uiRuns[0].samples.filter(row => row.t >= 2000).forEach(row => { row.toasts = []; }); }, 'UI_TOAST_DURATION_UNCONFIRMED'],
  ['toast disappears and returns with same ID', e => { e.uiRuns[0].samples[15].toasts = []; }, 'UI_TOAST_CHRONOLOGY_UNCONFIRMED'],
  ['toast predates the action', e => { e.uiRuns[0].samples[0].toasts = structuredClone(e.uiRuns[0].samples[7].toasts); }, 'UI_TOAST_CHRONOLOGY_UNCONFIRMED'],
]) test(`UI evidence rejects ${name}`, () => {
  const evidence = fixture(); mutate(evidence); assertIncomplete(evidence, finding);
});

test('confirmed notice may coexist with the loader in the final rendered frame', () => {
  const evidence = fixture(), samples = evidence.uiRuns[0].samples, overlap = samples.find(row => row.t === 600);
  overlap.busy = true; overlap.overlay = true; overlap.loaderColors = [[229, 183, 77]];
  const nextFrame = structuredClone(samples.find(row => row.t === 700)); nextFrame.t = 616.67;
  samples.splice(samples.indexOf(overlap) + 1, 0, nextFrame);
  assert.equal(verify(evidence).ok, true);
});
test('focus during or after a command is reported without inventing a functional requirement', () => {
  const evidence = fixture('recovery_query'); evidence.uiRuns[0].samples.filter(row => row.t > 0).forEach(row => { row.focusInDialog = false; });
  const certificate = verify(evidence);
  assert.equal(certificate.ok, true);
  assert.deepEqual(certificate.uiObservations, [{ caseId: 'recovery_query', sampling: 'animation_frame',
    focusInsideInitially: true, focusOutsideDuringLoading: true, focusInsideAtEnd: false, focusIsFunctionalGate: false }]);
});
test('a raw DOM recording cannot be silently reinterpreted as rendered-frame evidence', () => {
  const evidence = fixture(); delete evidence.uiRuns[0].sampling;
  rejects(evidence, 'ORG_UI_SAMPLING_UNCONFIRMED');
});
test('a partial recorder may report truthful timeout overshoot without certifying success', () => {
  for (const reason of ['timeout', 'stopped']) {
    const evidence = fixture(), run = evidence.uiRuns[0], overrun = CONTRACT.maxUiRunMs + 500;
    run.stopReason = reason; run.afterCaptureId = null;
    run.endedAt = new Date(Date.parse(run.startedAt) + overrun).toISOString(); evidence.capturedAt = run.endedAt;
    run.samples.push({ ...structuredClone(run.samples.at(-1)), t: overrun });
    assertIncomplete(evidence, 'UI_RECORDING_INCOMPLETE');
  }
});
test('the partial overshoot allowance cannot lengthen a successful recording', () => {
  const evidence = fixture(), run = evidence.uiRuns[0], overrun = CONTRACT.maxUiRunMs + 500;
  run.endedAt = new Date(Date.parse(run.startedAt) + overrun).toISOString();
  evidence.captures[1].capturedAt = new Date(Date.parse(run.endedAt) + 100).toISOString(); evidence.capturedAt = evidence.captures[1].capturedAt;
  run.samples.push({ ...structuredClone(run.samples.at(-1)), t: overrun });
  rejects(evidence);
});

test('an error keeps the draft throughout, including after its toast', () => {
  const evidence = fixture('save_error'); evidence.uiRuns[0].samples.at(-2).draftDigest = digest('temporary-loss');
  assertIncomplete(evidence, 'UI_ERROR_DRAFT_NOT_PRESERVED');
});
test('an error toast requires a close control and upper-right placement', () => {
  const evidence = fixture('save_error'); evidence.uiRuns[0].samples[7].toasts[0].hasCloseButton = false;
  assertIncomplete(evidence, 'UI_TOAST_PLACEMENT_FAILED');
});

for (const [name, mutate, finding] of [
  ['stale audit frame', e => fresh(e, entry => { entry.createdAt = new Date(Date.parse(e.captures[0].capturedAt) - 60_000).toISOString(); }), 'SAVE_EFFECT_NOT_CORRELATED'],
  ['notice before the recorded outcome', e => fresh(e, entry => { entry.createdAt = new Date(Date.parse(e.uiRuns[0].startedAt) + 3000).toISOString(); }), 'SAVE_EFFECT_NOT_CORRELATED'],
  ['different actor', e => fresh(e, (entry, detail) => { entry.actorId++; detail.actorId++; }), 'SAVE_EFFECT_NOT_CORRELATED'],
  ['different original actor', e => fresh(e, (_entry, detail) => { detail.originalActorId++; }), 'SAVE_EFFECT_NOT_CORRELATED'],
  ['missing operation ID', e => fresh(e, (_entry, detail) => { detail.operationId = null; }), 'SAVE_EFFECT_NOT_CORRELATED'],
  ['uncorrelated version', e => fresh(e, (_entry, detail) => { detail.version = 999; }), 'SAVE_EFFECT_NOT_CORRELATED'],
  ['authorization receipt only', e => fresh(e, (entry, detail) => { entry.result = detail.result = 'authorized'; }), 'SAVE_EFFECT_NOT_CORRELATED'],
  ['uncertain outcome', e => fresh(e, (entry, detail) => { entry.result = detail.result = 'unknown'; }), 'SAVE_EFFECT_NOT_CORRELATED'],
  ['different operation source', e => fresh(e, (_entry, detail) => { detail.source = 'other'; }), 'SAVE_EFFECT_NOT_CORRELATED'],
  ['truncated prior audit page', e => { e.captures[0].audit.truncated = true; }, 'SAVE_EFFECT_NOT_CORRELATED'],
  ['truncated after audit page', e => { e.captures[1].audit.truncated = true; }, 'SAVE_EFFECT_NOT_CORRELATED'],
  ['unchanged description', e => { e.captures[1].detail.organization.descriptionDigest = e.captures[0].detail.organization.descriptionDigest; }, 'SAVE_EFFECT_NOT_CORRELATED'],
  ['unbounded version advance', e => { e.captures[1].detail.organization.version += 4; }, 'SAVE_EFFECT_NOT_CORRELATED'],
]) test(`domain correlation rejects ${name}`, () => {
  const evidence = fixture(); mutate(evidence); assertIncomplete(evidence, finding);
});
test('an old known event cannot be relabelled as a newly observed effect', () => {
  const evidence = fixture();
  const copied = structuredClone(evidence.captures[1].audit.entries[0]), copiedDetail = structuredClone(evidence.captures[1].audit.details[0]);
  evidence.captures[0].audit.entries = [copied]; evidence.captures[0].audit.details = [copiedDetail];
  assertIncomplete(evidence, 'SAVE_EFFECT_NOT_CORRELATED');
});
test('a failure message cannot prove no effect if the organization version changed', () => {
  const evidence = fixture('save_error'); evidence.captures[1].detail.organization.version++;
  assertIncomplete(evidence, 'SAVE_FAILURE_NOT_CORRELATED');
});
test('query must refer to an operation observed before the UI action', () => {
  const evidence = fixture('recovery_query'); fresh(evidence, (_entry, detail) => { detail.operationId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; });
  assertIncomplete(evidence, 'RECOVERY_OBSERVATION_NOT_CORRELATED');
});
test('a succeeded update is not evidence that recovery query ran', () => {
  const evidence = fixture('recovery_query'); fresh(evidence, (entry, detail) => { entry.result = detail.result = 'succeeded'; detail.source = 'organization_operation'; });
  assertIncomplete(evidence, 'RECOVERY_OBSERVATION_NOT_CORRELATED');
});
for (const [name, mutate] of [
  ['old historical completion', e => fresh(e, entry => { entry.createdAt = new Date(Date.parse(e.captures[0].capturedAt) - 60_000).toISOString(); })],
  ['different actor', e => fresh(e, (entry, detail) => { entry.actorId++; detail.actorId++; })],
  ['different original actor', e => fresh(e, (_entry, detail) => { detail.originalActorId++; })],
  ['different deletion ID', e => { e.captures[1].deletion.id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; }],
  ['pending deletion', e => { e.captures[1].deletion.state = 'pending'; }],
  ['deletion reports error', e => { e.captures[1].deletion.hasError = true; }],
]) test(`deletion observation rejects ${name}`, () => { const evidence = fixture('deletion_observed'); mutate(evidence); assertIncomplete(evidence, 'DELETION_DOMAIN_EVIDENCE_INCOMPLETE'); });

for (const [name, mutate, code] of [
  ['capture order reversed', e => e.captures.reverse(), 'ORG_CAPTURE_ORDER_INVALID'],
  ['duplicate sampling timestamp', e => { e.uiRuns[0].samples[3].t = e.uiRuns[0].samples[2].t; }, 'ORG_UI_SAMPLE_ORDER'],
  ['out-of-order sampling timestamp', e => { e.uiRuns[0].samples[3].t = 1; }, 'ORG_UI_SAMPLE_ORDER'],
  ['different organization', e => { e.captures[1].detail.organization.id++; }],
  ['different session administrator', e => { e.captures[1].administratorUserId++; }],
  ['unsynthetic functional target', e => { e.captures[0].detail.organization.syntheticMarkerMatches = false; }, 'ORG_SYNTHETIC_SCOPE_UNCONFIRMED'],
  ['invented action alias', e => fresh(e, (entry, detail) => { entry.action = detail.action = 'organization.change'; })],
  ['coerced run ID array', e => { e.runId = [e.runId]; }],
  ['commit with trailing newline', e => { e.expectedCommit += '\n'; }],
  ['deployment ID with trailing newline', e => { e.expectedDeploymentId += '\n'; }],
  ['unrecorded source string', e => fresh(e, (_entry, detail) => { detail.source = 'private-provider-response'; })],
  ['mutating request', e => { e.captures[0].requests[1].method = 'POST'; }],
  ['arbitrary URL route', e => { e.captures[0].requests[1].route = 'https://example.com'; }],
  ['secret field', e => { e.token = 'DO_NOT_EXPORT'; }],
  ['raw field content', e => { e.uiRuns[0].samples[0].draft = 'PRIVATE_DRAFT'; }],
  ['raw identity', e => { e.captures[0].audit.entries[0].email = 'PRIVATE_EMAIL'; }],
  ['caller PASS checkbox', e => { e.complete = true; e.PASS = true; }],
  ['body exceeds bounded contract', e => { e.captures[0].requests[1].bytes = CONTRACT.maxResponseBytes + 1; }],
]) test(`strict evidence schema rejects ${name}`, () => { const evidence = fixture(); mutate(evidence); rejects(evidence, code); });

test('deletion status requires the corresponding observed GET with status 200', () => {
  const evidence = fixture('deletion_observed'); evidence.captures[1].requests = evidence.captures[1].requests.filter(row => row.route !== 'deletion');
  rejects(evidence, 'ORG_DELETION_REQUEST_UNCONFIRMED');
});
test('a failed or duplicate deletion GET cannot support a completed deletion record', () => {
  for (const duplicate of [false, true]) {
    const evidence = fixture('deletion_observed'), requests = evidence.captures[1].requests, request = requests.find(row => row.route === 'deletion');
    if (duplicate) requests.push(structuredClone(request)); else request.status = 503;
    rejects(evidence, 'ORG_DELETION_REQUEST_UNCONFIRMED');
  }
});
test('diagnostic mode permits only snapshot; it never admits mutation cases', () => {
  rejects(fixture('save_success', { mode: 'diagnostic' }), 'ORG_DIAGNOSTIC_MUTATION_CASE');
  const evidence = fixture('snapshot', { mode: 'diagnostic' }); evidence.captures[0].detail.organization.syntheticMarkerMatches = false;
  assert.equal(verify(evidence).ok, true); assert.equal(verify(evidence).complete, false);
});
test('old or future evidence cannot be repaired by supplied expected SHA', () => {
  rejects(fixture('snapshot', { now: FIXTURE_NOW - CONTRACT.maxEvidenceAgeMs - 1 }), 'ORG_EVIDENCE_TIME_INVALID');
  rejects(fixture('snapshot', { now: FIXTURE_NOW + 180_001 }), 'ORG_EVIDENCE_TIME_INVALID');
});

for (const [name, mutate, code = 'ORG_EXTERNAL_ENVIRONMENT_MISMATCH'] of [
  ['commit mismatch', report => { report.expectedCommit = 'b'.repeat(40); }],
  ['deployed commit mismatch', report => { report.preflight.canonical.commit = 'b'.repeat(40); }],
  ['dirty deployment', report => { report.preflight.canonical.commitDirty = true; }],
  ['deployment ID mismatch', report => { report.preflight.canonical.id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; }],
  ['different organization', report => { report.organizationId++; }],
  ['wrong database', report => { report.preflight.databaseId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; }],
  ['wrong canonical origin', report => { report.preflight.baseUrl = 'https://other.pages.dev'; }],
  ['nonterminal deployment', report => { report.preflight.canonical.status = 'active'; }],
  ['pending deployment', report => { report.preflight.pendingProductionDeployments = [{ id: 'pending' }]; }],
  ['after-the-fact report', (report, _external, evidence) => { report.finishedAt = new Date(Date.parse(evidence.startedAt) + 1).toISOString(); }],
  ['stale preflight', (report, _external, evidence) => { report.generatedAt = report.finishedAt = new Date(Date.parse(evidence.startedAt) - CONTRACT.maxEnvironmentAgeMs - 1).toISOString(); }],
  ['failed preflight', report => { report.ok = false; }, 'ORG_EXTERNAL_REPORT_INVALID'],
  ['preflight claiming acceptance', report => { report.acceptanceExecuted = true; }, 'ORG_EXTERNAL_REPORT_INVALID'],
  ['preflight claiming writes', report => { report.writesPerformed = true; }, 'ORG_EXTERNAL_REPORT_INVALID'],
  ['unrelated suite report', report => { report.suite = 'durable-project-save'; }, 'ORG_EXTERNAL_REPORT_INVALID'],
  ['different workflow run', report => { report.workflowRunId = '987654321'; }, 'ORG_EXTERNAL_WORKFLOW_MISMATCH'],
  ['unbound rerun attempt', report => { report.workflowRunAttempt = 2; }, 'ORG_EXTERNAL_WORKFLOW_MISMATCH'],
  ['noncanonical workflow number', report => { report.workflowRunId = 123456789; }, 'ORG_EXTERNAL_WORKFLOW_MISMATCH'],
  ['different supplied operation run', report => { report.runId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; }, 'ORG_EXTERNAL_RUN_MISMATCH'],
]) test(`external binding rejects ${name}`, () => {
  const evidence = fixture(); const external = changedReport(evidence, (report, source) => mutate(report, source, evidence));
  rejects(evidence, code, external);
});

test('external digest pins the original bytes, including whitespace', () => {
  const evidence = fixture(), external = makeEnvironmentFixture(evidence); external.bytes += '\n';
  rejects(evidence, 'ORG_EXTERNAL_DIGEST_MISMATCH', external);
});
test('external source is restricted to this repository and an explicit Actions run', () => {
  for (const source of ['https://github.com/another/repository/actions/runs/123456789', 'https://github.com/matheusapc22/maono_kepler_v1/actions/runs/123456789?token=private',
    'https://github.com/matheusapc22/maono_kepler_v1/actions/runs/123456789\n', 'https://example.com/123456789']) {
    const evidence = fixture(), external = makeEnvironmentFixture(evidence); external.source = source;
    rejects(evidence, 'ORG_EXTERNAL_PROVENANCE_INVALID', external);
  }
});
test('a new read-only preflight rerun binds only its explicit matching attempt URL', () => {
  const evidence = fixture(); const external = changedReport(evidence, (report, source) => { report.workflowRunAttempt = 2; source.source += '/attempts/2'; });
  assert.equal(verify(evidence, external).environment.workflowRunAttempt, 2);
});
test('older reports without actual runner identity remain incomplete, never backfilled from URL', () => {
  const evidence = fixture(); const external = changedReport(evidence, report => { delete report.workflowRunId; delete report.workflowRunAttempt; });
  const certificate = verify(evidence, external);
  assert.equal(certificate.ok, false); assert.equal(certificate.environment.matched, false);
  assert.equal(certificate.environment.reason, 'EXTERNAL_WORKFLOW_IDENTITY_UNRECORDED');
});
test('empty external JSON fails with a stable error without exposing its contents', () => {
  const evidence = fixture(), external = makeEnvironmentFixture(evidence); external.bytes = 'null'; external.sha256 = digest(external.bytes);
  rejects(evidence, 'ORG_EXTERNAL_ENVIRONMENT_MISMATCH', external);
});
test('preflight flags and cleanup checkboxes cannot satisfy operational closure', () => {
  const evidence = fixture(); const external = changedReport(evidence, report => {
    report.cleanupComplete = true; report.configurationRestored = true; report.complete = true;
    report.migrationApplied = true; report.allWorkersRestored = true;
  });
  const certificate = verify(evidence, external);
  assert.equal(certificate.complete, false); assert.equal(certificate.cleanupVerified, false);
  assert.equal(certificate.restorationVerified, false); assert.equal(certificate.migrationVerified, false);
});
test('local or Preview UI observations cannot impersonate the canonical Production deployment', () => {
  for (const origin of ['http://127.0.0.1:4173', 'https://some-branch.maono-kepler-v1.pages.dev']) {
    const evidence = fixture('snapshot', { origin });
    assert.equal(validateOrganizationEvidence(evidence, { now: FIXTURE_NOW }).origin, origin);
    rejects(evidence, 'ORG_EXTERNAL_ENVIRONMENT_MISMATCH');
  }
});
test('evidence and certificate retain hashes, never synthetic plaintext drafts or identities', () => {
  const evidence = fixture(), certificate = verify(evidence);
  for (const text of ['synthetic-draft', 'before-description', 'after-description', 'synthetic-name', 'synthetic-slug']) {
    assert.equal(JSON.stringify(evidence).includes(text), false);
    assert.equal(JSON.stringify(certificate).includes(text), false);
  }
});
test('new evidence tooling does not register a Production suite or add operational permissions', async () => {
  const registry = await readFile(new URL('../scripts/acceptance/registry.mjs', import.meta.url), 'utf8');
  assert.equal(registry.includes('organization-functional-evidence'), false);
  assert.equal(CONTRACT.registeredProductionSuite, false);
});
