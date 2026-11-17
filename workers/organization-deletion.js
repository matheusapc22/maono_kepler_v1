import {automaticDeletionEnabled, automaticDeletionBlocked, deletionEnabled, stepDeletion} from '../functions/_lib/organization-permanent-deletion.js';
import {check} from '../functions/_lib/organization-management-contract.js';
import {requirePermission} from '../functions/_lib/permissions.js';

// Re-read the original author before each destructive boundary. Browser sessions
// are not kept alive or impersonated; the original explicit request is durable.
export async function authorizeDeletionActor(env, actorId, organizationId=null) {
  const user=await env.DB.prepare('SELECT id,role,active FROM users WHERE id=?').bind(actorId).first();
  check(user&&Number(user.active)===1&&user.role==='super_admin','Autor da exclusão não possui mais acesso.',403,'ORGANIZATION_DELETE_ACTOR_REVOKED');
  return requirePermission(env,null,'admin.panel.access',organizationId===null?{scopeType:'global'}:{scopeType:'organization',organizationId}, {user,audit:false,auditOnSuccess:false});
}

export async function runScheduledOrganizationDeletion(env,{step=stepDeletion,authorize=authorizeDeletionActor}={}) {
  if(!automaticDeletionEnabled(env)||!await deletionEnabled(env))return {executed:false,reason:'FEATURE_DISABLED'};
  // No retroactive adoption: only new, atomically enrolled requests are eligible.
  // Existing D1 leases fence concurrent ticks/manual recovery. Conservative retry
  // budget; only explicit provider failures retry, all other failures stop.
  const rows=(await env.DB.prepare(`SELECT d.* FROM organization_deletions d
    WHERE d.state<>'completed' AND d.attempts<3
      AND EXISTS(SELECT 1 FROM organization_deletion_audit a WHERE a.deletion_id=d.id AND a.event_type='automatic_requested')
      AND (d.error_code IS NULL OR d.error_code='ORGANIZATION_DELETE_PROVIDER_FAILED')
      AND julianday(d.not_before)<=julianday('now')
      AND (d.lease_token IS NULL OR julianday(d.lease_until)<julianday('now'))
      AND (d.attempts=0 OR julianday(d.updated_at)<=julianday('now','-2 minutes'))
    ORDER BY d.created_at,d.id LIMIT 3`).all()).results||[];
  const results=[];
  for(const row of rows) {
    if(automaticDeletionBlocked(row))continue;
    try {
      const auth=await authorize(env,row.actor_id);
      const result=await step(env,auth.user,row.id,{
        automatic:true,
        authorizeGlobal:()=>authorize(env,row.actor_id),
        authorizeOrganization:id=>authorize(env,row.actor_id,id),
      });
      results.push({id:row.id,state:result.deletion.state,errorCode:result.deletion.errorCode});
    } catch(error) {
      // Failure before the core lease (e.g. revoked author). Never clear another
      // executor's lease, and never expose provider payloads in logs or status.
      const code=error?.code==='ORGANIZATION_DELETE_ACTOR_REVOKED'?error.code:'ORGANIZATION_DELETE_AUTOMATIC_BLOCKED';
      await env.DB.prepare(`UPDATE organization_deletions SET error_code=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND state<>'completed' AND (lease_token IS NULL OR julianday(lease_until)<julianday('now'))`).bind(code,row.id).run();
      results.push({id:row.id,errorCode:code});
    }
  }
  console.info('[Maono organization deletion]', {checked:rows.length,results});
  return {executed:true,checked:rows.length,results};
}
export default {scheduled(_controller,env,ctx){ctx.waitUntil(runScheduledOrganizationDeletion(env));}};
