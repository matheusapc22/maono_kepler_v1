import test from 'node:test';
import assert from 'node:assert/strict';
import {integratedDb,ACTORS as A,WINDOW,seedTicket,grant,commandRequest,PAYLOAD,drainExport} from './helpers/ticket-integrated-db.mjs';
import {onRequest as detail} from '../functions/api/organizations/[id]/tickets/[ticketId].js';
import {onRequest as collection} from '../functions/api/organizations/[id]/tickets.js';
import {onRequest as attachments} from '../functions/api/organizations/[id]/tickets/[ticketId]/attachments.js';
import {executeTicketCreate,executeTicketUpdate} from '../functions/_lib/ticket-commands.js';
import {requireTicketAccess} from '../functions/_lib/ticket-access.js';
import {resolveTicketConversationContext,createTicketMessage} from '../functions/_lib/ticket-conversations.js';
import {readMetrics,replayMetrics} from '../functions/_lib/ticket-metrics.js';
import {createTicketExport,downloadTicketExport,readTicketExport,processExportStep} from '../functions/_lib/ticket-exports.js';
import {consumeTicketNotifications,listTicketNotifications} from '../functions/_lib/ticket-notifications.js';
import {consumeTicketExports} from '../workers/ticket-exports.js';
import {can} from '../functions/_lib/permissions.js';

function ctx(f,userId,ticketId,org=1){return {env:f.env,params:{id:String(org),ticketId:String(ticketId)},request:new Request(`https://cc17.test/api/organizations/${org}/tickets/${ticketId}`,{headers:userId?{Cookie:f.sessionCookie(userId,1)}:{}})};}
for(const profile of ['author','editor','owner','admin','superadmin'])test(`CT55 local ${profile}: private ID, list, count and attachment isolation`,async t=>{
  const f=await integratedDb(t);seedTicket(f);seedTicket(f,{id:102,visibility:'private',subject:'SECRET-CC17'});seedTicket(f,{id:201,org:2});
  const actor=A[profile];
  const own=await detail(ctx(f,actor.id,101));assert.equal(own.status,200,await own.clone().text());
  assert.equal((await detail(ctx(f,actor.id,102))).status,404);
  assert.equal((await attachments(ctx(f,actor.id,102))).status,404);
  assert.equal((await detail(ctx(f,actor.id,201))).status,404,'wrong organization ID cannot resolve');
  const listCtx=ctx(f,actor.id,101);listCtx.request=new Request('https://cc17.test/api/organizations/1/tickets?limit=100&q=SECRET-CC17',{headers:{Cookie:f.sessionCookie(actor.id,1)}});
  const response=await collection(listCtx);assert.equal(response.status,200);const body=await response.json();assert.equal(body.pagination.total,0);assert.deepEqual(body.tickets,[]);
  grant(f,102,actor.id);assert.equal((await detail(ctx(f,actor.id,102))).status,200);
  f.sqlite.prepare("UPDATE ticket_acl_entries SET effect='deny' WHERE ticket_id=102 AND principal_id=?").run(String(actor.id));
  assert.equal((await detail(ctx(f,actor.id,102))).status,404,'explicit deny wins for private object');
});
test('CT55 local anonymous, cross-organization session and removed member denied',async t=>{
  const f=await integratedDb(t);seedTicket(f);seedTicket(f,{id:201,org:2});
  assert.equal((await detail(ctx(f,null,101))).status,401);
  assert.equal((await detail(ctx(f,3,201,2))).status,403);
  f.sqlite.prepare('DELETE FROM organization_users WHERE user_id=3 AND organization_id=1').run();
  assert.equal((await detail(ctx(f,3,101))).status,403);
});
for(const profile of ['author','editor','owner','admin'])test(`CT55 removed ${profile}: stale session and explicit permission cannot restore membership`,async t=>{
  const f=await integratedDb(t);seedTicket(f);const actor=A[profile];
  const request=ctx(f,actor.id,101); // Session exists before membership is revoked.
  f.sqlite.prepare('INSERT INTO user_permissions(user_id,permission,organization_id,active) VALUES(?,?,1,1)').run(actor.id,'ticket.manage');
  f.sqlite.prepare('DELETE FROM organization_users WHERE user_id=? AND organization_id=1').run(actor.id);
  assert.equal((await detail(request)).status,403);
  const permission=await can(f.env,actor,'ticket.manage',{organizationId:1});
  assert.equal(permission.allowed,false);assert.equal(permission.reason,'TICKET_ORGANIZATION_MEMBERSHIP_REQUIRED');
});
test('CT55 local internal message body absent from restricted detail with all schemas installed',async t=>{
  const f=await integratedDb(t);seedTicket(f);
  const context=await resolveTicketConversationContext(f.env,1,101,A.owner);
  await createTicketMessage(f.env,context,{body:'INTERNAL-CC17-SECRET',kind:'internal'},commandRequest('cc17-private-message'));
  const response=await detail(ctx(f,3,101));assert.equal(response.status,200);assert.ok(!(await response.text()).includes('INTERNAL-CC17-SECRET'));
});
test('CT55 local metrics, stored rollups and exported CSV revalidate ACL after revocation',async t=>{
  const f=await integratedDb(t);seedTicket(f);seedTicket(f,{id:102,visibility:'private',subject:'SECRET-CC17'});seedTicket(f,{id:201,org:2,subject:'OTHER-ORG-CC17'});
  grant(f,102,5);await replayMetrics(f.env,1,A.editor,WINDOW);
  const {job}=await createTicketExport(f.env,1,A.editor,{...WINDOW,idempotencyKey:'cc17-export-revocation'});
  assert.equal((await drainExport(f,job.id)).state,'ready');
  const csv=await (await downloadTicketExport(f.env,1,A.editor,job.id,{storage:f.storage})).text();assert.ok(csv.includes('SECRET-CC17'));assert.ok(!csv.includes('OTHER-ORG-CC17'));
  f.sqlite.prepare("DELETE FROM ticket_acl_entries WHERE ticket_id=102").run();
  const metrics=await readMetrics(f.env,1,A.editor,WINDOW);assert.equal(metrics.aggregation.pending+metrics.aggregation.matched,1);
  await assert.rejects(()=>downloadTicketExport(f.env,1,A.editor,job.id,{storage:f.storage}),{status:404});
  await assert.rejects(()=>readTicketExport(f.env,2,A.editor,job.id),{status:404});
});
test('CT57 local D1 failure rolls back command, history, cycle, outbox and candidates together',async t=>{
  const f=await integratedDb(t);const before=f.snapshot();f.failNextBatchAt(5);
  await assert.rejects(()=>executeTicketCreate(f.env,1,A.owner,PAYLOAD,commandRequest('cc17-atomic')));
  assert.deepEqual(f.snapshot(),before);
  await executeTicketCreate(f.env,1,A.owner,PAYLOAD,commandRequest('cc17-atomic'));
  assert.equal(f.rows('organization_tickets').length,1);assert.equal(f.rows('ticket_cycles').length,1);assert.equal(f.rows('ticket_commands').length,1);
});
test('CT57 local lost command ACK and concurrent replay preserve one effect',async t=>{
  const f=await integratedDb(t);const first=await executeTicketCreate(f.env,1,A.owner,PAYLOAD,commandRequest('cc17-lost-ack'));
  const retried=await Promise.all(Array.from({length:4},()=>executeTicketCreate(f.env,1,A.owner,PAYLOAD,commandRequest('cc17-lost-ack'))));
  assert.ok(retried.every(r=>r.ticket.id===first.ticket.id));assert.equal(f.rows('ticket_commands').length,1);assert.equal(f.rows('ticket_command_outbox').length,1);
  await assert.rejects(()=>executeTicketCreate(f.env,1,A.owner,{...PAYLOAD,subject:'Changed'},commandRequest('cc17-lost-ack')),{status:409});
});
test('CT57 local competing edits keep one CAS winner and matching immutable history',async t=>{
  const f=await integratedDb(t);const first=await executeTicketCreate(f.env,1,A.owner,PAYLOAD,commandRequest('cc17-cas-create'));
  const results=await Promise.allSettled(['one','two'].map((v,i)=>executeTicketUpdate(f.env,1,first.ticket.id,A.owner,{subject:v},commandRequest('cc17-cas-'+i,first.etag))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===412).length,1);assert.equal(f.rows('ticket_commands').length,2);
});
test('CT57 local consumer failure then retry and lost ACK produce one authorized notification',async t=>{
  const f=await integratedDb(t);await executeTicketCreate(f.env,1,A.owner,PAYLOAD,commandRequest('cc17-outbox'));
  f.failNextBatchAt(1);assert.equal((await consumeTicketNotifications(f.env)).retried,1);assert.equal(f.rows('ticket_notifications').length,0);
  f.sqlite.exec('UPDATE ticket_command_outbox SET notification_next_at=NULL');
  await Promise.all([consumeTicketNotifications(f.env),consumeTicketNotifications(f.env)]);assert.equal(f.rows('ticket_notifications').length,1);
  f.sqlite.exec("UPDATE ticket_command_outbox SET status='processing',notification_token='lost',notification_lease_until='2026-01-01'");
  await consumeTicketNotifications(f.env);assert.equal(f.rows('ticket_notifications').length,1);
  f.sqlite.exec("UPDATE organization_tickets SET visibility='private'");assert.equal((await listTicketNotifications(f.env,1,A.peer)).unread,0);
});
test('CT57 local storage write with lost ACK retries deterministically without duplicate export data',async t=>{
  const f=await integratedDb(t);seedTicket(f);const {job}=await createTicketExport(f.env,1,A.editor,{...WINDOW,idempotencyKey:'cc17-storage-failure'});
  let failed=false;const put=f.storage.put;f.storage.put=async(part,bytes)=>{await put(part,bytes);if(!failed){failed=true;throw Error('synthetic lost storage ACK');}};
  for(let i=0;i<5&&!failed;i++)await processExportStep(f.env,1,{storage:f.storage});
  assert.ok(f.sqlite.prepare('SELECT next_at FROM ticket_export_jobs WHERE id=?').get(job.id).next_at,'retry is scheduled, not a tight loop');
  // Advance the retry eligibility in the local fixture only.
  f.sqlite.exec('UPDATE ticket_export_jobs SET next_at=NULL');
  const row=await drainExport(f,job.id);assert.equal(row.state,'ready',row.error_code);assert.equal(failed,true);
  const csv=await(await downloadTicketExport(f.env,1,A.editor,job.id,{storage:f.storage})).text();assert.equal(csv.split('CC17 synthetic').length-1,1);
});
test('CT58 local command and consumer flags OFF preserve private reads, history and paused work',async t=>{
  const f=await integratedDb(t);const created=await executeTicketCreate(f.env,1,A.owner,PAYLOAD,commandRequest('cc17-rollback'));
  f.sqlite.prepare("UPDATE organization_tickets SET visibility='private' WHERE id=?").run(created.ticket.id);grant(f,created.ticket.id,1,'allow','ticket.manage');
  Object.assign(f.env,{MAONO_TICKET_COMMANDS_ENABLED:'false',MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:'false',MAONO_TICKET_EXPORT_WORKER_ENABLED:'false'});
  const readContext=ctx(f,1,created.ticket.id),before=f.snapshot();await assert.rejects(()=>executeTicketCreate(f.env,1,A.owner,PAYLOAD,commandRequest('cc17-off')),{status:503});
  assert.deepEqual(await consumeTicketNotifications(f.env),{enabled:false,claimed:0});assert.deepEqual(await consumeTicketExports(f.env),{enabled:false});
  assert.equal((await detail(readContext)).status,200);await assert.rejects(()=>requireTicketAccess(f.env,1,created.ticket.id,A.viewer),{status:404});
  assert.deepEqual(f.snapshot(),before);assert.equal(f.sqlite.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
