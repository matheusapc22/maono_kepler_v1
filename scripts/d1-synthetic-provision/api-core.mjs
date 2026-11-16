// Fixed provisioning implementation; invoke ONLY from separately approved protected CLI.
// No arbitrary URL/name/SQL, retries, deletion, rollback or secret installation.
import {buildFixedCreateD1Request,buildFixedWorkerUploadFromReceipt,buildFixedDisablePublicEndpointsRequest,SCAFFOLD_SHA256} from './fixed-core.mjs';
const ACCOUNT='1988481e4c75c760516161104b7e1e50',DATABASE='maono_synthetic_rehearsal_pilot_20261116',WORKER='maono-synthetic-rehearsal-pilot-20261116';
const BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT,SCRIPT=BASE+'/workers/scripts/'+WORKER;
const expected={schemaVersion:1,enabled:true,planId:'maono-free-synthetic-pilot-20261116',accountId:ACCOUNT,databaseName:DATABASE,workerName:WORKER,registryClassName:'SyntheticClaimRegistry',maxWorkers:1,maxDatabases:1,maxNamespaces:1,maxLifetimeHours:24,spendingLimitUSD:0,freeOnly:true,allowSubscriptionChange:false,allowDelete:false,allowSql:false,allowTransientDenyAllEndpoint:true,manualOwnerApprovalRequired:true,productionAllowed:false};
const safeObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function deny(){throw Error('FIXED_PROVISION_DENIED');}
function validatePlan(p){if(!safeObject(p)||Object.keys(p).length!==Object.keys(expected).length||Object.entries(expected).some(([k,v])=>p[k]!==v))deny();}
function validateObservation(o,now){
 const fields=['accountId','plan','monthlyBaseUSD','observedAtMs','source','operatorObservationOnly'];
 if(!safeObject(o)||Object.keys(o).length!==fields.length||!fields.every(k=>Object.hasOwn(o,k))||o.accountId!==ACCOUNT||o.plan!=='free'||o.monthlyBaseUSD!==0||o.source!=='cloudflare-dashboard'||o.operatorObservationOnly!==true||!Number.isSafeInteger(o.observedAtMs)||o.observedAtMs<0||o.observedAtMs>now||now-o.observedAtMs>3600000)deny();
}
async function api(request,{token,fetchImpl,timeoutMs}){
 if(![BASE+'/d1/database',BASE+'/workers/scripts',BASE+'/workers/durable_objects/namespaces',SCRIPT,SCRIPT+'/subdomain',SCRIPT+'/settings'].includes(request.url)||!['GET','POST','PUT'].includes(request.method))deny();
 const controller=new AbortController();let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('FIXED_PROVISION_DENIED'));},timeoutMs);});
 try{return await Promise.race([timeout,(async()=>{
  const r=await fetchImpl(request.url,{...request,headers:{...request.headers,Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',credentials:'omit',signal:controller.signal});
  if(!r||![200,201].includes(r.status)||r.redirected||(r.url&&r.url!==request.url)||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||'')||!r.body)deny();
  const reader=r.body.getReader(),chunks=[];let total=0;const abort=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',abort,{once:true});
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>1048576){abort();deny();}chunks.push(value);}}finally{controller.signal.removeEventListener('abort',abort);reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const e=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!safeObject(e)||Object.keys(e).some(k=>!['success','errors','messages','result','result_info'].includes(k))||(Object.hasOwn(e,'result_info')&&!(request.method==='GET'&&[BASE+'/d1/database',BASE+'/workers/scripts',BASE+'/workers/durable_objects/namespaces'].includes(request.url)))||e.success!==true||!Array.isArray(e.errors)||e.errors.length!==0||!Array.isArray(e.messages)||!Object.hasOwn(e,'result'))deny();
  return e;
 })()]);}catch{deny();}finally{clearTimeout(timer);controller.abort();}
}
function emptyList(e){
 if(!Array.isArray(e.result)||e.result.length!==0)deny();
 const p=e.result_info;if(p!==undefined){if(!safeObject(p)||Object.keys(p).some(k=>!['page','per_page','count','total_count','total_pages','cursor','next_cursor'].includes(k))||(p.page!==undefined&&p.page!==1)||(p.per_page!==undefined&&(!Number.isSafeInteger(p.per_page)||p.per_page<1)))deny();for(const k of ['count','total_count'])if(p[k]!==undefined&&p[k]!==0)deny();if(p.total_pages!==undefined&&p.total_pages!==0&&p.total_pages!==1)deny();for(const k of ['cursor','next_cursor'])if(p[k]!==undefined&&p[k]!==null&&p[k]!=='')deny();}
}
export async function provisionFixedPilot({plan,freeObservation,token,fetchImpl=globalThis.fetch,journal,now=Date.now,timeoutMs=10000}={}){
 let stage='validation',writeAttempts=0;const inventory=[];
 const result=(status)=>({status,stage,writeAttempts,inventory:structuredClone(inventory),retryAllowed:false,sqlExecuted:false,productionTouched:false,scaffoldSha256:SCAFFOLD_SHA256,freeObservationOnly:true,zeroCostGuarantee:false,allPublicRoutingVerified:false,namespaceStorageBackendVerified:false,migrationAuthorized:false});
 try{
  const p=structuredClone(plan),observation=structuredClone(freeObservation);validatePlan(p);
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{20,256}$/.test(token)||typeof fetchImpl!=='function'||typeof now!=='function'||!journal||typeof journal.begin!=='function'||typeof journal.record!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)deny();
  const startedAtMs=now();if(!Number.isSafeInteger(startedAtMs)||startedAtMs<0)deny();validateObservation(observation,startedAtMs);
  const options={token,fetchImpl,timeoutMs};
  stage='reserve-single-run';
  // CLI supplies exclusive/fsynced local journal plus protected cross-run gate.
  // Contract is trusted dependency, NOT proof manufactured by this function.
  if(await journal.begin({planId:p.planId,accountId:ACCOUNT,startedAtMs,expiresAtMs:startedAtMs+86400000,scaffoldSha256:SCAFFOLD_SHA256})!==true)deny();
  stage='empty-account-preflight';
  for(const url of [BASE+'/d1/database',BASE+'/workers/scripts',BASE+'/workers/durable_objects/namespaces'])emptyList(await api({url,method:'GET'},options));
  async function write(name,request,parse){
   stage=name;const time=now();if(!Number.isSafeInteger(time)||time<startedAtMs)deny();validateObservation(observation,time);
   if(await journal.record({phase:'before-write',operation:name,writeAttempts:writeAttempts+1,inventory:structuredClone(inventory)})!==true)deny();
   const afterJournal=now();if(!Number.isSafeInteger(afterJournal)||afterJournal<time)deny();validateObservation(observation,afterJournal);
   // Conservatively uncertain from this point, even if transport later errors.
   writeAttempts++;
   const response=await api(request,options);parse(response);
   if(await journal.record({phase:'write-acknowledged',operation:name,writeAttempts,inventory:structuredClone(inventory)})!==true)deny();
   return response;
  }
  inventory.push({kind:'d1',name:DATABASE,acknowledged:false});
  const receipt=await write('create-d1',buildFixedCreateD1Request(),e=>{
   buildFixedWorkerUploadFromReceipt(e);inventory[0]={kind:'d1',name:DATABASE,uuid:e.result.uuid,acknowledged:true};
  });
  // Name/class are retained before PUT: a lost ACK may still create Worker + DO.
  inventory.push({kind:'worker',name:WORKER,acknowledged:false},{kind:'durable-object-namespace',className:'SyntheticClaimRegistry',acknowledged:false});
  await write('upload-deny-all-worker',buildFixedWorkerUploadFromReceipt(receipt),e=>{
   if(!safeObject(e.result)||e.result.id!==WORKER)deny();inventory[1].acknowledged=true;
  });
  await write('disable-public-urls',buildFixedDisablePublicEndpointsRequest(),e=>{
   if(!safeObject(e.result)||e.result.enabled!==false||e.result.previews_enabled!==false)deny();
  });
  stage='verify-public-url-disabled';const subdomain=await api({url:SCRIPT+'/subdomain',method:'GET'},options);
  if(!safeObject(subdomain.result)||subdomain.result.enabled!==false||subdomain.result.previews_enabled!==false)deny();
  stage='verify-namespace-binding';const settings=(await api({url:SCRIPT+'/settings',method:'GET'},options)).result;
  if(!safeObject(settings)||!Array.isArray(settings.bindings)||settings.bindings.length!==2)deny();
  const db=settings.bindings.find(b=>b?.type==='d1'),ns=settings.bindings.find(b=>b?.type==='durable_object_namespace');
  const dbId=safeObject(db)&&Object.hasOwn(db,'database_id')?db.database_id:db?.id;
  if(!safeObject(db)||Object.keys(db).some(k=>!['type','name','id','database_id'].includes(k))||db.name!=='TARGET'||dbId!==receipt.result.uuid||
     (Object.hasOwn(db,'id')&&db.id!==receipt.result.uuid)||(Object.hasOwn(db,'database_id')&&db.database_id!==receipt.result.uuid)||!ns||ns.name!=='REGISTRY'||ns.class_name!=='SyntheticClaimRegistry'||typeof ns.namespace_id!=='string'||!/^[a-f0-9]{32}$/.test(ns.namespace_id)||(ns.script_name!==undefined&&ns.script_name!==WORKER))deny();
  inventory[2]={...inventory[2],uuid:ns.namespace_id,acknowledged:true};
  stage='record-completion';
  if(await journal.record({phase:'verified-deny-all',inventory:structuredClone(inventory),workersDevEnabled:false,previewsEnabled:false})!==true)deny();
  stage='completed';return {...result('provisioned-deny-all'),workersDevEnabled:false,previewsEnabled:false,expiresAtMs:startedAtMs+86400000};
 }catch{
  const summary=result(writeAttempts>0?'unknown-stop':'blocked-before-write');
  // Do not attempt cleanup, rollback, retry, another write or journal recovery.
  return summary;
 }
}
