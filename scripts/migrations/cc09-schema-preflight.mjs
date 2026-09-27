import {createHash} from 'node:crypto';
import {PRODUCTION_DATABASE_NAME,runWranglerJson,rowsFromD1Json,gateError} from './production-migration-lib.mjs';
export const CC09_MIGRATION='0032_ticket_flow_navigation.sql';
export const CC09_SCHEMA_QUERY="SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN ('organization_tickets','ticket_query_snapshots','ticket_query_snapshot_items','ticket_queue_policies') ORDER BY type,name;";
export function evaluateCC09Schema(objects,ledger) {
 const applied=new Set(ledger.map(x=>x.name));
 const missingLedger=['0010_ticket_center.sql','0025_ticket_triage_classification.sql','0026_ticket_command_lifecycle.sql','0027_ticket_selective_access.sql'].filter(name=>!applied.has(name));
 const base=objects.find(x=>x.name==='organization_tickets')?.sql || '';
 const missingColumns=['organization_id','status','active','version','last_command_id'].filter(name=>!new RegExp(`\\b${name}\\b`).test(base));
 const conflicting=objects.filter(x=>/^ticket_query_snapshot|^ticket_queue_policies|^ticket_flow_|^idx_ticket_flow_queue|^idx_ticket_snapshot_expiry/.test(x.name)).map(x=>x.name);
 if(/\bqueue_entered_at\b/.test(base))conflicting.push('organization_tickets.queue_entered_at');
 return {compatible:!missingLedger.length&&!missingColumns.length&&!conflicting.length,missingLedger,missingColumns,conflicting,objects,digest:createHash('sha256').update(JSON.stringify(objects)).digest('hex')};
}
export async function readCC09Schema(configPath,ledger){return evaluateCC09Schema(rowsFromD1Json(await runWranglerJson(['d1','execute',PRODUCTION_DATABASE_NAME,'--remote','--command',CC09_SCHEMA_QUERY],configPath)),ledger);}
export function assertCC09Schema(report){if(!report.compatible)throw gateError('CC09_SCHEMA_PREFLIGHT_BLOCKED','Schema/ledger incompatível com 0032; revisar relatório read-only antes de autorizar.',{missingLedger:report.missingLedger,missingColumns:report.missingColumns,conflicting:report.conflicting});}
