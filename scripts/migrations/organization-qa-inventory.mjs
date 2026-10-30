import {
  ORGANIZATION_MIGRATION, collectOrganizationPostValidation, queryOrganizationLedger,
} from './organization-management-schema.mjs';
import { PRODUCTION_DATABASE_NAME, PRODUCTION_DATABASE_ID, gateError, runWranglerJson,
  rowsFromD1Json, sha256Text } from './production-migration-lib.mjs';

export const QA_INVENTORY_MODE = 'organization-qa-inventory';
export const QA_INVENTORY_LIMIT = 100;
// Fixed projections only. No names, paths, account IDs, payloads, credentials or
// business content leave D1. Unknown dates/states conservatively count as busy.
export const QA_INVENTORY_QUERIES = Object.freeze({
  summary: `SELECT (SELECT COUNT(*) FROM organizations) AS organizationCount,
    (SELECT COUNT(*) FROM organization_management_operation_items WHERE state <> 'succeeded') +
    (SELECT COUNT(*) FROM organization_management_operations o WHERE NOT EXISTS
      (SELECT 1 FROM organization_management_operation_items i WHERE i.operation_id=o.id)) AS unresolvedManagementItems;`,
  organizations: `SELECT o.id, o.active,
    CASE WHEN o.storage_status IN ('READY','PENDING','ERROR','DISABLED') THEN o.storage_status ELSE 'UNKNOWN' END AS storageStatus,
    CASE WHEN trim(COALESCE(o.storage_error,'')) <> '' THEN 1 ELSE 0 END AS storageErrorPresent,
    o.management_version AS managementVersion,
    CASE WHEN o.management_owner_id IS NULL THEN 0 ELSE 1 END AS managerAssigned,
    (SELECT COUNT(*) FROM organization_users m JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=o.id AND m.user_id=o.management_owner_id AND m.access_level='owner' AND u.active=1) AS eligibleManagerCount,
    (SELECT COUNT(*) FROM organization_users m WHERE m.organization_id=o.id) AS memberCount,
    (SELECT COUNT(*) FROM organization_users m JOIN users u ON u.id=m.user_id WHERE m.organization_id=o.id AND u.active=1) AS activeMemberCount,
    (SELECT COUNT(*) FROM organization_users m JOIN users u ON u.id=m.user_id WHERE m.organization_id=o.id AND u.active=1 AND m.access_level='owner') AS activeOwnerCount,
    (SELECT COUNT(*) FROM organization_users m WHERE m.organization_id=o.id AND EXISTS
      (SELECT 1 FROM organization_users other WHERE other.user_id=m.user_id AND other.organization_id<>o.id)) AS sharedMemberCount,
    (SELECT COUNT(*) FROM sessions s WHERE
      (s.active_organization_id=o.id OR EXISTS (SELECT 1 FROM organization_users m WHERE m.organization_id=o.id AND m.user_id=s.user_id))
      AND (julianday(s.expires_at) IS NULL OR julianday(s.expires_at)>julianday('now'))) AS liveSessionCount,
    (SELECT COUNT(*) FROM organization_access_delegations d WHERE d.organization_id=o.id AND d.enabled<>0) AS enabledDelegationCount,
    (SELECT COUNT(*) FROM projects p WHERE p.organization_id=o.id) +
    (SELECT COUNT(*) FROM organization_files f WHERE f.organization_id=o.id) +
    (SELECT COUNT(*) FROM organization_file_folders f WHERE f.organization_id=o.id) +
    (SELECT COUNT(*) FROM organization_tickets t WHERE t.organization_id=o.id) +
    (SELECT COUNT(*) FROM organization_roadmaps r WHERE r.organization_id=o.id) +
    (SELECT COUNT(*) FROM organization_exports e WHERE e.organization_id=o.id) AS resourceCount,
    (SELECT COUNT(*) FROM organization_resource_reservations r WHERE r.organization_id=o.id AND r.status NOT IN ('COMMITTED','RELEASED','FAILED','EXPIRED')) +
    (SELECT COUNT(*) FROM organization_limit_requests r WHERE r.organization_id=o.id AND (r.status IS NULL OR r.status NOT IN ('approved','rejected'))) +
    (SELECT COUNT(*) FROM project_save_operations p WHERE p.organization_id=o.id AND p.state NOT IN ('PUBLISHED','CONFLICT','FAILED_FINAL')) +
    (SELECT COUNT(*) FROM project_preview_operations p WHERE p.organization_id=o.id AND p.state NOT IN ('READY','FAILED_FINAL','SUPERSEDED')) +
    (SELECT COUNT(*) FROM project_save_outbox b JOIN project_save_operations p ON p.id=b.operation_id WHERE p.organization_id=o.id AND b.state NOT IN ('DONE','FAILED_FINAL')) +
    (SELECT COUNT(*) FROM project_preview_outbox b JOIN project_preview_operations p ON p.id=b.operation_id WHERE p.organization_id=o.id AND b.state<>'DONE') +
    (SELECT COUNT(*) FROM organization_exports e WHERE e.organization_id=o.id) +
    (SELECT COUNT(*) FROM ticket_export_jobs j WHERE j.organization_id=o.id AND j.state NOT IN ('ready','failed','cancelled','expired','revoked')) +
    (SELECT COUNT(*) FROM ticket_export_gc g WHERE g.organization_id=o.id) +
    (SELECT COUNT(*) FROM ticket_attachment_upload_sessions u WHERE u.organization_id=o.id AND u.state NOT IN ('COMPLETED','CANCELLED','EXPIRED','FAILED')) +
    (SELECT COUNT(*) FROM ticket_command_outbox b WHERE b.organization_id=o.id AND b.status<>'delivered') +
    (SELECT COUNT(*) FROM project_change_requests r WHERE r.organization_id=o.id AND r.status NOT IN ('rejected','conflict','applied','superseded')) +
    (SELECT COUNT(*) FROM ticket_attachments a WHERE a.organization_id=o.id AND a.upload_session_id IS NULL AND a.status='PENDING') +
    (SELECT COUNT(*) FROM ticket_command_backfills b WHERE b.organization_id=o.id AND (b.status<>'ready' OR b.pending_count>0 OR b.skipped_count>0)) +
    (SELECT COUNT(*) FROM organization_files f WHERE f.organization_id=o.id AND
      (f.status NOT IN ('ACTIVE','FAILED','DELETED','TRASHED','PURGED') OR
        (f.deleted_at IS NOT NULL AND f.purged_at IS NULL AND (julianday(f.purge_after) IS NULL OR julianday(f.purge_after)<=julianday('now'))))) +
    (SELECT COUNT(*) FROM projects p WHERE p.organization_id=o.id AND p.preview_status='PENDING') +
    (SELECT COUNT(*) FROM project_config_revisions r JOIN projects p ON p.id=r.project_id WHERE p.organization_id=o.id AND
      (r.status NOT IN ('READY','FAILED') OR (r.revision>p.config_revision AND (r.status='READY' OR r.published_at IS NOT NULL)))) +
    (SELECT COUNT(*) FROM ticket_change_links l JOIN change_records c ON c.id=l.record_id AND c.organization_id=l.organization_id
      LEFT JOIN project_change_requests r ON r.id=c.change_request_id WHERE l.organization_id=o.id AND l.active=1 AND
      (l.source_status IS NULL OR l.source_version IS NOT CASE WHEN c.domain='map_project' THEN r.lifecycle_version ELSE c.version END)) AS pendingWorkCount,
    CASE WHEN julianday(o.updated_at) IS NULL OR julianday(o.updated_at)>=julianday('now','-1 day') OR EXISTS
      (SELECT 1 FROM organization_management_events e WHERE e.organization_id=o.id AND
        (julianday(e.created_at) IS NULL OR julianday(e.created_at)>=julianday('now','-1 day')))
      THEN 1 ELSE 0 END AS recentlyChanged
    FROM organizations o ORDER BY o.id LIMIT 101;`,
  quickCheck: 'PRAGMA quick_check;',
  foreignKeys: 'PRAGMA foreign_key_check;',
});
const COUNTS = ['managementVersion','eligibleManagerCount','memberCount','activeMemberCount','activeOwnerCount',
  'sharedMemberCount','liveSessionCount','enabledDelegationCount','resourceCount','pendingWorkCount'];
const BITS = ['active','storageErrorPresent','managerAssigned','recentlyChanged'];
const FIELDS = ['id','storageStatus',...COUNTS,...BITS].sort();
const fail = code => { throw gateError(code, 'Inventario QA bloqueado; nenhuma escrita executada.'); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const FAILURE_CODES = new Set(['QA_INVENTORY_CONTEXT_INVALID','QA_INVENTORY_RESPONSE_INVALID',
  'QA_INVENTORY_LIMIT_EXCEEDED','QA_INVENTORY_INCOMPLETE','QA_INVENTORY_SCHEMA_OR_LEDGER_UNREADY',
  'QA_INVENTORY_INTEGRITY_FAILED','QA_INVENTORY_DRIFT','ORGANIZATION_LEDGER_INVALID',
  'ORGANIZATION_SCHEMA_SOURCE_DRIFT',
  'ORGANIZATION_LEDGER_REQUIRED','ORGANIZATION_POSTVALIDATE_LEDGER_DRIFT',
  'ORGANIZATION_POSTVALIDATE_TARGET_INVALID','WRANGLER_COMMAND_FAILED','WRANGLER_EMPTY_JSON',
  'WRANGLER_INVALID_JSON','D1_JSON_SHAPE_UNEXPECTED','D1_IDENTITY_UNREADABLE',
  'PRODUCTION_DATABASE_IDENTITY_MISMATCH','D1_BOOKMARK_UNAVAILABLE','CLOUDFLARE_TOKEN_MISSING',
  'CLOUDFLARE_ACCOUNT_INVALID','GIT_COMMAND_FAILED','GIT_SHA_INVALID','ARGUMENT_INVALID']);
export function qaInventoryFailure(error) {
  return { ok:false, writesPerformed:false, code:FAILURE_CODES.has(error?.code) ? error.code : 'QA_INVENTORY_BLOCKED' };
}
function keys(row, fields) {
  return row && typeof row === 'object' && !Array.isArray(row) &&
    JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...fields].sort());
}

// Defense in depth, before ANY remote call. Environment approval itself remains
// enforced by GitHub, not by an environment variable or a human checkbox here.
export function validateQaInventoryContext(env, git, migration) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.GITHUB_REPOSITORY !== 'matheusapc22/maono_kepler_v1' || env.GITHUB_REF_NAME !== 'main' ||
      env.GITHUB_REPOSITORY_OWNER !== 'matheusapc22' || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER ||
      env.MODE !== QA_INVENTORY_MODE || migration !== ORGANIZATION_MIGRATION ||
      env.MIGRATION !== ORGANIZATION_MIGRATION || env.APPROVAL_HASH !== '' ||
      env.CLOUDFLARE_ACCOUNT_ID !== '09d455fa1cf988b0d9db89987b73eaff' ||
      env.PRODUCT_BRANCH !== 'mano_kepler_v1' || env.PRODUCTION_D1_NAME !== PRODUCTION_DATABASE_NAME ||
      env.PRODUCTION_D1_ID !== PRODUCTION_DATABASE_ID || !/^[0-9a-f]{40}$/.test(env.VALIDATED_RELEASE_SHA || '') ||
      git?.sha !== env.VALIDATED_RELEASE_SHA || git.clean !== true) fail('QA_INVENTORY_CONTEXT_INVALID');
}

function checkSummary(rows) {
  if (rows.length !== 1 || !keys(rows[0], ['organizationCount','unresolvedManagementItems']) ||
      !Object.values(rows[0]).every(integer)) fail('QA_INVENTORY_RESPONSE_INVALID');
  if (rows[0].organizationCount > QA_INVENTORY_LIMIT) fail('QA_INVENTORY_LIMIT_EXCEEDED');
  return rows[0];
}
function checkOrganizations(rows, summary) {
  if (rows.length !== summary.organizationCount) fail('QA_INVENTORY_INCOMPLETE');
  let last = 0;
  for (const row of rows) {
    if (!keys(row,FIELDS) || !Number.isSafeInteger(row.id) || row.id <= last ||
        !['READY','PENDING','ERROR','DISABLED','UNKNOWN'].includes(row.storageStatus) ||
        !COUNTS.every(k => integer(row[k])) || !BITS.every(k => row[k] === 0 || row[k] === 1) ||
        row.activeOwnerCount > row.activeMemberCount || row.activeMemberCount > row.memberCount ||
        row.sharedMemberCount > row.memberCount || row.eligibleManagerCount > row.managerAssigned ||
        row.eligibleManagerCount > row.activeOwnerCount) fail('QA_INVENTORY_RESPONSE_INVALID');
    last = row.id;
  }
  return rows;
}
function reasons(row, summary) {
  return [
    [row.active !== 1, 'INACTIVE'],
    [row.storageStatus !== 'READY' || row.storageErrorPresent !== 0, 'STORAGE_UNREADY'],
    [row.activeOwnerCount < 1 || row.eligibleManagerCount !== row.managerAssigned, 'OWNER_UNREADY'],
    [row.sharedMemberCount !== 0 || row.enabledDelegationCount !== 0, 'SHARED_ACCESS'],
    [row.liveSessionCount !== 0 || row.pendingWorkCount !== 0 || row.recentlyChanged !== 0, 'OBSERVED_ACTIVITY'],
    [summary.unresolvedManagementItems !== 0, 'GLOBAL_MANAGEMENT_UNRESOLVED'],
  ].filter(([blocked]) => blocked).map(([,code]) => code);
}

export async function collectQaInventory(configPath, remote, migration, injected = {}) {
  const evidence = await collectOrganizationPostValidation(configPath, remote, migration, injected);
  if (!evidence.schema.compatible || evidence.pending.pending.length !== 0) fail('QA_INVENTORY_SCHEMA_OR_LEDGER_UNREADY');
  const query = async key => {
    const json = await runWranglerJson([
      'd1','execute',PRODUCTION_DATABASE_NAME,'--remote','--command',QA_INVENTORY_QUERIES[key],
    ],configPath,injected);
    if ([json,...(Array.isArray(json) ? json : [])].some(r => r?.success === false || r?.result?.success === false)) fail('QA_INVENTORY_RESPONSE_INVALID');
    return rowsFromD1Json(json);
  };
  // Do not serialize raw integrity rows (which can contain row IDs/details).
  const quick = await query('quickCheck'), foreign = await query('foreignKeys');
  if (quick.length !== 1 || !keys(quick[0], ['quick_check']) || quick[0].quick_check !== 'ok' || foreign.length !== 0) fail('QA_INVENTORY_INTEGRITY_FAILED');
  const firstSummary = checkSummary(await query('summary'));
  const first = checkOrganizations(await query('organizations'), firstSummary);
  const finalSummary = checkSummary(await query('summary'));
  const final = checkOrganizations(await query('organizations'), finalSummary);
  const ledger = await queryOrganizationLedger(configPath, injected);
  if (JSON.stringify(ledger) !== JSON.stringify(evidence.ledger.rows) ||
      JSON.stringify(firstSummary) !== JSON.stringify(finalSummary) || JSON.stringify(first) !== JSON.stringify(final)) fail('QA_INVENTORY_DRIFT');
  const exclusions = { INACTIVE:0, STORAGE_UNREADY:0, OWNER_UNREADY:0, SHARED_ACCESS:0, OBSERVED_ACTIVITY:0, GLOBAL_MANAGEMENT_UNRESOLVED:0 };
  const eligible = final.filter(row => {
    const blocked = reasons(row, finalSummary);
    for (const code of blocked) exclusions[code]++;
    return blocked.length === 0;
  }).sort((a,b) => a.resourceCount-b.resourceCount || a.memberCount-b.memberCount || a.id-b.id);
  return {
    version:1, phase:'organization-qa-inventory-read-only', writesPerformed:false,
    schema:{ profile:evidence.schema.profile, digest:evidence.schema.digest, compatible:true },
    ledger:{ appliedCount:ledger.length, digest:evidence.ledger.digest, pendingCount:0, stable:true },
    integrity:{ quickCheck:'ok', foreignKeyViolationCount:0 },
    scannedCount:final.length, eligibleCount:eligible.length, exclusions,
    unresolvedManagementItems:finalSummary.unresolvedManagementItems,
    selection: eligible.length ? { status:'PROVISIONAL_CANDIDATE', organization:eligible[0] } : { status:'NO_ELIGIBLE_CANDIDATE', organization:null },
    snapshotDigest:sha256Text(JSON.stringify({ summary:finalSummary, organizations:final })),
    aggregateReadsStable:true, atomicDatabaseSnapshot:false, exclusiveTestWindowProven:false,
    qaCredentialsVerified:false, storageProviderVerified:false, functionalAcceptanceExecuted:false,
    flagsObserved:false, activationAuthorized:false,
  };
}
