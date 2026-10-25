import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cc07Infrastructure} from '../../scripts/acceptance/cc07-infrastructure.mjs';
import {runCc07Operator} from '../../scripts/acceptance/cc07-operator.mjs';
import {manifest,run} from '../../scripts/acceptance/suites/cc07-notifications.mjs';
import {parseArgs,safeFlags,suiteContext,PRODUCTION_D1_ID,fail} from '../../scripts/acceptance/production-acceptance-lib.mjs';
import {createTicketCommandDb} from './ticket-command-db.mjs';
import {consumeTicketNotifications} from '../../functions/_lib/ticket-notifications.js';
import notificationWorker from '../../workers/ticket-notifications.js';
import {summarizeCc07Worker} from '../../scripts/acceptance/cc07-observations.mjs';
import {preservedCc07Digest,preservedCc07Snapshot} from '../../scripts/acceptance/cc07-preserved.mjs';
import {onRequest as middleware} from '../../functions/_middleware.js';
import {onRequestPost as create} from '../../functions/api/organizations/[id]/tickets.js';
import {onRequestGet as detail,onRequestPatch as update} from '../../functions/api/organizations/[id]/tickets/[ticketId].js';
import {onRequest as access} from '../../functions/api/organizations/[id]/tickets/[ticketId]/access.js';
import {onRequest as state} from '../../functions/api/organizations/[id]/tickets/[ticketId]/state.js';
import {onRequest as transition} from '../../functions/api/organizations/[id]/tickets/[ticketId]/transitions.js';
import {onRequest as notifications} from '../../functions/api/organizations/[id]/ticket-notifications.js';
const sha='a'.repeat(40),now=Date.parse('2026-10-24T18:00:00.000Z');
const plan=()=>({version:2,preserved:null,readiness:{waitSeconds:60},productSha:sha,organizationId:1,qaIds:{manager:1,allowed:2,restricted:3},
 worker:{offVersion:'11111111-1111-4111-8111-111111111111',onVersion:'22222222-2222-4222-8222-222222222222',codeEtag:'b'.repeat(64),cron:'* * * * *'},
 policy:{runId:'33333333-3333-4333-8333-333333333333',organizationId:1,managerId:1,startAt:'2026-10-24T18:00:00.000Z',endAt:'2026-10-24T21:30:00.000Z',maxEvents:3,maxAttempts:15,batchSize:3},
 approval:{actor:'synthetic-owner',confirmedAt:'2026-10-24T17:50:00.000Z',writersPaused:true,syntheticOnly:true,workerVersionsReviewed:true,costAndVolumeApproved:true,humanRecoveryAvailable:true},
 qa9:{outboxCount:13,digest:'c'.repeat(64)},limits:{deliveryWaitSeconds:60,quiescenceSeconds:125}});
const cliOptions=(mode,report)=>parseArgs(['--mode',mode,'--suite','cc07-notifications','--organization-id','1','--qa-user-ids','1,2,3','--expected-commit',sha,'--report',report]);
const version=(p,on)=>({id:on?p.worker.onVersion:p.worker.offVersion,resources:{script:{etag:p.worker.codeEtag,handlers:['scheduled']},script_runtime:{compatibility_date:'2026-10-01'},bindings:[
 {name:'DB',type:'d1',id:PRODUCTION_D1_ID},{name:'CF_VERSION_METADATA',type:'version_metadata'},...Object.entries({MAONO_RUNTIME_ENV:'production',MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:'true',MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:String(on),MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:String(p.organizationId),MAONO_TICKET_NOTIFICATION_START_AT:p.policy.startAt,MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON:JSON.stringify(p.policy)}).map(([name,text])=>({name,type:'plain_text',text}))]}});
const snapshot=p=>({off:version(p,false),on:version(p,true),deployments:{deployments:[{id:'deployment',versions:[{version_id:p.worker.offVersion,percentage:100}]}]},schedules:{schedules:[]}});
const inventory=p=>({startedAt:new Date(now).toISOString(),completedAt:new Date(now).toISOString(),qa9Digest:p.qa9.digest,outsideDigest:'d'.repeat(64),organizationIds:[1,9],scoped:{outbox:[],candidates:[],notices:[],tickets:[]}});
async function localFixture(t,{lostCreate=false}={}){
 const db=await createTicketCommandDb(t);for(const file of ['0027_ticket_selective_access.sql','0028_ticket_conversations.sql','0030_ticket_notifications.sql','0041_ticket_notification_recipient_state.sql'])db.sqlite.exec(await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8'));
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
}// Exercise the complete orchestrator against local HTTP/SQLite and a stateful
// Pages/Worker simulator. These credentials are fixture strings, never remote.
async function operatorFixture(t,{fault=null,mode='run',cronDelayMs=0,waitSeconds=60,viaCli=false,preserve=false,setupOnly=false}={}){
 const f=await localFixture(t),p=f.plan,dir=await mkdtemp(join(tmpdir(),'cc07-operator-'));
 let preservedBefore=null;
 if(preserve){
  f.ctx.cc07.startConsumer=async()=>{throw Error('synthetic prior interruption');};
  await assert.rejects(()=>run(f.ctx));assert.deepEqual(await f.ctx.cleanup(),[]);
  const old=f.db.rows('organization_tickets')[0];
  p.preserved={ticketId:old.id,runId:p.policy.runId,managerId:1,recipientId:2,version:old.version,cycleNumber:old.current_cycle_number,outboxIds:f.db.rows('ticket_command_outbox').map(x=>x.id),eventIds:f.db.rows('ticket_events').map(x=>x.id),digest:'0'.repeat(64)};
  p.policy.runId='77777777-7777-4777-8777-777777777777';
  // A real new cutoff; leave append-only events and every old row untouched.
  await new Promise(resolve=>setTimeout(resolve,2));
  p.policy.startAt=new Date().toISOString();p.policy.endAt=new Date(Date.parse(p.policy.startAt)+210*60000).toISOString();
  f.db.env.MAONO_TICKET_NOTIFICATION_START_AT=p.policy.startAt;
  f.db.env.MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON=JSON.stringify(p.policy);
 }
 t.after(()=>rm(dir,{recursive:true,force:true}));let clock=Date.now(),active=false,scheduled=false,activated=false,patchLost=false,deployments=0;
 p.limits.deliveryWaitSeconds=waitSeconds;
 let nextTick=Infinity;const scheduler={invocations:0,failures:0};
 const tick=async()=>{
  if(!active||clock<nextTick)return;
  nextTick=clock+60000;scheduler.invocations++;
  const pending=[];
  const workerEnv=fault==='worker-before-claim'?{...f.db.env,DB:{prepare(){throw Error('private-worker-database-fixture');}}}:f.db.env;
  await notificationWorker.scheduled({cron:p.worker.cron,scheduledTime:clock},workerEnv,{waitUntil:promise=>pending.push(promise)});
  scheduler.failures+=(await Promise.allSettled(pending)).filter(result=>result.status==='rejected').length;
 };
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
  readWorker:async()=>{const s=snapshot(p);if(active)s.deployments.deployments[0].versions[0].version_id=p.worker.onVersion;if(scheduled)s.schedules.schedules=[{cron:p.worker.cron}];return s;},
  setActive:async(value,{scheduled:schedule=value}={})=>{
   controls.push(['worker',value]);if(!value&&fault==='stop'&&activated)throw Error('Worker stop unavailable');
   active=value;scheduled=schedule;f.db.env.MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED=String(value);
   if(value){
    activated=true;if(fault==='worker-lost')throw Error('lost Worker response');nextTick=clock+cronDelayMs;await tick();
    if(fault==='diagnostic-checkpoint'){
     const sequences=(await readdir(dir)).map(name=>/^report\.checkpoint-(\d+)\.json$/.exec(name)).filter(Boolean).map(match=>Number(match[1]));
     await mkdir(join(dir,`report.checkpoint-${Math.max(...sequences)+1}.json`));
    }
   }
   else nextTick=Infinity;
   return summarizeCc07Worker(await infrastructure.readWorker(),{active:value,observedAt:new Date(clock).toISOString()});
  },
  audit:async()=>{
   if(fault==='audit-unavailable')throw Error('read-only audit unavailable');
   const a=inventory(p);a.startedAt=a.completedAt=new Date(clock).toISOString();
   a.scoped={outbox:f.db.rows('ticket_command_outbox'),candidates:f.db.rows('ticket_notification_candidates'),notices:f.db.rows('ticket_notifications'),tickets:f.db.rows('organization_tickets')};
   if(p.preserved){
    // Capture only the additional fixed preservation reads through the public
    // audit method. Its terminal QA9 guard is expected to reject this local DB.
    const originalDigest=p.qa9.digest;const captured=[];
    const projectionInfra=cc07Infrastructure('local-worker','local-read',p,{now:()=>clock,fetchImpl:async(_url,o)=>{
     const {sql,params}=JSON.parse(o.body),results=(await f.db.env.DB.prepare(sql).bind(...params).all()).results;
     if(sql.includes('current_cycle_number,closed_at')||sql.includes('FROM ticket_events WHERE')||sql.includes('FROM ticket_cycles WHERE')||sql.includes('FROM ticket_acl_entries WHERE')||sql.includes('FROM ticket_ticket_access_policies WHERE'))captured.push(results);
     return Response.json({success:true,result:[{success:true,meta:{changed_db:false},results}]});
    }});
    await assert.rejects(()=>projectionInfra.audit(),{code:'CC07_QA9_PRESERVATION_FAILED'});
    assert.equal(p.qa9.digest,originalDigest);assert.equal(captured.length,6);
    a.preservedRows=Object.fromEntries(['ticket','events','cycles','acl','policies','counts'].map((k,i)=>[k,captured[i]]));
    // Freeze once before execution; never recompute/adopt during a run.
    if(!preservedBefore){preservedBefore=preservedCc07Snapshot(a,p);p.preserved.digest=preservedCc07Digest(preservedBefore);}
   }
   if(fault==='foreign-after-create'&&a.scoped.tickets.length)a.outsideDigest='foreign';return a;
  }
 };
 if(preserve)await infrastructure.audit();
 if(mode==='closure'){active=true;activated=true;vars.MAONO_TICKET_NOTIFICATIONS_ENABLED.value='true';canonical=deployment();}
 const env={MAONO_ACCEPTANCE_CC07_PLAN_JSON:JSON.stringify(p),MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:'local-fixture',MAONO_ACCEPTANCE_CC07_QA_CREDENTIALS_JSON:JSON.stringify(Object.fromEntries(manifest.requiredProfiles.map(name=>[name,{email:`${name}@synthetic.invalid`,password:'local-fixture-only'}]))),GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'synthetic-owner',GITHUB_REPOSITORY_OWNER:'synthetic-owner',GITHUB_REF:'refs/heads/main'};
 const reportPath=join(dir,'report.json');
 let proofSince=Infinity,proofObserved=false;
 const readiness={start:async()=>{},resetSince:time=>{proofSince=time;},receipt:()=>{
  if(['readiness-timeout','proof-and-cleanup'].includes(fault))return null;
  if(fault==='readiness-disconnect')fail('CC07_TAIL_DISCONNECTED','Local transport unavailable.');
  if(fault==='readiness-handler')fail('CC07_CRON_HANDLER_FAILED','Local handler failed.');
  if(fault==='readiness-deadline'){clock+=80*60000;return null;}
  proofObserved=true;
  return scheduled&&!active?{versionId:p.worker.offVersion,runId:p.policy.runId,scheduledAt:new Date(Math.max(proofSince,clock)).toISOString(),consumerOff:true,claimed:0}:null;
 },close:async()=>{if(fault==='proof-and-cleanup')fail('CC07_TAIL_CLEANUP_UNCONFIRMED','Local deletion failed.');return {deleted:true};}};
 if(fault==='foreign-during-readiness'){
  const original=infrastructure.audit;infrastructure.audit=async()=>{const value=await original();if(proofObserved)value.outsideDigest='changed';return value;};
 }
 const runtime={fetchImpl,infrastructure,readiness,now:()=>clock,sleep:async ms=>{clock+=ms;await tick();}};
 if(setupOnly)return {...f,env,runtime,reportPath,controls,get clock(){return clock;},get active(){return active;},get scheduled(){return scheduled;}};
 const cliMain=viaCli?(await import('../../scripts/acceptance/operator.mjs')).main:null;
 const exit=viaCli?await cliMain(['--mode',mode,'--suite','cc07-notifications','--organization-id','1','--qa-user-ids','1,2,3','--expected-commit',sha,'--report',reportPath],env,runtime):await runCc07Operator(cliOptions(mode,reportPath),env,runtime);
 const checkpoints=(await readdir(dir)).filter(name=>/^report\.checkpoint-\d+\.json$/.test(name));
 assert.ok(checkpoints.length>0,'A durable checkpoint must precede simulated configuration writes');
 const first=JSON.parse(await readFile(join(dir,'report.checkpoint-1.json')));
 assert.equal(first.writesPerformed,false);assert.equal(first.acceptanceExecuted,false);
 if(preserve)assert.deepEqual(preservedCc07Snapshot(await infrastructure.audit(),p),preservedBefore);
 return {...f,exit,result:JSON.parse(await readFile(reportPath)),controls,active,scheduled,vars,canonical,scheduler};
}

export {localFixture,operatorFixture};
