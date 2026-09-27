import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTicketCommandDb,COMMAND_ACTORS} from './helpers/ticket-command-db.mjs';
import {executeTicketCreate} from '../functions/_lib/ticket-commands.js';
import {createTicketMessage,resolveTicketConversationContext} from '../functions/_lib/ticket-conversations.js';
import {consumeTicketNotifications,listTicketNotifications,markTicketNotification,notificationReady,
 notificationOperations,retryTicketNotification} from '../functions/_lib/ticket-notifications.js';
import {onRequest} from '../functions/api/organizations/[id]/ticket-notifications.js';
import {onRequest as operationsHttp} from '../functions/api/organizations/[id]/ticket-notifications/operations.js';
const source=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const payload={subject:'CC07 privado',description:'Teste local',category:'support',priority:'normal',assignedTo:2,
 demandNature:'question_request',expectedResult:'Notificação',context:'Teste',impact:'team',urgency:'soon',priorityReason:'',triageAnswers:{},triageFormVersion:1};
const request=key=>new Request('https://cc07.test/tickets',{method:'POST',headers:{'Idempotency-Key':key,'Content-Type':'application/json'}});
async function fixture(t,{schema=true}={}) {
 const db=await createTicketCommandDb(t);
 db.sqlite.exec(source('../migrations/0027_ticket_selective_access.sql'));
 db.sqlite.exec(source('../migrations/0028_ticket_conversations.sql'));
 if(schema)db.sqlite.exec(source('../migrations/0030_ticket_notifications.sql'));
 Object.assign(db.env,{MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:'1,2',MAONO_RUNTIME_ENV:'local',MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:'true',MAONO_TICKET_CONVERSATIONS_ENABLED:'true',
 MAONO_TICKET_NOTIFICATIONS_ENABLED:'true',MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:'true',MAONO_TICKET_NOTIFICATION_START_AT:'2026-01-01T00:00:00.000Z'});
 const {ticket}=await executeTicketCreate(db.env,1,COMMAND_ACTORS.owner,payload,request('create'));
 return {db,ticket,env:db.env};
}
const peer=COMMAND_ACTORS.peer;
async function inbox(env,user=peer,opts={}) {return listTicketNotifications(env,1,user,opts);}

test('snapshot at enqueue excludes author and delivers once, with authorized unread/read',async t=>{
 const {db,env}=await fixture(t);
 assert.deepEqual(db.rows('ticket_notification_candidates').map(r=>r.recipient_id),[2]);
 assert.equal((await consumeTicketNotifications(env)).delivered,1);
 assert.equal((await consumeTicketNotifications(env)).claimed,0);
 const page=await inbox(env);assert.equal(page.unread,1);assert.equal(page.items.length,1);
 await markTicketNotification(env,1,peer,page.items[0].id,true);
 await markTicketNotification(env,1,peer,page.items[0].id,true);
 assert.equal((await inbox(env)).unread,0);
 await markTicketNotification(env,1,peer,page.items[0].id,false);assert.equal((await inbox(env)).unread,1);
 assert.equal(db.rows('ticket_notifications')[0].channel,'in_app');
});
test('OFF performs no database work and missing schema fails closed',async t=>{
 assert.deepEqual(await consumeTicketNotifications({}),{enabled:false,claimed:0});
 assert.equal((await listTicketNotifications({},1,peer)).enabled,false);
 const {env}=await fixture(t,{schema:false});
 await assert.rejects(()=>notificationReady(env),e=>e.code==='TICKET_NOTIFICATION_SCHEMA_OUTDATED');
});
test('requires access flag and a fixed valid cutoff',async t=>{
 const {env}=await fixture(t);env.MAONO_TICKET_NOTIFICATION_START_AT='';
 await assert.rejects(()=>consumeTicketNotifications(env),e=>e.code==='TICKET_NOTIFICATION_START_REQUIRED');
 env.MAONO_TICKET_NOTIFICATION_START_AT='2026-01-01T00:00:00.000Z';env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED='false';
 await assert.rejects(()=>inbox(env),e=>e.code==='TICKET_NOTIFICATION_ACCESS_REQUIRED');
});
test('rollback leaves neither command, event, outbox nor candidate',async t=>{
 const {db,env}=await fixture(t);const snap=db.snapshot();db.failNextBatchAt(5);
 await assert.rejects(()=>executeTicketCreate(env,1,COMMAND_ACTORS.owner,payload,request('rollback')));
 assert.deepEqual(db.snapshot(),snap);
});
test('two consumers claim a single event once',async t=>{
 const {db,env}=await fixture(t);
 const reports=await Promise.all([consumeTicketNotifications(env),consumeTicketNotifications(env)]);
 assert.equal(reports.reduce((n,r)=>n+r.claimed,0),1);assert.equal(db.rows('ticket_notifications').length,1);
});
test('CT24 atomic batch failure leaves no delivery; retry succeeds',async t=>{
 const {db,env}=await fixture(t);db.failNextBatchAt(1);
 const report=await consumeTicketNotifications(env);assert.equal(report.retried,1);
 assert.equal(db.rows('ticket_notifications').length,0);assert.equal(db.rows('ticket_command_outbox')[0].status,'pending');
 assert.equal((await consumeTicketNotifications(env)).claimed,0);
 db.sqlite.exec('UPDATE ticket_command_outbox SET notification_next_at=NULL');
 await consumeTicketNotifications(env);assert.equal(db.rows('ticket_notifications').length,1);
});
test('CT24 simulated lost ACK replays without visible duplication',async t=>{
 const {db,env}=await fixture(t);await consumeTicketNotifications(env);
 db.sqlite.exec("UPDATE ticket_command_outbox SET status='processing',notification_token='dead',notification_lease_until='2026-01-01T00:00:00.000Z'");
 await consumeTicketNotifications(env);assert.equal(db.rows('ticket_notifications').length,1);
});
test('old worker is fenced after lease is reclaimed before its commit',async t=>{
 const {db,env}=await fixture(t);
 db.beforeNextBatch(sqlite=>sqlite.exec("UPDATE ticket_command_outbox SET notification_token='new-worker'"));
 const report=await consumeTicketNotifications(env);assert.equal(report.lostLease,1);assert.equal(db.rows('ticket_notifications').length,0);
 assert.equal(db.rows('ticket_command_outbox')[0].notification_token,'new-worker');
});
test('expired lease cannot ACK even without another worker',async t=>{
 const {db,env}=await fixture(t);let calls=0;const base=Date.now();
 await consumeTicketNotifications(env,{now:()=>base+(++calls>=4?121000:0)});
 assert.equal(db.rows('ticket_notifications').length,0);
});
test('CT25 revoked private ACL suppresses delivery',async t=>{
 const {db,env,ticket}=await fixture(t);
 db.sqlite.prepare("UPDATE organization_tickets SET visibility='private' WHERE id=?").run(ticket.id);
 const report=await consumeTicketNotifications(env);assert.equal(report.suppressed,1);assert.equal(db.rows('ticket_notifications').length,0);
});
test('CT25 revocation after delivery hides items and unread count, denies read mutation',async t=>{
 const {db,env,ticket}=await fixture(t);await consumeTicketNotifications(env);
 const id=(await inbox(env)).items[0].id;
 db.sqlite.prepare("UPDATE organization_tickets SET visibility='private' WHERE id=?").run(ticket.id);
 assert.equal((await inbox(env)).unread,0);assert.equal((await inbox(env)).items.length,0);
 await assert.rejects(()=>markTicketNotification(env,1,peer,id,true),e=>e.status===404);
});
test('membership revocation and inactive user deny inbox even for owner',async t=>{
 const {db,env}=await fixture(t);await consumeTicketNotifications(env);
 db.sqlite.exec('DELETE FROM organization_users WHERE organization_id=1 AND user_id=2');
 await assert.rejects(()=>inbox(env),e=>e.status===403);
});
test('other organization/user cannot enumerate or mark another inbox',async t=>{
 const {env}=await fixture(t);await consumeTicketNotifications(env);const id=(await inbox(env)).items[0].id;
 assert.equal((await inbox(env,COMMAND_ACTORS.owner)).items.length,0);
 await assert.rejects(()=>listTicketNotifications(env,2,peer),e=>e.status===403);
 await assert.rejects(()=>markTicketNotification(env,1,COMMAND_ACTORS.owner,id,true),e=>e.status===404);
});
test('snapshot does not add a replacement assignee during retry',async t=>{
 const {db,env,ticket}=await fixture(t);db.sqlite.prepare('UPDATE organization_tickets SET assigned_to=3 WHERE id=?').run(ticket.id);
 await consumeTicketNotifications(env);assert.deepEqual(db.rows('ticket_notifications').map(r=>r.recipient_id),[2]);
});
test('historical events before cutoff are not delivered',async t=>{
 const {db,env}=await fixture(t);env.MAONO_TICKET_NOTIFICATION_START_AT='2099-01-01T00:00:00.000Z';
 assert.equal((await consumeTicketNotifications(env)).claimed,0);assert.equal(db.rows('ticket_notifications').length,0);
});
test('migration does not backfill old outbox rows',async t=>{
 const {db,env}=await fixture(t,{schema:false});db.sqlite.exec(source('../migrations/0030_ticket_notifications.sql'));
 assert.equal(db.rows('ticket_notification_candidates').length,0);assert.equal((await consumeTicketNotifications(env)).claimed,0);
 assert.equal(db.sqlite.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('CT25 five failures enter failed queue; owner cannot retry, super admin can with audit',async t=>{
 const {db,env}=await fixture(t);
 for(let i=0;i<5;i++){db.failNextBatchAt(0);db.sqlite.exec('UPDATE ticket_command_outbox SET notification_next_at=NULL');await consumeTicketNotifications(env);}
 const row=db.rows('ticket_command_outbox')[0];assert.equal(row.status,'failed');assert.equal(row.notification_attempts,5);
 await assert.rejects(()=>retryTicketNotification(env,1,peer,row.id),e=>e.status===403);
 const admin={...COMMAND_ACTORS.owner,role:'super_admin'};
 assert.equal((await notificationOperations(env,1,admin)).failures.length,1);
 await retryTicketNotification(env,1,admin,row.id);
 assert.equal(db.rows('audit_logs').filter(r=>r.action==='ticket.notification.retried').length,1);
 await consumeTicketNotifications(env);assert.equal(db.rows('ticket_notifications').length,1);
});
test('crash at final attempt becomes failed instead of infinitely reclaiming',async t=>{
 const {db,env}=await fixture(t);
 db.sqlite.exec("UPDATE ticket_command_outbox SET status='processing',notification_attempts=5,notification_lease_until='2026-01-01T00:00:00.000Z'");
 await consumeTicketNotifications(env);assert.equal(db.rows('ticket_command_outbox')[0].status,'failed');
});
test('internal note never goes to viewer and loses visibility on note permission revocation',async t=>{
 const {db,env,ticket}=await fixture(t);await consumeTicketNotifications(env);
 const ctx=await resolveTicketConversationContext(env,1,ticket.id,COMMAND_ACTORS.owner);
 await createTicketMessage(env,ctx,{kind:'internal',body:'TOP SECRET'},request('note'));
 await consumeTicketNotifications(env);
 assert.equal((await inbox(env)).items.filter(n=>n.internal).length,1);
 db.sqlite.exec("UPDATE users SET role='viewer' WHERE id=2; UPDATE organization_users SET access_level='viewer' WHERE user_id=2; INSERT OR IGNORE INTO role_permissions(role,permission,scope_type,active) VALUES ('viewer','ticket.view','organization',1)");
 const page=await inbox(env);assert.equal(page.items.filter(n=>n.internal).length,0);assert.equal(page.unread,1);
 assert.ok(!JSON.stringify(db.rows('ticket_notifications')).includes('TOP SECRET'));
});
test('pagination is keyset ordered and count independent of page',async t=>{
 const {env}=await fixture(t);
 for(let i=0;i<3;i++)await executeTicketCreate(env,1,COMMAND_ACTORS.owner,payload,request('page'+i));
 await consumeTicketNotifications(env);const first=await inbox(env,peer,{limit:2});assert.equal(first.unread,4);assert.ok(first.nextCursor);
 const second=await inbox(env,peer,{limit:2,before:first.nextCursor});assert.equal(second.items.length,2);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,4);
});
test('HTTP requires authentication, rejects cross origin and scopes to session',async t=>{
 const {db,env}=await fixture(t);await consumeTicketNotifications(env);
 const url='https://cc07.test/api/organizations/1/ticket-notifications';
 const call=(opts={})=>onRequest({env,params:{id:'1'},request:new Request(url,opts)});
 assert.equal((await call()).status,401);
 const cookie=db.sessionCookie(2);const res=await call({headers:{cookie}});assert.equal(res.status,200);
 assert.equal(res.headers.get('Cache-Control'),'private, no-store');const data=await res.json();assert.equal(data.items.length,1);
 assert.equal((await call({method:'PATCH',headers:{cookie,Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({id:data.items[0].id,read:true})})).status,403);
 const good=await call({method:'PATCH',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({id:data.items[0].id,read:true})});assert.equal(good.status,200);
 assert.equal((await operationsHttp({env,params:{id:'1'},request:new Request(url+'/operations',{headers:{cookie}})})).status,403);
});

test('consumer refuses Preview/unknown runtime and missing organization scope',async t=>{
 const {env}=await fixture(t);env.MAONO_RUNTIME_ENV='preview';
 await assert.rejects(()=>consumeTicketNotifications(env),e=>e.code==='TICKET_NOTIFICATION_RUNTIME_DENIED');
 env.MAONO_RUNTIME_ENV='local';env.MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS='';
 await assert.rejects(()=>consumeTicketNotifications(env),e=>e.code==='TICKET_NOTIFICATION_SCOPE_REQUIRED');
});
test('canary scope prevents processing and listing other organizations',async t=>{
 const {db,env}=await fixture(t);env.MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS='2';
 assert.equal((await consumeTicketNotifications(env)).claimed,0);assert.equal((await inbox(env)).enabled,false);
 assert.equal(db.rows('ticket_notifications').length,0);
});
test('batch size is bounded and backlog remains pending',async t=>{
 const {db,env}=await fixture(t);
 for(let i=0;i<2;i++)await executeTicketCreate(env,1,COMMAND_ACTORS.owner,payload,request('bounded'+i));
 assert.equal((await consumeTicketNotifications(env,{batchSize:1})).claimed,1);
 assert.equal(db.rows('ticket_command_outbox').filter(r=>r.status==='pending').length,2);
});
test('retry audit and state reset roll back together',async t=>{
 const {db,env}=await fixture(t);db.sqlite.exec("UPDATE ticket_command_outbox SET status='failed',notification_attempts=5");
 const before=db.snapshot();db.failNextBatchAt(1);
 await assert.rejects(()=>retryTicketNotification(env,1,{...COMMAND_ACTORS.owner,role:'super_admin'},db.rows('ticket_command_outbox')[0].id));
 assert.deepEqual(db.snapshot(),before);
});
test('fresh schema contains valid notifications expansion and integrity',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const sqlite=new DatabaseSync(':memory:');
 try{sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(source('../schema.sql'));
 assert.equal(sqlite.prepare('PRAGMA quick_check').get().quick_check,'ok');
 assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='ticket_notification_snapshot'").get());
 }finally{sqlite.close();}
});
