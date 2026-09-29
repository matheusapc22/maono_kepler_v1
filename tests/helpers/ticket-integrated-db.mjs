import { readFileSync } from 'node:fs';
import { createTicketCommandDb, COMMAND_ACTORS } from './ticket-command-db.mjs';
import { processExportStep } from '../../functions/_lib/ticket-exports.js';

export const ACTORS = { ...COMMAND_ACTORS,
  author: COMMAND_ACTORS.viewer,
  editor: {id:5, role:'editor', activeOrganizationId:1},
  admin: {id:6, role:'admin', activeOrganizationId:1},
  superadmin: {id:7, role:'super_admin', activeOrganizationId:1},
};
export const WINDOW = {from:'2026-01-01T00:00:00.000Z',to:'2026-02-01T00:00:00.000Z',asOf:'2026-02-01T00:00:00.000Z'};
export const MIGRATIONS = ['0027_ticket_selective_access.sql','0028_ticket_conversations.sql','0029_ticket_attachment_upload_sessions.sql','0030_ticket_notifications.sql','0031_ticket_change_reconciliation.sql','0032_ticket_flow_navigation.sql','0033_ticket_sla_policies.sql','0034_ticket_metric_rollups.sql','0035_ticket_report_exports.sql','0036_ticket_incidents_problems.sql','0037_ticket_knowledge.sql','0038_ticket_feedback.sql'];
// Literal upgrade migrations together, not schema/query-pattern substitutes.
export async function integratedDb(t) {
  const f=await createTicketCommandDb(t);
  for(const name of MIGRATIONS) f.sqlite.exec(readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8'));
  f.sqlite.exec(`INSERT INTO users(id,email,name,role,password_hash) VALUES
    (5,'editor@cc17.test','Editor','editor','fixture'),(6,'admin@cc17.test','Admin','admin','fixture'),(7,'super@cc17.test','Super','super_admin','fixture');
    INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(1,5,'editor'),(1,6,'owner'),(1,7,'owner');
    INSERT OR IGNORE INTO role_permissions(role,permission,scope_type) VALUES('viewer','ticket.view','organization'),('viewer','ticket.comment','organization');`);
  Object.assign(f.env,{
    MAONO_RUNTIME_ENV:'local', MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:'true',MAONO_TICKET_CONVERSATIONS_ENABLED:'true',MAONO_TICKET_RESUMABLE_UPLOADS_ENABLED:'true',
    MAONO_TICKET_NOTIFICATIONS_ENABLED:'true',MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:'true',MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:'1,2',MAONO_TICKET_NOTIFICATION_START_AT:'2026-01-01T00:00:00.000Z',
    MAONO_TICKET_METRICS_ENABLED:'true',MAONO_TICKET_METRICS_ORGANIZATION_IDS:'1,2',MAONO_TICKET_SLA_ENABLED:'true',MAONO_TICKET_SLA_ORGANIZATION_IDS:'1,2',
    MAONO_TICKET_EXPORTS_ENABLED:'true',MAONO_TICKET_EXPORT_ORGANIZATION_IDS:'1,2',MAONO_TICKET_EXPORT_TTL_SECONDS:'3600',MAONO_TICKET_EXPORT_MAX_ROWS:'1000',MAONO_TICKET_EXPORT_MAX_BYTES:String(10*1024*1024),MAONO_TICKET_EXPORT_MAX_JOBS_PER_ORG:'10',MAONO_TICKET_EXPORT_MAX_ATTEMPTS:'3',MAONO_TICKET_EXPORT_CSV_PROFILE:'text-v1',
  });
  // Explicit synthetic organization-scoped grants; role names alone aren't export grants.
  for(const permission of ['ticket.view','export.create','export.view','export.download'])
    f.sqlite.prepare('INSERT INTO user_permissions(user_id,permission,organization_id,active) VALUES(5,?,1,1)').run(permission);
  f.files=new Map(); f.storage={
    async put(part,bytes){ f.files.set(part.id,bytes); },
    async get(part){return new Response(f.files.get(part.id));},
    async remove(part){f.files.delete(part.id);},
  };
  return f;
}
export function seedTicket(f,{id=101,org=1,visibility='organization',author=3,subject='CC17 synthetic'}={}) {
  f.sqlite.prepare("INSERT INTO organization_tickets(id,organization_id,code,subject,description,status,created_by,created_at,updated_at,current_cycle_number,visibility) VALUES(?,?,?,?, 'synthetic','open',?,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1,?)").run(id,org,'CC17-'+id,subject,author,visibility);
  f.sqlite.prepare("INSERT INTO ticket_cycles(organization_id,ticket_id,cycle_number,origin,opened_at,opened_by) VALUES(?,?,1,'created','2026-01-01T00:00:00.000Z',?)").run(org,id,author);
}
export function grant(f,ticketId,userId,effect='allow',action='ticket.view') {
  f.sqlite.prepare("INSERT INTO ticket_acl_entries(organization_id,ticket_id,principal_type,principal_id,action,effect,created_by,created_at) VALUES(1,?,'user',?,?,?,1,'2026-01-01')").run(ticketId,String(userId),action,effect);
}
export function commandRequest(key,etag) {return new Request('https://cc17.test/tickets',{method:'POST',headers:{'Idempotency-Key':key,...(etag?{'If-Match':etag}:{})}});}
export const PAYLOAD={subject:'CC17 command',description:'Synthetic command',priority:'normal',category:'support',assignedTo:2,demandNature:'question_request',expectedResult:'Integrity',context:'Local gate',impact:'team',urgency:'soon',priorityReason:'',triageAnswers:{},triageFormVersion:1};
export async function drainExport(f,id) {
  for(let i=0;i<100;i++) {
    const row=f.sqlite.prepare('SELECT * FROM ticket_export_jobs WHERE id=?').get(id);
    if(['ready','failed','revoked','cancelled','expired'].includes(row.state))return row;
    await processExportStep(f.env,1,{storage:f.storage});
  }
  throw new Error('Local export did not reach a terminal state');
}
