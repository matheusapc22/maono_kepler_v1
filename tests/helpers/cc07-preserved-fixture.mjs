import {preservedCc07Digest,preservedCc07Snapshot} from '../../scripts/acceptance/cc07-preserved.mjs';
// Synthetic structural evidence. No production identifiers or content.
export function preservedFixture(plan){
 const time=new Date(Date.parse(plan.policy.startAt)-3600000).toISOString();
 const preserved={ticketId:70,runId:'44444444-4444-4444-8444-444444444444',managerId:1,recipientId:2,version:5,cycleNumber:1,
  outboxIds:['55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'],eventIds:[101,102,103,104],digest:'0'.repeat(64)};
 const scoped={tickets:[{id:70,organization_id:plan.organizationId,created_by:1,status:'closed',visibility:'private',version:5,active:1,created_at:time}],
  outbox:preserved.outboxIds.map((id,i)=>({id,organization_id:plan.organizationId,ticket_id:70,event_id:i?104:101,event_type:i?'ticket.closed':'ticket.created',status:'pending',created_at:time,notification_attempts:0,notification_next_at:null,notification_lease_until:null,notification_error:null,notification_completed_at:null})),
  candidates:preserved.outboxIds.map(outbox_id=>({outbox_id,recipient_id:2,state:'pending',organization_id:plan.organizationId})),notices:[]};
 const preservedRows={ticket:[{current_cycle_number:1,closed_at:time,closure_present:1,no_active_wait:1,matches_origin:1}],
  events:preserved.eventIds.map((id,i)=>({id,organization_id:plan.organizationId,ticket_id:70,event_type:['created','access_changed','access_changed','closed'][i],actor_user_id:1,created_at:time,command_id:null,entity_version:i+1,corrects_event_id:null,audience:'public'})),
  cycles:[{cycle_number:1,origin:'created',opened_at:time,opened_by:1,closed_at:time,closure_present:1}],
  acl:[{principal_type:'user',principal_id:1,action:'ticket.manage',effect:'allow',created_by:1,created_at:time}],policies:[],counts:[{events:4,cycles:1,acl:1,policies:0}]};
 plan.preserved=preserved;preserved.digest=preservedCc07Digest(preservedCc07Snapshot({scoped,preservedRows},plan));
 return {scoped,preservedRows};
}
