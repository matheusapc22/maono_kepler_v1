import {cc07Digest} from './cc07-infrastructure.mjs';
import {fail} from './production-acceptance-lib.mjs';
const check=(ok,code='CC07_PRESERVED_DRIFT')=>{if(!ok)fail(code,'Registros preservados CC07 divergentes; nenhuma exclusão ou adoção automática.');};
const sameSet=(a,b)=>a.length===new Set(a).size&&b.length===new Set(b).size&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
// Structural projections only. No subject, message, closure text or credentials.
export function preservedCc07Snapshot(audit,plan){
 const p=plan.preserved;if(!p)return null;
 const outbox=audit.scoped.outbox.filter(x=>x.ticket_id===p.ticketId),ids=new Set(outbox.map(x=>x.id));
 return {ticket:audit.scoped.tickets.filter(x=>x.id===p.ticketId),outbox,
  candidates:audit.scoped.candidates.filter(x=>ids.has(x.outbox_id)),notices:audit.scoped.notices.filter(x=>ids.has(x.outbox_id)),
  details:audit.preservedRows};
}
export function preservedCc07Digest(snapshot){
 const normalize=x=>Array.isArray(x)?x.map(normalize).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalize(x[k])])):x;
 return cc07Digest(normalize(snapshot));
}
export function currentCc07Inventory(audit,plan){
 const p=plan.preserved;if(!p)return audit;
 const s=preservedCc07Snapshot(audit,plan),d=s.details;
 check(s.ticket.length===1&&d&&d.ticket.length===1&&d.counts.length===1);
 const t=s.ticket[0],detail=d.ticket[0];
 check(t.organization_id===plan.organizationId&&t.created_by===p.managerId&&t.version===p.version&&t.status==='closed'&&t.visibility==='private'&&t.active===1);
 check(detail.matches_origin===1&&detail.current_cycle_number===p.cycleNumber&&detail.closure_present===1&&detail.no_active_wait===1&&detail.closed_at<plan.policy.startAt&&t.created_at<plan.policy.startAt);
 check(sameSet(s.outbox.map(x=>x.id),p.outboxIds)&&sameSet(d.events.map(x=>x.id),p.eventIds));
 check(s.outbox.every(x=>x.organization_id===plan.organizationId&&p.eventIds.includes(x.event_id)&&x.created_at<plan.policy.startAt&&x.status==='pending'&&x.notification_attempts===0&&x.notification_lease_until===null&&x.notification_next_at===null&&x.notification_completed_at===null&&x.notification_error===null));
 check(s.outbox.some(x=>x.event_type==='ticket.created')&&s.outbox.some(x=>x.event_type==='ticket.closed'));
 check(s.candidates.length===2&&s.candidates.every(x=>x.recipient_id===p.recipientId&&x.state==='pending')&&sameSet(s.candidates.map(x=>x.outbox_id),p.outboxIds)&&s.notices.length===0);
 check(d.cycles.length===1&&d.cycles[0].cycle_number===p.cycleNumber&&d.cycles[0].origin==='created'&&d.cycles[0].closed_at===detail.closed_at&&d.cycles[0].closure_present===1);
 check(d.acl.length===1&&d.acl[0].principal_type==='user'&&String(d.acl[0].principal_id)===String(p.managerId)&&d.acl[0].action==='ticket.manage'&&d.acl[0].effect==='allow'&&d.policies.length===0);
 check(['events','cycles','acl','policies'].every(k=>d.counts[0][k]===d[k].length));
 check(d.events.every(x=>x.organization_id===plan.organizationId&&x.ticket_id===p.ticketId&&x.created_at<plan.policy.startAt));
 check(preservedCc07Digest(s)===p.digest);
 const ids=new Set(p.outboxIds);
 const scoped={tickets:audit.scoped.tickets.filter(x=>x.id!==p.ticketId),outbox:audit.scoped.outbox.filter(x=>!ids.has(x.id)),
  candidates:audit.scoped.candidates.filter(x=>!ids.has(x.outbox_id)),notices:audit.scoped.notices.filter(x=>!ids.has(x.outbox_id))};
 return {...audit,scoped,preservedVerified:true};
}
