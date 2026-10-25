import {createHash} from 'node:crypto';
import {cfRequest,CF_ACCOUNT_ID,PRODUCTION_D1_ID,fail} from './production-acceptance-lib.mjs';
import {summarizeCc07Worker} from './cc07-observations.mjs';
export const CC07_WORKER='maono-ticket-notifications';
const workerPath=`/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${CC07_WORKER}`;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export const cc07Digest=v=>createHash('sha256').update(JSON.stringify(stable(v??null))).digest('hex');
const check=(ok,code)=>{if(!ok)fail(code,'Estado CC07 não corresponde ao plano revisado.');};
const bindings=v=>v?.resources?.bindings;
function checkVersion(v,id,enabled,plan){
 check(v?.id===id && v.resources?.script?.etag===plan.worker.codeEtag,'CC07_WORKER_CODE_DRIFT');
 check(JSON.stringify(v.resources?.script?.handlers)==='["scheduled"]','CC07_WORKER_HANDLERS_INVALID');
 check(!v.resources.script.named_handlers?.length,'CC07_WORKER_HANDLERS_INVALID');
 check(v.resources.script_runtime&&typeof v.resources.script_runtime==='object'&&!Array.isArray(v.resources.script_runtime)&&/^\d{4}-\d\d-\d\d$/.test(v.resources.script_runtime.compatibility_date||''),'CC07_WORKER_RUNTIME_INVALID');
 const entries=bindings(v);check(Array.isArray(entries)&&new Set(entries.map(x=>x.name)).size===entries.length,'CC07_WORKER_BINDINGS_INVALID');
 const expected={MAONO_RUNTIME_ENV:'production',MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:'true',MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:String(enabled),
  MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:String(plan.organizationId),MAONO_TICKET_NOTIFICATION_START_AT:plan.policy.startAt,MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON:JSON.stringify(plan.policy)};
 check(entries.length===Object.keys(expected).length+1,'CC07_WORKER_BINDINGS_INVALID');
 check(entries.some(x=>x.name==='DB'&&x.type==='d1'&&x.id===PRODUCTION_D1_ID),'CC07_WORKER_D1_INVALID');
 for(const [name,text]of Object.entries(expected))check(entries.some(x=>x.name===name&&x.type==='plain_text'&&x.text===text),'CC07_WORKER_BINDINGS_INVALID');
}
export function validateCc07Worker(snapshot,plan,{active=false}={}){
 checkVersion(snapshot.off,plan.worker.offVersion,false,plan);checkVersion(snapshot.on,plan.worker.onVersion,true,plan);
 check(cc07Digest(snapshot.off.resources.script_runtime)===cc07Digest(snapshot.on.resources.script_runtime),'CC07_WORKER_RUNTIME_DRIFT');
 const current=snapshot.deployments?.deployments?.[0];
 check(current?.versions?.length===1&&current.versions[0].percentage===100&&current.versions[0].version_id===(active?plan.worker.onVersion:plan.worker.offVersion),'CC07_WORKER_DEPLOYMENT_DRIFT');
 const schedules=snapshot.schedules?.schedules;
 check(Array.isArray(schedules)&&JSON.stringify(schedules.map(s=>s.cron).sort())===JSON.stringify(active?[plan.worker.cron]:[]),'CC07_WORKER_SCHEDULE_DRIFT');
 return current.id;
}
export function cc07Infrastructure(workerToken,readToken,plan,deps={}){
 const api=(path,options={})=>cfRequest(workerToken,workerPath+path,{...deps,...options});
 const readWorker=async()=>{
  const [off,on,deployments,schedules]=await Promise.all([api(`/versions/${plan.worker.offVersion}`),api(`/versions/${plan.worker.onVersion}`),api('/deployments'),api('/schedules')]);return {off,on,deployments,schedules};
 };
 const select=async(sql,params=[])=>{
  check(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'CC07_SQL_NOT_READONLY');
  const result=await cfRequest(readToken,`/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${PRODUCTION_D1_ID}/query`,{...deps,method:'POST',body:{sql,params:params.map(String)}});
  check(Array.isArray(result)&&result.length===1&&result[0].success===true&&result[0].meta?.changed_db===false,'CC07_SQL_READ_UNCONFIRMED');
  return result[0].results;
 };
 // Fixed, structural rows only. Never return subjects, content, emails or tokens.
 const audit=async()=>{
  const startedAt=new Date((deps.now||Date.now)()).toISOString();
  const schema=await select("SELECT name FROM pragma_table_info('ticket_notifications') WHERE name IN ('dismissed_at','version','action_token') ORDER BY name");
  check(schema.length===3,'CC07_RECIPIENT_SCHEMA_REQUIRED');
  const organizations=await select('SELECT id FROM organizations WHERE active=1 ORDER BY id');
  check(organizations.some(x=>x.id===plan.organizationId),'CC07_ORGANIZATION_INACTIVE');
  const outbox=await select('SELECT id,organization_id,ticket_id,event_id,event_type,status,created_at,notification_attempts,notification_next_at,notification_lease_until,notification_error,notification_completed_at FROM ticket_command_outbox ORDER BY id');
  const candidates=await select('SELECT c.outbox_id,c.recipient_id,c.state,o.organization_id FROM ticket_notification_candidates c JOIN ticket_command_outbox o ON o.id=c.outbox_id ORDER BY c.outbox_id,c.recipient_id');
  const notices=await select('SELECT id,outbox_id,organization_id,ticket_id,event_id,recipient_id,channel,audience,created_at,read_at,dismissed_at,version FROM ticket_notifications ORDER BY id');
  const tickets=await select('SELECT id,organization_id,created_by,status,visibility,version,active,created_at FROM organization_tickets WHERE organization_id=? ORDER BY id',[plan.organizationId]);
  const counts=await select('SELECT (SELECT COUNT(*) FROM ticket_command_outbox) AS outbox,(SELECT COUNT(*) FROM ticket_notification_candidates) AS candidates,(SELECT COUNT(*) FROM ticket_notifications) AS notices,(SELECT COUNT(*) FROM organization_tickets WHERE organization_id=?) AS tickets',[plan.organizationId]);
  check(counts.length===1&&['outbox','candidates','notices','tickets'].every(k=>counts[0][k]===({outbox,candidates,notices,tickets})[k].length),'CC07_INVENTORY_TRUNCATED_OR_CHANGED');
  const legacyTables=await select("SELECT name FROM sqlite_master WHERE type='table' AND name='tickets'");
  if(legacyTables.length){const legacy=await select('SELECT COUNT(*) AS total FROM tickets WHERE organization_id=?',[plan.organizationId]);check(legacy[0]?.total===0,'CC07_TARGET_LEGACY_PRESENT');}
  const markers=await select("SELECT organization_id FROM ticket_command_backfills WHERE organization_id=? AND status='ready' AND schema_version=1 AND pending_count=0 AND skipped_count=0",[plan.organizationId]);
  check(markers.length===1,'CC07_COMMAND_MARKER_INVALID');
  const own=rows=>rows.filter(x=>x.organization_id===plan.organizationId),outside=rows=>rows.filter(x=>x.organization_id!==plan.organizationId);
  const qa9=outbox.filter(x=>x.organization_id===9);
  check(qa9.length===13&&cc07Digest({outbox:qa9,candidates:candidates.filter(x=>x.organization_id===9),notices:notices.filter(x=>x.organization_id===9)})===plan.qa9.digest,'CC07_QA9_PRESERVATION_FAILED');
  return {startedAt,completedAt:new Date((deps.now||Date.now)()).toISOString(),outsideDigest:cc07Digest({outbox:outside(outbox),candidates:outside(candidates),notices:outside(notices)}),qa9Digest:plan.qa9.digest,
   scoped:{outbox:own(outbox),candidates:own(candidates),notices:own(notices),tickets},organizationIds:organizations.map(x=>x.id)};
 };
 const deploy=async(version)=>api('/deployments',{method:'POST',body:{strategy:'percentage',versions:[{version_id:version,percentage:100}]}});
 const schedules=async(enabled)=>api('/schedules',{method:'PUT',body:enabled?[{cron:plan.worker.cron}]:[]});
 // No retries after uncertain writes. Read actual state before any new intent.
 const setActive=async(active)=>{
  const snapshot=await readWorker();checkVersion(snapshot.off,plan.worker.offVersion,false,plan);checkVersion(snapshot.on,plan.worker.onVersion,true,plan);
  check(cc07Digest(snapshot.off.resources.script_runtime)===cc07Digest(snapshot.on.resources.script_runtime),'CC07_WORKER_RUNTIME_DRIFT');
  const versions=snapshot.deployments?.deployments?.[0]?.versions;
  check(versions?.length===1&&versions[0].percentage===100&&[plan.worker.offVersion,plan.worker.onVersion].includes(versions[0].version_id),'CC07_WORKER_CONCURRENT_CHANGE');
  const observed=snapshot.schedules?.schedules;check(Array.isArray(observed)&&observed.length<=1&&observed.every(x=>x.cron===plan.worker.cron),'CC07_WORKER_CONCURRENT_CHANGE');
  if(!active && observed.length)await schedules(false); // stop scheduling before restoring OFF version
  if(versions[0].version_id!==(active?plan.worker.onVersion:plan.worker.offVersion))await deploy(active?plan.worker.onVersion:plan.worker.offVersion);
  if(active&&!observed.length)await schedules(true);
  const final=await readWorker();validateCc07Worker(final,plan,{active});
  return summarizeCc07Worker(final,{active,observedAt:new Date((deps.now||Date.now)()).toISOString()});
 };
 return {readWorker,audit,setActive};
}
