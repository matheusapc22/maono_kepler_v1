import {fail} from './production-acceptance-lib.mjs';
import {notificationAcceptancePolicy} from '../../functions/_lib/ticket-notification-acceptance.js';

const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k));
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v||'');
export function validateCc07Plan(raw,options,{now=Date.now(),admit=false}={}){
 let p;try{p=JSON.parse(raw);}catch{fail('CC07_PLAN_REQUIRED','Informe o plano CC07 revisado, sem credenciais.');}
 const reject=()=>fail('CC07_PLAN_INVALID','Plano CC07 incompleto ou divergente; renovar revisão.');
 if(!exact(p,['version','productSha','organizationId','qaIds','worker','policy','approval','qa9','limits'])||p.version!==1||p.productSha!==options.expectedCommit||p.organizationId!==options.organizationId||p.organizationId===9||options.projectSlug)reject();
 if(!exact(p.qaIds,['manager','allowed','restricted'])||Object.values(p.qaIds).some(id=>!Number.isSafeInteger(id)||id<1)||new Set(Object.values(p.qaIds)).size!==3)reject();
 if(options.qaUserIds && Object.entries(p.qaIds).some(([k,v])=>options.qaUserIds[k]!==v))reject();
 if(!exact(p.worker,['offVersion','onVersion','codeEtag','cron'])||!uuid(p.worker.offVersion)||!uuid(p.worker.onVersion)||p.worker.offVersion===p.worker.onVersion||!/^[a-f0-9]{32,64}$/.test(p.worker.codeEtag||'')||p.worker.cron!=='* * * * *')reject();
 const policy=notificationAcceptancePolicy({MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON:JSON.stringify(p.policy),MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:String(p.organizationId),MAONO_TICKET_NOTIFICATION_START_AT:p.policy?.startAt},now);
 if(!policy||policy.organizationId!==p.organizationId||policy.managerId!==p.qaIds.manager)reject();
 if(!exact(p.approval,['actor','confirmedAt','writersPaused','syntheticOnly','workerVersionsReviewed','costAndVolumeApproved','humanRecoveryAvailable'])||
   !/^[A-Za-z0-9-]{1,39}$/.test(p.approval.actor||'')||!Number.isFinite(Date.parse(p.approval.confirmedAt))||Date.parse(p.approval.confirmedAt)>now||
   ['writersPaused','syntheticOnly','workerVersionsReviewed','costAndVolumeApproved','humanRecoveryAvailable'].some(k=>p.approval[k]!==true))reject();
 if(!exact(p.qa9,['outboxCount','digest'])||p.qa9.outboxCount!==13||!/^[a-f0-9]{64}$/.test(p.qa9.digest||''))reject();
 if(!exact(p.limits,['deliveryWaitSeconds','quiescenceSeconds'])||!Number.isSafeInteger(p.limits.deliveryWaitSeconds)||p.limits.deliveryWaitSeconds<60||p.limits.deliveryWaitSeconds>600||!Number.isSafeInteger(p.limits.quiescenceSeconds)||p.limits.quiescenceSeconds<125||p.limits.quiescenceSeconds>300)reject();
 if(admit && (!policy.active || Date.parse(policy.endAt)-now<135*60000))fail('CC07_WINDOW_NOT_ADMITTED','Janela fora do horário ou sem a reserva de 135 minutos.');
 return structuredClone(p);
}
export function assertCc07Actor(plan,env){
 if(env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||env.GITHUB_ACTOR!==plan.approval.actor||env.GITHUB_REF!=='refs/heads/main')
   fail('CC07_DISPATCH_CONTEXT_INVALID','Uma única execução pelo proprietário, em main, exige plano aprovado.');
}
