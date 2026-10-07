import { createHash } from 'node:crypto';
import { fail } from './production-acceptance-lib.mjs';

export const MANUAL_QA = Object.freeze({ id: 9, slug: 'maono-preview-qa' });
export const MANUAL_ORIGIN = 'https://maono-kepler-v1.pages.dev';
export const BEFORE_MAX_AGE_MS = 15 * 60_000;
export const RUN_MAX_AGE_MS = 75 * 60_000;
export const EVIDENCE_MAX_BYTES = 24 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const WORKFLOW_RUN = /^[1-9][0-9]{0,19}$/;
const SUITES = new Set(['durable-project-save', 'durable-project-preview']);
const NAME = /^QA Durable/;
const SLUG = /^qa-durable-/;
const FUNCTIONAL = {
  'durable-project-save': ['DS-SMALL', 'DS-LARGE', 'DS-IDEMPOTENT', 'DS-LOST-ACK', 'DS-HISTORICAL', 'DS-STALE-CAS', 'DS-OLD-CLIENT'],
  'durable-project-preview': ['PNG-CAPTURE', 'PNG-REFRESH', 'PNG-ORDER', 'PNG-FAILURE'],
};
function check(value, code = 'MANUAL_EVIDENCE_INVALID') {
  if (!value) fail(code, code === 'MANUAL_EVIDENCE_STALE'
    ? 'Inventário expirado antes da admissão. Não use Re-run: revise o relatório e, somente sem mutações ou pendências, prepare novo dispatch autorizado e novo export no gate de aprovação.'
    : 'Evidência administrativa ausente, divergente ou não verificável; preserve o estado e revise os artifacts.');
}
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const evidenceDigest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
function timestamp(value) {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value));
  const time = Date.parse(value); check(Number.isFinite(time)); return time;
}
function bounded(value) {
  check(object(value) && Buffer.byteLength(JSON.stringify(value)) <= EVIDENCE_MAX_BYTES, 'MANUAL_EVIDENCE_TOO_LARGE');
}
function inventory(value) {
  check(object(value) && Array.isArray(value.projects) && Array.isArray(value.files) && value.projects.length <= 64 && value.files.length <= 64);
  const projects = value.projects.map(row => {
    check(object(row) && positive(row.id) && row.organizationId === 9 && typeof row.name === 'string' && row.name.length <= 500 &&
      typeof row.slug === 'string' && row.slug.length <= 500 && (NAME.test(row.name) || SLUG.test(row.slug)) && positive(row.createdById) && (row.organizationFileId === null || positive(row.organizationFileId)));
    return { id: row.id, name: row.name, slug: row.slug, organizationId: 9, createdById: row.createdById, organizationFileId: row.organizationFileId };
  });
  const files = value.files.map(row => {
    check(object(row) && positive(row.id) && row.organizationId === 9 && typeof row.name === 'string' && row.name.length <= 500 && NAME.test(row.name) &&
      typeof row.active === 'boolean' && typeof row.isProject === 'boolean' && (row.linkedProjectId === null || positive(row.linkedProjectId)));
    return { id: row.id, name: row.name, organizationId: 9, active: row.active, isProject: row.isProject, linkedProjectId: row.linkedProjectId };
  });
  check(new Set(projects.map(row => row.id)).size === projects.length && new Set(files.map(row => row.id)).size === files.length);
  return { projects, files };
}
export function validateBeforeEvidence(value, { suite, expectedCommit, organizationId = 9, baseUrl = MANUAL_ORIGIN, runId = null, workflowRunId = null, now = Date.now(), maxAgeMs = BEFORE_MAX_AGE_MS } = {}) {
  bounded(value);
  check(value.schemaVersion === 1 && value.kind === 'qa-before-inventory' && SUITES.has(suite) && value.suite === suite &&
    typeof value.workflowRunId === 'string' && WORKFLOW_RUN.test(value.workflowRunId) && value.workflowRunAttempt === 1 &&
    (!workflowRunId || value.workflowRunId === workflowRunId) && SHA.test(expectedCommit || '') && value.expectedCommit === expectedCommit && UUID.test(value.runId || '') && (!runId || value.runId === runId) &&
    organizationId === 9 && value.organization?.id === 9 && value.organization?.slug === MANUAL_QA.slug && value.organization?.active === true &&
    baseUrl === MANUAL_ORIGIN && value.origin === MANUAL_ORIGIN && positive(value.administratorUserId), 'MANUAL_EVIDENCE_SCOPE_MISMATCH');
  const captured = timestamp(value.capturedAt);
  check(captured <= now + 60_000 && captured >= now - maxAgeMs, 'MANUAL_EVIDENCE_STALE');
  const observed = inventory(value.inventory);
  check(observed.projects.length === 0 && !observed.files.some(row => row.active || row.isProject || row.linkedProjectId !== null), 'QA_PRIOR_CLEANUP_UNVERIFIED');
  check(!observed.files.some(row => row.name.includes(value.runId)), 'QA_RUN_ID_COLLISION');
  return { schemaVersion: 1, kind: value.kind, suite, expectedCommit, runId: value.runId, workflowRunId: value.workflowRunId, workflowRunAttempt: 1, organization: { ...MANUAL_QA, active: true },
    administratorUserId: value.administratorUserId, origin: MANUAL_ORIGIN, capturedAt: value.capturedAt, inventory: observed };
}
export function parseManualBundle(raw, options) {
  check(typeof options?.workflowRunId === 'string' && WORKFLOW_RUN.test(options.workflowRunId) && options.workflowRunAttempt === 1, 'QA_WORKFLOW_RUN_MISMATCH');
  check(typeof raw === 'string' && Buffer.byteLength(raw) <= 48 * 1024, 'QA_CREDENTIALS_INVALID');
  let bundle; try { bundle = JSON.parse(raw); } catch { check(false, 'QA_CREDENTIALS_INVALID'); }
  check(object(bundle) && Object.keys(bundle).length === 2 && Object.hasOwn(bundle, 'creator') && Object.hasOwn(bundle, 'manualInventory') &&
    object(bundle.creator) && typeof bundle.creator.email === 'string' && typeof bundle.creator.password === 'string', 'MANUAL_QA_BUNDLE_INVALID');
  // Never return credential fields or raw input, including on validation failure.
  return validateBeforeEvidence(bundle.manualInventory, options);
}
export function createManualAdministration(before, creatorUserId) {
  check(positive(creatorUserId) && creatorUserId !== before.administratorUserId, 'QA_IDENTITIES_NOT_DISTINCT');
  return { schemaVersion: 1, runId: before.runId, suite: before.suite, expectedCommit: before.expectedCommit, organizationId: 9,
    creatorUserId, administratorUserId: before.administratorUserId, origin: before.origin, beforeInventoryDigest: evidenceDigest(before),
    beforeInventory: before, resources: [] };
}
export function publicManualResources(resources) {
  check(Array.isArray(resources) && resources.length <= 2);
  return resources.map(row => ({ kind: row.kind, name: row.name, projectId: row.id ?? null, slug: row.slug ?? null,
    organizationFileId: row.organizationFileId ?? null, reservationStarted: row.reservationStarted === true, reservationUncertain: row.reservationUncertain === true }));
}
export function manualFunctionalCases(suite) { check(SUITES.has(suite)); return [...FUNCTIONAL[suite]]; }

export function verifyManualCleanup(report, evidence, { now = Date.now() } = {}) {
  // The report must be the unchanged artifact fetched from its trusted GitHub
  // run. These content checks do not cryptographically attest a human export.
  bounded(evidence);
  const m = report?.manualAdministration;
  check(object(report) && object(m) && report.mode === 'run' && report.acceptanceExecuted === true && report.configurationRestored === true &&
    m.schemaVersion === 1 && SUITES.has(m.suite) && SHA.test(m.expectedCommit || '') && UUID.test(m.runId || '') && m.organizationId === 9 &&
    positive(m.creatorUserId) && positive(m.administratorUserId) && m.creatorUserId !== m.administratorUserId && m.origin === MANUAL_ORIGIN &&
    report.runId === m.runId && report.suite === m.suite && report.expectedCommit === m.expectedCommit && report.organizationId === 9, 'MANUAL_REPORT_INVALID');
  check(Array.isArray(report.cleanupErrors) && report.cleanupErrors.length > 0 && report.cleanupErrors.every(row => row.code === 'MANUAL_CLEANUP_REQUIRED'), 'QA_CLOSURE_UNVERIFIED');
  check(report.operationalTestsPassed === true && report.acceptanceStatus === 'PENDING_MANUAL_CLEANUP' && report.error?.code === 'MANUAL_CLEANUP_REQUIRED' &&
    !Object.hasOwn(report, 'budgetError') && !Object.hasOwn(report, 'restoreError') && Array.isArray(report.cases) &&
    new Set(report.cases.map(row => row.id)).size === report.cases.length &&
    FUNCTIONAL[m.suite].every(id => report.cases.some(row => row.id === id && row.status === 'PASS')), 'QA_REMOTE_OPERATIONS_UNVERIFIED');
  const finished = timestamp(report.finishedAt);
  check(finished <= now + 60_000);
  const before = validateBeforeEvidence(m.beforeInventory, { suite: m.suite, expectedCommit: m.expectedCommit, runId: m.runId,
    workflowRunId: report.workflowRunId, now: timestamp(m.beforeInventory?.capturedAt) });
  check(typeof report.workflowRunId === 'string' && WORKFLOW_RUN.test(report.workflowRunId) && report.workflowRunAttempt === 1 && before.workflowRunId === report.workflowRunId, 'QA_WORKFLOW_RUN_MISMATCH');
  check(timestamp(before.capturedAt) <= finished);
  check(m.beforeInventoryDigest === evidenceDigest(before) && before.administratorUserId === m.administratorUserId);
  const safe = { PROJECT_DURABLE_SAVE_V1: false, PROJECT_DURABLE_SAVE_INLINE_ENABLED: true,
    ...(m.suite === 'durable-project-preview' ? { PROJECT_PREVIEW_OPERATIONS_V1: false, PROJECT_PREVIEW_PROCESSOR_ENABLED: false, VITE_PROJECT_PREVIEW_OPERATIONS_V1: false } : {}) };
  check(report.final?.databaseId === '5bc4dc32-f3bd-4c92-bbd1-cbda63e467db' && report.final.baseUrl === MANUAL_ORIGIN &&
    report.final.canonical?.commit === m.expectedCommit && report.final.canonical.status === 'success' && report.final.canonical.commitDirty === false);
  for (const [name, value] of Object.entries(safe)) check(report.final.configuredFlags?.[name]?.state === 'observed' &&
    report.final.configuredFlags[name].value === value && report.final.canonical.flags?.[name]?.state === 'observed' && report.final.canonical.flags[name].value === value);
  check(Array.isArray(m.resources) && m.resources.length >= 1 && m.resources.length <= (m.suite === 'durable-project-preview' ? 1 : 2));
  const started = [];
  for (const resource of m.resources) {
    check(['small', 'large'].includes(resource.kind) && (m.suite !== 'durable-project-preview' || resource.kind === 'small') && resource.name === `QA Durable ${m.runId} ${resource.kind}` &&
      typeof resource.reservationStarted === 'boolean' && typeof resource.reservationUncertain === 'boolean');
    check(!resource.reservationUncertain, 'QA_RESERVATION_OUTCOME_UNCERTAIN');
    if (!resource.reservationStarted) {
      check(resource.projectId === null && resource.slug === null && resource.organizationFileId === null); continue;
    }
    check(positive(resource.projectId) && new RegExp(`^qa-durable-${m.runId}-${resource.kind}(?:-[0-9]+)?$`).test(resource.slug || '') &&
      (resource.organizationFileId === null || positive(resource.organizationFileId)));
    started.push(resource);
  }
  check(new Set(started.map(row => row.projectId)).size === started.length && new Set(m.resources.map(row => row.kind)).size === m.resources.length);
  const reportDigest = evidenceDigest(report), inspection = evidence.inspection;
  for (const value of [evidence, inspection]) {
    check(object(value) && value.schemaVersion === 1 && value.runId === m.runId && value.suite === m.suite && value.expectedCommit === m.expectedCommit &&
      value.organizationId === 9 && value.creatorUserId === m.creatorUserId && value.administratorUserId === m.administratorUserId &&
      value.origin === MANUAL_ORIGIN && value.reportDigest === reportDigest, 'MANUAL_EVIDENCE_SCOPE_MISMATCH');
  }
  check(evidence.kind === 'qa-after-cleanup' && inspection.kind === 'qa-cleanup-inspection');
  const inspectedAt = timestamp(inspection.capturedAt), capturedAt = timestamp(evidence.capturedAt);
  check(inspectedAt >= finished && capturedAt >= inspectedAt && capturedAt <= now + 60_000 && capturedAt >= now - 30 * 60_000, 'MANUAL_EVIDENCE_STALE');
  check(Array.isArray(inspection.resources) && inspection.resources.length === started.length && Array.isArray(evidence.observations) && evidence.observations.length === started.length);
  const usedProjects = new Set(), usedFiles = new Set();
  for (const row of inspection.resources) {
    const resource = started.find(value => value.projectId === row.projectId);
    check(resource && row.kind === resource.kind && row.name === resource.name && row.slug === resource.slug && row.organizationId === 9 &&
      row.createdById === m.creatorUserId && positive(row.organizationFileId) && (!resource.organizationFileId || resource.organizationFileId === row.organizationFileId));
    check(!usedProjects.has(row.projectId) && !usedFiles.has(row.organizationFileId)); usedProjects.add(row.projectId); usedFiles.add(row.organizationFileId);
    const matches = evidence.observations.filter(value => value.projectId === row.projectId);
    check(matches.length === 1 && matches[0].projectStatus === 404);
    const file = matches[0].file;
    check(file?.id === row.organizationFileId && file.organizationId === 9 && file.name === row.name && file.active === false && file.isProject === false && file.linkedProjectId === null);
  }
  const after = inventory(evidence.inventory);
  check(!after.projects.length && !after.files.some(row => row.active || row.isProject || row.linkedProjectId !== null), 'QA_CLEANUP_UNVERIFIED');
  for (const row of inspection.resources) check(after.files.some(file => file.id === row.organizationFileId && file.name === row.name));
  check(Array.isArray(report.cases) && new Set(report.cases.map(row => row.id)).size === report.cases.length);
  const testsPassed = report.operationalTestsPassed === true && FUNCTIONAL[m.suite].every(id => report.cases.some(row => row.id === id && row.status === 'PASS'));
  const complete = testsPassed && report.error?.code === 'MANUAL_CLEANUP_REQUIRED' && !report.budgetError && !report.restoreError;
  return { schemaVersion: 1, verificationMode: 'validated-human-admin-api-export', verifiedAt: new Date(now).toISOString(), runId: m.runId,
    suite: m.suite, expectedCommit: m.expectedCommit, organizationId: 9, workflowRunId: report.workflowRunId, workflowRunAttempt: 1, reportDigest, evidenceDigest: evidenceDigest(evidence),
    operationalTestsPassed: testsPassed, cleanupComplete: true, configurationRestored: true, complete, ok: complete,
    note: 'Derived evidence certificate; original GitHub run remains immutable. Validate artifact provenance and the human-operated source.' };
}
