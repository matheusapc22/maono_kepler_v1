import {fail,assertHttpResponse} from '../production-acceptance-lib.mjs';
import {assertQaContext} from './cc04-resources.mjs';
import {stateDigest} from './cc03-state.mjs';

const fixedTrue={requiredBefore:true,activeValue:true,safeValue:true};
export const manifest=Object.freeze({id:'cc07-notifications',version:1,description:'Scoped in-app notification delivery with preserved recipient state and independent consumer shutdown',
 mutationMode:'controlled_mutation',requiresBrowser:false,requiresApprovedIdentities:true,
 requiredProfiles:['manager','allowed','restricted'],requiredPermissions:{manager:['ticket.view','ticket.create','ticket.manage','ticket.access.manage'],allowed:['ticket.view'],restricted:['ticket.view']},
 managedFlags:{MAONO_TICKET_COMMANDS_ENABLED:fixedTrue,MAONO_TICKET_TRIAGE_ENABLED:fixedTrue,MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:fixedTrue,
  MAONO_TICKET_NOTIFICATIONS_ENABLED:{requiredBefore:false,activeValue:true,safeValue:false}},
 prerequisites:['Separate human authorization for one empty dedicated organization other than QA9 and three dedicated non-admin identities',
  '0041 audited/applied separately; approved immutable OFF/ON Worker versions, fixed D1 and no other bindings or handlers',
  'Approved cutoff/window, volume/cost limits, paused writers, QA9 digest and human recovery availability',
  'Separate protected Worker-control and D1-read-only credentials; no consumer or resource provisioning by this operator'],
 cleanup:{policy:'preserve-private-cc07-v1',method:'Stop cron and consumer first; close only the new owned ticket using fresh state ETag and manager-only ACL; preserve all records',
  interruption:'Uncertain creation cannot be retried. Closure stops infrastructure; resource containment needs the journal and a separately approved recovery.'},
 cases:['CC07-DELIVERY','CC07-IDEMPOTENCY','CC07-RECIPIENT-STATE','CC07-ACL','CC07-CLEANUP']});
const check=(ok,message)=>{if(!ok)fail('CC07_ASSERTION_FAILED',message);};
const expect=(r,status)=>{assertHttpResponse(r,r.status===status,'Resposta CC07 inesperada.');return r.body;};
export function prepare(ctx){
 assertQaContext(ctx);const p=ctx.cc07.plan;
 check(ctx.organizationId!==9&&ctx.organizationId===p.organizationId,'Escopo QA9 proibido.');
 for(const [name,id]of Object.entries(p.qaIds))check(Number(ctx.profiles[name].user.id)===id,'Identidade diferente da aprovada.');
 check(ctx.runId===p.policy.runId,'Identificador da janela divergente.');
}
export async function run(ctx){
 prepare(ctx);const {plan,audit,startConsumer,stopConsumer,poll}=ctx.cc07;
 const root=`/api/organizations/${ctx.organizationId}`,subject=`QA-CC07-${ctx.runId}`;
 let ticketId=null,unknownCreation=false;
 const journal=()=>ctx.publishResourceJournal({policy:'preserve-private-cc07-v1',runId:ctx.runId,organizationId:ctx.organizationId,ticketId,unknownCreation});
 const path=(suffix='')=>`${root}/tickets/${ticketId}${suffix}`;
 const read=async()=>{const body=expect(await ctx.api('manager',path()),200);check(body.ticket?.id===ticketId&&body.ticket.organizationId===ctx.organizationId&&body.ticket.subject===subject&&Number(body.ticket.createdBy?.id)===plan.qaIds.manager,'Chamado não pertence à execução.');return body.ticket;};
 const state=async()=>{const r=await ctx.api('manager',path('/state'),{headers:{'Accept-Encoding':'identity','Cache-Control':'no-transform'}});const body=expect(r,200),s=body.state;check(s?.id===ticketId&&s.organizationId===ctx.organizationId&&Number.isSafeInteger(s.version)&&s.version>0&&r.headers.get('etag')===`"ticket-state-${stateDigest(s)}"`,'Contrato state/ETag inválido.');return {state:s,etag:r.headers.get('etag')};};
 const access=async allowed=>{await read();expect(await ctx.api('manager',path('/access'),{method:'PUT',json:{visibility:'private',policyIds:[],acl:[{principalType:'user',principalId:plan.qaIds.manager,action:'ticket.manage',effect:'allow'},...(allowed?[{principalType:'user',principalId:plan.qaIds.allowed,action:'ticket.view',effect:'allow'}]:[])]}}),200);};
 ctx.registerCleanup(async()=>{
  await stopConsumer(); // Never rely on the UI flag to stop delivery.
  check(!unknownCreation,'Criação incerta: conferir o diário antes de qualquer recuperação.');
  if(ticketId){
   await access(false);const before=await state();
   if(before.state.status!=='closed'){
    try{expect(await ctx.api('manager',path('/transitions'),{method:'POST',headers:{'If-Match':before.etag},json:{status:'closed',closure:{outcomeCode:'answered',summary:'Teste sintético CC07 encerrado.',evidence:'Relatório protegido CC07.',communication:'Registrado no relatório.',pendingChangeAcknowledged:false}}}),200);}
    catch(error){if((await state()).state.status!=='closed')throw error;}
   }
   const final=await read(),canonical=await state(),acl=expect(await ctx.api('manager',path('/access')),200).access;
   check(final.status==='closed'&&final.visibility==='private'&&canonical.state.status==='closed'&&canonical.state.closure&&canonical.state.wait==null&&acl?.visibility==='private'&&acl.policies?.length===0&&acl.acl?.length===1&&acl.acl[0].principalType==='user'&&Number(acl.acl[0].principalId)===plan.qaIds.manager&&acl.acl[0].action==='ticket.manage'&&acl.acl[0].effect==='allow','Contenção final não comprovada.');
   for(const name of ['allowed','restricted'])expect(await ctx.api(name,path()),404);
  }
  await journal();ctx.record('CC07-CLEANUP','PASS',{ticketId,privateClosed:true,permanentDeletion:false});
 });
 const payload={subject,description:'Teste fictício de notificações in-app.',category:'support',priority:'normal',assignedTo:plan.qaIds.allowed,demandNature:'question_request',expectedResult:'Verificar entrega autorizada e isolamento.',context:'Janela CC07 aprovada.',impact:'individual',urgency:'flexible',priorityReason:'',triageAnswers:{},triageFormVersion:1};
 const create={method:'POST',headers:{'Idempotency-Key':`cc07-${ctx.runId}`},json:payload};
 unknownCreation=true;await journal();const first=expect(await ctx.api('manager',`${root}/tickets`,create),201).ticket;
 check(Number.isSafeInteger(first?.id)&&first.id>0&&first.organizationId===ctx.organizationId&&first.subject===subject&&Number(first.createdBy?.id)===plan.qaIds.manager,'Criação não comprovada.');
 ticketId=first.id;unknownCreation=false;await journal();await access(true);
 const replay=await ctx.api('manager',`${root}/tickets`,create);expect(replay,201);check(replay.body.ticket.id===ticketId&&replay.headers.get('Idempotency-Replayed')==='true','Repetição não idempotente.');
 await startConsumer(ticketId);
 const delivered=await poll(async()=>{const a=await audit();return a.scoped.notices.length===1?a:null;});
 check(delivered.scoped.outbox.length===1&&delivered.scoped.candidates.length===1&&delivered.scoped.notices[0].recipient_id===plan.qaIds.allowed,'Entrega excedeu o candidato aprovado.');
 ctx.record('CC07-DELIVERY','PASS',{channel:'in_app',recipients:1});
 const inbox=`${root}/ticket-notifications`;
 let allowed=expect(await ctx.api('allowed',inbox),200);check(allowed.items.length===1&&allowed.unread===1,'Aviso permitido ausente.');
 const noticeId=allowed.items[0].id;
 check(expect(await ctx.api('restricted',inbox),200).items.length===0,'Destinatário restrito recebeu aviso.');
 await poll(async()=>{const a=await audit();return a.scoped.outbox.every(x=>x.status==='delivered')?a:null;});
 check((await audit()).scoped.notices.length===1,'Entrega duplicada.');ctx.record('CC07-IDEMPOTENCY','PASS',{notices:1,createReplayed:true});
 for(const action of ['read','dismiss','restore']){
  const folder=action==='restore'?'?folder=deleted':'';allowed=expect(await ctx.api('allowed',inbox+folder),200);const n=allowed.items.find(x=>x.id===noticeId);check(n,'Aviso perdeu identidade.');
  expect(await ctx.api('allowed',inbox,{method:'PATCH',json:{id:n.id,action,version:n.version}}),200);
  expect(await ctx.api('allowed',inbox,{method:'PATCH',json:{id:n.id,action,version:n.version}}),200);
 }
 allowed=expect(await ctx.api('allowed',inbox),200);check(allowed.items.length===1&&allowed.unread===0&&allowed.items[0].readAt,'Estado por destinatário não persistiu.');
 ctx.record('CC07-RECIPIENT-STATE','PASS',{read:true,dismissedAndRestored:true,retained:true});
 await stopConsumer();await access(false);const before=await state();
 expect(await ctx.api('manager',path(),{method:'PATCH',headers:{'If-Match':before.etag},json:{nextAction:'Conferir supressão após revogação fictícia.'}}),200);
 await startConsumer(ticketId);
 await poll(async()=>{const a=await audit();return a.scoped.candidates.some(x=>x.state==='suppressed')?a:null;});
 check((await audit()).scoped.notices.length===1,'Revogação gerou entrega indevida.');
 check(expect(await ctx.api('allowed',inbox),200).items.length===0,'Conteúdo revogado ainda visível.');
 expect(await ctx.api('allowed',inbox,{method:'PATCH',json:{id:noticeId,action:'dismiss',version:allowed.items[0].version}}),404);
 ctx.record('CC07-ACL','PASS',{revokedHidden:true,nextEventSuppressed:true});
 return {syntheticTicketId:ticketId,channel:'in_app',coverage:'API_AND_SCHEDULED_WORKER',retryFaultInjection:'LOCAL_ONLY'};
}
