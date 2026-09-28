import { createHash } from 'node:crypto';
import { PRODUCTION_DATABASE_NAME, runWranglerJson, rowsFromD1Json, gateError } from './production-migration-lib.mjs';
export const CC11_MIGRATION = '0034_ticket_metric_rollups.sql';
export const CC11_SCHEMA_QUERY = "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN ('organization_tickets','ticket_cycles','ticket_events','ticket_wait_intervals','ticket_messages','ticket_message_revisions','ticket_commands','ticket_sla_assignments','ticket_sla_policies','ticket_metric_definitions','ticket_metric_rollups','ticket_metric_checkpoints') ORDER BY type,name;";
export function evaluateCC11Schema(objects, ledger) {
    const applied = new Set(ledger.map(x => x.name)), missingLedger = ['0010_ticket_center.sql', '0025_ticket_triage_classification.sql', '0026_ticket_command_lifecycle.sql', '0027_ticket_selective_access.sql', '0028_ticket_conversations.sql', '0033_ticket_sla_policies.sql'].filter(n => !applied.has(n));
    const required = { organization_tickets: ['organization_id', 'version', 'active', 'visibility'], ticket_cycles: ['cycle_number', 'origin', 'opened_at', 'closed_at'], ticket_events: ['entity_version', 'corrects_event_id', 'audience', 'message_id'], ticket_wait_intervals: ['started_at', 'ended_at'], ticket_messages: ['command_id', 'author_user_id'], ticket_message_revisions: ['message_id', 'version', 'body'], ticket_commands: ['actor_user_id', 'operation'], ticket_sla_assignments: ['policy_version', 'effective_at'], ticket_sla_policies: ['version', 'policy_json'] };
    const missingColumns = Object.entries(required).flatMap(([table, cols]) => cols.filter(c => !new RegExp(`\\b${c}\\b`).test(objects.find(o => o.name === table)?.sql || '')).map(c => `${table}.${c}`));
    const conflicting = objects.filter(o => /^ticket_metric_/.test(o.name) || /^ticket_metric_/.test(o.tbl_name)).map(o => o.name);
    return { compatible: !missingLedger.length && !missingColumns.length && !conflicting.length, missingLedger, missingColumns, conflicting, objects, digest: createHash('sha256').update(JSON.stringify(objects)).digest('hex') };
}
export async function readCC11Schema(configPath, ledger) { return evaluateCC11Schema(rowsFromD1Json(await runWranglerJson(['d1', 'execute', PRODUCTION_DATABASE_NAME, '--remote', '--command', CC11_SCHEMA_QUERY], configPath)), ledger); }
export function assertCC11Schema(report) { if (!report.compatible)
    throw gateError('CC11_SCHEMA_PREFLIGHT_BLOCKED', 'Schema/ledger incompatível com 0034; revisar auditoria antes de autorizar.', { missingLedger: report.missingLedger, missingColumns: report.missingColumns, conflicting: report.conflicting }); }
