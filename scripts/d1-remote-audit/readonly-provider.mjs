// Read-only pinned metadata provider. No invocation, provisioning, SQL or retries.
// Calling this function with the default fetch is a real read and needs operator scope.
export const PRODUCTION_ACCOUNT_ID='09d455fa1cf988b0d9db89987b73eaff';
export const PRODUCTION_DATABASE_UUID='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fields=['accountId','databaseUuid','databaseName','workerName','deploymentId','versionId','registryNamespaceId','registryClassName'];
const MAX_BYTES=1048576;
function deny(){throw Error('READONLY_PROVIDER_DENIED');}
function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function keysOnly(v,required,optional=[]){return object(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));}
function validate(m){
 if(!object(m)||!fields.every(k=>typeof m[k]==='string')||!/^[a-f0-9]{32}$/.test(m.accountId)||m.accountId===PRODUCTION_ACCOUNT_ID||
    !uuid.test(m.databaseUuid)||m.databaseUuid===PRODUCTION_DATABASE_UUID||!/^maono_synthetic_rehearsal_[a-z0-9_]{1,80}$/.test(m.databaseName)||
    !/^maono-synthetic-rehearsal-[a-z0-9-]{1,40}$/.test(m.workerName)||!uuid.test(m.deploymentId)||!uuid.test(m.versionId)||
    !/^[a-f0-9]{32}$/.test(m.registryNamespaceId)||m.registryClassName!=='SyntheticClaimRegistry')deny();
}
async function jsonGet(url,{token,fetchImpl,timeoutMs}){
 const controller=new AbortController();let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('READONLY_PROVIDER_DENIED'));},timeoutMs);});
 try {
  return await Promise.race([timeout,(async()=>{
   const response=await fetchImpl(url,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});
   if(!response||response.status!==200||response.redirected||(response.url&&response.url!==url)||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')||!response.body)deny();
   const size=response.headers.get('content-length');if(size!==null&&(!/^\d+$/.test(size)||Number(size)>MAX_BYTES))deny();
   const reader=response.body.getReader();const chunks=[];let total=0;
   const cancelRead=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancelRead,{once:true});
   try {for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_BYTES){void reader.cancel().catch(()=>{});deny();}chunks.push(value);}}
   finally{controller.signal.removeEventListener('abort',cancelRead);reader.releaseLock();}
   const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   // Pinned GET endpoints are not paginated. Never interpret a partial list.
   if(!object(envelope)||envelope.success!==true||!Array.isArray(envelope.errors)||envelope.errors.length!==0||
      !Array.isArray(envelope.messages)||!object(envelope.result)||Object.hasOwn(envelope,'result_info'))deny();
   return envelope.result;
  })()]);
 }catch{deny();}finally{clearTimeout(timer);controller.abort();}
}
export async function collectReadonlyPinnedMetadata({manifest,token,fetchImpl=globalThis.fetch,timeoutMs=10000,now=Date.now}){
 try {
  validate(manifest);const m=Object.fromEntries(fields.map(k=>[k,manifest[k]]));
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{20,256}$/.test(token)||typeof fetchImpl!=='function'||typeof now!=='function'||
     !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)deny();
  const startedAtMs=now();if(!Number.isSafeInteger(startedAtMs)||startedAtMs<0)deny();
  const accountBase='https://api.cloudflare.com/client/v4/accounts/'+m.accountId;
  const scriptBase=accountBase+'/workers/scripts/'+m.workerName;
  const options={token,fetchImpl,timeoutMs};
  const database=await jsonGet(accountBase+'/d1/database/'+m.databaseUuid,options);
  if(database.uuid!==m.databaseUuid||database.name!==m.databaseName)deny();
  const deployment=await jsonGet(scriptBase+'/deployments/'+m.deploymentId,options);
  if(deployment.id!==m.deploymentId||deployment.strategy!=='percentage'||!Array.isArray(deployment.versions)||deployment.versions.length!==1||
     deployment.versions[0]?.version_id!==m.versionId||deployment.versions[0]?.percentage!==100)deny();
  const version=await jsonGet(scriptBase+'/versions/'+m.versionId,options);
  if(version.id!==m.versionId||!object(version.resources)||!Array.isArray(version.resources.bindings)||version.resources.bindings.length!==2)deny();
  const bindings=version.resources.bindings;
  const d1=bindings.find(b=>b?.type==='d1'),registry=bindings.find(b=>b?.type==='durable_object_namespace');
  if(!keysOnly(d1,['type','name','id'])||d1.name!=='TARGET'||d1.id!==m.databaseUuid||
     !keysOnly(registry,['type','name','namespace_id','class_name'],['script_name'])||registry.name!=='REGISTRY'||
     registry.namespace_id!==m.registryNamespaceId||registry.class_name!==m.registryClassName||
     (Object.hasOwn(registry,'script_name')&&registry.script_name!==m.workerName))deny();
  const collectedAtMs=now();if(!Number.isSafeInteger(collectedAtMs)||collectedAtMs<startedAtMs)deny();
  const observedAtMs=startedAtMs;
  // Deliberately exclude raw responses, script etag, authors, annotations, token and errors.
  return Object.freeze({readOnly:true,pinnedMetadataMatched:true,observedAtMs,collectedAtMs,
   accountId:m.accountId,database:{uuid:database.uuid,name:database.name},workerName:m.workerName,
   deployment:{id:deployment.id,versionId:m.versionId,percentage:100},
   bindings:[{type:'d1',name:'TARGET',id:d1.id},{type:'durable_object_namespace',name:'REGISTRY',namespace_id:registry.namespace_id,class_name:registry.class_name,script_name:m.workerName}],
   activeDeploymentVerified:false,deploymentPropagationVerified:false,versionOverrideProtectionVerified:false,bundleProvenanceVerified:false,liveInvocationBindingVerified:false,
   namespaceStorageIdentityVerified:false,tokenScopeVerified:false,operationalAuthorization:false});
 }catch{deny();}
}
