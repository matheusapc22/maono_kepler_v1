import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateCc07Plan,assertCc07Actor} from '../scripts/acceptance/cc07-plan.mjs';
import {validateCc07Worker,cc07Infrastructure} from '../scripts/acceptance/cc07-infrastructure.mjs';
import {assertCc07Inventory,runCc07Operator} from '../scripts/acceptance/cc07-operator.mjs';
import {manifest,run} from '../scripts/acceptance/suites/cc07-notifications.mjs';
import {safeFlags,suiteContext,PRODUCTION_D1_ID} from '../scripts/acceptance/production-acceptance-lib.mjs';
import {createTicketCommandDb} from './helpers/ticket-command-db.mjs';
import {consumeTicketNotifications} from '../functions/_lib/ticket-notifications.js';
import {onRequest as middleware} from '../functions/_middleware.js';
import {onRequestPost as create} from '../functions/api/organizations/[id]/tickets.js';
import {onRequestGet as detail,onRequestPatch as update} from '../functions/api/organizations/[id]/tickets/[ticketId].js';
import {onRequest as access} from '../functions/api/organizations/[id]/tickets/[ticketId]/access.js';
import {onRequest as state} from '../functions/api/organizations/[id]/tickets/[ticketId]/state.js';
import {onRequest as transition} from '../functions/api/organizations/[id]/tickets/[ticketId]/transitions.js';
import {onRequest as notifications} from '../functions/api/organizations/[id]/ticket-notifications.js';
const sha='a'.repeat(40),now=Date.parse('2026-10-24T18:00:00.000Z');
const plan=()=>({version:1,productSha:sha,organizationId:1,qaIds:{manager:1,allowed:2,restricted:3},
 worker:{offVersion:'11111111-1111-4111-8111-111111111111',onVersion:'22222222-2222-4222-8222-222222222222',codeEtag:'b'.repeat(64),cron:'* * * * *'},
 policy:{runId:'33333333-3333-4333-8333-333333333333',organizationId:1,managerId:1,startAt:'2026-10-24T18:00:00.000Z',endAt:'2026-10-24T21:30:00.000Z',maxEvents:3,maxAttempts:15,batchSize:3},
 approval:{actor:'synthetic-owner',confirmedAt:'2026-10-24T17:50:00.000Z',writersPaused:true,syntheticOnly:true,workerVersionsReviewed:true,costAndVolumeApproved:true,humanRecoveryAvailable:true},
 qa9:{outboxCount:13,digest:'c'.repeat(64)},limits:{deliveryWaitSeconds:60,quiescenceSeconds:125}});
const opts={expectedCommit:sha,organizationId:1,qaUserIds:{manager:1,allowed:2,restricted:3},projectSlug:null};
const version=(p,on)=>({id:on?p.worker.onVersion:p.worker.offVersion,resources:{script:{etag:p.worker.codeEtag,handlers:['scheduled']},script_runtime:{compatibility_date:'2026-10-01'},bindings:[
 {name:'DB',type:'d1',id:PRODUCTION_D1_ID},...Object.entries({MAONO_RUNTIME_ENV:'production',MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:'true',MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:String(on),MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:String(p.organizationId),MAONO_TICKET_NOTIFICATION_START_AT:p.policy.startAt,MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON:JSON.stringify(p.policy)}).map(([name,text])=>({name,type:'plain_text',text}))]}});
const snapshot=p=>({off:version(p,false),on:version(p,true),deployments:{deployments:[{id:'deployment',versions:[{version_id:p.worker.offVersion,percentage:100}]}]},schedules:{schedules:[]}});
const inventory=p=>({startedAt:new Date(now).toISOString(),completedAt:new Date(now).toISOString(),qa9Digest:p.qa9.digest,outsideDigest:'d'.repeat(64),organizationIds:[1,9],scoped:{outbox:[],candidates:[],notices:[],tickets:[]}});

test('CC07 plan requires exact approved scope, independent limits and unchanged safe COMMANDS',()=>{
 assert.deepEqual(validateCc07Plan(JSON.stringify(plan()),opts,{now,admit:true}),plan());
 assert.equal(safeFlags(manifest).MAONO_TICKET_COMMANDS_ENABLED,true);assert.equal(safeFlags(manifest).MAONO_TICKET_SELECTIVE_ACCESS_ENABLED,true);assert.equal(safeFlags(manifest).MAONO_TICKET_NOTIFICATIONS_ENABLED,false);
});
for(const [label,change]of Object.entries({qa9:p=>{p.organizationId=9;},identity:p=>{p.qaIds.allowed=1;},cutoff:p=>{p.policy.startAt='today';},late:p=>{p.policy.endAt='2026-10-24T19:00:00.000Z';},limit:p=>{p.policy.maxAttempts=999;},cost:p=>{p.approval.costAndVolumeApproved=false;},extra:p=>{p.sql='DELETE';},cron:p=>{p.worker.cron='*/5 * * * *';},versions:p=>{p.worker.onVersion=p.worker.offVersion;},digest:p=>{p.qa9.digest='unknown';}}))test(`CC07 rejects ${label} without remote access`,()=>{const p=plan();change(p);assert.throws(()=>validateCc07Plan(JSON.stringify(p),opts,{now,admit:true}));});
test('CC07 dispatcher refuses reruns, non-owner, alternate ref and approval mismatch',()=>{
 const env={GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'synthetic-owner',GITHUB_REPOSITORY_OWNER:'synthetic-owner',GITHUB_REF:'refs/heads/main'};
 assert.doesNotThrow(()=>assertCc07Actor(plan(),env));for(const [k,v]of [['GITHUB_RUN_ATTEMPT','2'],['GITHUB_ACTOR','other'],['GITHUB_REF','refs/heads/feature']])assert.throws(()=>assertCc07Actor(plan(),{...env,[k]:v}));
});
for(const [label,change]of Object.entries({code:s=>{s.on.resources.script.etag='e'.repeat(64);},handler:s=>{s.on.resources.script.handlers.push('fetch');},binding:s=>{s.on.resources.bindings.push({name:'EXTERNAL',type:'service'});},database:s=>{s.on.resources.bindings[0].id='foreign';},scope:s=>{s.on.resources.bindings.find(x=>x.name==='MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS').text='9';},runtime:s=>{s.on.resources.script_runtime.compatibility_date='2026-09-01';},deployment:s=>{s.deployments.deployments[0].versions[0].percentage=50;},cron:s=>{s.schedules.schedules.push({cron:'* * * * *'});}}))test(`CC07 Worker preflight rejects ${label} drift`,()=>{const p=plan(),s=snapshot(p);assert.doesNotThrow(()=>validateCc07Worker(s,p));change(s);assert.throws(()=>validateCc07Worker(s,p));});
test('CC07 structural evidence rejects expired snapshots, foreign activity and unapproved recipients',()=>{
 const p=plan(),a=inventory(p);assert.doesNotThrow(()=>assertCc07Inventory(a,p,{now,empty:true}));
 assert.throws(()=>assertCc07Inventory(a,p,{now:now+600001,empty:true}));
 assert.throws(()=>assertCc07Inventory({...a,outsideDigest:'changed'},p,{now,before:a}));
 const modified=structuredClone(a);modified.scoped.tickets=[{id:1,created_by:1}];modified.scoped.candidates=[{outbox_id:'unknown',recipient_id:3}];assert.throws(()=>assertCc07Inventory(modified,p,{now,ticketId:1}));
});
test('CC07 Worker control uses fixed API paths and never retries uncertain deployment',async()=>{
 const p=plan(),s=snapshot(p),calls=[];
 const fetchImpl=async(url,options)=>{const path=new URL(url).pathname;calls.push([path,options.method]);assert.ok(path.startsWith('/client/v4/accounts/'));if(options.method!=='GET')throw new Error('uncertain transport');const result=path.endsWith('/deployments')?s.deployments:path.endsWith('/schedules')?s.schedules:path.endsWith(p.worker.offVersion)?s.off:s.on;return Response.json({success:true,result});};
 const api=cc07Infrastructure('local-fixture','local-read-fixture',p,{fetchImpl});await assert.rejects(()=>api.setActive(true));assert.equal(calls.filter(x=>x[1]==='POST').length,1);assert.equal(calls.filter(x=>x[1]==='PUT').length,0);
});
test('CC07 preflight uses read-only infrastructure and never accesses QA credentials',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cc07-preflight-'));t.after(()=>rm(dir,{recursive:true,force:true}));const p=plan();
 const vars=Object.fromEntries(Object.entries({...safeFlags(manifest),MAONO_RUNTIME_ENV:'production',MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:'1',MAONO_TICKET_NOTIFICATION_START_AT:p.policy.startAt}).map(([k,v])=>[k,{type:'plain_text',value:String(v)}]));
 const deployment={id:'deployed',environment:'production',url:'https://maono-kepler-v1.pages.dev',deployment_trigger:{metadata:{commit_hash:sha,commit_dirty:false}},latest_stage:{name:'deploy',status:'success'},env_vars:vars};
 const calls=[];const fetchImpl=async(url,o)=>{calls.push(o.method);assert.equal(o.method,'GET');return Response.json({success:true,result:String(url).includes('/deployments?')?[deployment]:{name:'maono-kepler-v1',production_branch:'mano_kepler_v1',subdomain:'maono-kepler-v1.pages.dev',deployment_configs:{production:{d1_databases:{DB:{id:PRODUCTION_D1_ID}},env_vars:vars}},canonical_deployment:deployment}});};
 const env={MAONO_ACCEPTANCE_CC07_PLAN_JSON:JSON.stringify(p),MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:'local-fixture',GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'synthetic-owner',GITHUB_REPOSITORY_OWNER:'synthetic-owner',GITHUB_REF:'refs/heads/main'};
 Object.defineProperty(env,'MAONO_ACCEPTANCE_CC07_QA_CREDENTIALS_JSON',{get(){throw Error('must not read QA secret');}});
 const report=join(dir,'report.json');assert.equal(await runCc07Operator({...opts,mode:'preflight',report},env,{now:()=>now,fetchImpl,infrastructure:{readWorker:async()=>snapshot(p),audit:async()=>inventory(p),setActive:async()=>assert.fail('preflight mutation')}}),0);
 const result=JSON.parse(await readFile(report));assert.equal(result.writesPerformed,false);assert.equal(result.acceptanceExecuted,false);assert.equal(result.complete,true);assert.ok(calls.length>0);
});

async function localFixture(t,{lostCreate=false}={}){
 const db=await createTicketCommandDb(t);for(const file of ['0027_ticket_selective_access.sql','0028_ticket_conversations.sql','0030_ticket_notifications.sql','0041_ticket_notification_recipient_state.sql'])db.sqlite.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 db.sqlite.exec("UPDATE users SET role='editor' WHERE id=2; UPDATE organization_users SET access_level='editor' WHERE user_id=2; INSERT INTO user_permissions(user_id,permission,organization_id,active) VALUES(2,'ticket.view',1,1),(3,'ticket.view',1,1)");
 const p=plan(),start=Date.now()-10000;p.policy.startAt=new Date(start).toISOString();p.policy.endAt=new Date(start+210*60000).toISOString();
 Object.assign(db.env,{MAONO_RUNTIME_ENV:'production',MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:'true',MAONO_TICKET_NOTIFICATIONS_ENABLED:'true',MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:'false',MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:'1',MAONO_TICKET_NOTIFICATION_START_AT:p.policy.startAt,MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON:JSON.stringify(p.policy)});
 const profiles=Object.fromEntries(Object.entries(p.qaIds).map(([name,id])=>[name,{cookie:db.sessionCookie(id,1),organization:{id:1},user:{id,role:name==='manager'?'owner':name==='allowed'?'editor':'viewer',permissions:manifest.requiredPermissions[name]}}]));
 const calls=[],journals=[];
 const fetchImpl=async(url,options)=>{
  const pathname=new URL(url).pathname,method=options.method;calls.push([pathname,method]);assert.notEqual(method,'DELETE');
  const match=pathname.match(/^\/api\/organizations\/1\/(?:tickets(?:\/(\d+)(.*))?|ticket-notifications)$/);assert.ok(match,pathname);
  const suffix=match[2]||'';const handler=pathname.endsWith('ticket-notifications')?notifications:!match[1]?create:({'/access':access,'/state':state,'/transitions':transition})[suffix]||(method==='PATCH'?update:detail);
  const c={env:db.env,params:{id:'1',ticketId:match[1]},request:new Request(url,options)};
  const response=await middleware({...c,next:()=>handler(c)});if(lostCreate&&method==='POST'&&pathname.endsWith('/tickets'))throw Error('lost create');return response;
 };
 const ctx=suiteContext({baseUrl:'https://synthetic.test',organizationId:1,profiles,runId:p.policy.runId,deps:{fetchImpl,onResourceJournal:async j=>journals.push(j)}});
 const audit=async()=>({scoped:{outbox:db.rows('ticket_command_outbox'),candidates:db.rows('ticket_notification_candidates'),notices:db.rows('ticket_notifications')}});
 ctx.cc07={plan:p,audit,startConsumer:async()=>{db.env.MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED='true';await consumeTicketNotifications(db.env);},stopConsumer:async()=>{db.env.MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED='false';},poll:async read=>{const result=await read();assert.ok(result,'local delivery completed');return result;}};
 return {db,ctx,calls,journals,fetchImpl,plan:p,profiles};
}
test('CC07 complete suite exercises real HTTP/SQLite, recipient actions and preserved private cleanup',async t=>{
 const f=await localFixture(t);let result;try{result=await run(f.ctx);}finally{assert.deepEqual(await f.ctx.cleanup(),[]);}
 const ticket=f.db.row(result.syntheticTicketId);assert.equal(ticket.status,'closed');assert.equal(ticket.visibility,'private');assert.equal(f.db.rows('organization_tickets').length,1);
 assert.equal(f.db.rows('ticket_notifications').length,1);assert.equal(f.db.rows('ticket_command_outbox').length,3);assert.equal(f.db.rows('ticket_command_outbox').at(-1).status,'pending');assert.equal(f.db.env.MAONO_TICKET_COMMANDS_ENABLED,'true');
 assert.deepEqual(f.ctx.cases.map(x=>x.id).sort(),[...manifest.cases].sort());assert.ok(f.ctx.cases.every(x=>x.status==='PASS'));
});
test('CC07 uncertain create never retries, adopts another ticket or claims cleanup',async t=>{
 const f=await localFixture(t,{lostCreate:true});await assert.rejects(()=>run(f.ctx));assert.equal((await f.ctx.cleanup()).length,1);assert.equal(f.db.rows('organization_tickets').length,1);assert.equal(f.calls.filter(x=>x[1]==='POST').length,1);assert.equal(f.journals.at(-1).unknownCreation,true);assert.equal(f.db.env.MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED,'false');
});

// Exercise the complete orchestrator against local HTTP/SQLite and a stateful
// Pages/Worker simulator. These credentials are fixture strings, never remote.
async function operatorFixture(t,{fault=null,mode='run'}={}){
 const f=await localFixture(t),p=f.plan,dir=await mkdtemp(join(tmpdir(),'cc07-operator-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));let clock=Date.now(),active=false,activated=false,patchLost=false,deployments=0;
 let vars=Object.fromEntries(Object.entries({...safeFlags(manifest),MAONO_RUNTIME_ENV:'production',MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:'1',MAONO_TICKET_NOTIFICATION_START_AT:p.policy.startAt}).map(([k,v])=>[k,{type:'plain_text',value:String(v)}]));
 const deployment=()=>({id:`deployment-${deployments}`,environment:'production',url:'https://maono-kepler-v1.pages.dev',deployment_trigger:{metadata:{commit_hash:sha,commit_dirty:false}},latest_stage:{name:'deploy',status:'success'},env_vars:structuredClone(vars)});
 let canonical=deployment();const controls=[];
 const fetchImpl=async(url,o)=>{
  const path=new URL(url).pathname;
  if(path.startsWith('/client/v4/')){
   controls.push([o.method,path]);let result;
   if(o.method==='PATCH'){Object.assign(vars,JSON.parse(o.body).deployment_configs.production.env_vars);if(fault==='pages-lost'&&!patchLost){patchLost=true;throw Error('lost Pages response');}result={};}
   else if(o.method==='POST'){assert.ok(path.endsWith('/retry'));deployments++;canonical=deployment();Object.assign(f.db.env,Object.fromEntries(Object.entries(vars).map(([k,v])=>[k,v.value])));result=canonical;}
   else if(path.endsWith('/deployments'))result=[canonical];
   else if(path.includes('/deployments/'))result=canonical;
   else result={name:'maono-kepler-v1',production_branch:'mano_kepler_v1',subdomain:'maono-kepler-v1.pages.dev',deployment_configs:{production:{d1_databases:{DB:{id:PRODUCTION_D1_ID}},env_vars:vars}},canonical_deployment:canonical};
   return Response.json({success:true,result});
  }
  if(path==='/api/auth/login'){
   const name=JSON.parse(o.body).email.split('@')[0];assert.ok(f.profiles[name]);
   return Response.json({ok:true},{headers:{'set-cookie':f.profiles[name].cookie+'; Path=/; HttpOnly'}});
  }
  if(path==='/api/session'){
   const profile=Object.values(f.profiles).find(x=>x.cookie===o.headers.Cookie);assert.ok(profile);
   return Response.json({authenticated:true,user:profile.user,activeOrganization:profile.organization,permissions:profile.user.permissions});
  }
  return f.fetchImpl(url,o);
 };
 const infrastructure={
  readWorker:async()=>{const s=snapshot(p);if(active){s.deployments.deployments[0].versions[0].version_id=p.worker.onVersion;s.schedules.schedules=[{cron:p.worker.cron}];}return s;},
  setActive:async value=>{
   controls.push(['worker',value]);if(!value&&fault==='stop'&&activated)throw Error('Worker stop unavailable');
   active=value;f.db.env.MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED=String(value);
   if(value){activated=true;if(fault==='worker-lost')throw Error('lost Worker response');await consumeTicketNotifications(f.db.env);}
  },
  audit:async()=>{
   if(fault==='audit-unavailable')throw Error('read-only audit unavailable');
   const a=inventory(p);a.startedAt=a.completedAt=new Date(clock).toISOString();
   a.scoped={outbox:f.db.rows('ticket_command_outbox'),candidates:f.db.rows('ticket_notification_candidates'),notices:f.db.rows('ticket_notifications'),tickets:f.db.rows('organization_tickets')};
   if(fault==='foreign-after-create'&&a.scoped.tickets.length)a.outsideDigest='foreign';return a;
  }
 };
 if(mode==='closure'){active=true;activated=true;vars.MAONO_TICKET_NOTIFICATIONS_ENABLED.value='true';canonical=deployment();}
 const env={MAONO_ACCEPTANCE_CC07_PLAN_JSON:JSON.stringify(p),MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:'local-fixture',MAONO_ACCEPTANCE_CC07_QA_CREDENTIALS_JSON:JSON.stringify(Object.fromEntries(manifest.requiredProfiles.map(name=>[name,{email:`${name}@synthetic.invalid`,password:'local-fixture-only'}]))),GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'synthetic-owner',GITHUB_REPOSITORY_OWNER:'synthetic-owner',GITHUB_REF:'refs/heads/main'};
 const reportPath=join(dir,'report.json');
 const exit=await runCc07Operator({...opts,mode,report:reportPath},env,{fetchImpl,infrastructure,now:()=>clock,sleep:async ms=>{clock+=ms;}});
 return {...f,exit,result:JSON.parse(await readFile(reportPath)),controls,active,vars,canonical};
}

test('CC07 orchestrator completes delivery and containment, retaining COMMANDS and records',async t=>{
 const f=await operatorFixture(t);assert.equal(f.exit,0,JSON.stringify(f.result));
 assert.equal(f.result.operationalTestsPassed,true);assert.equal(f.result.cleanupComplete,true);assert.equal(f.result.preservationVerified,true);assert.equal(f.result.configurationRestored,true);
 assert.equal(f.db.rows('organization_tickets')[0].status,'closed');assert.equal(f.db.rows('ticket_command_outbox').length,3);assert.equal(f.active,false);assert.equal(f.vars.MAONO_TICKET_COMMANDS_ENABLED.value,'true');assert.equal(f.vars.MAONO_TICKET_NOTIFICATIONS_ENABLED.value,'false');
});
for(const fault of ['pages-lost','worker-lost','foreign-after-create'])test(`CC07 contains ${fault} without retrying the acceptance or hiding audit failure`,async t=>{
 const f=await operatorFixture(t,{fault});assert.equal(f.exit,1);assert.equal(f.result.complete,false);assert.equal(f.result.configurationRestored,true,JSON.stringify(f.result));assert.equal(f.active,false);
 assert.equal(f.vars.MAONO_TICKET_COMMANDS_ENABLED.value,'true');assert.equal(f.vars.MAONO_TICKET_NOTIFICATIONS_ENABLED.value,'false');
 const tickets=f.db.rows('organization_tickets');assert.equal(tickets.length,fault==='pages-lost'?0:1);if(tickets.length){assert.equal(tickets[0].status,'closed');assert.equal(tickets[0].visibility,'private');}
 assert.equal(f.controls.filter(x=>x[0]==='worker'&&x[1]===true).length,fault==='worker-lost'?1:0);
 if(fault==='foreign-after-create'){assert.equal(f.result.preservationVerified,false);assert.equal(f.result.preservationError.code,'CC07_FOREIGN_ACTIVITY');}
});
test('CC07 uncertain shutdown reports unresolved infrastructure and never claims resource cleanup',async t=>{
 const f=await operatorFixture(t,{fault:'stop'});assert.equal(f.exit,1);assert.equal(f.result.configurationRestored,false);assert.equal(f.result.cleanupComplete,false);assert.equal(f.result.complete,false);assert.equal(f.db.rows('organization_tickets').length,1);assert.notEqual(f.db.rows('organization_tickets')[0].status,'closed');assert.equal(f.vars.MAONO_TICKET_NOTIFICATIONS_ENABLED.value,'false');assert.equal(f.vars.MAONO_TICKET_COMMANDS_ENABLED.value,'true');
});
test('CC07 closure stops reviewed infrastructure even when data audit is unavailable; resource closure remains pending',async t=>{
 const f=await operatorFixture(t,{mode:'closure',fault:'audit-unavailable'});assert.equal(f.exit,1);assert.equal(f.active,false);assert.equal(f.result.configurationRestored,true,JSON.stringify(f.result));assert.equal(f.result.cleanupComplete,false);assert.equal(f.result.preservationVerified,false);assert.equal(f.db.rows('organization_tickets').length,0);assert.equal(f.calls.length,0);assert.deepEqual(f.result.pendingGates,['EXACT_RESOURCE_JOURNAL_AND_HUMAN_RECOVERY']);
});
