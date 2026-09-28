import { onRequestGet as listRoute } from '../functions/api/organizations/[id]/tickets.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createTicketCommandDb, COMMAND_ACTORS } from './helpers/ticket-command-db.mjs';
import { listTickets, parseTicketListOptions } from '../functions/_lib/ticket-center.js';
import { saveQueuePolicy, readQueuePolicies } from '../functions/_lib/ticket-flow.js';
import { executeTicketCreate, executeTicketTransition } from '../functions/_lib/ticket-commands.js';
import { onRequest as flowRoute } from '../functions/api/organizations/[id]/tickets/flow.js';
const actor = COMMAND_ACTORS.owner;
const sql = path => readFileSync(new URL(path,import.meta.url),'utf8');
async function fixture(t) {
 const f = await createTicketCommandDb(t);
 f.sqlite.exec(sql('../migrations/0027_ticket_selective_access.sql'));
 f.sqlite.exec(sql('../migrations/0032_ticket_flow_navigation.sql'));
 f.env.MAONO_TICKET_FLOW_ENABLED = 'true';
 f.env.MAONO_TICKET_FLOW_ORGANIZATION_IDS = '1,2';
 f.env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED = 'true';
 return f;
}
function seed(f,n=250) {
 const insert = f.sqlite.prepare(`INSERT INTO organization_tickets(organization_id,code,subject,description,status,priority,category,created_by,created_at,updated_at,due_at)
 VALUES(1,?,?,'fixture','open','normal','support',1,'2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z',?)`);
 for(let i=0;i<n;i++) insert.run(`FLOW-${i}`,`Fixture ${i}`,i%2 ? '2026-09-30T10:00:00.000Z' : null);
}
const query = (f,params='',user=actor,org=1) => listTickets(f.env,org,parseTicketListOptions(`https://local.test/?${params}`),user);
for(const sort of ['updated_desc','updated_asc','due_asc','priority_desc']) test(`CT30 ${sort}: 250 records, ties, insert/update between pages; no omissions/duplicates`,async t => {
 const f=await fixture(t);seed(f);
 const before=f.rows('organization_tickets').map(x=>x.id);
 let response=await query(f,`limit=50&sort=${sort}`);const ids=response.tickets.map(x=>x.id),snapshot=response.pagination.snapshot;
 f.sqlite.exec(`INSERT INTO organization_tickets(organization_id,code,subject,description,status,priority,category,created_by,created_at,updated_at) VALUES(1,'LATE','Late','fixture','open','high','support',1,'2099','2099')`);
 f.sqlite.exec(`UPDATE organization_tickets SET updated_at='2099', priority='high' WHERE id=1`);
 for(let page=2;page<=5;page++){response=await query(f,`limit=50&sort=${sort}&page=${page}&snapshot=${snapshot}`);ids.push(...response.tickets.map(x=>x.id));}
 assert.equal(ids.length,250);assert.equal(new Set(ids).size,250);assert.deepEqual([...ids].sort((a,b)=>a-b),before);
 assert.equal(response.pagination.hasMore,false);assert.equal(response.pagination.total,250);
 assert.equal((await query(f)).pagination.total,251);
});
test('CT32 snapshot is scoped to actor, org, query and expiry; revocation leaves a hole and reduces counts',async t=>{
 const f=await fixture(t);seed(f,4);
 const first=await query(f,'limit=2',COMMAND_ACTORS.viewer);const snapshot=first.pagination.snapshot;
 await assert.rejects(query(f,`limit=2&page=2&snapshot=${snapshot}`,actor),{code:'TICKET_QUERY_EXPIRED'});
 await assert.rejects(query(f,`limit=2&page=2&snapshot=${snapshot}`,COMMAND_ACTORS.viewer,2),{code:'TICKET_QUERY_EXPIRED'});
 await assert.rejects(query(f,`limit=2&q=changed&snapshot=${snapshot}`,COMMAND_ACTORS.viewer),{code:'TICKET_QUERY_EXPIRED'});
 f.sqlite.exec("UPDATE organization_tickets SET visibility='private' WHERE id=1");
 const second=await query(f,`limit=2&page=2&snapshot=${snapshot}`,COMMAND_ACTORS.viewer);
 assert.deepEqual(second.tickets.map(x=>x.id),[2]);assert.equal(second.pagination.total,3);assert.equal(second.facets.byStatus.open,3);assert.equal(second.pagination.hasMore,false);
 f.sqlite.prepare("UPDATE ticket_query_snapshots SET expires_at='2000' WHERE id=?").run(snapshot);
 await assert.rejects(query(f,`snapshot=${snapshot}`,COMMAND_ACTORS.viewer),{code:'TICKET_QUERY_EXPIRED'});
});
test('shared due-date filter includes undated consistently and excludes private totals',async t=>{
 const f=await fixture(t);seed(f,6);f.sqlite.exec("UPDATE organization_tickets SET visibility='private' WHERE id=1");
 const response=await query(f,'from=2026-09-30&to=2026-09-30&includeUndated=1',COMMAND_ACTORS.viewer);
 assert.equal(response.pagination.total,5);assert.equal(response.facets.byStatus.open,5);
 assert.equal(response.tickets.filter(x=>!x.dueAt).length,2);
});
const req=etag=>new Request('https://local.test/',{method:'POST',headers:etag?{'If-Match':etag}:{'Idempotency-Key':crypto.randomUUID()}});
async function created(f){return executeTicketCreate(f.env,1,actor,{subject:'WIP fixture',description:'Control',priority:'normal',category:'support',assignedTo:2,demandNature:'question_request',expectedResult:'Result',context:'',impact:'individual',urgency:'flexible',triageAnswers:{},triageFormVersion:1},req());}
async function open(f){const result=await created(f);return executeTicketTransition(f.env,1,result.ticket.id,actor,{status:'open',nextAction:'Examinar demanda'},req(result.etag));}
test('CT31 two entrants race for last WIP slot; justified exception is audited; stale CAS wins',async t=>{
 const f=await fixture(t);
 assert.equal((await readQueuePolicies(f.env,1))[0].wipLimit,null);
 await saveQueuePolicy(f.env,1,actor,{queue:'in_progress',wipLimit:1,version:0,reason:'Capacidade de um atendente'});
 const a=await open(f),b=await open(f);
 const enter=result=>executeTicketTransition(f.env,1,result.ticket.id,actor,{status:'in_progress',nextAction:'Investigar caso'},req(result.etag));
 const outcomes=await Promise.allSettled([enter(a),enter(b)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'TICKET_WIP_LIMIT_REACHED');
 const blocked=outcomes[0].status==='rejected'?a:b;
 const baseline=f.rows('ticket_events').length;
 await assert.rejects(executeTicketTransition(f.env,1,blocked.ticket.id,actor,{status:'in_progress',nextAction:'Investigar',wipExceptionReason:'x'},req(blocked.etag)),{code:'TICKET_WIP_REASON_REQUIRED'});
 assert.equal(f.rows('ticket_events').length,baseline);
 const changed=await executeTicketTransition(f.env,1,blocked.ticket.id,actor,{status:'in_progress',nextAction:'Investigar',wipExceptionReason:'Urgência aprovada pela gestão'},req(blocked.etag));
 assert.equal(changed.ticket.status,'in_progress');
 const event=f.rows('ticket_events').at(-1);assert.equal(JSON.parse(event.metadata).wipException.reason,'Urgência aprovada pela gestão');
 assert.ok(f.row(blocked.ticket.id).queue_entered_at);
 await assert.rejects(enter(blocked),{status:412});
});
test('WIP configuration is CAS audited, validates values and requires manage permission over HTTP',async t=>{
 const f=await fixture(t);
 const config={queue:'in_review',wipLimit:2,version:0,reason:'Revisão de dois atendimentos'};
 await saveQueuePolicy(f.env,1,actor,config);
 await assert.rejects(saveQueuePolicy(f.env,1,actor,config),{status:412});
 await assert.rejects(saveQueuePolicy(f.env,1,actor,{...config,version:1,wipLimit:0}),{status:400});
 assert.equal(f.rows('audit_logs').filter(x=>x.action==='ticket.queue_policy.updated').length,1);
 const response=await flowRoute({env:f.env,params:{id:'1'},request:new Request('https://local.test/api/organizations/1/tickets/flow',{method:'PUT',headers:{cookie:f.sessionCookie(3), 'Content-Type':'application/json'},body:JSON.stringify({...config,version:1})})});
 assert.equal(response.status,403);
});
test('flow flag off needs no migration; flag on missing schema fails closed',async t=>{
 const f=await createTicketCommandDb(t);
 assert.equal((await query(f)).flowEnabled,false);
 f.env.MAONO_TICKET_FLOW_ENABLED='true';f.env.MAONO_TICKET_FLOW_ORGANIZATION_IDS='1';await assert.rejects(query(f),{code:'TICKET_FLOW_NOT_READY'});
});
test('snapshot transaction rolls back fully and expiration cleanup cascades',async t=>{
 const f=await fixture(t);seed(f,3);f.failNextBatchAt(2);
 await assert.rejects(query(f),/FIXTURE_STATEMENT_FAILURE/);assert.equal(f.rows('ticket_query_snapshots').length,0);
 await query(f);f.sqlite.exec("UPDATE ticket_query_snapshots SET expires_at='2000'");await query(f);
 assert.equal(f.rows('ticket_query_snapshots').length,1);assert.equal(f.rows('ticket_query_snapshot_items').length,3);
 assert.equal(f.sqlite.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('per-column pagination reconciles the shared query without a 100-ticket cap',async t=>{
 const f=await fixture(t);seed(f,250);
 const all=await query(f,'includeUndated=1');
 let page=await query(f,'queue=open&limit=25&includeUndated=1');const ids=page.tickets.map(x=>x.id),snapshot=page.pagination.snapshot;
 for(let n=2;page.pagination.hasMore;n++){page=await query(f,`queue=open&limit=25&includeUndated=1&page=${n}&snapshot=${snapshot}`);ids.push(...page.tickets.map(x=>x.id));}
 assert.equal(new Set(ids).size,all.pagination.total);assert.equal(ids.length,250);
 for(const queue of ['in_progress','in_review','closed']) assert.equal((await query(f,`queue=${queue}`)).pagination.total,0);
});

test('rollback flag does not bypass an existing WIP policy',async t=>{
 const f=await fixture(t),ticket=await open(f);
 await saveQueuePolicy(f.env,1,actor,{queue:'in_progress',wipLimit:1,version:0,reason:'Limite da equipe validado'});
 f.env.MAONO_TICKET_FLOW_ENABLED='false';
 await assert.rejects(executeTicketTransition(f.env,1,ticket.ticket.id,actor,{status:'in_progress',nextAction:'Investigar'},req(ticket.etag)),{code:'TICKET_FLOW_DISABLED'});
});

test('canary requires an explicit organization allowlist',async t=>{
 const f=await fixture(t);delete f.env.MAONO_TICKET_FLOW_ORGANIZATION_IDS;
 assert.equal((await query(f)).flowEnabled,false);
 f.env.MAONO_TICKET_FLOW_ORGANIZATION_IDS='2';assert.equal((await query(f)).flowEnabled,false);
});

test('authenticated HTTP list returns scoped snapshot and denies anonymous access',async t=>{
 const f=await fixture(t);seed(f,3);
 const url='https://local.test/api/organizations/1/tickets?limit=2';
 const data=await listRoute({env:f.env,params:{id:'1'},request:new Request(url,{headers:{cookie:f.sessionCookie(1)}})});
 assert.equal(data.status,200);const body=await data.json();assert.equal(body.tickets.length,2);assert.ok(body.pagination.snapshot);
 const anonymous=await listRoute({env:f.env,params:{id:'1'},request:new Request(url)});assert.equal(anonymous.status,401);
});
test('partial flow schema cannot advertise readiness',async t=>{
 const f=await fixture(t);f.sqlite.exec('DROP TRIGGER ticket_flow_queue_entry');
 await assert.rejects(query(f),{code:'TICKET_FLOW_NOT_READY'});
});

test('CT31 columns share one immutable partition: a concurrent move cannot duplicate or lose a card',async t=>{
 const f=await fixture(t);seed(f,250);
 const root=await query(f,'includeUndated=1');const snapshot=root.pagination.snapshot;
 f.sqlite.exec("UPDATE organization_tickets SET status='in_progress' WHERE id=1");
 const ids=[];
 for(const queue of ['open','in_progress','in_review','closed']){
  let response;
  for(let page=1;!response || response.pagination.hasMore;page++){
   response=await query(f,`includeUndated=1&limit=25&queue=${queue}&page=${page}&snapshot=${snapshot}`);ids.push(...response.tickets.map(t=>t.id));
  }
 }
 assert.equal(ids.length,250);assert.equal(new Set(ids).size,250);
 assert.equal((await query(f,`includeUndated=1&queue=in_progress&snapshot=${snapshot}`)).pagination.total,0);
 assert.equal((await query(f,'includeUndated=1&queue=in_progress')).pagination.total,1);
});

test('turning flow off never silently downgrades a snapshot to mutable OFFSET',async t=>{
 const f=await fixture(t);seed(f,3);const first=await query(f,'limit=2');
 f.env.MAONO_TICKET_FLOW_ENABLED='false';
 await assert.rejects(query(f,`limit=2&page=2&snapshot=${first.pagination.snapshot}`),{code:'TICKET_QUERY_EXPIRED'});
 assert.equal((await query(f)).flowEnabled,false);
});
