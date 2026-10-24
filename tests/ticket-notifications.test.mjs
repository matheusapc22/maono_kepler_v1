import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTicketCommandDb,COMMAND_ACTORS} from './helpers/ticket-command-db.mjs';
import {executeTicketCreate} from '../functions/_lib/ticket-commands.js';
import {createTicketMessage,resolveTicketConversationContext} from '../functions/_lib/ticket-conversations.js';
import {consumeTicketNotifications,listTicketNotifications,markTicketNotification,changeTicketNotification,notificationReady,
 notificationOperations,retryTicketNotification} from '../functions/_lib/ticket-notifications.js';
import {onRequest} from '../functions/api/organizations/[id]/ticket-notifications.js';
import {onRequest as operationsHttp} from '../functions/api/organizations/[id]/ticket-notifications/operations.js';
const source=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const payload={subject:'CC07 privado',description:'Teste local',category:'support',priority:'normal',assignedTo:2,
 demandNature:'question_request',expectedResult:'Notificação',context:'Teste',impact:'team',urgency:'soon',priorityReason:'',triageAnswers:{},triageFormVersion:1};
const request=key=>new Request('https://cc07.test/tickets',{method:'POST',headers:{'Idempotency-Key':key,'Content-Type':'application/json'}});
async function fixture(t,{schema=true,recipientState=false}={}) {
 const db=await createTicketCommandDb(t);
 db.sqlite.exec(source('../migrations/0027_ticket_selective_access.sql'));
 db.sqlite.exec(source('../migrations/0028_ticket_conversations.sql'));
 if(schema)db.sqlite.exec(source('../migrations/0030_ticket_notifications.sql'));
 if(recipientState)db.sqlite.exec(source('../migrations/0041_ticket_notification_recipient_state.sql'));
 Object.assign(db.env,{MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:'1,2',MAONO_RUNTIME_ENV:'local',MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:'true',MAONO_TICKET_CONVERSATIONS_ENABLED:'true',
 MAONO_TICKET_NOTIFICATIONS_ENABLED:'true',MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:'true',MAONO_TICKET_NOTIFICATION_START_AT:'2026-01-01T00:00:00.000Z'});
 const {ticket}=await executeTicketCreate(db.env,1,COMMAND_ACTORS.owner,payload,request('create'));
 return {db,ticket,env:db.env};
}
const peer=COMMAND_ACTORS.peer;
async function inbox(env,user=peer,opts={}) {return listTicketNotifications(env,1,user,opts);}

test('recipient state migration preserves history and supports audited reversible deletion',async t=>{
 const {db,env}=await fixture(t,{recipientState:true});
 await consumeTicketNotifications(env);
 const ledger=JSON.stringify({events:db.rows('ticket_events'),outbox:db.rows('ticket_command_outbox'),candidates:db.rows('ticket_notification_candidates')});
 let page=await inbox(env); const id=page.items[0].id;
 assert.equal(page.recipientState,true);assert.equal(page.unread,1);
 const before=db.snapshot();await inbox(env);assert.deepEqual(db.snapshot(),before,'opening the board is read-only');
 await changeTicketNotification(env,1,peer,id,'read',1);
 page=await inbox(env);assert.equal(page.unread,0);assert.equal(page.items[0].version,2);
 await changeTicketNotification(env,1,peer,id,'dismiss',2);
 assert.equal((await inbox(env)).items.length,0);
 const deleted=await inbox(env,peer,{folder:'deleted'});assert.equal(deleted.items[0].version,3);
 assert.equal(deleted.unread,0);assert.ok(deleted.items[0].readAt);
 const snap=db.snapshot();
 assert.equal((await changeTicketNotification(env,1,peer,id,'dismiss',2)).replayed,true);
 assert.deepEqual(db.snapshot(),snap,'lost response retry must not duplicate audit or timestamp');
 await changeTicketNotification(env,1,peer,id,'restore',3);
 page=await inbox(env);assert.equal(page.items.length,1);assert.equal(page.items[0].version,4);assert.equal(page.unread,0);
 assert.equal(JSON.stringify({events:db.rows('ticket_events'),outbox:db.rows('ticket_command_outbox'),candidates:db.rows('ticket_notification_candidates')}),ledger);
 assert.deepEqual(db.rows('audit_logs').filter(r=>r.action.startsWith('ticket.notification.')).map(r=>r.action),['ticket.notification.read','ticket.notification.dismiss','ticket.notification.restore']);
});

test('recipient updates reject stale intent and rollback atomically without erasing other recipients',async t=>{
 const {db,env}=await fixture(t,{recipientState:true});await consumeTicketNotifications(env);
 const id=(await inbox(env)).items[0].id;
 await assert.rejects(()=>changeTicketNotification(env,1,COMMAND_ACTORS.owner,id,'dismiss',1),e=>e.code==='TICKET_NOTIFICATION_NOT_FOUND');
 await assert.rejects(()=>changeTicketNotification(env,2,peer,id,'dismiss',1),e=>e.status===403);
 await changeTicketNotification(env,1,peer,id,'read',1);
 await assert.rejects(()=>changeTicketNotification(env,1,peer,id,'dismiss',1),e=>e.code==='TICKET_NOTIFICATION_CONFLICT');
 const before=db.snapshot();db.failNextBatchAt(1);
 await assert.rejects(()=>changeTicketNotification(env,1,peer,id,'dismiss',2));assert.deepEqual(db.snapshot(),before);
 await changeTicketNotification(env,1,peer,id,'dismiss',2);
 await assert.rejects(()=>markTicketNotification(env,1,peer,id,true),e=>e.code==='TICKET_NOTIFICATION_NOT_FOUND');
 db.sqlite.exec('DELETE FROM organization_users WHERE organization_id=1 AND user_id=2');
 await assert.rejects(()=>inbox(env,peer,{folder:'deleted'}),e=>e.code==='TICKET_NOTIFICATION_FORBIDDEN');
 await assert.rejects(()=>changeTicketNotification(env,1,peer,id,'restore',3),e=>e.code==='TICKET_NOTIFICATION_FORBIDDEN');
 assert.ok(db.rows('ticket_notifications')[0].dismissed_at);
});

test('old schema remains readable but reversible actions fail closed until migration',async t=>{
 const {env}=await fixture(t);await consumeTicketNotifications(env);const page=await inbox(env);
 assert.equal(page.recipientState,false);
 await assert.rejects(()=>changeTicketNotification(env,1,peer,page.items[0].id,'dismiss',1),e=>e.code==='TICKET_NOTIFICATION_RECIPIENT_SCHEMA_REQUIRED');
 await assert.rejects(()=>inbox(env,peer,{folder:'deleted'}),e=>e.code==='TICKET_NOTIFICATION_RECIPIENT_SCHEMA_REQUIRED');
});

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

test('consumer shutdown preserves pending events while commands and inbox remain enabled',async t=>{
 const {db,env}=await fixture(t);
 env.MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED='false';
 const before=db.snapshot();
 assert.deepEqual(await consumeTicketNotifications(env),{enabled:false,claimed:0});
 assert.deepEqual(db.snapshot(),before);
 assert.equal((await inbox(env)).enabled,true);
 assert.equal(String(env.MAONO_TICKET_COMMANDS_ENABLED),'true');
 assert.equal(env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED,'true');
});

test('inbox shutdown does not stop the independently enabled consumer',async t=>{
 const {db,env}=await fixture(t);
 env.MAONO_TICKET_NOTIFICATIONS_ENABLED='false';
 assert.equal((await consumeTicketNotifications(env)).delivered,1);
 const before=db.snapshot();
 assert.equal((await inbox(env)).enabled,false);
 assert.deepEqual(db.snapshot(),before);
 assert.equal(db.rows('ticket_notifications').length,1);
 env.MAONO_TICKET_NOTIFICATIONS_ENABLED='true';
 assert.equal((await inbox(env)).unread,1);
});

test('command notifications work without enabling conversations',async t=>{
 const {env}=await fixture(t);
 env.MAONO_TICKET_CONVERSATIONS_ENABLED='false';
 await executeTicketCreate(env,1,COMMAND_ACTORS.owner,payload,request('commands-only'));
 assert.equal((await consumeTicketNotifications(env)).delivered,2);
 assert.equal((await inbox(env)).unread,2);
 assert.equal(String(env.MAONO_TICKET_COMMANDS_ENABLED),'true');
});

test('excluded organization preserves all candidate, pending and exhausted lease rows',async t=>{
 const {db,env}=await fixture(t);
 // Keep each synthetic creator below the real command rate limit.
 for(let i=0;i<12;i++)await executeTicketCreate(env,1,i<8?COMMAND_ACTORS.owner:peer,
  {...payload,assignedTo:i<8?2:1},request('excluded-'+i));
 db.sqlite.exec("UPDATE ticket_command_outbox SET status='processing',notification_attempts=5,notification_token='expired-local-worker',notification_lease_until='2026-01-01T00:00:00.000Z' WHERE id IN (SELECT id FROM ticket_command_outbox ORDER BY id LIMIT 4)");
 assert.equal(db.rows('ticket_command_outbox').length,13);
 assert.equal(db.rows('ticket_notification_candidates').length,13);
 env.MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS='2';
 const before=db.snapshot();
 assert.equal((await consumeTicketNotifications(env,{batchSize:25})).claimed,0);
 assert.deepEqual(db.snapshot(),before);
 assert.equal((await inbox(env)).enabled,false);
 assert.deepEqual(db.snapshot(),before);
});

test('cutoff preserves excluded historical pending and exhausted lease rows',async t=>{
 const {db,env}=await fixture(t);
 await executeTicketCreate(env,1,COMMAND_ACTORS.owner,payload,request('old-exhausted'));
 db.sqlite.exec("UPDATE ticket_command_outbox SET status='processing',notification_attempts=5,notification_token='expired-local-worker',notification_lease_until='2026-01-01T00:00:00.000Z' WHERE id IN (SELECT id FROM ticket_command_outbox ORDER BY id LIMIT 1)");
 env.MAONO_TICKET_NOTIFICATION_START_AT='2099-01-01T00:00:00.000Z';
 const before=db.snapshot();
 assert.equal((await consumeTicketNotifications(env)).claimed,0);
 assert.deepEqual(db.snapshot(),before);
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
 const {db,env}=await fixture(t);const base=Date.now();let clock=base;
 // Advance at the real delivery boundary, not after an implementation-specific
 // number of clock reads (policy validation also reads the clock).
 const originalPrepare=db.env.DB.prepare.bind(db.env.DB);
 db.env.DB.prepare=(sql)=>{if(sql.includes('SELECT e.audience,e.event_type'))clock=base+121000;return originalPrepare(sql);};
 await consumeTicketNotifications(env,{now:()=>clock});
 assert.equal(db.rows('ticket_notifications').length,0);
});

test('production always rejects QA9 scope even when a configuration includes it',async t=>{
 const {db,env}=await fixture(t);env.MAONO_RUNTIME_ENV='production';env.MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS='1,9';
 const before=db.snapshot();await assert.rejects(()=>consumeTicketNotifications(env),e=>e.code==='TICKET_NOTIFICATION_QA_EXCLUDED');assert.deepEqual(db.snapshot(),before);
});

test('bounded Worker policy excludes foreign activity and honors time/attempt limits',async t=>{
 const {db,env,ticket}=await fixture(t);const runId='11111111-1111-4111-8111-111111111111';const start='2026-01-01T00:00:00.000Z',end='2026-01-01T03:30:00.000Z';
 const policy={runId,organizationId:1,managerId:1,startAt:start,endAt:end,maxEvents:2,maxAttempts:1,batchSize:1};
 env.MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS='1';env.MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON=JSON.stringify(policy);
 let before=db.snapshot();assert.equal((await consumeTicketNotifications(env,{now:()=>Date.parse(end)})).windowClosed,true);assert.deepEqual(db.snapshot(),before);
 await assert.rejects(()=>consumeTicketNotifications(env,{now:()=>Date.parse(start)+1000}),e=>e.code==='TICKET_NOTIFICATION_ACCEPTANCE_DRIFT');assert.deepEqual(db.snapshot(),before);
 db.sqlite.prepare('UPDATE organization_tickets SET subject=?,created_at=? WHERE id=?').run('QA-CC07-'+runId,start,ticket.id);
 assert.equal((await consumeTicketNotifications(env,{now:()=>Date.parse(start)+1000})).delivered,1);
 db.sqlite.exec("UPDATE ticket_command_outbox SET status='pending',notification_next_at=NULL");before=db.snapshot();
 assert.equal((await consumeTicketNotifications(env,{now:()=>Date.parse(start)+2000})).claimed,0);assert.deepEqual(db.snapshot(),before);
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
 const report=await consumeTicketNotifications(env);
 assert.equal(db.rows('ticket_command_outbox')[0].status,'failed');
 assert.equal(report.failed,1,'the scheduled batch must report exhausted attempts');
 assert.equal(report.claimed,0,'an exhausted attempt is not claimed again');
 assert.equal((await consumeTicketNotifications(env)).failed,0,'a later batch must not count the same terminal row again');
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

test('0041 upgrades existing recipient rows without changing delivery history; raw reapply is rejected',async t=>{
 const {db,env}=await fixture(t);await consumeTicketNotifications(env);
 const previous=db.rows('ticket_notifications'),outbox=db.rows('ticket_command_outbox'),events=db.rows('ticket_events');
 const sql=source('../migrations/0041_ticket_notification_recipient_state.sql');db.sqlite.exec(sql);
 const upgraded=db.rows('ticket_notifications');assert.equal(upgraded.length,previous.length);
 for(let i=0;i<upgraded.length;i++){const {dismissed_at,version,action_token,...old}=upgraded[i];assert.deepEqual(old,previous[i]);assert.equal(dismissed_at,null);assert.equal(version,1);assert.equal(action_token,null);}
 assert.deepEqual(db.rows('ticket_command_outbox'),outbox);assert.deepEqual(db.rows('ticket_events'),events);
 assert.throws(()=>db.sqlite.exec(sql),/duplicate column/i);assert.deepEqual(db.rows('ticket_notifications'),upgraded);
 assert.equal(db.sqlite.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
