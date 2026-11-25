import { can } from './permissions.js';
import { check, integer, text } from './organization-management-contract.js';
import * as management from './organization-management-service.js';
import * as deletion from './organization-permanent-deletion.js';
import { requireOperationAuditReady, operationAuditIdentity, auditFrameStatement, operationOrganization, organizationAction } from './operation-audit.js';

const one=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).first();
const all=async(env,sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results||[];
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const stableStorage=row=>['READY','ACTIVE','CONFIGURED'].includes(row?.storage_status);
const knownNoEffect=new Set(['ORGANIZATION_VERSION_CONFLICT','REQUEST_VERSION_CONFLICT','ORGANIZATION_OWNER_INELIGIBLE','ORGANIZATION_LIMIT_BELOW_USAGE','PROJECT_QUOTA_REQUIRED','ORGANIZATION_NAME_EXISTS','ORGANIZATION_EXISTS','REQUEST_TYPE_NOT_SUPPORTED']);

async function actorAccess(env,actor,organizationId) {
  const current=await one(env,'SELECT id,name,role,active FROM users WHERE id=?',actor?.id??null);
  if(!current||Number(current.active)!==1||current.role!=='super_admin')return false;
  const global=await can(env,current,'admin.panel.access',{scopeType:'global'});
  if(!global.allowed)return false;
  if(organizationId){const scoped=await can(env,current,'admin.panel.access',{scopeType:'organization',organizationId});if(!scoped.allowed)return false;}
  return true;
}
async function target(env,frame) {
  const id=frame.operation_id;
  if(!id)return null;
  const deleted=await one(env,'SELECT * FROM organization_deletions WHERE id=?',id);
  if(deleted)return {type:'deletion',operation:deleted,organization:await one(env,'SELECT * FROM organizations WHERE id=?',deleted.organization_id)};
  const operation=await one(env,'SELECT * FROM organization_management_operations WHERE id=?',id);
  if(!operation)return null;
  const item=await one(env,'SELECT * FROM organization_management_operation_items WHERE operation_id=? AND item_index=?',id,frame.item_index??0);
  if(!item)return null;
  const input=parse(operation.payload_json)?.[item.item_index];
  const requestRecord=operation.kind==='review'?await one(env,'SELECT id,organization_id,management_version,status FROM organization_limit_requests WHERE id=?',input?.id??null):null;
  const org=await operationOrganization(env,operation.kind,input,`${id}:${item.item_index}`);
  const organization=org?await one(env,'SELECT * FROM organizations WHERE id=?',org.id):null;
  const reconciled=await one(env,'SELECT * FROM organization_operation_reconciliations WHERE operation_id=? AND item_index=? AND observed_attempts=?',id,item.item_index,item.attempts);
  return {type:'management',operation,item,input,organization,requestRecord,reconciled};
}
function versionsMatch(t) {
  if(t.operation.kind==='create')return true;
  if(t.operation.kind==='review')return Number(t.input?.organizationVersion)===Number(t.organization?.management_version)&&Number(t.input?.version)===Number(t.requestRecord?.management_version);
  return Number(t.input?.version)===Number(t.organization?.management_version);
}
function baseAction(t,kind,enabled=true,reason=null) {
  return {kind,enabled,reason,operationId:t.operation.id,organizationId:t.organization?.id??t.operation.organization_id??null,
    ...(t.type==='deletion'?{deletionId:t.operation.id,expectedVersion:t.operation.requested_version,confirmationRequired:['retry','resume'].includes(kind)}:{itemIndex:t.item.item_index,expectedVersion:t.organization?.management_version??null})};
}
async function reconciliationEvidence(env,t) {
  if(t.type!=='management'||!t.organization||!['failed','partial','running'].includes(t.item.state))return null;
  if(t.item.lease_token && Date.parse(t.item.lease_until)>Date.now())return null;
  const key=`${t.operation.id}:${t.item.item_index}`;
  const events=await all(env,"SELECT id,request_id,action FROM organization_management_events WHERE organization_id=? AND (request_id=? OR request_id=? OR request_id=?) ORDER BY id",t.organization.id,key,`${key}:lifecycle`,`${key}:configured`);
  if(events.length) {
    const creation=t.operation.kind==='create';
    const storageRelevant=creation||t.input?.active===true;
    if(creation&&!events.some(event=>event.request_id===`${key}:configured`))return null;
    if(storageRelevant&&(t.organization.active!==1||!stableStorage(t.organization)))return null;
    return {disposition:'confirmed_effect',confirmedEventIds:events.map(event=>event.id)};
  }
  if(t.item.state==='failed'&&knownNoEffect.has(t.item.error_code)&&t.operation.kind!=='create')
    return {disposition:'confirmed_no_effect',confirmedEventIds:[],confirmedNoEffect:true};
  return null;
}

/** Availability is recalculated from domain state and current permissions.
 * A historical event or publicDeletion.retryable is never execution authority. */
export async function getAuditRecoveryActions(env,actor,frame) {
  await requireOperationAuditReady(env);
  const t=await target(env,frame);
  if(!t)return [{kind:'review',enabled:false,reason:'Este registro não possui um comando recuperável comprovado.'}];
  if(!await actorAccess(env,actor,t.organization?.id))return [baseAction(t,'review',false,'Seu acesso atual não permite operar este recurso.')];
  return recoveryActions(env,actor,t);
}
async function recoveryActions(env,actor,t) {
  if(Number(t.operation.actor_id)!==Number(actor.id))return [baseAction(t,'review',false,'Nesta etapa, somente o autor original pode retomar a operação. O histórico permanece consultável.')];
  if(t.type==='deletion') {
    const d=t.operation;
    if(d.state==='completed')return [];
    if((d.lease_token&&Date.parse(d.lease_until)>Date.now())||Date.now()<Date.parse(d.not_before))return [baseAction(t,'follow')];
    if(!d.error_code)return [baseAction(t,'query'),baseAction(t,'resume')];
    const inspected=await one(env,"SELECT * FROM audit_operation_frames WHERE operation_id=? AND event_type='recovery_inspected' ORDER BY id DESC LIMIT 1",d.id);
    const observation=parse(inspected?.details_json);
    if(inspected&&!inspected.code&&['storage_present_verified','storage_absent_verified'].includes(observation?.checkpoint)&&observation.attempt===d.attempts&&observation.expectedVersion===d.requested_version&&Date.now()-Date.parse(inspected.occurred_at)<300000)
      return [baseAction(t,'query'),baseAction(t,'resume')];
    // Interrupted/unknown outcomes are consulted. Structural or authorization
    // blockers cannot be made retryable by a broad unfinished-operation flag.
    return [baseAction(t,'query'),baseAction(t,'resolve',true,'Revise o impedimento antes de continuar a mesma exclusão.')];
  }
  if(t.operation.kind==='import')return [baseAction(t,'review',false,'A importação foi descontinuada; este registro é somente histórico.')];
  if(!t.input)return [baseAction(t,'review',false,'O comando original está incompleto e requer revisão administrativa.')];
  if(t.reconciled||t.item.state==='succeeded')return [];
  if(t.operation.kind==='create'&&t.organization) {
    const owner=await one(env,'SELECT id,active FROM users WHERE lower(email)=?',t.input.ownerEmail);
    if(!owner||Number(owner.active)!==1)return [baseAction(t,'query'),baseAction(t,'review',false,'O responsável precisa estar ativo antes de retomar a preparação.')];
    const configured=await one(env,"SELECT after_json FROM organization_management_events WHERE organization_id=? AND request_id=? AND action='organization.configured'",t.organization.id,`${t.operation.id}:${t.item.item_index}:configured`);
    const snapshot=parse(configured?.after_json);
    if(configured && (snapshot?.ownerId!==t.organization.management_owner_id||t.organization.management_owner_id!==owner.id||t.organization.plan!==t.input.plan) || !configured&&t.organization.management_version!==0)
      return [baseAction(t,'query'),baseAction(t,'review',false,'A configuração da organização mudou. Revise os dados no formulário antes de iniciar um novo comando.')];
  }
  if(t.item.state==='running') {
    if(t.item.lease_token&&Date.parse(t.item.lease_until)>Date.now())return [baseAction(t,'follow')];
    const inspected=await one(env,"SELECT * FROM audit_operation_frames WHERE operation_id=? AND item_index=? AND event_type='recovery_inspected' ORDER BY id DESC LIMIT 1",t.operation.id,t.item.item_index);
    const observation=parse(inspected?.details_json);
    const ready=observation?.checkpoint==='management_idempotency_checked'&&observation.attempt===t.item.attempts&&observation.expectedVersion===(t.organization?.management_version??null)&&Date.now()-Date.parse(inspected.occurred_at)<300000;
    return [baseAction(t,'query'),...(ready?[baseAction(t,'resume')]:[])];
  }
  if(t.item.state==='pending')return [baseAction(t,'query'),baseAction(t,'resume')];
  const evidence=await reconciliationEvidence(env,t);
  if(evidence)return [baseAction(t,'query',true,'Consultar e registrar os efeitos comprovados, preservando a tentativa original.')];
  if(t.item.state==='partial'&&t.input.active===true&&t.organization?.active===1&&t.item.error_code==='STORAGE_UNCONFIRMED')return [baseAction(t,'query'),baseAction(t,'resume')];
  if(t.item.retryable===1) {
    const finished=await one(env,"SELECT outcome FROM audit_operation_frames WHERE operation_id=? AND item_index=? AND event_type='attempt_finished' ORDER BY id DESC LIMIT 1",t.operation.id,t.item.item_index);
    if(t.item.state==='failed'&&(!finished||finished.outcome==='unknown')) {
      const inspected=await one(env,"SELECT * FROM audit_operation_frames WHERE operation_id=? AND item_index=? AND event_type='recovery_inspected' ORDER BY id DESC LIMIT 1",t.operation.id,t.item.item_index);
      const observation=parse(inspected?.details_json);
      if(observation?.checkpoint!=='management_idempotency_checked'||observation.attempt!==t.item.attempts||observation.expectedVersion!==(t.organization?.management_version??null)||Date.now()-Date.parse(inspected.occurred_at)>=300000)return [baseAction(t,'query')];
    }
    if(!versionsMatch(t))return [baseAction(t,'query'),baseAction(t,'review',false,'A versão mudou. Revise os dados no formulário antes de criar um novo comando.')];
    return [baseAction(t,'query'),baseAction(t,t.item.state==='partial'?'resume':'retry')];
  }
  return [baseAction(t,'query'),baseAction(t,'review',false,'O resultado precisa ser comprovado; não há repetição segura disponível.')];
}

async function reconcile(env,actor,t,request) {
  const evidence=await reconciliationEvidence(env,t);
  if(!evidence) {
    if((t.item.state==='running'||t.item.state==='failed'&&t.item.retryable===1)&&(!t.item.lease_token||Date.parse(t.item.lease_until)<=Date.now())) {
      const key=`${t.operation.id}:${t.item.item_index}`;
      const effects=await all(env,'SELECT id FROM organization_management_events WHERE organization_id=? AND (request_id=? OR request_id=? OR request_id=?)',t.organization?.id??null,key,`${key}:lifecycle`,`${key}:configured`);
      const safe=effects.length>0||versionsMatch(t);
      const context=await operationAuditIdentity(env,actor,t.operation.id,request,{originalActorId:t.operation.actor_id,origin:'domain:organization-audit-recovery'});
      await env.DB.batch([auditFrameStatement(env,{source:'organization_operation_inspection',sourceEventId:crypto.randomUUID(),operationId:t.operation.id,itemIndex:t.item.item_index,
        eventType:'recovery_inspected',outcome:safe?'unknown':'blocked',context,organization:t.organization||{},action:organizationAction(t.operation.kind),version:t.organization?.management_version,
        details:{checkpoint:safe?'management_idempotency_checked':'version_review_required',attempt:t.item.attempts,expectedVersion:t.organization?.management_version??null,confirmedEventIds:effects.map(event=>event.id)}})]);
    }
    return {reconciled:false,operation:await management.operation(env,actor,t.operation.id)};
  }
  const context=await operationAuditIdentity(env,actor,t.operation.id,request,{originalActorId:t.operation.actor_id,origin:'domain:organization-audit-recovery'});
  const current=env.DB.prepare(`INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN EXISTS(
    SELECT 1 FROM organization_management_operation_items i JOIN organizations o ON o.id=?
    WHERE i.operation_id=? AND i.item_index=? AND i.state=? AND i.attempts=? AND o.management_version=?
      AND o.storage_status IS ? AND o.active IS ? AND o.dropbox_root_path IS ? AND o.management_create_key IS ?
      AND (i.lease_token IS NULL OR julianday(i.lease_until)<=julianday('now')))
    THEN 1 ELSE 0 END`).bind(t.organization.id,t.operation.id,t.item.item_index,t.item.state,t.item.attempts,t.organization.management_version,
      t.organization.storage_status,t.organization.active,t.organization.dropbox_root_path,t.organization.management_create_key);
  const key=`${t.operation.id}:${t.item.item_index}`;
  const proof=evidence.confirmedEventIds.length
    ? env.DB.prepare(`INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN (SELECT COUNT(*) FROM organization_management_events WHERE organization_id=? AND id IN (${evidence.confirmedEventIds.map(()=>'?').join(',')}))=? THEN 1 ELSE 0 END`).bind(t.organization.id,...evidence.confirmedEventIds,evidence.confirmedEventIds.length)
    : env.DB.prepare('INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM organization_management_events WHERE organization_id=? AND (request_id=? OR request_id=? OR request_id=?)) THEN 1 ELSE 0 END').bind(t.organization.id,key,`${key}:lifecycle`,`${key}:configured`);
  await env.DB.batch([current,proof,
    env.DB.prepare(`INSERT INTO organization_operation_reconciliations(operation_id,item_index,observed_attempts,organization_id,observed_version,actor_id,disposition,evidence_json)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(operation_id,item_index,observed_attempts) DO NOTHING`).bind(t.operation.id,t.item.item_index,t.item.attempts,t.organization.id,t.organization.management_version,actor.id,evidence.disposition,JSON.stringify(evidence)),
    auditFrameStatement(env,{source:'organization_reconciliation',sourceEventId:`${t.operation.id}:${t.item.item_index}:${t.item.attempts}`,operationId:t.operation.id,itemIndex:t.item.item_index,
      attemptId:t.item.lease_token,eventType:'reconciled',outcome:evidence.disposition==='confirmed_no_effect'?'no_change':'succeeded',context,organization:t.organization,
      action:organizationAction(t.operation.kind),version:t.organization.management_version,
      details:{...evidence,reconciled:true,effectOnly:true}}),
    ...(t.item.state==='running'&&evidence.disposition==='confirmed_effect'?[env.DB.prepare("UPDATE organization_management_operation_items SET state='succeeded',retryable=0,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE operation_id=? AND item_index=? AND attempts=? AND state='running'").bind(t.operation.id,t.item.item_index,t.item.attempts)]:[])]);
  return {reconciled:true,disposition:evidence.disposition,operation:await management.operation(env,actor,t.operation.id)};
}

/** Execute only catalogued domain commands, never URLs/SQL/payloads from a log. */
export async function runAuditRecoveryAction(env,actor,frame,command,request,deps={}) {
  await requireOperationAuditReady(env);
  check(['query','follow','retry','resume','resolve'].includes(command?.action),'Ação de recuperação inválida.',400,'AUDIT_RECOVERY_ACTION_INVALID');
  const t=await target(env,frame);
  check(t&&Number(t.operation.actor_id)===Number(actor.id),'Somente o autor original pode retomar.',403,'AUDIT_RECOVERY_ACTOR_MISMATCH');
  check(await actorAccess(env,actor,t.organization?.id),'Acesso atual insuficiente.',403,'AUTH_PERMISSION_DENIED');
  // Replayed commands return the current result after authentication even when
  // the first attempt has already succeeded and no new action is available.
  const mutating=['retry','resume'].includes(command.action);
  const key=mutating?text(command.requestKey||'','Chave de recuperação',16,160):null;
  const sourceId=mutating?`${actor.id}:${key}`:null;
  const previous=mutating?await one(env,"SELECT operation_id,item_index,details_json FROM audit_operation_frames WHERE source='audit_recovery_request' AND source_event_id=?",sourceId):null;
  if(previous) {
    const recorded=parse(previous.details_json);
    check(previous.operation_id===t.operation.id && previous.item_index===(t.item?.item_index??null) && recorded?.reason===command.action && recorded.expectedVersion===(command.expectedVersion??null),
      'Chave usada para outra recuperação.',409,'ORGANIZATION_IDEMPOTENCY_CONFLICT');
    return t.type==='deletion'?deletion.deletionStatus(env,actor,t.operation.id):{operation:await management.operation(env,actor,t.operation.id)};
  }
  const actions=await recoveryActions(env,actor,t);
  const allowed=actions.find(action=>action.kind===command.action&&action.enabled);
  check(allowed,'A recuperação não está disponível nas condições atuais.',409,'AUDIT_RECOVERY_UNAVAILABLE');
  if(command.action==='resolve')return {preview:await deletion.deletionPreview(env,t.organization?.id??t.operation.organization_id,actor)};
  if(command.action==='follow')return t.type==='deletion'?deletion.deletionStatus(env,actor,t.operation.id):{operation:await management.operation(env,actor,t.operation.id)};
  if(command.action==='query')return t.type==='management'?reconcile(env,actor,t,request):deletion.inspectDeletionRecovery(env,actor,t.operation.id,{...deps,request});
  check(typeof deps.authorizeGlobal==='function'&&typeof deps.authorizeOrganization==='function','Executor de recuperação indisponível.',503,'AUDIT_RECOVERY_EXECUTOR_UNAVAILABLE');
  await deps.authorizeGlobal();
  if(t.organization)await deps.authorizeOrganization(t.organization.id);
  const expected=allowed.expectedVersion;
  check(expected===null||integer(command.expectedVersion,'Versão',0)===expected,'A versão mudou. Atualize o relatório antes de retomar.',412,'ORGANIZATION_VERSION_CONFLICT');
  if(t.type==='deletion')check(command.confirmation===deletion.DELETION_CONFIRMATION,'Confirme novamente a exclusão permanente.',400,'ORGANIZATION_DELETE_CONFIRMATION_REQUIRED');
  const requestToken=crypto.randomUUID(),context=await operationAuditIdentity(env,actor,t.operation.id,request,{originalActorId:t.operation.actor_id,origin:'domain:organization-audit-recovery'});
  await env.DB.batch([auditFrameStatement(env,{source:'audit_recovery_request',sourceEventId:sourceId,operationId:t.operation.id,itemIndex:t.item?.item_index,
    attemptId:requestToken,eventType:'recovery_requested',outcome:'requested',context,organization:t.organization||{id:t.operation.organization_id,name:t.operation.name,slug:t.operation.slug},
    action:t.type==='deletion'?'organization.permanent_delete':organizationAction(t.operation.kind),version:expected,
    details:{reason:command.action,expectedVersion:expected,attempt:t.item?.attempts??t.operation.attempts}})]);
  const owner=await one(env,"SELECT attempt_id FROM audit_operation_frames WHERE source='audit_recovery_request' AND source_event_id=?",sourceId);
  if(owner?.attempt_id!==requestToken)return t.type==='deletion'?deletion.deletionStatus(env,actor,t.operation.id):{operation:await management.operation(env,actor,t.operation.id)};
  if(t.type==='deletion')return deletion.stepDeletion(env,actor,t.operation.id,{...deps,request});
  return {operation:await management.stepOperation(env,actor,t.operation.id,true,{...deps,request,auditItemIndex:t.item.item_index,
    recoverStorage:['partial','running'].includes(t.item.state)&&t.input.active===true&&t.organization?.active===1&&!stableStorage(t.organization)})};
}

export async function consultOrganizationOperation(env,actor,operationId,itemIndex=0,request,deps={}) {
  await requireOperationAuditReady(env);
  const frame={operation_id:text(operationId,'Operação',1,80),item_index:integer(itemIndex,'Item',0)};
  const t=await target(env,frame);
  check(t?.type==='management'&&Number(t.operation.actor_id)===Number(actor.id),'Operação não encontrada.',404,'ORGANIZATION_OPERATION_NOT_FOUND');
  check(await actorAccess(env,actor,t.organization?.id),'Acesso atual insuficiente.',403,'AUTH_PERMISSION_DENIED');
  const context=await operationAuditIdentity(env,actor,t.operation.id,request,{originalActorId:t.operation.actor_id,origin:'domain:organization-audit-recovery'});
  const sourceEventId=crypto.randomUUID();
  await env.DB.batch([auditFrameStatement(env,{source:'organization_operation_consultation',sourceEventId,operationId:t.operation.id,itemIndex:t.item.item_index,
    eventType:'state_observed',outcome:t.item.state==='pending'?'requested':t.item.state==='running'?'running':'unknown',context,organization:t.organization||{},
    action:organizationAction(t.operation.kind),version:t.organization?.management_version,
    details:{state:t.item.state,attempt:t.item.attempts,operationKind:t.operation.kind}})]);
  const result=await reconcile(env,actor,t,request,deps);
  const latest=await one(env,'SELECT id FROM audit_operation_frames WHERE operation_id=? AND item_index=? ORDER BY id DESC LIMIT 1',t.operation.id,t.item.item_index);
  return {...result,auditEventId:`frame:${latest.id}`};
}
