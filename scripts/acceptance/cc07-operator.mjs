import {createExecutionBudget} from './execution-budget.mjs';
import {validateCc07Plan,assertCc07Actor} from './cc07-plan.mjs';
import {cc07Infrastructure,validateCc07Worker,cc07Digest} from './cc07-infrastructure.mjs';
import * as suite from './suites/cc07-notifications.mjs';
import {assertProduction,buildProfiles,fail,initialReport,parseCredentials,readProduction,safeError,suiteContext,transitionFlags,writeReport,activeFlags,safeFlags} from './production-acceptance-lib.mjs';
const check=(ok,code)=>{if(!ok)fail(code,'Gate CC07 não comprovado; nenhuma ampliação automática.');};
const invariants={...suite.manifest,managedFlags:Object.fromEntries(Object.entries(suite.manifest.managedFlags).filter(([k])=>k!=='MAONO_TICKET_NOTIFICATIONS_ENABLED'))};
export function assertCc07Pages(project,plan,{active=false}={}){
 assertProduction(project,plan.productSha,invariants);
 for(const vars of [project.raw?.deployment_configs?.production?.env_vars,project.raw?.canonical_deployment?.env_vars]){
  check(vars?.MAONO_RUNTIME_ENV?.value==='production','CC07_RUNTIME_INVALID');
  check(vars?.MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS?.type==='plain_text'&&vars.MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS.value===String(plan.organizationId),'CC07_PAGES_ALLOWLIST_INVALID');
  check(vars?.MAONO_TICKET_NOTIFICATION_START_AT?.type==='plain_text'&&vars.MAONO_TICKET_NOTIFICATION_START_AT.value===plan.policy.startAt,'CC07_PAGES_CUTOFF_INVALID');
  const flag=vars?.MAONO_TICKET_NOTIFICATIONS_ENABLED;
  check(active?flag?.type==='plain_text'&&flag.value==='true':!flag||flag.type==='plain_text'&&flag.value==='false','CC07_INBOX_FLAG_DRIFT');
  for(const [name,v]of Object.entries(vars||{}))if(name.startsWith('MAONO_TICKET_')&&name.endsWith('_ENABLED')&&!Object.hasOwn(suite.manifest.managedFlags,name))
    check(v.type==='plain_text'&&v.value==='false','CC07_OTHER_MODULE_ENABLED');
 }
}
export function assertCc07Inventory(audit,plan,{now=Date.now(),empty=false,before=null,ticketId=null}={}){
 check(Date.parse(audit.startedAt)<=now&&now-Date.parse(audit.startedAt)<=600000&&Date.parse(audit.completedAt)<=now,'CC07_INVENTORY_EXPIRED');
 check(audit.qa9Digest===plan.qa9.digest,'CC07_QA9_PRESERVATION_FAILED');
 if(before)check(audit.outsideDigest===before.outsideDigest&&JSON.stringify(audit.organizationIds)===JSON.stringify(before.organizationIds),'CC07_FOREIGN_ACTIVITY');
 if(empty)check(Object.values(audit.scoped).every(rows=>rows.length===0),'CC07_TARGET_NOT_EMPTY');
 if(ticketId){
  check(audit.scoped.tickets.length===1&&audit.scoped.tickets[0].id===ticketId&&audit.scoped.tickets[0].created_by===plan.qaIds.manager,'CC07_TICKET_SCOPE_DRIFT');
  check(audit.scoped.outbox.length<=plan.policy.maxEvents&&audit.scoped.outbox.every(x=>x.ticket_id===ticketId&&x.created_at>=plan.policy.startAt),'CC07_EVENT_SCOPE_DRIFT');
  check(audit.scoped.outbox.reduce((sum,x)=>sum+x.notification_attempts,0)<=plan.policy.maxAttempts,'CC07_ATTEMPT_LIMIT');
  const ids=new Set(audit.scoped.outbox.map(x=>x.id));
  check(audit.scoped.candidates.every(x=>ids.has(x.outbox_id)&&x.recipient_id===plan.qaIds.allowed)&&audit.scoped.notices.every(x=>ids.has(x.outbox_id)&&x.ticket_id===ticketId&&x.recipient_id===plan.qaIds.allowed&&x.channel==='in_app'),'CC07_RECIPIENT_SCOPE_DRIFT');
 }
}
export async function runCc07Operator(options,env=process.env,runtime={}){
 const manifest=suite.manifest,now=runtime.now||Date.now,budget=createExecutionBudget(manifest,{now}),deps={...runtime,budget};
 const report=initialReport({mode:options.mode,suite:manifest.id,suiteVersion:manifest.version,organizationId:options.organizationId,expectedCommit:options.expectedCommit});
 let context=null,armed=false,initial=null,plan=null,infra=null,before=null,sequence=0,error=null,workerStopped=false;
 const save=()=>writeReport(options.report.replace(/\.json$/,`.checkpoint-${++sequence}.json`),report);
 try{
  budget.enter('preflight');plan=validateCc07Plan(env.MAONO_ACCEPTANCE_CC07_PLAN_JSON,options,{now:now(),admit:options.mode==='run'});assertCc07Actor(plan,env);
  if(options.mode==='run')budget.constrainDeadline(Date.parse(plan.policy.endAt));
  const token=env.MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN;
  infra=runtime.infrastructure||cc07Infrastructure(env.MAONO_ACCEPTANCE_CC07_WORKER_TOKEN,env.MAONO_ACCEPTANCE_CC07_D1_READ_TOKEN,plan,deps);
  initial=await readProduction(token,manifest,deps);
  if(options.mode!=='closure')assertCc07Pages(initial,plan);
  else assertProduction(initial,plan.productSha,invariants);
  const worker=await infra.readWorker();
  if(options.mode!=='closure')validateCc07Worker(worker,plan);
  if(options.mode==='closure'){
   // Data-audit availability must not prevent containment of a reviewed Worker.
   // setActive validates code, bindings and the observed version before writes.
   report.preflight={commit:initial.canonical.commit,deploymentId:initial.canonical.id,configuredFlags:initial.configuredFlags};
   report.pendingGates=['EXACT_RESOURCE_JOURNAL_AND_HUMAN_RECOVERY'];
   await save();armed=true;report.writesPerformed=true;
   fail('CC07_RESOURCE_CLOSURE_REQUIRES_REVIEW','Conter infraestrutura; revisar o diário para conter o chamado exato.');
  }
  before=await infra.audit();
  if(options.mode!=='closure')assertCc07Inventory(before,plan,{now:now(),empty:true});
  report.preflight={commit:initial.canonical.commit,deploymentId:initial.canonical.id,configuredFlags:initial.configuredFlags,organizationId:plan.organizationId,qa9OutboxCount:13,qa9Digest:before.qa9Digest,outsideDigest:before.outsideDigest,inventoryAt:before.startedAt,workerOffVersion:plan.worker.offVersion};
  if(options.mode==='preflight'){
   report.ok=true;report.complete=true;report.cleanupComplete=true;report.configurationRestored=true;
   report.pendingGates=['EXPLICIT_CC07_WINDOW','FRESH_INVENTORY','QA_AUTHENTICATION','ENVIRONMENT_RUN_APPROVAL'];return 0;
  }
  check(options.qaUserIds,'QA_IDENTITIES_REQUIRED');
  validateCc07Plan(env.MAONO_ACCEPTANCE_CC07_PLAN_JSON,options,{now:now(),admit:true});
  assertCc07Inventory(before,plan,{now:now(),empty:true});
  const credentials=parseCredentials(env.MAONO_ACCEPTANCE_CC07_QA_CREDENTIALS_JSON,manifest.requiredProfiles);
  const profiles=await buildProfiles(initial.baseUrl,credentials,manifest,plan.organizationId,deps);
  context=suiteContext({baseUrl:initial.baseUrl,organizationId:plan.organizationId,profiles,runId:plan.policy.runId,expectedCommit:options.expectedCommit,mutationMode:manifest.mutationMode,
   deps:{...deps,onResourceJournal:async value=>{report.resourceJournal=value;await save();}}});
  let currentTicket=null;
  const audit=async()=>{const result=await infra.audit();assertCc07Inventory(result,plan,{now:now(),before,ticketId:currentTicket});return result;};
  context.cc07={plan,audit,
   async startConsumer(ticketId){currentTicket=ticketId;await audit();budget.assertAdmission();await infra.setActive(true);workerStopped=false;},
   async stopConsumer(){if(!workerStopped){await infra.setActive(false);await budget.pause(plan.limits.quiescenceSeconds*1000,runtime.sleep);workerStopped=true;}},
   async poll(read){const end=now()+plan.limits.deliveryWaitSeconds*1000;while(now()<end){budget.assertAdmission();const value=await read();if(value)return value;await budget.pause(5000,runtime.sleep);}fail('CC07_DELIVERY_TIMEOUT','Entrega não confirmada dentro do limite aprovado.');}
  };
  suite.prepare(context);
  // Renew after authentication and immediately before configuration writes.
  const fresh=await infra.audit();assertCc07Inventory(fresh,plan,{now:now(),empty:true,before});before=fresh;
  initial=await readProduction(token,manifest,deps);assertCc07Pages(initial,plan);validateCc07Worker(await infra.readWorker(),plan);
  validateCc07Plan(env.MAONO_ACCEPTANCE_CC07_PLAN_JSON,options,{now:now(),admit:true});
  budget.enter('activation');await save();armed=true;report.writesPerformed=true;
  await transitionFlags({token,sourceDeploymentId:initial.canonical.id,commit:plan.productSha,manifest,values:activeFlags(manifest),deps,validateCurrent:current=>assertCc07Pages(current,plan)});
  assertCc07Pages(await readProduction(token,manifest,deps),plan,{active:true});
  budget.enter('suite');report.acceptanceExecuted=true;report.result=await suite.run(context);
 }catch(cause){error=cause;report.error=safeError(cause);}
 finally{
  if(armed){
   try{
    if(budget.phase!=='cleanup')budget.enter('cleanup');
    // Independently stop scheduling/consumption even if suite never registered cleanup.
    await infra.setActive(false);await budget.pause(plan.limits.quiescenceSeconds*1000,runtime.sleep);workerStopped=true;
    const cleanup=context?await context.cleanup():[];report.cleanupComplete=Boolean(context)&&cleanup.length===0;
    if(cleanup.length)report.cleanupErrors=cleanup;
   }catch(cause){report.cleanupComplete=false;report.cleanupError=safeError(cause);error??=cause;}
   try{
    budget.enter('restoration');
    // If stop was uncertain, inspect before another intent; never cancel an active cleanup.
    await transitionFlags({token:env.MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN,sourceDeploymentId:initial.canonical.id,commit:plan.productSha,manifest,values:safeFlags(manifest),deps,validateCurrent:current=>assertProduction(current,plan.productSha,invariants)});
    if(!workerStopped){validateCc07Worker(await infra.readWorker(),plan);workerStopped=true;}
    const final=await readProduction(env.MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN,manifest,deps);assertCc07Pages(final,plan);validateCc07Worker(await infra.readWorker(),plan);
    report.final={commit:final.canonical.commit,deploymentId:final.canonical.id,flags:final.configuredFlags,workerStopped};
    report.configurationRestored=true;
   }catch(cause){report.configurationRestored=false;report.restorationError=safeError(cause);error??=cause;}
   // Keep the observed configuration result even if the independent data audit fails.
   try{
    const after=await infra.audit();assertCc07Inventory(after,plan,{now:now(),before,ticketId:report.resourceJournal?.ticketId||null});
    check(after.scoped.outbox.every(x=>x.status!=='processing'),'CC07_INFLIGHT_UNRESOLVED');
    report.preservationVerified=Boolean(before);
    report.finalAudit={qa9Preserved:after.qa9Digest===plan.qa9.digest,outsidePreserved:before?after.outsideDigest===before.outsideDigest:null,scopedCounts:Object.fromEntries(Object.entries(after.scoped).map(([k,v])=>[k,v.length]))};
   }catch(cause){report.preservationVerified=false;report.preservationError=safeError(cause);error??=cause;}
  }
  if(context)report.cases=context.cases;
  if(options.mode!=='preflight'){report.ok=!error&&report.cleanupComplete&&report.configurationRestored;report.complete=report.ok;}
  report.operationalTestsPassed=report.acceptanceExecuted&&manifest.cases.every(id=>report.cases.some(c=>c.id===id&&c.status==='PASS'));
  report.acceptanceIncomplete=!report.operationalTestsPassed||!report.cleanupComplete||!report.configurationRestored;
  if(options.mode==='run'&&(!report.operationalTestsPassed||!report.preservationVerified)){report.ok=false;report.complete=false;report.acceptanceIncomplete=true;}
  report.budget={startedAt:new Date(budget.startedAt).toISOString(),deadline:new Date(budget.endAt).toISOString(),closureReserveMinutes:75};
  report.planDigest=plan?cc07Digest(plan):null;
  await writeReport(options.report,report);
 }
 return report.ok?0:1;
}
