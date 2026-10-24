// Optional, immutable Worker binding for the protected CC07 test only.
// Production rollout is a separate decision; no default target or allowance.
export function notificationAcceptancePolicy(env, now=Date.now()) {
  const raw=env.MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON;
  if(!raw)return null;
  const invalid=()=>{throw Object.assign(new Error('Invalid notification acceptance policy'),{code:'CC07_WORKER_POLICY_INVALID'});};
  let p;try{p=JSON.parse(raw);}catch{invalid();}
  const keys=['runId','organizationId','managerId','startAt','endAt','maxEvents','maxAttempts','batchSize'];
  if(!p||Object.keys(p).length!==keys.length||keys.some(k=>!Object.hasOwn(p,k)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.runId||''))invalid();
  for(const k of ['organizationId','managerId','maxEvents','maxAttempts','batchSize'])if(!Number.isSafeInteger(p[k])||p[k]<1)invalid();
  if(p.organizationId===9 || p.maxEvents>25 || p.maxAttempts>125 || p.batchSize>25 || p.batchSize>p.maxEvents)invalid();
  for(const k of ['startAt','endAt'])if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p[k]||'')||!Number.isFinite(Date.parse(p[k]))||new Date(p[k]).toISOString()!==p[k])invalid();
  if(Date.parse(p.endAt)<=Date.parse(p.startAt)||Date.parse(p.endAt)-Date.parse(p.startAt)>210*60000 ||
    String(env.MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS)!==String(p.organizationId)||env.MAONO_TICKET_NOTIFICATION_START_AT!==p.startAt)invalid();
  return {...p,subject:`QA-CC07-${p.runId}`,active:now>=Date.parse(p.startAt)&&now<Date.parse(p.endAt)};
}

export function notificationAcceptanceScope(policy) {
  if(!policy)return {sql:'1=1',values:[]};
  return {sql:`ticket_id IN (SELECT id FROM organization_tickets WHERE organization_id=? AND subject=? AND created_by=? AND created_at>=?)`,
    values:[policy.organizationId,policy.subject,policy.managerId,policy.startAt]};
}
