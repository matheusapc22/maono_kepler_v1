import {localFixture,operatorFixture} from './helpers/cc07-operator-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateCc07Plan,assertCc07Actor} from '../scripts/acceptance/cc07-plan.mjs';
import {validateCc07Worker,cc07Infrastructure} from '../scripts/acceptance/cc07-infrastructure.mjs';
import {assertCc07Inventory,runCc07Operator} from '../scripts/acceptance/cc07-operator.mjs';
import {manifest,run} from '../scripts/acceptance/suites/cc07-notifications.mjs';
import {parseArgs,safeFlags,PRODUCTION_D1_ID} from '../scripts/acceptance/production-acceptance-lib.mjs';
const sha='a'.repeat(40),now=Date.parse('2026-10-24T18:00:00.000Z');
const plan=()=>({version:2,preserved:null,readiness:{waitSeconds:60},productSha:sha,organizationId:1,qaIds:{manager:1,allowed:2,restricted:3},
 worker:{offVersion:'11111111-1111-4111-8111-111111111111',onVersion:'22222222-2222-4222-8222-222222222222',codeEtag:'b'.repeat(64),cron:'* * * * *'},
 policy:{runId:'33333333-3333-4333-8333-333333333333',organizationId:1,managerId:1,startAt:'2026-10-24T18:00:00.000Z',endAt:'2026-10-24T21:30:00.000Z',maxEvents:3,maxAttempts:15,batchSize:3},
 approval:{actor:'synthetic-owner',confirmedAt:'2026-10-24T17:50:00.000Z',writersPaused:true,syntheticOnly:true,workerVersionsReviewed:true,costAndVolumeApproved:true,humanRecoveryAvailable:true},
 qa9:{outboxCount:13,digest:'c'.repeat(64)},limits:{deliveryWaitSeconds:60,quiescenceSeconds:125}});
const opts={expectedCommit:sha,organizationId:1,qaUserIds:{manager:1,allowed:2,restricted:3},projectSlug:null};
const cliOptions=(mode,report)=>parseArgs(['--mode',mode,'--suite','cc07-notifications','--organization-id','1','--qa-user-ids','1,2,3','--expected-commit',sha,'--report',report]);
const version=(p,on)=>({id:on?p.worker.onVersion:p.worker.offVersion,resources:{script:{etag:p.worker.codeEtag,handlers:['scheduled']},script_runtime:{compatibility_date:'2026-10-01'},bindings:[
 {name:'DB',type:'d1',id:PRODUCTION_D1_ID},{name:'CF_VERSION_METADATA',type:'version_metadata'},...Object.entries({MAONO_RUNTIME_ENV:'production',MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:'true',MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:String(on),MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:String(p.organizationId),MAONO_TICKET_NOTIFICATION_START_AT:p.policy.startAt,MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON:JSON.stringify(p.policy)}).map(([name,text])=>({name,type:'plain_text',text}))]}});
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
 s.schedules.schedules=[{cron:p.worker.cron}];
 const fetchImpl=async(url,options)=>{const path=new URL(url).pathname;calls.push([path,options.method]);assert.ok(path.startsWith('/client/v4/accounts/'));if(options.method!=='GET')throw new Error('uncertain transport');const result=path.endsWith('/deployments')?s.deployments:path.endsWith('/schedules')?s.schedules:path.endsWith(p.worker.offVersion)?s.off:s.on;return Response.json({success:true,result});};
 const api=cc07Infrastructure('local-fixture','local-read-fixture',p,{fetchImpl});await assert.rejects(()=>api.setActive(true));assert.equal(calls.filter(x=>x[1]==='POST').length,1);assert.equal(calls.filter(x=>x[1]==='PUT').length,0);
});
test('CC07 rejects missing or divergent Worker runtime before any control write',async()=>{
 for(const missing of [true,false]){
  const p=plan(),s=snapshot(p),calls=[];
  if(missing){delete s.off.resources.script_runtime;delete s.on.resources.script_runtime;}
  else s.on.resources.script_runtime.compatibility_date='2026-09-01';
  const fetchImpl=async(url,o)=>{calls.push(o.method);assert.equal(o.method,'GET');const path=new URL(url).pathname;return Response.json({success:true,result:path.endsWith('/deployments')?s.deployments:path.endsWith('/schedules')?s.schedules:path.endsWith(p.worker.offVersion)?s.off:s.on});};
  await assert.rejects(()=>cc07Infrastructure('local-fixture','local-read-fixture',p,{fetchImpl}).setActive(true));assert.ok(calls.every(x=>x==='GET'));
 }
});
test('CC07 preflight uses read-only infrastructure and never accesses QA credentials',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cc07-preflight-'));t.after(()=>rm(dir,{recursive:true,force:true}));const p=plan();
 const vars=Object.fromEntries(Object.entries({...safeFlags(manifest),MAONO_RUNTIME_ENV:'production',MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:'1',MAONO_TICKET_NOTIFICATION_START_AT:p.policy.startAt}).map(([k,v])=>[k,{type:'plain_text',value:String(v)}]));
 const deployment={id:'deployed',environment:'production',url:'https://maono-kepler-v1.pages.dev',deployment_trigger:{metadata:{commit_hash:sha,commit_dirty:false}},latest_stage:{name:'deploy',status:'success'},env_vars:vars};
 const calls=[];const fetchImpl=async(url,o)=>{calls.push(o.method);assert.equal(o.method,'GET');return Response.json({success:true,result:String(url).includes('/deployments?')?[deployment]:{name:'maono-kepler-v1',production_branch:'mano_kepler_v1',subdomain:'maono-kepler-v1.pages.dev',deployment_configs:{production:{d1_databases:{DB:{id:PRODUCTION_D1_ID}},env_vars:vars}},canonical_deployment:deployment}});};
 const env={MAONO_ACCEPTANCE_CC07_PLAN_JSON:JSON.stringify(p),MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:'local-fixture',GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'synthetic-owner',GITHUB_REPOSITORY_OWNER:'synthetic-owner',GITHUB_REF:'refs/heads/main'};
 Object.defineProperty(env,'MAONO_ACCEPTANCE_CC07_QA_CREDENTIALS_JSON',{get(){throw Error('must not read QA secret');}});
 const report=join(dir,'report.json');assert.equal(await runCc07Operator(cliOptions('preflight',report),env,{now:()=>now,fetchImpl,infrastructure:{readWorker:async()=>snapshot(p),audit:async()=>inventory(p),setActive:async()=>assert.fail('preflight mutation')}}),0);
 const result=JSON.parse(await readFile(report));assert.equal(result.writesPerformed,false);assert.equal(result.acceptanceExecuted,false);assert.equal(result.complete,true);assert.ok(calls.length>0);
});


test('CC07 complete suite exercises real HTTP/SQLite, recipient actions and preserved private cleanup',async t=>{
 const f=await localFixture(t);let result;try{result=await run(f.ctx);}finally{assert.deepEqual(await f.ctx.cleanup(),[]);}
 const ticket=f.db.row(result.syntheticTicketId);assert.equal(ticket.status,'closed');assert.equal(ticket.visibility,'private');assert.equal(f.db.rows('organization_tickets').length,1);
 assert.equal(f.db.rows('ticket_notifications').length,1);assert.equal(f.db.rows('ticket_command_outbox').length,3);assert.equal(f.db.rows('ticket_command_outbox').at(-1).status,'pending');assert.equal(f.db.env.MAONO_TICKET_COMMANDS_ENABLED,'true');
 assert.deepEqual(f.ctx.cases.map(x=>x.id).sort(),[...manifest.cases].sort());assert.ok(f.ctx.cases.every(x=>x.status==='PASS'));
});
test('CC07 uncertain create never retries, adopts another ticket or claims cleanup',async t=>{
 const f=await localFixture(t,{lostCreate:true});await assert.rejects(()=>run(f.ctx));assert.equal((await f.ctx.cleanup()).length,1);assert.equal(f.db.rows('organization_tickets').length,1);assert.equal(f.calls.filter(x=>x[1]==='POST').length,1);assert.equal(f.journals.at(-1).unknownCreation,true);assert.equal(f.db.env.MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED,'false');
});


test('CC07 CLI run preserves the exact prior failed fixture while testing only a new ticket',async t=>{
 const f=await operatorFixture(t,{preserve:true,viaCli:true});assert.equal(f.exit,0,JSON.stringify(f.result));
 assert.equal(f.result.finalAudit.preservedRecordsVerified,true);assert.equal(f.db.rows('organization_tickets').length,2);
 assert.equal(f.db.rows('ticket_command_outbox').length,5);assert.equal(f.active,false);assert.equal(f.scheduled,false);assert.equal(f.result.telemetryClosed,true);
});
for(const fault of ['readiness-timeout','readiness-disconnect'])test(`CC07 CLI ${fault} removes cron before any Pages activation or fixture`,async t=>{
 const f=await operatorFixture(t,{fault,viaCli:true});assert.equal(f.exit,1);assert.equal(f.result.error.code,fault==='readiness-timeout'?'CC07_CRON_READINESS_TIMEOUT':'CC07_TAIL_DISCONNECTED');
 assert.equal(f.result.configurationRestored,true);assert.equal(f.result.cleanupComplete,true);assert.equal(f.result.telemetryClosed,true);assert.equal(f.scheduled,false);assert.equal(f.active,false);
 assert.equal(f.db.rows('organization_tickets').length,0);assert.equal(f.controls.filter(x=>x[0]==='POST'||x[0]==='PATCH'||x[0]==='worker'&&x[1]).length,0);
});
for(const [fault,code]of [['readiness-handler','CC07_CRON_HANDLER_FAILED'],['readiness-deadline','ACCEPTANCE_PHASE_TIMEOUT'],['foreign-during-readiness','CC07_FOREIGN_ACTIVITY']])test(`CC07 CLI stops ${fault} with no fixture and preserved restoration`,async t=>{
 const f=await operatorFixture(t,{fault,viaCli:true});assert.equal(f.exit,1);assert.equal(f.result.error.code,code);
 assert.equal(f.result.configurationRestored,true);assert.equal(f.active,false);assert.equal(f.scheduled,false);assert.equal(f.db.rows('organization_tickets').length,0);
 assert.equal(f.controls.filter(x=>x[0]==='worker'&&x[1]).length,0);assert.equal(f.result.budget.closureReserveMinutes,75);
});
test('CC07 CLI telemetry cleanup failure cannot mask the original proof timeout or stop OFF restoration',async t=>{
 const f=await operatorFixture(t,{fault:'proof-and-cleanup',viaCli:true});assert.equal(f.exit,1);assert.equal(f.result.error.code,'CC07_CRON_READINESS_TIMEOUT');
 assert.equal(f.result.telemetryError.code,'CC07_TAIL_CLEANUP_UNCONFIRMED');assert.equal(f.result.telemetryClosed,false);
 assert.equal(f.result.configurationRestored,true);assert.equal(f.result.cleanupComplete,true);assert.equal(f.scheduled,false);
});

test('CC07 controls prepare cron only on OFF and retain it between approved versions until final cleanup',async()=>{
 const p=plan(),s=snapshot(p),writes=[];
 const api=cc07Infrastructure('fixture-only','fixture-read',p,{fetchImpl:async(url,o)=>{
  const path=new URL(url).pathname;let result;
  if(o.method==='GET')result=path.endsWith('/deployments')?s.deployments:path.endsWith('/schedules')?s.schedules:path.endsWith(p.worker.offVersion)?s.off:s.on;
  else{const body=JSON.parse(o.body);writes.push([o.method,body]);if(o.method==='PUT')s.schedules.schedules=body;else s.deployments.deployments[0].versions=body.versions;result={};}
  return Response.json({success:true,result});
 }});
 await assert.rejects(()=>api.setActive(true),{code:'CC07_CRON_NOT_PREPARED'});assert.equal(writes.length,0);
 await api.setActive(false,{scheduled:true});assert.deepEqual(writes,[['PUT',[{cron:p.worker.cron}]]]);
 await api.setActive(true);await api.setActive(false,{scheduled:true});await api.setActive(true);await api.setActive(false);
 assert.deepEqual(writes.map(x=>x[0]),['PUT','POST','POST','POST','PUT','POST']);
 assert.deepEqual(s.schedules.schedules,[]);assert.equal(s.deployments.deployments[0].versions[0].version_id,p.worker.offVersion);
});

test('CC07 orchestrator completes delivery and containment, retaining COMMANDS and records',async t=>{
 const f=await operatorFixture(t);assert.equal(f.exit,0,JSON.stringify(f.result));
 assert.equal(f.result.operationalTestsPassed,true);assert.equal(f.result.cleanupComplete,true);assert.equal(f.result.preservationVerified,true);assert.equal(f.result.configurationRestored,true);
 assert.equal(f.db.rows('organization_tickets')[0].status,'closed');assert.equal(f.db.rows('ticket_command_outbox').length,3);assert.equal(f.active,false);assert.equal(f.vars.MAONO_TICKET_COMMANDS_ENABLED.value,'true');assert.equal(f.vars.MAONO_TICKET_NOTIFICATIONS_ENABLED.value,'false');
});
test('CC07 delayed scheduled invocations pass without changing approved wait or closure reserves',async t=>{
 const f=await operatorFixture(t,{cronDelayMs:10000});assert.equal(f.exit,0,JSON.stringify(f.result));
 assert.equal(f.scheduler.invocations,2);assert.equal(f.scheduler.failures,0);
 assert.deepEqual(f.result.deliveryWaits.map(x=>[x.stage,x.outcome]),[['first-delivery','satisfied'],['outbox-completion','satisfied'],['revocation-suppression','satisfied']]);
 assert.equal(f.result.deliveryWaits[0].lastInventory.evidence,'PERSISTED_PROCESSING_OBSERVED');
 assert.ok(f.result.workerControls.every(x=>x.outcome==='confirmed'&&x.readback.configurationReadbackOnly===true));
 assert.equal(f.result.budget.closureReserveMinutes,75);assert.equal(f.result.final.workerStopped,true);
});
test('CC07 reproduces documented cron propagation beyond a five-minute wait without extending it',async t=>{
 const f=await operatorFixture(t,{cronDelayMs:15*60000,waitSeconds:300});
 assert.equal(f.exit,1);assert.equal(f.result.error.code,'CC07_DELIVERY_TIMEOUT');assert.equal(f.scheduler.invocations,0);
 const wait=f.result.deliveryWaits[0];assert.equal(wait.outcome,'timeout');assert.equal(wait.stage,'first-delivery');
 assert.equal(Date.parse(wait.completedAt)-Date.parse(wait.startedAt),300000);assert.equal(wait.samples,60);
 assert.equal(wait.lastInventory.attempts,0);assert.equal(wait.lastInventory.counts.notices,0);assert.equal(wait.lastInventory.evidence,'NO_PERSISTED_PROCESSING_OBSERVED');
 assert.equal(f.result.configurationRestored,true);assert.equal(f.result.cleanupComplete,true);assert.equal(f.result.preservationVerified,true);
 assert.deepEqual(f.result.cases.map(x=>x.id),['CC07-CLEANUP']);assert.equal(f.db.rows('ticket_command_outbox').length,2);
 assert.equal(f.active,false);assert.equal(f.vars.MAONO_TICKET_COMMANDS_ENABLED.value,'true');
});
test('CC07 zero attempts also occurs after a real scheduled-handler failure before claim',async t=>{
 const f=await operatorFixture(t,{fault:'worker-before-claim',cronDelayMs:10000});
 assert.equal(f.exit,1);assert.equal(f.result.error.code,'CC07_DELIVERY_TIMEOUT');assert.ok(f.scheduler.invocations>0);assert.equal(f.scheduler.failures,f.scheduler.invocations);
 assert.equal(f.result.deliveryWaits[0].lastInventory.evidence,'NO_PERSISTED_PROCESSING_OBSERVED');
 assert.equal(f.result.deliveryWaits[0].lastInventory.attempts,0);
 assert.equal(f.result.configurationRestored,true);assert.equal(f.result.cleanupComplete,true);
 assert.ok(!JSON.stringify(f.result).includes('private-worker-database-fixture'));
 assert.ok(!JSON.stringify(f.result).includes('CRON_NOT_PROPAGATED'));
});
test('CC07 diagnostic checkpoint failure preserves the delivery error and still contains the fixture',async t=>{
 const f=await operatorFixture(t,{fault:'diagnostic-checkpoint',cronDelayMs:15*60000,waitSeconds:300});
 assert.equal(f.exit,1);assert.equal(f.result.error.code,'CC07_DELIVERY_TIMEOUT');assert.equal(f.result.diagnosticCheckpointUnavailable,true);
 assert.equal(f.result.deliveryWaits[0].outcome,'timeout');assert.equal(f.result.workerControls[0].outcome,'confirmed');
 assert.equal(f.result.cleanupComplete,true);assert.equal(f.result.configurationRestored,true);assert.equal(f.result.preservationVerified,true);
 assert.equal(f.active,false);assert.equal(f.db.rows('organization_tickets')[0].status,'closed');assert.equal(f.db.rows('ticket_command_outbox').length,2);
 assert.equal(f.vars.MAONO_TICKET_COMMANDS_ENABLED.value,'true');assert.equal(f.vars.MAONO_TICKET_NOTIFICATIONS_ENABLED.value,'false');
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
