import { createHash } from 'node:crypto';
import { PRODUCTION_DATABASE_NAME, runWranglerJson, rowsFromD1Json, gateError } from './production-migration-lib.mjs';
export const CC10_MIGRATION = '0033_ticket_sla_policies.sql';
export const CC10_SCHEMA_QUERY = "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN ('organization_tickets','ticket_cycles','ticket_wait_intervals','ticket_commands','ticket_events','ticket_messages','ticket_sla_policies','ticket_sla_assignments','ticket_sla_schema') ORDER BY type,name;";
export function evaluateCC10Schema(objects, ledger) {
    const applied = new Set(ledger.map(x => x.name));
    const missingLedger = ['0010_ticket_center.sql', '0025_ticket_triage_classification.sql', '0026_ticket_command_lifecycle.sql', '0027_ticket_selective_access.sql', '0028_ticket_conversations.sql'].filter(name => !applied.has(name));
    const required = { organization_tickets: ['organization_id', 'current_cycle_number', 'active', 'status', 'visibility'], ticket_cycles: ['ticket_id', 'cycle_number', 'opened_at', 'closed_at'], ticket_wait_intervals: ['cycle_number', 'reason', 'started_at', 'ended_at'], ticket_commands: ['actor_user_id', 'operation'], ticket_events: ['message_id', 'corrects_event_id'], ticket_messages: ['command_id', 'author_user_id', 'kind', 'audience'] };
    const missingColumns = Object.entries(required).flatMap(([table, columns]) => columns.filter(c => !new RegExp(`\\b${c}\\b`).test(objects.find(x => x.name === table)?.sql || '')).map(c => `${table}.${c}`));
    const conflicting = objects.filter(x => /^ticket_sla_/.test(x.name) || /^ticket_sla_/.test(x.tbl_name)).map(x => x.name);
    return { compatible: !missingLedger.length && !missingColumns.length && !conflicting.length, missingLedger, missingColumns, conflicting, objects, digest: createHash('sha256').update(JSON.stringify(objects)).digest('hex') };
}
export async function readCC10Schema(configPath, ledger) { return evaluateCC10Schema(rowsFromD1Json(await runWranglerJson(['d1', 'execute', PRODUCTION_DATABASE_NAME, '--remote', '--command', CC10_SCHEMA_QUERY], configPath)), ledger); }
export function assertCC10Schema(report) { if (!report.compatible)
    throw gateError('CC10_SCHEMA_PREFLIGHT_BLOCKED', 'Schema/ledger incompatível com 0033; revisar relatório read-only antes de autorizar.', { missingLedger: report.missingLedger, missingColumns: report.missingColumns, conflicting: report.conflicting }); }
